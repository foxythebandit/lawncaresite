"""Customer history uses reviewed identity links, never a matching phone alone."""
import json
import pathlib
import uuid
import urllib.parse
import urllib.request

from playwright.sync_api import sync_playwright

BASE = 'http://localhost:3102'
CFG = json.loads(pathlib.Path('/tmp/qg-test-config.json').read_text())
assert urllib.parse.urlsplit(CFG['API_URL']).scheme == 'http'
assert urllib.parse.urlsplit(CFG['API_URL']).netloc == '127.0.0.1:56421'


def rows(path, data=None):
    headers = {'apikey': CFG['SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + CFG['SERVICE_ROLE_KEY']}
    if data is not None:
        headers.update({'Content-Type': 'application/json', 'Prefer': 'return=representation'})
    req = urllib.request.Request(CFG['API_URL'] + '/rest/v1/' + path,
                                 data=json.dumps(data).encode() if data is not None else None,
                                 headers=headers, method='POST' if data is not None else 'GET')
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)


name = 'History ' + uuid.uuid4().hex[:8]
phone = '+15125550888'
lead = rows('leads', {'name': name, 'phone': phone, 'address': '812 Test Oak St, Austin, TX', 'source': 'crm-test'})[0]
job = rows('bookings', {'name': name, 'phone': phone, 'address': lead['address'], 'status': 'pending',
                        'price_per_visit': 125, 'job_total': 125, 'lead_id': lead['id']})[0]
other = rows('bookings', {'name': name + ' unlinked', 'phone': phone, 'address': '99 Different Rd, Austin, TX',
                          'status': 'pending', 'price_per_visit': 85, 'job_total': 85})[0]

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 390, 'height': 844})
    allowed = {'localhost:3102', '127.0.0.1:56421'}
    context.route('**/*', lambda route: route.continue_() if urllib.parse.urlsplit(route.request.url).netloc in allowed else route.abort())
    page = context.new_page()
    page.goto(BASE + '/admin/customers')
    assert '/admin/login' in page.url
    page.locator('input[name=email]').fill('staff@example.test')
    page.locator('input[name=password]').fill('Local-test-password-123!')
    page.get_by_role('button', name='Sign in').click()
    page.wait_for_url(BASE + '/admin/customers')
    assert page.get_by_role('link', name=name, exact=False).count() == 0
    page.goto(BASE + '/admin?search=' + urllib.parse.quote(name, safe=''))
    card = page.locator('.admin-card').filter(has_text=lead['address'])
    card.locator('.admin-card-summary').click()
    card.get_by_role('button', name='Link reviewed identity').click()
    page.get_by_role('status').filter(has_text='Customer and property linked.').wait_for()
    linked = rows('bookings?id=eq.' + job['id'])[0]
    assert linked['customer_id'] and linked['property_id']
    assert rows('bookings?id=eq.' + other['id'])[0]['customer_id'] is None
    assert rows('leads?id=eq.' + lead['id'])[0]['customer_id'] == linked['customer_id']
    page.get_by_label('Paid amount').fill('125.00')
    page.get_by_role('button', name='Record payment').click()
    page.get_by_role('status').filter(has_text='Payment recorded.').wait_for()
    old_job = rows('bookings', {'name': name + ' older visit', 'phone': phone, 'address': lead['address'],
                      'status': 'completed', 'price_per_visit': 75, 'job_total': 75,
                      'customer_id': linked['customer_id'], 'property_id': linked['property_id'],
                      'amount_charged': 75, 'payment_method': 'Cash',
                      'payment_recorded_at': '2026-10-20T15:00:00Z', 'completed_at': '2026-10-20T15:00:00Z'})[0]
    rows('job_payments', {'booking_id': old_job['id'], 'operation_id': str(uuid.uuid4()), 'amount': 20, 'paid_on': '2026-10-22', 'method': 'Cash', 'provenance': 'manual'})
    page.goto(BASE + '/admin/customers')
    page.get_by_role('link', name=name, exact=False).wait_for()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.get_by_role('link', name=name, exact=False).click()
    page.wait_for_url(BASE + '/admin/customers/' + linked['customer_id'])
    assert page.get_by_role('heading', name=name).is_visible()
    assert page.get_by_role('heading', name='Properties (1)').is_visible()
    assert page.get_by_role('heading', name='Visits (2)').is_visible()
    assert page.get_by_role('heading', name='Payments (3)').is_visible()
    assert page.get_by_role('heading', name='Leads (1)').is_visible()
    assert page.get_by_text('Staff recorded').first.is_visible()
    assert page.get_by_text('$20.00 · Cash', exact=True).is_visible()
    assert page.get_by_text('$75.00 · Cash', exact=True).is_visible()
    assert page.get_by_role('heading', name='Historical recorded amounts').is_visible()
    assert page.get_by_text('Paid date unverified', exact=False).is_visible()
    assert page.get_by_text('99 Different Rd, Austin, TX').count() == 0
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path='/tmp/qg-crm-customer-mobile-390.png', full_page=True)
    context.close()
    desktop = browser.new_context(viewport={'width': 1360, 'height': 900})
    desktop.route('**/*', lambda route: route.continue_() if urllib.parse.urlsplit(route.request.url).netloc in allowed else route.abort())
    page = desktop.new_page()
    page.goto(BASE + '/admin/customers/' + linked['customer_id'])
    page.locator('input[name=email]').fill('staff@example.test')
    page.locator('input[name=password]').fill('Local-test-password-123!')
    page.get_by_role('button', name='Sign in').click()
    page.wait_for_url(BASE + '/admin/customers/' + linked['customer_id'])
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path='/tmp/qg-crm-customer-desktop-1360.png', full_page=True)
    desktop.close()
    browser.close()

print('PASS: protected customer list/detail, reviewed identity link, same-phone isolation, linked lead/property/job, manual payment provenance, mobile/desktop layout')
