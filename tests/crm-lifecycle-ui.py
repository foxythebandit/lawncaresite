"""Staff lifecycle through real local Next + PostgREST; synthetic data only."""
import datetime
import json
import pathlib
import urllib.parse
import urllib.request
import uuid
from playwright.sync_api import sync_playwright
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

ROOT = pathlib.Path(__file__).resolve().parents[1]
cfg = json.loads(pathlib.Path('/tmp/qg-test-config.json').read_text())
BASE = 'http://localhost:3102'
assert cfg['API_URL'].startswith('http://127.0.0.1:56421') or cfg['API_URL'].startswith('http://localhost:56421')
assert BASE == 'http://localhost:3102'

def db(path, method='GET', body=None):
    headers = {'apikey': cfg['SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + cfg['SERVICE_ROLE_KEY'],
               'Content-Type': 'application/json', 'Prefer': 'return=representation'}
    payload = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(cfg['REST_URL'].rstrip('/') + '/' + path, data=payload, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=8) as response:
        content = response.read()
        return json.loads(content) if content else None

marker = uuid.uuid4().hex[:8]
name = 'Lifecycle UI ' + marker
phone = '555' + str(int(marker[:6], 16) % 10000000).zfill(7)
address = marker + ' Local Test Lane'
anchor = '2027-01-31'
next_on = '2027-02-28'
job = db('bookings', 'POST', {'name': name, 'phone': phone, 'address': address,
    'status': 'pending', 'preferred_date': anchor, 'frequency': 'Monthly', 'price_per_visit': 60,
    'job_total': '60.00', 'payment_link': 'https://example.test/old-job-price', 'accepted_quote_snapshot': {'original_total': 60},
    'one_time': False, 'manual_quote': False, 'notify_failed': False})[0]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    page.goto(BASE + '/admin/login?next=' + urllib.parse.quote('/admin?search=' + marker, safe=''))
    page.locator('input[name=email]').fill('staff@example.test')
    page.locator('input[name=password]').fill('Local-test-password-123!')
    page.get_by_role('button', name='Sign in').click()
    page.wait_for_url('**/admin/leads')
    page.goto(BASE + '/admin/jobs/' + job['id'])
    page.get_by_role('button', name='More actions', exact=True).click()
    page.get_by_role('button', name='Link customer and property', exact=True).click()
    page.get_by_role('button', name='Link reviewed identity').click()
    page.get_by_text('Customer and property linked.').wait_for(timeout=15000)
    linked = db('bookings?id=eq.' + job['id'])[0]
    assert linked['customer_id'] and linked['property_id']
    assert page.get_by_role('link', name='Text link').count() == 1
    page.get_by_role('button', name='Items and price').click()
    page.get_by_label('Item 1 description').fill('Lawn care')
    page.get_by_role('button', name='Add discount').click()
    page.get_by_label('Item 2 amount').fill('5.00')
    page.get_by_role('button', name='Save this visit price').click()
    page.get_by_text('Visit price saved.').wait_for(timeout=15000)
    assert page.get_by_role('link', name='Text link').count() == 0
    priced = db('bookings?id=eq.' + job['id'])[0]
    assert priced['payment_link'] is None
    assert float(priced['job_total']) == 55 and priced['accepted_quote_snapshot']['original_total'] == 60
    page.get_by_role('button', name='Set schedule').click()
    page.get_by_label('Repeat every').fill('1')
    page.get_by_label('Next visit after this one').fill(next_on)
    page.get_by_role('button', name='Start mowing schedule').click()
    page.get_by_text('Mowing schedule started.').wait_for(timeout=15000)
    agreement_id = db('bookings?id=eq.' + job['id'])[0]['agreement_id']
    assert agreement_id
    page.get_by_role('button', name='Confirm first visit', exact=True).click()
    page.get_by_role('button', name='Confirm visit', exact=True).click()
    page.get_by_text('Visit confirmed.').wait_for(timeout=15000)
    page.get_by_role('button', name='Mark done', exact=True).click()
    page.get_by_role('button', name='Save completion', exact=True).click()
    page.get_by_text('Visit marked done.').wait_for(timeout=15000)
    original = db('bookings?id=eq.' + job['id'])[0]
    future = [visit for visit in db('rpc/crm_calendar_entries', 'POST', {'p_from': next_on, 'p_through': next_on})
              if visit['agreement_id'] == agreement_id]
    assert original['status'] == 'completed' and len(future) == 1
    page.get_by_role('button', name='Record payment', exact=True).click()
    page.get_by_label('Paid amount').fill('25.00')
    page.get_by_role('button', name='Save payment', exact=True).click()
    page.get_by_text('Payment recorded.').wait_for(timeout=15000)
    payments = db('job_payments?booking_id=eq.' + job['id'])
    assert len(payments) == 1 and float(payments[0]['amount']) == 25
    page.goto(BASE + '/admin/revenue')
    page.get_by_text('Monthly job payments recorded by paid date').wait_for(timeout=15000)
    body = page.locator('body').inner_text()
    assert 'PAID ALL TIME' in body.upper(), body[:1200]
    assert name in page.locator('body').inner_text()
    browser.close()
print('PASS: browser staff link/customer-property, agreement, confirmation, atomic completion/next visit, partial payment, revenue')
