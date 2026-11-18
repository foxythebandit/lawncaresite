"""Book a lead, add an itemized visit, and schedule a second property in a disposable local CRM."""
import datetime
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


name = 'Plan customer ' + uuid.uuid4().hex[:8]
lead = db('leads', {'name': name, 'phone': '+1512555' + str(uuid.uuid4().int % 9000 + 1000), 'address': '4612 Avenue F, Austin, TX 78751',
                    'services': ['Mowing'], 'sq_ft': 3000, 'frequency': 'Bi-weekly', 'source': 'website-map'})[0]
lead_id = lead['id']
first_visit = (datetime.date.today() + datetime.timedelta(days=3)).isoformat()

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1360, 'height': 900})
    context.route('**/*', lambda route: route.continue_() if urlparse(route.request.url).netloc in ('localhost:3102', '127.0.0.1:56421') else route.abort())
    page = context.new_page()
    page.goto(BASE + '/admin/leads/' + lead_id)
    page.locator('input[name=email]').fill('staff@example.test')
    page.locator('input[name=password]').fill('Local-test-password-123!')
    page.get_by_role('button', name='Sign in').click()
    page.wait_for_url(BASE + '/admin/leads/' + lead_id)
    page.get_by_role('heading', name=name).wait_for()
    page.add_style_tag(content='nextjs-portal { display: none !important; }')

    # Lead: price, mark quoted, book the first visit with a bi-weekly plan in one step.
    assert page.get_by_label('Include measured lawn care').is_checked()
    page.get_by_role('button', name='Save as quoted', exact=True).click()
    page.get_by_role('status').filter(has_text='Saved as quoted.').wait_for()
    page.get_by_role('button', name='Book visit', exact=True).click()
    page.locator('.crm-booking-request input[type=date]').fill(first_visit)
    plan_box = page.get_by_label('Start bi-weekly mowing plan', exact=False)
    assert plan_box.is_checked()
    page.get_by_role('button', name='Confirm booking', exact=True).click()
    page.get_by_text('Visit booked and mowing plan started.').first.wait_for()
    quoted = db('leads?id=eq.' + lead_id)[0]
    assert quoted['quote_status'] == 'accepted' and quoted['stage'] == 'booked'
    job = db('bookings?lead_id=eq.' + lead_id)[0]
    assert job['customer_id'] and job['property_id'] and job['agreement_id'] and job['preferred_date'] == first_visit
    plan = db('recurring_agreements?id=eq.' + job['agreement_id'])[0]
    lawn = quoted['quote_draft']['overridePrice'] or quoted['quote_draft']['calculatedPrice']
    assert plan['interval_unit'] == 'week' and plan['interval_count'] == 2
    assert plan['next_on'] == (datetime.date.fromisoformat(first_visit) + datetime.timedelta(days=14)).isoformat()
    assert [item['description'] for item in plan['items_template']] == ['Lawn care']
    assert float(plan['price_per_visit']) == float(lawn)
    customer_id = job['customer_id']

    # Booked lead hands off to the customer.
    page.get_by_role('link', name='Open customer').click()
    page.wait_for_url(BASE + '/admin/customers/' + customer_id)
    page.get_by_role('heading', name=name).wait_for()

    # Customer: one-off upsell job.
    page.get_by_role('button', name='Add itemized visit').click()
    sheet = page.locator('section[aria-label="Add itemized visit"]')
    sheet.get_by_label('Service', exact=True).fill('Leaf cleanup')
    sheet.get_by_label('Price ($)', exact=True).fill('180')
    sheet.get_by_label('Discount ($, optional)').fill('20')
    sheet.get_by_role('button', name='Add visit', exact=True).click()
    page.get_by_text('Visit added.', exact=False).first.wait_for()
    extra = [row for row in db('bookings?customer_id=eq.' + customer_id) if row['agreement_id'] is None]
    assert len(extra) == 1 and float(extra[0]['job_total']) == 160 and extra[0]['one_time'] is True
    assert extra[0]['property_id'] == job['property_id'] and extra[0]['status'] == 'pending'
    assert extra[0]['accepted_quote_snapshot']['source'] == 'staff_job'
    assert len(db('job_items?booking_id=eq.' + extra[0]['id'])) == 2

    # Customer: second property gets its own mowing plan.
    page.get_by_role('link', name='Add service', exact=True).click()
    page.get_by_role('heading', name='Add service', exact=True).wait_for()
    page.get_by_label('Property', exact=True).select_option('')
    page.get_by_label('Address', exact=True).fill('8103 Shoal Creek Blvd, Austin, TX 78757')
    page.get_by_label('Service label').select_option(label='Lawn care')
    page.get_by_label('Agreed price per visit ($)').fill('45')
    page.get_by_label('Visit date', exact=True).fill(first_visit)
    page.get_by_role('button', name='Preview changes', exact=True).click()
    page.get_by_role('heading', name='Review before saving').wait_for()
    page.get_by_role('button', name='Save reviewed change', exact=True).click()
    page.get_by_text('Lawn care · $45.00 per visit', exact=True).wait_for()
    plans = db('recurring_agreements?customer_id=eq.' + customer_id + '&order=created_at')
    assert len(plans) == 2 and float(plans[1]['price_per_visit']) == 45 and plans[1]['property_id'] != job['property_id']
    assert len(db('properties?customer_id=eq.' + customer_id)) == 2
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    browser.close()

print('PASS: book visit with lawn-only mowing plan, lead-to-customer handoff, customer add job, customer start plan on new property')
