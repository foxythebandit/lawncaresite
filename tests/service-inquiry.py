"""Real local intake/database check; run Next with tests/twilio-mock.cjs.

Uses the existing disposable /tmp/qg-test-config.json only. Does not migrate,
reset, or access production. QG_TEST_BASE defaults to http://localhost:3101.
"""
import json
import os
import pathlib
import urllib.parse
import urllib.request
import uuid
from playwright.sync_api import sync_playwright

CFG = json.loads(pathlib.Path('/tmp/qg-test-config.json').read_text())
BASE = os.environ.get('QG_TEST_BASE', 'http://localhost:3101')
assert CFG['API_URL'] == 'http://127.0.0.1:56421'
assert urllib.parse.urlparse(BASE).hostname in ('localhost', '127.0.0.1')


def db(path):
    req = urllib.request.Request(CFG['API_URL'] + '/rest/v1/' + path, headers={
        'apikey': CFG['SECRET_KEY'], 'Authorization': 'Bearer ' + CFG['SERVICE_ROLE_KEY'],
    })
    with urllib.request.urlopen(req) as response:
        return json.load(response)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 390, 'height': 844})
    context.route('**/*', lambda r: r.continue_() if r.request.url.startswith((BASE, CFG['API_URL'])) else r.abort())
    def address_response(route):
        if 'unavailable' in route.request.url:
            route.fulfill(status=503, body='Unavailable')
            return
        def feature(number, country='US'):
            return {'geometry': {'coordinates': [-97.7, 30.3]}, 'properties': {
                'housenumber': number, 'street': 'Test Garden Lane', 'city': 'Austin',
                'state': 'Texas', 'postcode': '78701', 'countrycode': country,
            }}
        route.fulfill(json={'features': [feature('123'), feature('123'), feature('456'), feature('789', 'GB')]})
    context.route('https://photon.komoot.io/api/**', address_response)
    page = context.new_page()
    page.goto(BASE + '/?utm_source=google&utm_medium=cpc&utm_campaign=landscaping-test&utm_content=door-project#service-inquiry')
    page.wait_for_load_state('networkidle')
    form = page.locator('#service-inquiry')
    assert form.get_by_role('heading', name='Landscaping & other outdoor projects.').count() == 1
    assert page.locator('#map-quote').count() == 1
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    for width in (901, 1000, 1050, 1440):
        page.set_viewport_size({'width': width, 'height': 900})
        assert page.locator('.nav-cta').bounding_box()['height'] < 68
    page.set_viewport_size({'width': 390, 'height': 844})
    form.locator('input[name=name]').fill('Project Test ' + str(uuid.uuid4())[:8])
    form.locator('input[name=phone]').fill('+15125550123')
    form.locator('select[name=service]').select_option('Landscaping')
    form.locator('textarea[name=notes]').fill('Please discuss the front garden; no mowing requested.')
    form.get_by_role('button', name='Send project inquiry').click()
    assert form.locator('input[name=address]').evaluate('(e) => e.validity.valueMissing')
    address_input = form.locator('input[name=address]')
    address_input.fill('123 Test')
    form.get_by_role('option', name='123 Test Garden Lane, Austin, Texas 78701', exact=True).wait_for()
    assert form.get_by_role('listbox').get_by_role('option').count() == 2
    address_input.press('ArrowDown')
    address_input.press('Enter')
    assert address_input.input_value() == '123 Test Garden Lane, Austin, Texas 78701'
    assert form.get_by_role('listbox').count() == 0
    address_input.fill('456 Test')
    form.get_by_role('option', name='456 Test Garden Lane, Austin, Texas 78701', exact=True).click()
    assert address_input.input_value() == '456 Test Garden Lane, Austin, Texas 78701'
    address_input.fill('123 Test')
    address_input.press('Escape')
    page.wait_for_timeout(700)
    assert form.get_by_role('listbox').count() == 0
    address_input.fill('unavailable provider address')
    page.wait_for_timeout(700)
    assert form.get_by_role('listbox').count() == 0
    assert address_input.input_value() == 'unavailable provider address'
    address_input.fill('123 Test')
    form.get_by_role('option', name='123 Test Garden Lane, Austin, Texas 78701', exact=True).click()
    form.locator('input[name=email]').fill('garden@example.test')
    captured = []
    page.on('request', lambda r: captured.append({'headers': r.all_headers(), 'body': r.post_data})
            if r.method == 'POST' and r.headers.get('next-action') else None)
    form.get_by_role('button', name='Send project inquiry').click()
    form.get_by_role('heading', name='Thanks, we got your project details.').wait_for()
    submission = json.loads(captured[0]['body'])[0]['submission_id']
    assert page.evaluate("sessionStorage.getItem('qg_submission_service')") is None
    rows = db('leads?source=eq.website-service&external_submission_id=eq.' + submission)
    assert len(rows) == 1
    lead = rows[0]
    assert lead['services'] == ['Landscaping']
    assert lead['address'] == '123 Test Garden Lane, Austin, Texas 78701'
    assert lead['answers']['notes'] == 'Please discuss the front garden; no mowing requested.'
    assert lead['sq_ft'] is None and lead['quote_confirmed_at'] is None
    assert lead['email'] == 'garden@example.test'
    assert lead['consent'] is False
    assert lead['attribution']['first_touch']['utm_campaign'] == 'landscaping-test'
    assert db('bookings?lead_id=eq.' + lead['id']) == []
    events = db('intake_events?lead_id=eq.' + lead['id'])
    assert len(events) == 1
    alerts = db('staff_alerts?event_id=eq.' + events[0]['id'])
    assert len(alerts) == 2 and all(a['state'] == 'accepted' and a['attempts'] == 1 for a in alerts)
    action = captured[0]
    headers = {'Next-Action': action['headers']['next-action'],
               'Content-Type': action['headers']['content-type'], 'Origin': BASE}
    replay = context.request.post(BASE + '/', data=action['body'], headers=headers)
    assert replay.status == 200 and '"success":true' in replay.text()
    assert len(db('intake_events?lead_id=eq.' + lead['id'])) == 1
    assert all(a['attempts'] == 1 for a in db('staff_alerts?event_id=eq.' + events[0]['id']))
    # Exercise server validation directly through the captured public Server Action.
    args = json.loads(action['body'])
    for field, value in [('service', 'Unlisted service'), ('address', ''), ('phone', '-------'), ('notes', 'x' * 2001)]:
        invalid = {**args[0], 'submission_id': str(uuid.uuid4()), field: value}
        result = context.request.post(BASE + '/', data=json.dumps([invalid]), headers=headers)
        assert result.status == 200 and '"success":false' in result.text(), (field, result.text())
        assert db('leads?external_submission_id=eq.' + invalid['submission_id']) == []
    form.get_by_role('button', name='Start a new inquiry').click()
    assert page.evaluate("sessionStorage.getItem('qg_submission_service')") is None
    assert form.locator('input[name=name]').input_value() == ''
    # Existing manual mowing entry remains available and keeps its mowing semantics.
    page.get_by_role('button', name="Don't want to draw?", exact=False).click()
    manual = page.locator('.manualq-inline-form')
    manual.get_by_placeholder('Your name').fill('Mowing Regression')
    manual.get_by_placeholder('Phone number').fill('+15125550124')
    manual.get_by_placeholder('Property address').fill('456 Test Mowing Lane, Austin, TX 78701')
    manual.get_by_role('button', name='Get my quote').click()
    page.locator('.manualq-inline-success').wait_for()
    manual_id = page.evaluate("sessionStorage.getItem('qg_submission_manual')")
    assert db('leads?source=eq.website-manual&external_submission_id=eq.' + manual_id)[0]['services'] == ['Lawn care']
    # Stored details are accessible through the protected staff workspace.
    page.goto(BASE + '/admin/leads/' + lead['id'])
    page.locator('input[name=email]').fill('staff@example.test')
    page.locator('input[name=password]').fill('Local-test-password-123!')
    page.get_by_role('button', name='Sign in').click()
    page.wait_for_url(BASE + '/admin/leads/' + lead['id'])
    page.get_by_role('heading', name=lead['name']).wait_for()
    page.get_by_text('Answers and acquisition details', exact=True).click()
    assert page.locator('pre').filter(has_text='Please discuss the front garden').is_visible()
    assert page.get_by_role('link', name='Call +15125550123').is_visible()
    # Storage failures must give a recoverable error rather than a stuck button.
    broken = browser.new_context()
    broken.route('**/*', lambda r: r.continue_() if r.request.url.startswith((BASE, CFG['API_URL'])) else r.abort())
    broken.add_init_script("Storage.prototype.getItem = function () { throw new Error('Test: unavailable storage') }")
    blocked = broken.new_page()
    blocked.goto(BASE + '/#service-inquiry')
    failed_form = blocked.locator('#service-inquiry')
    failed_form.locator('input[name=name]').fill('Storage test')
    failed_form.locator('input[name=phone]').fill('+15125550123')
    failed_form.locator('input[name=address]').fill('789 Test Lane')
    failed_form.locator('select[name=service]').select_option('Other')
    failed_form.get_by_role('button', name='Send project inquiry').click()
    failed_form.get_by_role('alert').wait_for()
    assert failed_form.get_by_role('button', name='Send project inquiry').is_enabled()
    broken.close()
    browser.close()

print('PASS: responsive layout, required address, unpriced landscaping inquiry, attribution, no booking, two simulated SMS alerts, retry deduplication, server validation, new-inquiry reset, existing manual mowing intake, staff visibility, storage-failure recovery.')
