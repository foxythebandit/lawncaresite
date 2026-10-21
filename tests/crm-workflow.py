"""End-to-end public manual intake and staff measurement/booking stages; real local database."""
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
 name='Workflow '+uuid.uuid4().hex[:8]
 phone='+1512'+str(int(uuid.uuid4().hex[:8],16))[-7:].zfill(7)
 page.goto(BASE+'/?utm_source=meta&utm_campaign=first&creative_id=original&creative_type=real');page.wait_for_load_state('networkidle')
 page.goto(BASE+'/?utm_source=google&utm_campaign=latest&gclid=test-click');page.wait_for_load_state('networkidle')
 attr=page.evaluate('JSON.parse(localStorage.getItem("qg_attr"))')
 assert attr['value']['first_touch']['creative_id']=='original' and attr['value']['latest_touch']['utm_campaign']=='latest',attr
 page.get_by_role('button',name="Don't want to draw?",exact=False).click()
 form=page.locator('.manualq-inline-form')
 form.get_by_placeholder('Your name').fill(name);form.get_by_placeholder('Phone number').fill(phone);form.get_by_placeholder('Property address').fill('807 E 47th St, Austin, TX')
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
 canvas=page.locator('.maplibregl-canvas');canvas.scroll_into_view_if_needed()
 box=canvas.bounding_box();assert box and box['width']>100
 # Trace three corners, save while still drawing, then restore and finish.
 for x,y in [(0.4,0.4),(0.6,0.4),(0.6,0.6)]:canvas.click(position={'x':box['width']*x,'y':box['height']*y})
 page.get_by_role('button',name='Save draft',exact=True).click();page.get_by_role('status').filter(has_text='Draft saved.').wait_for()
 draft=db('leads?id=eq.'+lid)[0]['quote_draft'];assert len(draft['unfinishedPoints'])==3,draft
 page.reload();page.wait_for_load_state('networkidle');page.get_by_text('3 points placed',exact=True).wait_for(timeout=20000)
 page.get_by_role('button',name='Finish ✓',exact=True).click()
 page.get_by_label('Staff price override').fill('80')
 page.get_by_role('button',name='Confirm quote',exact=True).click();page.get_by_role('status').filter(has_text='Quote confirmed.').wait_for()
 saved=db('leads?id=eq.'+lid)[0];assert saved['quote_confirmed_at'] and len(saved['quote_draft']['sections'])==1
 assert saved['quote_draft']['calculatedPrice']>0 and saved['quote_draft']['overridePrice']==80
 assert len(db('intake_events?lead_id=eq.'+lid))==1
 page.get_by_role('button',name='Create booking request',exact=True).click()
 page.get_by_text('Booking stages (1)',exact=True).wait_for()
 booking=db('bookings?lead_id=eq.'+lid)[0];assert booking['status']=='pending' and booking['price_per_visit']==80 and booking['utm_source']=='meta'
 assert booking['attribution']==saved['attribution']
 page.goto(BASE+'/admin');page.wait_for_load_state('networkidle')
 page.get_by_role('button',name=name,exact=False).first.click()
 page.get_by_role('button',name='✓ Confirm',exact=True).click()
 page.locator('.admin-confirm-date-panel input[type=date]').fill('2026-10-25')
 page.get_by_role('button',name='✓ Confirm & send email',exact=True).click()
 page.get_by_role('button',name='✓ Mark complete',exact=True).wait_for()
 confirmed=db('bookings?id=eq.'+booking['id'])[0];assert confirmed['status']=='confirmed' and confirmed['confirmed_at']
 page.get_by_role('button',name='✓ Mark complete',exact=True).click()
 page.locator('.admin-complete-panel select').select_option(label='Cash')
 with page.expect_response(lambda r: r.request.method=='POST' and bool(r.request.headers.get('next-action'))):
  page.get_by_role('button',name='✓ Save & schedule next',exact=True).click()
 page.wait_for_load_state('networkidle')
 rows=db('bookings?lead_id=eq.'+lid)
 assert len(rows)==2,rows
 completed=next(r for r in rows if r['status']=='completed');recurring=next(r for r in rows if r['status']=='confirmed')
 assert completed['completed_at'] and completed['payment_recorded_at'] and completed['payment_method']=='Cash'
 assert recurring['attribution']==saved['attribution'] and recurring['utm_source']=='meta' and recurring['confirmed_at']
 page.goto(BASE+'/admin/leads');page.wait_for_load_state('networkidle')
 card=page.locator('.admin-card').filter(has_text=phone)
 assert card.get_by_text('Booked',exact=True).is_visible()
 page.once('dialog',lambda dialog:dialog.accept())
 card.filter(has_text='Booked').get_by_role('button',name='Delete lead').click()
 page.get_by_role('alert').filter(has_text='must be retained').wait_for()
 assert len(db('leads?id=eq.'+lid))==1
 # A completed + recurring visit still represents a single converted lead.
 all_leads=db('leads?select=id');all_bookings=db('bookings?select=lead_id,status')
 expected=len({r['lead_id'] for r in all_bookings if r['lead_id'] and r['status'] in ['confirmed','completed']})
 assert page.locator('.admin-stat').filter(has_text='Confirmed booking conversion').locator('.admin-stat-val').inner_text()==str(expected)

 c.close();b.close()
print('PASS: public manual intake/retry, first/latest attribution, staff geocoding/tracing, unfinished trace restore, shared price calculation, override/quote confirmation, explicit linked pending booking, confirmation/completion/payment stage timestamps, recurring acquisition preservation, distinct-lead conversion reporting')
