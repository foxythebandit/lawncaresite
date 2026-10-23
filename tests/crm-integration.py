"""Real local Supabase + running Next app. External Twilio is intercepted by twilio-mock.cjs.
Requires /tmp/qg-test-config.json from the disposable setup described in docs/crm-setup.md.
"""
import json, uuid, pathlib, urllib.request, urllib.error, urllib.parse, concurrent.futures, time
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]
CFG = json.loads(pathlib.Path('/tmp/qg-test-config.json').read_text())
assert CFG['API_URL'] == 'http://127.0.0.1:56421', 'Only disposable local databases are allowed'
BASE = __import__('os').environ.get('QG_TEST_BASE', 'http://localhost:3102')
assert BASE in ('http://localhost:3102','http://127.0.0.1:3102'), 'Only revamp test app allowed'
SECRET = 'local-test-only-secret-0000000000000000'

def request(url, data=None, headers=None, method=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers={'Content-Type':'application/json', **(headers or {})}, method=method)
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or 'null')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or 'null')

def db(path):
    code, result = request(CFG['API_URL']+'/rest/v1/'+path, headers={'apikey':CFG['SECRET_KEY'], 'Authorization':'Bearer '+CFG['SERVICE_ROLE_KEY']})
    assert code == 200, (code,result)
    return result

def wait_alerts(event_id):
    end=time.monotonic()+35
    while time.monotonic()<end:
        found=db('staff_alerts?event_id=eq.'+event_id+'&order=recipient,channel')
        if len(found)==4 and all(a['state'] not in ('pending','sending') for a in found):return found
        time.sleep(.25)
    raise AssertionError(found)

def intake(payload, auth=True):
    return request(BASE+'/api/intake', payload, {'Authorization':'Bearer '+SECRET} if auth else {})

fixture=json.loads((ROOT/'tests/fixtures/canonical-intake.json').read_text())
fixture['submission_id']='test-'+str(uuid.uuid4())
assert intake(fixture, False)[0] == 401
bad={**fixture,'contact':{'phone':'invalid'}}
assert intake(bad)[0] == 400
pathlib.Path(__import__('os').environ.get('QG_SMS_MODE','/tmp/qg-revamp-sms-mode')).write_text('reject')
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    results=list(pool.map(lambda _: intake(fixture), range(5)))
assert sorted(code for code,_ in results)==[200,200,200,200,201], results
lead=results[0][1]['lead_id']; event=results[0][1]['event_id']
assert len({r['lead_id'] for _,r in results})==1
assert intake(dict(reversed(list(fixture.items()))))[0]==200
assert intake({**fixture,'timing':'Different'})[0]==409
assert len(db('leads?id=eq.'+lead))==1
alerts=wait_alerts(event)
sms_alerts=[a for a in alerts if a['channel']=='sms']
alert_id=sms_alerts[0]['id']
other_alert_id=sms_alerts[1]['id']
assert len(alerts)==4 and len(sms_alerts)==2 and all(a['state']=='failed' and a['attempts']==1 for a in alerts), alerts
saved=db('leads?id=eq.'+lead)[0]
assert saved['attribution']['first_touch']['creative_id']=='test-creative'
assert saved['score']==90 and saved['estimated_value']==250
# Actual customer Auth session must not read staff data or other customers' bookings.
code, login=request(CFG['API_URL']+'/auth/v1/token?grant_type=password', {'email':'customer@example.test','password':'Local-test-password-123!'}, {'apikey':CFG['PUBLISHABLE_KEY']})
assert code==200, login
customer_headers={'apikey':CFG['PUBLISHABLE_KEY'],'Authorization':'Bearer '+login['access_token']}
code,rows=request(CFG['API_URL']+'/rest/v1/leads?select=*',headers=customer_headers)
assert (code==200 and rows==[]) or code==403
for column in ['*', 'notes', 'customer_notes', 'attribution', 'lead_id']:
    assert request(CFG['API_URL']+'/rest/v1/bookings?select='+column, headers=customer_headers)[0] == 403, column
assert request(CFG['API_URL']+'/rest/v1/rpc/record_intake', {'p_source':'evil','p_submission':'evil-test','p_hash':'x','p_lead':{}}, customer_headers)[0] in [401,403,404]

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    context=browser.new_context(viewport={'width':1440,'height':1000})
    # Never contact ad platforms or third-party maps during deterministic tests.
    context.route('**/*', lambda route: route.continue_() if urllib.parse.urlsplit(route.request.url).netloc in (urllib.parse.urlsplit(BASE).netloc,urllib.parse.urlsplit(CFG['API_URL']).netloc) else route.abort())
    page=context.new_page()
    page.goto(BASE+'/admin/leads/'+lead)
    page.wait_for_load_state('networkidle')
    assert '/admin/login?next=' in page.url
    assert page.locator('input[name=next]').input_value()=='/admin/leads/'+lead
    page.locator('input[name=email]').fill('customer@example.test')
    page.locator('input[name=password]').fill('Local-test-password-123!')
    page.get_by_role('button',name='Sign in').click()
    page.get_by_text('Staff sign-in unavailable or credentials invalid.').wait_for()
    page.locator('input[name=email]').fill('outsider@example.test')
    page.get_by_role('button',name='Sign in').click()
    page.get_by_text('Staff sign-in unavailable or credentials invalid.').wait_for()
    page.locator('input[name=email]').fill('staff@example.test')
    page.locator('input[name=password]').fill('Local-test-password-123!')
    page.get_by_role('button',name='Sign in').click()
    page.wait_for_url(BASE+'/admin/leads/'+lead)
    page.wait_for_load_state('networkidle')
    assert page.get_by_role('heading',name='Test Lawn Owner').is_visible()
    assert page.locator('input').filter().count()>0
    assert page.get_by_role('link', name='Call 512-555-0123').get_attribute('href') == 'tel:+15125550123'
    assert page.locator('script[src*="googletagmanager"], script#meta-pixel').count()==0
    page.get_by_label('Quote notes').fill('Gate on the left. Draft test.')
    captured=[]
    page.on('request', lambda r: captured.append({'headers':r.all_headers(), 'body':r.post_data}) if r.method=='POST' and r.headers.get('next-action') else None)
    page.get_by_role('button',name='Save',exact=True).click()
    page.get_by_role('status').filter(has_text='Price saved.').wait_for()
    assert db('leads?id=eq.'+lead)[0]['quote_draft']['notes']=='Gate on the left. Draft test.'
    before=len(db('intake_events?lead_id=eq.'+lead))
    page.reload(); page.wait_for_load_state('networkidle')
    assert page.get_by_label('Quote notes').input_value()=='Gate on the left. Draft test.'
    assert len(db('intake_events?lead_id=eq.'+lead))==before
    assert db('staff_alerts?id=eq.'+alert_id)[0]['attempts']==1
    # Replay a captured real Server Action at the public root, without session cookies.
    action=captured[0]
    anon=browser.new_context()
    response=anon.request.post(BASE+'/',data=action['body'],headers={'Next-Action':action['headers']['next-action'],'Content-Type':action['headers']['content-type'],'Origin':BASE})
    assert 'admin/login' in (response.headers.get('x-action-redirect','')+response.text()), (response.status,response.text()[:400])
    anon.close()
    # Provider retry is explicit; acceptance is distinguished from delivery.
    pathlib.Path(__import__('os').environ.get('QG_SMS_MODE','/tmp/qg-revamp-sms-mode')).write_text('accept')
    page.get_by_text('Staff alerts',exact=True).click()
    alert_card=page.locator('details.crm-details').filter(has_text='Staff alerts').locator('div').filter(has_text=sms_alerts[0]['recipient']+' · sms ·')
    alert_card.get_by_role('button',name='Retry staff alert').click()
    page.get_by_role('button',name='Check delivery').wait_for()
    assert db('staff_alerts?id=eq.'+alert_id)[0]['state']=='accepted'
    page.get_by_role('button',name='Check delivery').click()
    page.get_by_text('delivered (delivered)',exact=False).wait_for()
    assert db('staff_alerts?id=eq.'+alert_id)[0]['state']=='delivered'
    page.reload();page.wait_for_load_state('networkidle')
    assert db('staff_alerts?id=eq.'+alert_id)[0]['attempts']==2
    other_alert=db('staff_alerts?id=eq.'+other_alert_id)[0]
    assert other_alert['state']=='failed' and other_alert['attempts']==1
    page.get_by_text('Staff alerts',exact=True).click()
    sibling_card=page.locator('details.crm-details').filter(has_text='Staff alerts').locator('div').filter(has_text=sms_alerts[1]['recipient']+' · sms ·')
    sibling_card.get_by_role('button',name='Retry staff alert').click()
    sibling_card.get_by_role('button',name='Check delivery').wait_for()
    assert db('staff_alerts?id=eq.'+other_alert_id)[0]['state']=='accepted'
    assert db('staff_alerts?id=eq.'+alert_id)[0]['state']=='delivered' and db('staff_alerts?id=eq.'+alert_id)[0]['attempts']==2
    assert intake(fixture)[0]==200
    sent_to=[]
    for entry in pathlib.Path(__import__('os').environ.get('QG_SMS_LOG','/tmp/qg-revamp-sms-log')).read_text().splitlines():
        item=json.loads(entry)
        if item['method']=='POST' and item.get('channel')=='sms':
            fields=urllib.parse.parse_qs(item['body'])
            if lead in fields['Body'][0]:sent_to.append(fields['To'][0])
    assert sorted(sent_to)==sorted([a['recipient'] for a in sms_alerts]*2),sent_to
    # Logout and safe return target.
    page.get_by_role('button',name='Sign out').click()
    page.wait_for_url('**/admin/login')
    page.goto(BASE+'/admin/login?next=//evil.example')
    assert page.locator('input[name=next]').input_value()=='/admin/leads'
    context.close();browser.close()
# An ambiguous provider failure must not be retried on duplicate webhook delivery.
pathlib.Path(__import__('os').environ.get('QG_SMS_MODE','/tmp/qg-revamp-sms-mode')).write_text('timeout')
other={**fixture,'submission_id':'test-'+str(uuid.uuid4())}
code,res=intake(other);assert code==201
assert intake(other)[0]==200
unknown_alerts=wait_alerts(res['event_id'])
assert len(unknown_alerts)==4 and all(a['state']=='unknown' and a['attempts']==1 for a in unknown_alerts),unknown_alerts
print('PASS: authenticated intake, validation, concurrent idempotency/conflict, persisted attribution, customer RLS, staff login/deep-link/logout, quote prefill/save/reload, unauthenticated action guard, SMS failure isolation/retry/acceptance/delivery/unknown handling')
