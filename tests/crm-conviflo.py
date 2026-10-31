"""Verified ConviFlo-shaped synthetic fixture against guarded local Next/Supabase only."""
import hashlib
import hmac
import json
import os
import pathlib
import time
import urllib.error
import urllib.request
import uuid

root = pathlib.Path(__file__).resolve().parents[1]
cfg = json.loads(pathlib.Path('/tmp/qg-test-config.json').read_text())
assert cfg['API_URL'] == 'http://127.0.0.1:56421'
base = os.environ.get('QG_TEST_BASE','http://localhost:3102')
assert base in ('http://localhost:3102','http://127.0.0.1:3102')
env = dict(line.split('=',1) for line in (root/'.env.local').read_text().splitlines() if '=' in line and not line.startswith('#'))
secret = env['CONVIFLO_WEBHOOK_SECRET'].strip().strip('"\'')
assert len(secret) >= 32

def send(payload, signed=True):
    raw = json.dumps(payload, separators=(',',':'),ensure_ascii=False).encode()
    signature = hmac.new(secret.encode(),raw,hashlib.sha256).hexdigest() if signed else '0'*64
    req = urllib.request.Request(base+'/api/intake/conviflo',data=raw,method='POST',
        headers={'Content-Type':'application/json','X-Conviflow-Signature':signature})
    try:
        with urllib.request.urlopen(req,timeout=20) as response:
            return response.status,json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code,json.loads(error.read())

def rows(table, query):
    req = urllib.request.Request(cfg['API_URL']+'/rest/v1/'+table+'?'+query,
        headers={'apikey':cfg['SERVICE_ROLE_KEY'],'Authorization':'Bearer '+cfg['SERVICE_ROLE_KEY']})
    with urllib.request.urlopen(req,timeout=10) as response: return json.loads(response.read())

partial = json.loads((root/'tests/fixtures/conviflo-partial.json').read_text())
completed = json.loads((root/'tests/fixtures/conviflo-completed.json').read_text())
completed['responseId'] = str(uuid.uuid4())
assert send(completed,False)[0] == 401
assert send(partial) == (200,{'ignored':True})
missing = json.loads(json.dumps(completed))
missing['answers'].pop('address')
missing['responseId'] = str(uuid.uuid4())
status,result = send(missing)
assert status == 201,(status,result)
addressless = rows('leads','id=eq.'+result['lead_id'])[0]
assert addressless['address'] is None and addressless['answers']['address_missing'] is True
unknown = {**completed,'formId':str(uuid.uuid4())}
assert send(unknown)[0] == 422
status,result = send(completed)
assert status == 201,(status,result)
assert send(completed)[0] == 200
assert send({**completed,'leadValue':61})[0] == 409
lead = rows('leads','id=eq.'+result['lead_id'])[0]
assert lead['address'] == '123 TEST ONLY Lane, Test Unit 2, Austin', lead['address']
assert lead['answers']['address_needs_review'] is True
assert lead['answers']['address']['street'] == '123 TEST ONLY Lane'
assert lead['estimated_value'] == completed['leadValue']
assert lead['attribution']['first_touch']['utm_source'] == 'google'
assert lead['attribution']['first_touch']['utm_campaign'] == '800001'
assert 'meta_campaign_id' not in lead['attribution']['first_touch']
# Combine the two captured synthetic form variants: Meta UTMs were observed before
# address was added; the address object was observed in the later Google visit.
meta_variant = json.loads(json.dumps(completed))
meta_variant['responseId'] = str(uuid.uuid4())
meta_variant['meta']['utm'] = {'utm_source':'meta','utm_medium':'paid_social',
    'utm_campaign':'900001','utm_term':'900002','utm_content':'900003'}
meta_status, meta_result = send(meta_variant)
assert meta_status == 201, (meta_status,meta_result)
meta_lead = rows('leads','id=eq.'+meta_result['lead_id'])[0]
assert meta_lead['attribution']['first_touch']['meta_campaign_id'] == '900001'
assert meta_lead['attribution']['first_touch']['meta_adset_id'] == '900002'
assert meta_lead['attribution']['first_touch']['meta_ad_id'] == '900003'
assert meta_lead['attribution']['first_touch']['creative_id'] == 'AI video: leaf cleanup'
assert meta_lead['attribution']['first_touch']['creative_type'] == 'ai'
second_form = {**completed,'formId':'11111111-1111-4111-8111-111111111111'}
second_status,second_result = send(second_form)
assert second_status == 201,(second_status,second_result)
assert second_result['lead_id'] != result['lead_id']
assert send(second_form)[0] == 200
second_lead = rows('leads','id=eq.'+second_result['lead_id'])[0]
assert second_lead['external_submission_id'] != lead['external_submission_id']
assert second_lead['answers']['conviflo_response_id'] == lead['answers']['conviflo_response_id']
end = time.monotonic()+20
while time.monotonic() < end:
    alerts = rows('staff_alerts','event_id=eq.'+result['event_id'])
    if len(alerts)==4 and all(a['state'] not in ('pending','sending') for a in alerts):break
    time.sleep(.25)
assert len(alerts)==4 and {a['channel'] for a in alerts}=={'voice','sms'}, alerts
assert all(a['attempts']==1 for a in alerts), alerts
print('PASS: signed verified ConviFlo completed/partial shape, exact address fields, form allowlist, idempotency, source-aware attribution, four local alert intents')
