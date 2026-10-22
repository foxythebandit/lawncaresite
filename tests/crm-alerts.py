"""Disposable local HTTP/DB alert test. Requires the guarded Next test server on 3102."""
import json
import os
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

cfg = json.loads(pathlib.Path('/tmp/qg-test-config.json').read_text())
assert cfg['API_URL'] == 'http://127.0.0.1:56421'
base = os.environ.get('QG_TEST_BASE', 'http://localhost:3102')
assert base in ('http://localhost:3102', 'http://127.0.0.1:3102')
mode = pathlib.Path(os.environ.get('QG_SMS_MODE', '/tmp/qg-revamp-sms-mode'))
log = pathlib.Path(os.environ.get('QG_SMS_LOG', '/tmp/qg-revamp-sms-log'))
assert str(mode).startswith('/tmp/qg-revamp-') and str(log).startswith('/tmp/qg-revamp-')
root = pathlib.Path(__file__).resolve().parents[1]

def request(url, data=None, headers=None, method=None):
    body = json.dumps(data).encode() if data is not None else (b'' if method == 'POST' else None)
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={'Content-Type':'application/json', **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.status, json.loads(response.read() or 'null')
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or 'null')

service_headers = {'apikey':cfg['SERVICE_ROLE_KEY'], 'Authorization':'Bearer '+cfg['SERVICE_ROLE_KEY']}

def rows(table, filters):
    code, result = request(cfg['API_URL']+'/rest/v1/'+table+'?'+filters, headers=service_headers)
    assert code == 200, (code, result)
    return result

def alerts(event_id):
    return rows('staff_alerts', 'event_id=eq.'+event_id+'&order=recipient,channel')

def wait_alerts(event_id, count=4):
    end = time.monotonic()+25
    while time.monotonic() < end:
        found = alerts(event_id)
        if len(found) == count and all(row['state'] not in ('pending','sending') for row in found):
            return found
        time.sleep(.25)
    raise AssertionError(alerts(event_id))

def intake(payload):
    return request(base+'/api/intake', payload,
                   {'Authorization':'Bearer local-test-only-secret-0000000000000000'})

fixture = json.loads((root/'tests/fixtures/canonical-intake.json').read_text())
fixture['submission_id'] = 'alert-'+uuid.uuid4().hex
fixture['contact']['address'] = '123 Long Drive, '+('North Valley, '*13)+'Texas'
fixture['answers'] = {'gate':'Side access', 'pets':'Dog in backyard', 'notes':'Call before arriving'}
fixture['attribution'] = {'utm_source':'meta','utm_medium':'paid_social',
                          'utm_campaign':'120247992042830144','utm_term':'120247992042830145',
                          'utm_content':'120247992042830146','creative_id':'ai-image-test','creative_type':'ai'}
assert request(base+'/api/intake', fixture)[0] == 401
assert intake({**fixture,'contact':{**fixture['contact'],'address':''}})[0] == 400
mode.write_text('accept')
start = len(log.read_text().splitlines()) if log.exists() else 0
code, result = intake(fixture)
assert code == 201, (code,result)
event, lead = result['event_id'], result['lead_id']
accepted = wait_alerts(event)
assert len(accepted) == 4 and all(row['state'] == 'accepted' and row['attempts'] == 1 for row in accepted), accepted
assert {row['channel'] for row in accepted} == {'voice','sms'}
assert len({row['recipient'] for row in accepted}) == 2
assert all(row['provider_sid'].startswith('CA' if row['channel']=='voice' else 'SM') for row in accepted)
sent = [json.loads(line) for line in log.read_text().splitlines()[start:]]
assert sorted(row['channel'] for row in sent if row['method']=='POST') == ['sms','sms','voice','voice'], sent
for row in sent:
    if row['channel'] != 'sms' or row['method'] != 'POST': continue
    body = urllib.parse.parse_qs(row['body'])['Body'][0]
    for required in (fixture['contact']['name'], fixture['contact']['phone'],
                     fixture['contact']['address'], 'Mowing', 'Mulch', 'Side access',
                     '120247992042830145', '120247992042830146', 'ai-image-test', lead):
        assert required in body, required
assert intake(fixture)[0] == 200
time.sleep(.5)
assert all(row['attempts'] == 1 for row in alerts(event))
saved = rows('leads','id=eq.'+lead)[0]
assert saved['attribution']['first_touch']['meta_adset_id'] == '120247992042830145'

max_fixture = {**fixture, 'submission_id':'alert-'+uuid.uuid4().hex,
    'contact':{**fixture['contact'],'name':'N'*150,'address':'A'*500},
    'services':['Service '+str(i)+' '+('x'*80) for i in range(20)],
    'attribution':{'utm_source':'meta','utm_campaign':'C'*150,'meta_adset_id':'S'*150,
      'meta_ad_id':'D'*150,'creative_id':'I'*150,'creative_type':'ai',
      'google_campaign_id':'G'*150,'google_adgroup_id':'H'*150,'google_ad_id':'J'*150}}
code, max_result = intake(max_fixture)
assert code == 201,(code,max_result)
wait_alerts(max_result['event_id'])
max_bodies = [urllib.parse.parse_qs(json.loads(line)['body'])['Body'][0]
    for line in log.read_text().splitlines() if json.loads(line).get('channel')=='sms'
    and max_result['lead_id'] in json.loads(line)['body']]
assert len(max_bodies)==2
assert all(len(body)<=1600 and 'N'*150 in body and 'A'*500 in body
           and fixture['contact']['phone'] in body for body in max_bodies)

mode.write_text('reject-voice')
other = {**fixture,'submission_id':'alert-'+uuid.uuid4().hex}
code, result = intake(other)
assert code == 201
mixed = wait_alerts(result['event_id'])
assert all(row['state'] == ('failed' if row['channel']=='voice' else 'accepted') for row in mixed), mixed

mode.write_text('timeout-voice')
unknown_payload = {**fixture,'submission_id':'alert-'+uuid.uuid4().hex}
code, result = intake(unknown_payload)
assert code == 201
unknown_event = result['event_id']
unknown = wait_alerts(unknown_event)
assert all(row['state'] == ('unknown' if row['channel']=='voice' else 'accepted') for row in unknown), unknown
assert intake(unknown_payload)[0] == 200

# Create a committed outbox without the request callback, then recover it explicitly.
mode.write_text('accept')
pending_id = 'alert-'+uuid.uuid4().hex
code, pending = request(cfg['API_URL']+'/rest/v1/rpc/record_intake_v2', {
    'p_source':'test-recovery','p_submission':pending_id,'p_hash':'fixed-hash',
    'p_lead':{'phone':'+15125559999','name':'Recovery Test','address':'99 Local Road','services':['Lawn care']},
    'p_booking':None,'p_existing_lead':None,
    'p_recipients':[row['recipient'] for row in accepted if row['channel']=='sms']}, service_headers)
assert code == 200, (code,pending)
assert all(row['state']=='pending' for row in alerts(pending['event_id']))
assert request(base+'/api/staff-alerts/recover', method='POST')[0] == 401
recovery_secret = next(line.split('=',1)[1].strip() for line in (root/'.env.local').read_text().splitlines()
                       if line.startswith('ALERT_RECOVERY_SECRET='))
assert len(recovery_secret) >= 32
code, recovered = request(base+'/api/staff-alerts/recover', method='POST',
                          headers={'Authorization':'Bearer '+recovery_secret})
assert code == 200, (code,recovered)
assert all(row['state']=='accepted' for row in wait_alerts(pending['event_id']))
assert all(row['attempts']==1 for row in alerts(unknown_event))
print('PASS: four durable voice/SMS intents, complete SMS and IDs, replay, channel isolation, unknown no-resend, authenticated recovery')
