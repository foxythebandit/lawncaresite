"""End-to-end public manual intake and staff measurement/booking stages; real local database."""
import json, pathlib, uuid, urllib.request, urllib.parse, io
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
CFG=json.loads(pathlib.Path('/tmp/qg-test-config.json').read_text())
assert CFG['API_URL'] == 'http://127.0.0.1:56421'
BASE=__import__('os').environ.get('QG_TEST_BASE','http://localhost:3102')
assert BASE in ('http://localhost:3102','http://127.0.0.1:3102'), 'Only revamp test app allowed'
def db(path):
 req=urllib.request.Request(CFG['API_URL']+'/rest/v1/'+path,headers={'apikey':CFG['SECRET_KEY'],'Authorization':'Bearer '+CFG['SERVICE_ROLE_KEY']})
 with urllib.request.urlopen(req) as r:return json.load(r)
pathlib.Path(__import__('os').environ.get('QG_SMS_MODE','/tmp/qg-revamp-sms-mode')).write_text('reject')
png=io.BytesIO();Image.new('RGB',(256,256),'#648c60').save(png,format='PNG')
def route_external(route):
 url=route.request.url
 if urllib.parse.urlsplit(url).netloc in (urllib.parse.urlsplit(BASE).netloc,urllib.parse.urlsplit(CFG['API_URL']).netloc):route.continue_()
 elif 'nominatim.openstreetmap.org/search' in url:route.fulfill(json=[{'lat':'30.3049','lon':'-97.7184','display_name':'807 E 47th St, Austin, TX'}])
 elif 'photon.komoot.io/api/' in url:route.fulfill(json={'features':[{'geometry':{'coordinates':[-97.7184,30.3049]},'properties':{'housenumber':'807','street':'E 47th St','city':'Austin','state':'Texas','postcode':'78751','countrycode':'US'}}]})
 elif 'arcgisonline.com' in url:route.fulfill(body=png.getvalue(),content_type='image/png')
 else:route.abort()
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader'])
 c=b.new_context(viewport={'width':1440,'height':1000});c.route('**/*',route_external);page=c.new_page()
 name='Workflow '+uuid.uuid4().hex[:8]
 phone='+1512'+str(int(uuid.uuid4().hex[:8],16))[-7:].zfill(7)
 page.goto(BASE+'/?utm_source=meta&utm_campaign=first&creative_id=original&creative_type=real');page.wait_for_load_state('networkidle')
 page.goto(BASE+'/?utm_source=google&utm_campaign=latest&gclid=test-click');page.wait_for_load_state('networkidle')
 attr=page.evaluate('JSON.parse(localStorage.getItem("qg_attr"))')
 assert attr['value']['first_touch']['creative_id']=='original' and attr['value']['latest_touch']['utm_campaign']=='latest',attr
 page.get_by_role('button',name="Don't want to draw?",exact=False).click()
 form=page.locator('.manualq-inline-form')
 form.get_by_placeholder('Your name').fill(name);form.get_by_placeholder('Phone number').fill(phone);form.get_by_placeholder('Property address').fill('807 E 47th St')
 reqs=[]
 page.on('request',lambda r:reqs.append({'headers':r.all_headers(),'body':r.post_data}) if r.method=='POST' and r.headers.get('next-action') else None)
 form.get_by_role('button',name='Get my quote',exact=True).click();page.get_by_text("Got it — we'll be in touch shortly with your price.").wait_for()
 leads=db('leads?name=eq.'+urllib.parse.quote(name));assert len(leads)==1
 lead=leads[0];lid=lead['id'];assert lead['utm_source']=='meta' and lead['attribution']['latest_touch']['utm_source']=='google'
 assert db('bookings?lead_id=eq.'+lid)==[]
 # Replay same real public action: one lead and one SMS attempt.
 r=reqs[0];page.request.post(BASE+'/',data=r['body'],headers={'Next-Action':r['headers']['next-action'],'Content-Type':r['headers']['content-type'],'Origin':BASE})
 assert len(db('leads?name=eq.'+urllib.parse.quote(name)))==1
 page.get_by_role('button',name='Start a new inquiry',exact=True).click()
 form=page.locator('.manualq-inline-form')
 form.get_by_placeholder('Your name').fill(name+' second');form.get_by_placeholder('Phone number').fill(phone);form.get_by_placeholder('Property address').fill('Another address')
 form.get_by_role('button',name='Get my quote',exact=True).click();page.get_by_text("Got it — we'll be in touch shortly with your price.").wait_for()
 assert len(db('leads?phone=eq.'+urllib.parse.quote(phone)))==2
 page.goto(BASE+'/admin/login?next=/admin/leads/'+lid);page.locator('input[name=email]').fill('staff@example.test');page.locator('input[name=password]').fill('Local-test-password-123!');page.get_by_role('button',name='Sign in').click();page.wait_for_url(BASE+'/admin/leads/'+lid);page.wait_for_load_state('networkidle')
 page.get_by_text('Click around your lawn to place points',exact=True).wait_for(timeout=20000)
 page.get_by_role('button',name='new search',exact=False).click()
 page.get_by_label('Your street address').fill('807 E 47th St, Austin')
 page.get_by_role('listbox').get_by_role('option').first.click()
 page.get_by_role('button',name='Find my property',exact=False).click()
 page.get_by_text('Click around your lawn to place points',exact=True).wait_for(timeout=20000)
 canvas=page.locator('.maplibregl-canvas');canvas.scroll_into_view_if_needed()
 box=canvas.bounding_box();assert box and box['width']>100
 # Trace three corners, save while still drawing, then restore and finish.
 for x,y in [(0.4,0.4),(0.6,0.4),(0.6,0.6)]:canvas.click(position={'x':box['width']*x,'y':box['height']*y})
 page.get_by_role('button',name='Save draft',exact=True).click();page.get_by_role('status').filter(has_text='Draft saved.').wait_for()
 draft=db('leads?id=eq.'+lid)[0]['quote_draft'];assert len(draft['unfinishedPoints'])==3,draft
 page.reload();page.wait_for_load_state('networkidle');page.get_by_text('3 points placed',exact=True).wait_for(timeout=20000)
 page.get_by_role('button',name='Finish ✓',exact=True).click()
 page.get_by_label('Staff price override').fill('80')
 page.get_by_role('button',name='Confirm quote',exact=True).click()
 try: page.get_by_role('status').filter(has_text='Quote confirmed.').wait_for(timeout=10000)
 except Exception:
  print('QUOTE STATUS',page.get_by_role('status').all_inner_texts(),flush=True)
  raise
 saved=db('leads?id=eq.'+lid)[0];assert saved['quote_confirmed_at'] and len(saved['quote_draft']['sections'])==1
 assert saved['address']=='807 E 47th St' and saved['quote_draft']['address']!=saved['address']
 assert saved['quote_draft']['contactAddressAtReview']==saved['address']
 assert saved['quote_draft']['calculatedPrice']>0 and saved['quote_draft']['overridePrice']==80
 assert len(db('intake_events?lead_id=eq.'+lid))==1
 page.get_by_role('button',name='Mark accepted').click();page.get_by_text('Saved.',exact=True).first.wait_for()
 assert db('leads?id=eq.'+lid)[0]['quote_status']=='accepted'
 page.get_by_role('button',name='Create booking request',exact=True).click()
 page.get_by_text('Booking stages (1)',exact=True).wait_for()
 booking=db('bookings?lead_id=eq.'+lid)[0];assert booking['status']=='pending' and booking['price_per_visit']==80 and booking['utm_source']=='meta'
 assert booking['attribution']==saved['attribution']
 page.goto(BASE+'/admin');page.wait_for_load_state('networkidle')
 page.get_by_role('button',name=name,exact=False).first.click()
 page.get_by_role('button',name='Link reviewed identity').click()
 page.get_by_role('status').filter(has_text='Customer and property linked.').wait_for()
 assert db('bookings?id=eq.'+booking['id'])[0]['customer_id']
 page.get_by_label('Visit date').fill('2026-10-25')
 page.get_by_role('button',name='Save visit date').click()
 page.get_by_role('status').filter(has_text='Visit confirmed.').wait_for()
 confirmed=db('bookings?id=eq.'+booking['id'])[0];assert confirmed['status']=='confirmed' and confirmed['confirmed_at']
 page.get_by_role('button',name='Make recurring',exact=False).click()
 page.locator('section[aria-label="Start recurring agreement"] input[type=date]').fill('2026-11-01')
 page.get_by_role('button',name='Start agreement',exact=True).click()
 page.get_by_role('status').filter(has_text='Recurring agreement created.').wait_for()
 page.get_by_label('Date completed').fill('2026-10-25')
 page.get_by_role('button',name='Mark complete',exact=True).click()
 page.get_by_role('status').filter(has_text='Visit completed.').wait_for()
 page.get_by_label('Paid amount').fill('80.00')
 page.get_by_label('Date paid').fill('2026-10-25')
 page.get_by_label('Payment method').select_option(label='Cash')
 page.get_by_role('button',name='Record payment',exact=True).click()
 page.get_by_role('status').filter(has_text='Payment recorded.').wait_for()
 page.wait_for_load_state('networkidle')
 rows=db('bookings?lead_id=eq.'+lid)
 assert len(rows)==2,rows
 completed=next(r for r in rows if r['status']=='completed');recurring=next(r for r in rows if r['status']=='confirmed')
 assert completed['completed_at'] and len(db('job_payments?booking_id=eq.'+completed['id']))==1
 assert recurring['attribution']==saved['attribution'] and recurring['utm_source']=='meta' and recurring['confirmed_at']
 page.goto(BASE+'/admin/leads');page.wait_for_load_state('networkidle')
 card=page.get_by_role('link',name='Open quote for '+name,exact=True).locator('..')
 assert card.get_by_text('Booked',exact=True).is_visible()
 assert card.get_by_role('button',name='Delete lead').count()==0
 assert len(db('leads?id=eq.'+lid))==1
 # A completed + recurring visit still represents a single converted lead.
 all_leads=db('leads?select=id');all_bookings=db('bookings?select=lead_id,status')
 expected=len({r['lead_id'] for r in all_bookings if r['lead_id'] and r['status'] in ['confirmed','completed']})
 assert page.locator('.admin-stat').filter(has_text='Confirmed booking conversion').locator('.admin-stat-val').inner_text()==str(expected)

 c.close();b.close()
print('PASS: public manual intake/retry, first/latest attribution, staff geocoding/tracing, unfinished trace restore, shared price calculation, override/quote confirmation, explicit linked pending booking, confirmation/completion/payment stage timestamps, recurring acquisition preservation, distinct-lead conversion reporting')
