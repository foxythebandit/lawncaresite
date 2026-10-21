"""Public map phone gate and linked booking; real local database."""
import json, pathlib, uuid, urllib.request, urllib.parse, io
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
CFG=json.loads(pathlib.Path('/tmp/qg-test-config.json').read_text())
assert CFG['API_URL'].startswith('http://127.0.0.1:')
BASE='http://localhost:3100'
def db(path):
 req=urllib.request.Request(CFG['API_URL']+'/rest/v1/'+path,headers={'apikey':CFG['SECRET_KEY'],'Authorization':'Bearer '+CFG['SERVICE_ROLE_KEY']})
 with urllib.request.urlopen(req) as r:return json.load(r)
pathlib.Path('/tmp/qg-sms-mode').write_text('reject')
png=io.BytesIO();Image.new('RGB',(256,256),'#648c60').save(png,format='PNG')
def route_external(route):
 url=route.request.url
 if url.startswith((BASE,CFG['API_URL'])):route.continue_()
 elif 'nominatim.openstreetmap.org/search' in url:route.fulfill(json=[{'lat':'30.3049','lon':'-97.7184','display_name':'807 E 47th St, Austin, TX'}])
 elif 'arcgisonline.com' in url:route.fulfill(body=png.getvalue(),content_type='image/png')
 else:route.abort()
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader'])
 c=b.new_context(viewport={'width':1440,'height':1000});c.route('**/*',route_external);page=c.new_page()
 phone='+1512'+str(int(uuid.uuid4().hex[:8],16))[-7:].zfill(7)
 page.goto(BASE+'/?utm_source=meta&utm_campaign=map-first&meta_ad_id=test-ad');page.wait_for_load_state('networkidle')
 page.get_by_label('Your street address').fill('807 E 47th St, Austin, TX')
 page.get_by_role('button',name='Find my property',exact=False).click()
 page.get_by_text('Click around your lawn to place points',exact=True).wait_for(timeout=20000)
 page.get_by_role('button',name="Can't see your lawn clearly?",exact=False).click()
 page.get_by_placeholder('e.g. 3500').fill('3500');page.get_by_role('button',name='Get quote →',exact=True).click()
 gate=page.locator('.mapq-lead-form');gate.get_by_label('Phone number').fill(phone);gate.locator('input[type=checkbox]').check()
 gate.get_by_role('button',name='Unlock price',exact=False).click()
 page.get_by_role('button',name='Book this visit',exact=False).wait_for()
 lead=db('leads?phone=eq.'+urllib.parse.quote(phone))[0]
 assert lead['source']=='website-map' and lead['consent'] and lead['consented_at'] and lead['consent_version']=='quote-contact:1'
 assert db('bookings?lead_id=eq.'+lead['id'])==[]
 # A later tagged visit changes latest acquisition, but booking keeps the lead's original acquisition.
 page.evaluate("history.replaceState({}, '', '/?utm_source=google&utm_campaign=later')")
 page.get_by_role('button',name='Book this visit',exact=False).click()
 page.locator('#booking-name').fill('Map Booking Test');page.locator('#booking-email').fill('customer@example.test')
 assert page.locator('#booking-phone').input_value()==phone
 page.get_by_role('button',name='Request this visit',exact=False).click()
 page.get_by_role('heading',name='Request locked in.').wait_for()
 rows=db('bookings?lead_id=eq.'+lead['id']);assert len(rows)==1,rows
 assert rows[0]['status']=='pending' and rows[0]['utm_source']=='meta' and rows[0]['attribution']==lead['attribution']
 assert len(db('intake_events?lead_id=eq.'+lead['id']))==2
 # Actual customer session can read this booking, but never another customer's rows.
 req=urllib.request.Request(CFG['API_URL']+'/auth/v1/token?grant_type=password',data=json.dumps({'email':'customer@example.test','password':'Local-test-password-123!'}).encode(),headers={'apikey':CFG['PUBLISHABLE_KEY'],'Content-Type':'application/json'})
 with urllib.request.urlopen(req) as r:session=json.load(r)
 req=urllib.request.Request(CFG['API_URL']+'/rest/v1/bookings?select=id,email',headers={'apikey':CFG['PUBLISHABLE_KEY'],'Authorization':'Bearer '+session['access_token']})
 with urllib.request.urlopen(req) as r:visible=json.load(r)
 assert rows[0]['id'] in [r['id'] for r in visible] and all(r['email']=='customer@example.test' for r in visible)
 c.close();b.close()
print('PASS: public map lead consent, no premature booking, explicit signed lead-to-booking link, original acquisition persistence, pending stage, customer own-booking RLS')
