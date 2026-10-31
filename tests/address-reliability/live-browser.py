"""One real browser provider lookup; no intake, authentication, or database writes."""
import io,json,pathlib,time,urllib.parse
from PIL import Image
from playwright.sync_api import sync_playwright
BASE='http://localhost:3103'
png=io.BytesIO();Image.new('RGB',(256,256),'#648c60').save(png,format='PNG')
receipts=[]
def boundary(route):
 url=route.request.url;host=urllib.parse.urlsplit(url).hostname
 if host=='localhost' and urllib.parse.urlsplit(url).port==3103:route.continue_()
 elif host in ('photon.komoot.io','nominatim.openstreetmap.org'):route.continue_()
 elif 'arcgisonline.com' in url:route.fulfill(body=png.getvalue(),content_type='image/png')
 else:route.abort()
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader'])
 context=browser.new_context(viewport={'width':390,'height':844});context.route('**/*',boundary);page=context.new_page()
 page.on('response',lambda response: receipts.append({'url':response.url,'status':response.status}) if urllib.parse.urlsplit(response.url).hostname in ('photon.komoot.io','nominatim.openstreetmap.org') else None)
 page.on('requestfailed',lambda request: receipts.append({'url':request.url,'failure':request.failure}) if urllib.parse.urlsplit(request.url).hostname in ('photon.komoot.io','nominatim.openstreetmap.org') else None)
 page.goto(BASE);page.wait_for_load_state('networkidle')
 field=page.get_by_label('Your street address');field.fill('162 Danish dr, Hutto, 78634')
 started=time.monotonic();page.get_by_role('button',name='Find my property',exact=False).click()
 page.wait_for_function("document.querySelector('.mapq-error') || [...document.querySelectorAll('button')].some(b => b.textContent === 'Confirm this property') || document.body.textContent.includes('Click around your lawn to place points')",timeout=20000)
 elapsed=round((time.monotonic()-started)*1000)
 errors=page.locator('.mapq-error').all_text_contents()
 outcome='safe_error' if errors else 'property_candidate_or_trace'
 receipt=json.dumps({'outcome':outcome,'elapsed_ms':elapsed,'errors':errors,'provider_receipts':receipts},indent=2)
 pathlib.Path('/tmp/qg-address-live-browser.json').write_text(receipt);print(receipt,flush=True)
 page.evaluate("document.querySelector('.mapq-grid')?.scrollIntoView({block:'start',behavior:'instant'})")
 page.wait_for_timeout(1000);page.screenshot(path='/tmp/qg-address-live-browser-phone.png',animations='disabled')
 context.close();browser.close()
