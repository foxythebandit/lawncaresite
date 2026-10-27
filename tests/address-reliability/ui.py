"""Local address recovery through real Next/auth/DB; only external providers are mocked."""
import io,json,pathlib,time,urllib.parse,urllib.request,uuid
from PIL import Image
from playwright.sync_api import sync_playwright,expect
ROOT=pathlib.Path(__file__).resolve().parents[2]
CFG={}
for line in (ROOT/'.env.local').read_text().splitlines():
 if '=' in line and not line.startswith('#'):
  k,v=line.split('=',1);CFG[k]=v.strip().strip('"').strip("'")
BASE='http://localhost:3103';API=CFG['NEXT_PUBLIC_SUPABASE_URL']
assert API=='http://127.0.0.1:56421','Local disposable database only'
KEY=CFG['SUPABASE_SECRET_KEY']
def db(path,data=None):
 req=urllib.request.Request(API+'/rest/v1/'+path,data=json.dumps(data).encode() if data is not None else None,headers={'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json','Prefer':'return=representation'})
 with urllib.request.urlopen(req) as r:return json.load(r)
def seed(**extra):
 row={'phone':'+15125550123','name':'Address reliability '+uuid.uuid4().hex[:8],'address':'162 Danish dr, Hutto','source':'conviflo','services':['Lawn care'],'answers':{'property_address':{'street':'162 Danish dr','city':'Hutto','unit':''},'postcode':'78634','address_needs_review':True},**extra}
 return db('leads',row)[0]['id']
png=io.BytesIO();Image.new('RGB',(256,256),'#648c60').save(png,format='PNG')
MODE='house';requests=[];pending=[]
def external(route):
 url=route.request.url;host=urllib.parse.urlsplit(url).netloc
 if host in ('localhost:3103','127.0.0.1:56421'):route.continue_();return
 requests.append(url)
 if 'nominatim.openstreetmap.org/search' in url:
  if MODE=='fail':route.fulfill(json=[])
  else:route.fulfill(json=[{'lat':'30.510755' if MODE!='outside' else '32.7767','lon':'-97.586527' if MODE!='outside' else '-96.7970','display_name':'162 Danish Drive, Hutto, Texas, 78634','address':{'house_number':'999' if MODE=='wrong' else '162','road':'Old Street' if MODE=='wrong' else 'Danish Drive','postcode':'78634','state':'Texas','country_code':'us'}}])
 elif 'photon.komoot.io/api/' in url:
  if MODE=='stale' and urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).get('q',[''])[0].startswith('999'):pending.append(route)
  else:route.fulfill(json={'features':[]})
 elif 'arcgisonline.com' in url or '/tiles/' in url:route.fulfill(body=png.getvalue(),content_type='image/png')
 else:route.abort()
def open_staff(page,lid):
 page.goto(BASE+'/admin/leads/'+lid);page.wait_for_load_state('networkidle')
 if '/login' in page.url:
  page.locator('input[name=email]').fill('staff@example.test');page.locator('input[name=password]').fill('Local-test-password-123!');page.get_by_role('button',name='Sign in').click();page.wait_for_url(BASE+'/admin/leads/'+lid);page.wait_for_load_state('networkidle')
 page.get_by_label('Include measured lawn care').check()
def search(page):
 page.get_by_role('button',name='Find my property',exact=False).click()
def confirm(page):
 page.get_by_role('button',name='Confirm this property',exact=True).wait_for(timeout=20000)
 expect(page.get_by_text('Click around your lawn to place points',exact=True)).not_to_be_visible()
 page.get_by_role('button',name='Confirm this property',exact=True).click()
 page.get_by_text('Click around your lawn to place points',exact=True).wait_for()
for _ in range(60):
 try:urllib.request.urlopen(BASE,timeout=2);break
 except Exception:time.sleep(1)
else:raise RuntimeError('Local test app is unavailable')
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader'])
 context=browser.new_context(viewport={'width':390,'height':844});context.route('**/*',external);page=context.new_page()
 changedid=seed(address='543 Different Street, Austin');open_staff(page,changedid)
 expect(page.get_by_label('Your street address')).to_have_value('543 Different Street, Austin')
 lid=seed();open_staff(page,lid);print('staff ready',flush=True)
 expect(page.get_by_label('Your street address')).to_have_value('162 Danish dr, Hutto, 78634')
 search(page);confirm(page)
 page.screenshot(path='/tmp/qg-address-confirmed-phone.png',full_page=False,animations="disabled")
 page.get_by_role('button',name="Can't see your lawn clearly?",exact=False).click();page.get_by_placeholder('e.g. 3500').fill('3500');page.get_by_role('button',name='Get quote →',exact=True).click()
 with page.expect_request(lambda req: req.method=='POST' and bool(req.headers.get('next-action'))) as action:
  page.get_by_role('button',name='Save as quoted',exact=True).click()
 page.get_by_role('status').filter(has_text='Saved as quoted.').wait_for()
 action_id=action.value.headers['next-action']
 print('confirmed quote saved',flush=True)
 saved=db('leads?id=eq.'+lid)[0];assert saved['address']=='162 Danish dr, Hutto';assert saved['quote_draft']['propertyConfirmation'];assert saved['quote_draft']['address'].endswith('78634')
 # Moving an already measured property clears the old lawn before further work.
 page.get_by_text('Can’t find the property? Set its location',exact=True).click()
 page.get_by_label('Property location').fill('30.511755, -97.585527');page.get_by_role('button',name='Show this location',exact=True).click();confirm(page)
 expect(page.get_by_text('3,500 sq ft',exact=True)).not_to_be_visible()
 page.get_by_role('button',name='Save',exact=True).click();page.get_by_role('status').filter(has_text='Price saved.').wait_for()
 moved=db('leads?id=eq.'+lid)[0]['quote_draft'];assert moved['sections']==[];assert moved['jobLatLng']=={'lat':30.511755,'lng':-97.585527}
 page.screenshot(path='/tmp/qg-address-relocated-phone.png',full_page=False,animations='disabled')
 # Historical pin without a confirmation must return to the explicit review gate.
 old=dict(saved['quote_draft']);old.pop('propertyConfirmation',None)
 oldid=seed(quote_draft=old);oldrow=db('leads?id=eq.'+oldid)[0]
 rejected=page.request.post(BASE+'/admin/leads/'+oldid,headers={'Next-Action':action_id,'Content-Type':'text/plain;charset=UTF-8'},data=json.dumps([oldid,oldrow['updated_at'],old,True]))
 assert 'Confirm the matching property' in rejected.text(),rejected.text()
 assert db('leads?id=eq.'+oldid)[0]['quote_draft']==old
 open_staff(page,oldid)
 page.get_by_role('button',name='Confirm this property',exact=True).wait_for(timeout=20000)
 expect(page.get_by_text('Click around your lawn to place points',exact=True)).not_to_be_visible()
 page.screenshot(path='/tmp/qg-address-old-pin-phone.png',full_page=False,animations="disabled")
 # A late autocomplete response cannot replace the current typed address.
 MODE='stale';staleid=seed();open_staff(page,staleid)
 field=page.get_by_label('Your street address');field.fill('999 Old Street, Hutto')
 page.wait_for_timeout(600);assert pending,'Expected an in-flight autocomplete request'
 field.fill('162 Danish dr, Hutto, 78634');page.wait_for_timeout(500)
 for delayed in pending:
  try:delayed.fulfill(json={'features':[{'geometry':{'coordinates':[-97.58,30.51]},'properties':{'housenumber':'999','street':'Old Street','city':'Hutto','state':'Texas','postcode':'78634','countrycode':'US'}}]})
  except Exception:pass # The component may already have aborted the obsolete request.
 page.wait_for_timeout(300);expect(field).to_have_value('162 Danish dr, Hutto, 78634')
 expect(page.get_by_role('option').filter(has_text='999 Old Street')).to_have_count(0)
 # Both providers empty: staff can place a property, but never with malformed input.
 MODE='fail';manualid=seed();open_staff(page,manualid);page.evaluate('sessionStorage.clear()');search(page)
 page.locator('.mapq-error').wait_for(timeout=20000)
 page.get_by_text('Can’t find the property? Set its location',exact=True).click()
 page.get_by_label('Property location').fill('https://maps.app.goo.gl/not-a-place');page.get_by_role('button',name='Show this location',exact=True).click()
 expect(page.get_by_role('button',name='Confirm this property',exact=True)).not_to_be_visible()
 expect(page.locator('.mapq-error')).to_contain_text('shortened link')
 page.get_by_label('Property location').fill('https://www.google.com/maps/place/Test/data=!3d30.510755!4d-97.586527');page.get_by_role('button',name='Show this location',exact=True).click()
 page.get_by_role('button',name='Confirm this property',exact=True).wait_for()
 page.get_by_label('Property location').fill('30.510755, -97.586527');page.get_by_role('button',name='Show this location',exact=True).click();confirm(page)
 page.screenshot(path='/tmp/qg-address-manual-phone.png',full_page=False,animations="disabled")
 # Public failed lookup retains a personal-inquiry path, while outside-area is waitlist only.
 MODE='wrong'
 public=browser.new_context(viewport={'width':390,'height':844});public.route('**/*',external);pub=public.new_page();pub.goto(BASE);pub.wait_for_load_state('networkidle')
 pub.get_by_label('Your street address').fill('162 Danish dr, Hutto, 78634');search(pub)
 pub.get_by_role('link',name='Send your address for a personal quote instead',exact=False).wait_for(timeout=20000)
 expect(pub.get_by_text('Click around your lawn to place points',exact=True)).not_to_be_visible()
 pub.get_by_label('Your street address').scroll_into_view_if_needed();pub.wait_for_timeout(500)
 pub.screenshot(path='/tmp/qg-address-public-failure-phone.png',full_page=False,animations="disabled")
 MODE='outside';search(pub);pub.locator('.mapq-waitlist').wait_for(timeout=20000)
 expect(pub.locator('.mapq-error')).to_contain_text('30 miles')
 expect(pub.get_by_text('Click around your lawn to place points',exact=True)).not_to_be_visible()
 pub.locator('.mapq-waitlist').scroll_into_view_if_needed();pub.wait_for_timeout(500)
 pub.screenshot(path='/tmp/qg-address-outside-phone.png',full_page=False,animations="disabled")
 public.close();context.close();browser.close()
assert any('postalcode=78634' in url for url in requests if 'nominatim' in url)
print('PASS: legacy postcode lookup, confirmation, saved proof, server rejection without confirmation, old-pin review, stale autocomplete, manual recovery and measured-property relocation reset, wrong-house public inquiry fallback and outside-area waitlist; external calls intercepted')
