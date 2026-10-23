"""Preserved legacy inquiry without address -> staff measurement, add-ons and private booking notes."""
import json,pathlib,uuid,urllib.request,urllib.parse,io
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
CFG=json.loads(pathlib.Path('/tmp/qg-test-config.json').read_text())
assert CFG['API_URL']=='http://127.0.0.1:56421'
BASE=__import__('os').environ.get('QG_TEST_BASE','http://localhost:3102')
assert BASE in ('http://localhost:3102','http://127.0.0.1:3102'), 'Only revamp test app allowed'
def db(path):
 with urllib.request.urlopen(urllib.request.Request(CFG['API_URL']+'/rest/v1/'+path,headers={'apikey':CFG['SECRET_KEY'],'Authorization':'Bearer '+CFG['SERVICE_ROLE_KEY']})) as r:return json.load(r)
# New intake requires an address; legacy rows must remain usable and recoverable.
legacy = {'phone': '+15125550123', 'name': 'Legacy address ' + uuid.uuid4().hex[:8], 'address': None, 'source': 'legacy-test'}
req=urllib.request.Request(CFG['API_URL']+'/rest/v1/leads',data=json.dumps(legacy).encode(),headers={'apikey':CFG['SECRET_KEY'],'Authorization':'Bearer '+CFG['SERVICE_ROLE_KEY'],'Content-Type':'application/json','Prefer':'return=representation'})
with urllib.request.urlopen(req) as r:lid=json.load(r)[0]['id']
png=io.BytesIO();Image.new('RGB',(256,256),'#648c60').save(png,format='PNG')
def route_external(route):
 url=route.request.url
 if urllib.parse.urlsplit(url).netloc in (urllib.parse.urlsplit(BASE).netloc,urllib.parse.urlsplit(CFG['API_URL']).netloc):route.continue_()
 elif 'nominatim.openstreetmap.org/search' in url:route.fulfill(json=[{'lat':'30.3049','lon':'-97.7184','display_name':'807 E 47th St, Austin, TX'}])
 elif 'photon.komoot.io/api/' in url:route.fulfill(json={'features':[{'geometry':{'coordinates':[-97.7184,30.3049]},'properties':{'housenumber':'807','street':'E 47th St','city':'Austin','state':'Texas','postcode':'78751','countrycode':'US'}}]})
 elif 'arcgisonline.com' in url:route.fulfill(body=png.getvalue(),content_type='image/png')
 else:route.abort()
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']);c=b.new_context(viewport={'width':1440,'height':1000});c.route('**/*',route_external);page=c.new_page()
 page.goto(BASE+'/admin/login?next=/admin/leads/'+lid);page.locator('input[name=email]').fill('staff@example.test');page.locator('input[name=password]').fill('Local-test-password-123!');page.get_by_role('button',name='Sign in').click();page.wait_for_url(BASE+'/admin/leads/'+lid);page.wait_for_load_state('networkidle')
 page.get_by_label('Include measured lawn care').check()
 page.get_by_label('Your street address').fill('807 E 47th St, Austin, TX');page.get_by_role('listbox').get_by_role('option').first.click();page.get_by_role('button',name='Find my property',exact=False).click()
 page.get_by_text('Click around your lawn to place points',exact=True).wait_for(timeout=20000)
 page.get_by_role('button',name="Can't see your lawn clearly?",exact=False).click();page.get_by_placeholder('e.g. 3500').fill('3500');page.get_by_role('button',name='Get quote →',exact=True).click()
 page.get_by_label('Quote notes').fill('Private staff margin note')
 page.get_by_role('button',name='Save as quoted',exact=True).click();page.get_by_role('status').filter(has_text='Saved as quoted.').wait_for()
 saved=db('leads?id=eq.'+lid)[0];assert saved['address'] is None and saved['quote_draft']['address']
 page.get_by_role('button',name='Book visit',exact=True).click();page.get_by_role('button',name='Confirm booking',exact=True).click();page.get_by_text('Booking stages (1)',exact=True).wait_for()
 row=db('bookings?lead_id=eq.'+lid)[0]
 assert row['address']==saved['quote_draft']['address'] and row['notes']=='Private staff margin note' and row['customer_notes'] is None
 assert row['last_mow']==saved['quote_draft']['lastMow'] and row['overgrowth_fee']==saved['quote_draft']['overgrowthFee']
 assert row['customer_id'] and row['property_id']
 c.close();b.close()
print('PASS: addressless external lead, staff-entered address, saved last mow/overgrowth, private notes, explicit booking')
