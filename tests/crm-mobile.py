"""Staff mobile response and manual quote flow against the disposable local CRM."""
import json
import pathlib
import uuid
import urllib.request
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE = 'http://localhost:3102'
CFG = json.loads(pathlib.Path('/tmp/qg-test-config.json').read_text())
assert urlparse(CFG['API_URL']).scheme == 'http' and urlparse(CFG['API_URL']).netloc == '127.0.0.1:56421'


def db(path, data=None):
    headers = {'apikey': CFG['SECRET_KEY'], 'Authorization': 'Bearer ' + CFG['SERVICE_ROLE_KEY']}
    if data is not None:
        headers.update({'Content-Type': 'application/json', 'Prefer': 'return=representation'})
    request = urllib.request.Request(CFG['API_URL'] + '/rest/v1/' + path,
                                     data=json.dumps(data).encode() if data is not None else None,
                                     headers=headers, method='POST' if data is not None else 'GET')
    with urllib.request.urlopen(request) as response:
        return json.load(response)


def rpc(name, data):
    request = urllib.request.Request(CFG['API_URL'] + '/rest/v1/rpc/' + name,
                                     data=json.dumps(data).encode(), method='POST',
                                     headers={'apikey': CFG['SECRET_KEY'], 'Authorization': 'Bearer ' + CFG['SERVICE_ROLE_KEY'],
                                              'Content-Type': 'application/json'})
    with urllib.request.urlopen(request) as response:
        return json.load(response)


name = 'Mobile lead ' + uuid.uuid4().hex[:8]
lead = db('leads', {'name': name, 'phone': '+15125550199', 'address': '807 E 47th St, Austin, TX',
                    'services': ['Leaf cleanup'], 'sq_ft': 2400, 'source': 'website-service',
                    'answers': {'project_description': 'Bag the leaves by the back gate'},
                    'attribution': {'first_touch': {'utm_source': 'meta', 'meta_ad_id': '900003', 'creative_type': 'ai'}}})[0]
lead_id = lead['id']

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1,
                                  user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')
    context.route('**/*', lambda route: route.continue_() if urlparse(route.request.url).netloc in ('localhost:3102', '127.0.0.1:56421') else route.abort())
    page = context.new_page()
    page.goto(BASE + '/admin/leads/' + lead_id)
    assert '/admin/login' in page.url and 'next=' in page.url
    page.locator('input[name=email]').fill('staff@example.test')
    page.locator('input[name=password]').fill('Local-test-password-123!')
    page.get_by_role('button', name='Sign in').click()
    page.wait_for_url(BASE + '/admin/leads/' + lead_id)
    page.get_by_role('heading', name=name).wait_for()
    page.add_style_tag(content='nextjs-portal { display: none !important; }')
    assert page.get_by_role('link', name='Call +15125550199').get_attribute('href') == 'tel:+15125550199'
    assert page.get_by_role('link', name='Build quote').get_attribute('href') == '#map-quote'
    assert page.locator('#map-quote').count() == 1
    page.get_by_text('Answers and acquisition details', exact=True).click()
    page.get_by_text('Bag the leaves by the back gate', exact=True).wait_for()
    page.get_by_text('Meta ad', exact=True).wait_for()
    page.get_by_text('Answers and acquisition details', exact=True).click()
    assert page.get_by_role('link', name='Open Messages').get_attribute('href').startswith('sms:+15125550199?body=')
    iphone_href = page.get_by_role('link', name='Open Messages').evaluate('''link => {
      document.addEventListener('click', event => { if (event.target === link) event.preventDefault() }, { capture: true, once: true });
      link.click();
      return link.getAttribute('href');
    }''')
    assert iphone_href.startswith('sms:+15125550199&body=')
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'mobile horizontal overflow'
    page.screenshot(path='/tmp/qg-crm-mobile-compact-390.png', full_page=True)
    page.get_by_text('Update lead and follow-up', exact=True).click()
    page.get_by_label('Outcome').select_option('no_answer')
    page.get_by_role('button', name='Save call outcome').click()
    page.get_by_text('Saved.', exact=True).first.wait_for()
    assert db('leads?id=eq.' + lead_id)[0]['contact_outcome'] == 'no_answer'
    page.get_by_label('Date and time').fill('2026-11-02T09:00')
    page.get_by_role('button', name='Set follow-up').click()
    page.get_by_text('Saved.', exact=True).first.wait_for()
    assert db('leads?id=eq.' + lead_id)[0]['follow_up_at']
    page.get_by_label('Leaf cleanup price').fill('125.50')
    page.get_by_role('button', name='Save draft', exact=True).click()
    page.get_by_role('status').filter(has_text='Draft saved.').wait_for()
    saved = db('leads?id=eq.' + lead_id)[0]
    assert saved['quote_draft']['manualLines'][0]['amountCents'] == 12550
    assert saved['quote_draft']['totalCents'] == 12550
    assert saved['quote_draft']['includeMowing'] is False
    page.reload()
    page.get_by_label('Leaf cleanup price').wait_for()
    assert page.get_by_label('Leaf cleanup price').input_value() == '125.50'
    page.get_by_role('button', name='Confirm quote', exact=True).click()
    page.get_by_role('status').filter(has_text='Quote confirmed.').wait_for()
    page.get_by_role('button', name='Mark accepted').click()
    page.get_by_text('Saved.', exact=True).first.wait_for()
    accepted = db('leads?id=eq.' + lead_id)[0]
    assert accepted['quote_status'] == 'accepted'
    assert accepted['accepted_quote_snapshot']['totalCents'] == 12550
    # A later contact-address change must not silently book the earlier accepted property.
    page.get_by_text('Edit contact', exact=True).click()
    page.get_by_label('Property address', exact=True).fill('999 Temporary Test Property, Austin, TX')
    page.get_by_role('button', name='Save contact').click()
    page.get_by_text('Contact address changed.', exact=False).wait_for()
    page.get_by_role('button', name='Create booking request').click()
    page.get_by_text('The contact address changed after this quote.', exact=False).first.wait_for()
    assert db('bookings?lead_id=eq.' + lead_id) == []
    assert db('leads?id=eq.' + lead_id)[0]['accepted_quote_snapshot']['address'] == '807 E 47th St, Austin, TX'
    assert page.get_by_role('button', name='Confirm quote', exact=True).count() == 0
    page.get_by_role('button', name='Cancel acceptance').click()
    page.get_by_role('button', name='Start quote for updated address').click()
    assert page.get_by_label('Leaf cleanup price').input_value() in ('', '0', '0.00')
    page.get_by_label('Leaf cleanup price').fill('125.50')
    page.get_by_role('button', name='Save draft', exact=True).click()
    page.get_by_role('status').filter(has_text='Draft saved.').wait_for()
    page.get_by_role('button', name='Confirm quote', exact=True).click()
    page.get_by_role('status').filter(has_text='Quote confirmed.').wait_for()
    page.get_by_role('button', name='Mark accepted').click()
    page.get_by_text('Saved.', exact=True).first.wait_for()
    page.get_by_role('button', name='Create booking request').click()
    page.get_by_text('Booking request created.').first.wait_for()
    bookings = db('bookings?lead_id=eq.' + lead_id)
    assert len(bookings) == 1 and bookings[0]['status'] == 'pending'
    assert bookings[0]['address'] == '999 Temporary Test Property, Austin, TX'
    assert bookings[0]['accepted_quote_snapshot']['total'] == 125.50
    new_draft = db('leads?id=eq.' + lead_id)[0]['quote_draft']
    assert new_draft['sections'] == [] and new_draft['jobLatLng'] is None
    assert new_draft['contactAddressAtReview'] == '999 Temporary Test Property, Austin, TX'
    assert len(db('job_items?booking_id=eq.' + bookings[0]['id'])) == 1
    page.reload()
    page.locator('a[href^="sms:"][href*="body="]').wait_for()
    current_version = db('leads?id=eq.' + lead_id)[0]['updated_at']
    rpc('update_lead_workflow', {'p_lead_id': lead_id, 'p_expected_updated_at': current_version,
                                 'p_patch': {}, 'p_activity': {'kind': 'note', 'body': 'Other staff note'},
                                 'p_actor_email': 'other-staff@example.test'})
    page.get_by_text('Update lead and follow-up', exact=True).click()
    page.get_by_label('Note', exact=True).fill('Stale staff note')
    page.get_by_role('button', name='Add note').evaluate('(button) => button.click()')
    page.get_by_text('This lead changed since you opened it.', exact=False).first.wait_for(timeout=5000)
    assert len(db('lead_activities?lead_id=eq.' + lead_id + '&body=eq.Stale%20staff%20note')) == 0
    page.reload()
    page.get_by_text('Edit contact', exact=True).click()
    page.get_by_label('Phone', exact=True).fill('+15125550198')
    page.get_by_label('Property address', exact=True).fill('999 New Test Property, Austin, TX')
    page.get_by_role('button', name='Save contact').click()
    page.get_by_text('Contact address changed.', exact=False).wait_for()
    corrected = db('leads?id=eq.' + lead_id)[0]
    assert corrected['phone'] == '+15125550198'
    assert corrected['accepted_quote_snapshot']['address'] == '999 Temporary Test Property, Austin, TX'
    assert db('bookings?lead_id=eq.' + lead_id)[0]['address'] == '999 Temporary Test Property, Austin, TX'
    page.screenshot(path='/tmp/qg-crm-mobile-390.png', full_page=True)
    context.close()
    desktop = browser.new_context(viewport={'width': 1360, 'height': 900})
    desktop.route('**/*', lambda route: route.continue_() if urlparse(route.request.url).netloc in ('localhost:3102', '127.0.0.1:56421') else route.abort())
    page = desktop.new_page()
    page.goto(BASE + '/admin/leads')
    page.locator('input[name=email]').fill('staff@example.test')
    page.locator('input[name=password]').fill('Local-test-password-123!')
    page.get_by_role('button', name='Sign in').click()
    page.wait_for_url(BASE + '/admin/leads')
    page.get_by_role('link', name='Open quote for ' + name).wait_for()
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'desktop horizontal overflow'
    page.screenshot(path='/tmp/qg-crm-desktop-1360.png', full_page=True)
    desktop.close()
    browser.close()

print('PASS: protected deep link, responsive lead UI, native call/text draft, explicit call/follow-up, manual quote/review/acceptance, immutable booking snapshot')
