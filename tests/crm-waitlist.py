"""Outside-area public map response stays an inquiry with an explicit waitlist marker."""
import json
import pathlib
import uuid
import urllib.request
import urllib.parse
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE = 'http://localhost:3102'
CFG = json.loads(pathlib.Path('/tmp/qg-test-config.json').read_text())
assert urlparse(CFG['API_URL']).scheme == 'http' and urlparse(CFG['API_URL']).netloc == '127.0.0.1:56421'


def db(path):
    request = urllib.request.Request(CFG['API_URL'] + '/rest/v1/' + path,
                                     headers={'apikey': CFG['SECRET_KEY'], 'Authorization': 'Bearer ' + CFG['SERVICE_ROLE_KEY']})
    with urllib.request.urlopen(request) as response:
        return json.load(response)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 390, 'height': 844})

    def route_external(route):
        url = route.request.url
        if urlparse(url).netloc in ('localhost:3102', '127.0.0.1:56421'):
            route.continue_()
        elif 'nominatim.openstreetmap.org/search' in url:
            route.fulfill(json=[{'lat': '40.7128', 'lon': '-74.0060', 'display_name': 'New York, NY'}])
        else:
            route.abort()

    context.route('**/*', route_external)
    page = context.new_page()
    page.goto(BASE + '/?utm_source=google&utm_campaign=waitlist-test')
    page.get_by_label('Your street address').fill('123 Outside St, New York, NY')
    page.get_by_role('button', name='Find my property', exact=False).click()
    page.get_by_role('heading', name='Join the service waitlist').wait_for(timeout=20000)
    assert page.get_by_text('We serve Austin and up to').is_visible()
    name = 'Waitlist ' + uuid.uuid4().hex[:8]
    waitlist = page.locator('.mapq-waitlist')
    waitlist.get_by_label('Your name').fill(name)
    waitlist.get_by_label('Phone number').fill('+15125550188')
    waitlist.get_by_role('button', name='Join waitlist').click()
    page.get_by_text('You’re on the waitlist.').wait_for()
    leads = db('leads?name=eq.' + urllib.parse.quote(name))
    assert len(leads) == 1
    lead = leads[0]
    assert lead['source'] == 'website-waitlist' and lead['answers']['waitlist'] is True
    assert lead['address'] == '123 Outside St, New York, NY'
    assert db('bookings?lead_id=eq.' + lead['id']) == []
    events = db('intake_events?lead_id=eq.' + lead['id'])
    assert len(events) == 1
    alerts = db('staff_alerts?event_id=eq.' + events[0]['id'])
    assert len(alerts) == 4 and {alert['channel'] for alert in alerts} == {'sms', 'voice'}
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    page.screenshot(path='/tmp/qg-crm-waitlist-390.png')
    context.close()
    browser.close()

print('PASS: outside-area notice, required contact, marked waitlist inquiry, no booking, four staff alerts')
