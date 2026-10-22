"""Customer payment display uses only authorized booking IDs and preserves legacy amounts."""
import base64, json, pathlib, uuid, urllib.request
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
CFG = json.loads(pathlib.Path('/tmp/qg-test-config.json').read_text())
assert CFG['API_URL'] == 'http://127.0.0.1:56421'
BASE = 'http://localhost:3102'
def request(path, data=None, auth=False):
    headers = {'apikey': CFG['PUBLISHABLE_KEY'] if auth else CFG['SERVICE_ROLE_KEY']}
    if not auth: headers['Authorization'] = 'Bearer ' + CFG['SERVICE_ROLE_KEY']
    if data is not None: headers.update({'Content-Type':'application/json','Prefer':'return=representation'})
    req = urllib.request.Request(CFG['API_URL'] + path, data=json.dumps(data).encode() if data is not None else None, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as response: return json.load(response)
marker = uuid.uuid4().hex[:8]
email = 'portal-'+marker+'@example.test'
request('/auth/v1/admin/users', {'email':email,'password':'Local-test-password-123!','email_confirm':True})
job = request('/rest/v1/bookings', {'name':'Portal payment '+marker,'email':email,
    'phone':'+15125550166','address':marker+' TEST ONLY Road','status':'completed',
    'completed_at':'2026-10-21T12:00:00Z','job_total':125.50,'amount_charged':60,
    'payment_method':'Cash','payment_link':'https://example.test/old-total'})[0]
request('/rest/v1/bookings', {'name':'Private other customer','email':'other@example.test','phone':'+15125550167',
    'address':marker+' PRIVATE ADDRESS','status':'completed','completed_at':'2026-10-21T12:00:00Z','job_total':999})
def pay(amount, booking_id=job['id']):
    request('/rest/v1/rpc/record_job_payment', {'p_booking_id':booking_id,'p_operation_id':str(uuid.uuid4()),
        'p_amount':amount,'p_paid_on':'2026-10-22','p_method':'Cash','p_provenance':'manual'})
pay(20)
partial_job = request('/rest/v1/bookings', {'name':'Partial portal '+marker,'email':email,
    'phone':'+15125550166','address':marker+' Partial Road','status':'completed',
    'completed_at':'2026-10-21T12:00:00Z','job_total':25,'payment_link':'https://example.test/partial-old-total'})[0]
pay(13.50, partial_job['id'])
request('/rest/v1/bookings', {'name':'Intro visit '+marker,'email':email,
    'phone':'+15125550166','address':marker+' Intro Road','status':'confirmed',
    'confirmed_date':'2026-11-01','price_per_visit':100,'first_visit_price':70})
session = request('/auth/v1/token?grant_type=password', {'email':email,'password':'Local-test-password-123!'}, True)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    context=browser.new_context()
    context.route('**/*',lambda route: route.continue_() if urlsplit(route.request.url).netloc in ('localhost:3102','127.0.0.1:56421') else route.abort())
    cookie='base64-'+base64.urlsafe_b64encode(json.dumps(session).encode()).decode().rstrip('=')
    context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'domain':'localhost','path':'/'}])
    page=context.new_page();page.goto(BASE+'/portal')
    page.get_by_text('$20.00 paid',exact=True).wait_for()
    assert page.get_by_text('$70.00',exact=False).is_visible()
    assert page.get_by_text('Please contact us to confirm the remaining balance.',exact=True).is_visible()
    assert page.get_by_text('$105.50 remaining',exact=False).count() == 0
    assert page.get_by_text('$11.50 remaining',exact=False).is_visible()
    assert page.locator('a[href="https://example.test/partial-old-total"]').count()==0
    assert page.get_by_text('Earlier amount recorded: $60.00',exact=False).is_visible()
    assert 'PRIVATE ADDRESS' not in page.inner_text('body')
    assert page.locator('a[href="https://example.test/old-total"]').count()==0
    pay(105.50);page.reload()
    page.get_by_text('$125.50 paid',exact=True).wait_for()
    assert page.get_by_text('Paid in full',exact=True).is_visible()
    assert page.locator('a[href="https://example.test/old-total"]').count()==0
    assert page.get_by_text('Earlier amount recorded: $60.00',exact=False).is_visible()
    browser.close()
print('PASS: customer payment totals, partial/full status, old full-price link suppressed, legacy record retained, other customer private')
