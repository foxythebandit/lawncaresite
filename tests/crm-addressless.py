"""External inquiry without address -> staff measurement, add-ons and private booking notes."""
import json,pathlib,uuid,urllib.request,io
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
CFG=json.loads(pathlib.Path('/tmp/qg-test-config.json').read_text())
assert CFG['API_URL']=='http://127.0.0.1:56421'
BASE='http://localhost:3100'
def db(path):
 with urllib.request.urlopen(urllib.request.Request(CFG['API_URL']+'/rest/v1/'+path,headers={'apikey':CFG['SECRET_KEY'],'Authorization':'Bearer '+CFG['SERVICE_ROLE_KEY']})) as r:return json.load(r)
payload=json.loads((ROOT/'tests/fixtures/canonical-intake.json').read_text());payload['submission_id']=str(uuid.uuid4());payload['contact'].pop('address');payload['services']=[]
pathlib.Path('/tmp/qg-sms-mode').write_text('reject')
req=urllib.request.Request(BASE+'/api/intake',data=json.dumps(payload).encode(),headers={'Authorization':'Bearer local-test-only-secret-0000000000000000','Content-Type':'application/json'})
with urllib.request.urlopen(req) as r:lid=json.load(r)['lead_id']
png=io.BytesIO();Image.new('RGB',(256,256),'#648c60').save(png,format='PNG')
def route_external(route):
 url=route.request.url
 if url.startswith((BASE,CFG['API_URL'])):route.continue_()
 elif 'nominatim.openstreetmap.org/search' in url:route.fulfill(json=[{'lat':'30.3049','lon':'-97.7184','display_name':'807 E 47th St, Austin, TX'}])
 elif 'arcgisonline.com' in url:route.fulfill(body=png.getvalue(),content_type='image/png')
 else:route.abort()
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']);c=b.new_context(viewport={'width':1440,'height':1000});c.route('**/*',route_external);page=c.new_page()
 page.goto(BASE+'/admin/login?next=/admin/leads/'+lid);page.locator('input[name=email]').fill('staff@example.test');page.locator('input[name=password]').fill('Local-test-password-123!');page.get_by_role('button',name='Sign in').click();page.wait_for_url(BASE+'/admin/leads/'+lid);page.wait_for_load_state('networkidle')
 page.get_by_label('Your street address').fill('807 E 47th St, Austin, TX');page.get_by_role('option').first.click();page.get_by_role('button',name='Find my property',exact=False).click()
 page.get_by_text('Click around your lawn to place points',exact=True).wait_for(timeout=20000)
 page.get_by_role('button',name="Can't see your lawn clearly?",exact=False).click();page.get_by_placeholder('e.g. 3500').fill('3500');page.get_by_role('button',name='Get quote →',exact=True).click()
 page.get_by_role('button',name='Maintenance',exact=False).click();page.get_by_label('Include maintenance interest with my booking request').check()
 page.get_by_label('Quote notes').fill('Private staff margin note')
 page.get_by_role('button',name='Confirm quote',exact=True).click();page.get_by_role('status').filter(has_text='Quote confirmed.').wait_for()
 saved=db('leads?id=eq.'+lid)[0];assert saved['address'] is None and saved['quote_draft']['address']
 page.get_by_role('button',name='Create booking request',exact=True).click();page.get_by_text('Booking stages (1)',exact=True).wait_for()
 row=db('bookings?lead_id=eq.'+lid)[0]
 assert row['address']==saved['quote_draft']['address'] and row['notes']=='Private staff margin note' and row['customer_notes'] is None
 assert row['addon_interest']['maintenance']['interested'] and row['last_mow']==saved['quote_draft']['lastMow'] and row['overgrowth_fee']==saved['quote_draft']['overgrowthFee']
 assert 'maintenance' in db('leads?id=eq.'+lid)[0]['services']
 c.close();b.close()
print('PASS: addressless external lead, staff-entered address, saved add-ons/last mow/overgrowth, private notes, explicit booking')
