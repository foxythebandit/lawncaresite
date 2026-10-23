"""Quote outcomes: booked then canceled (lead and job card paths) keeps history and records a canceled quote."""
import datetime
import json
import pathlib
import uuid
import urllib.parse
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


name = 'Cancel customer ' + uuid.uuid4().hex[:8]
lead = db('leads', {'name': name, 'phone': '+1512555' + str(uuid.uuid4().int % 9000 + 1000), 'address': '2205 Pearl St, Austin, TX 78705',
                    'services': ['Mowing'], 'sq_ft': 2800, 'frequency': 'Weekly', 'source': 'website-map'})[0]
lead_id = lead['id']
first_visit = (datetime.date.today() + datetime.timedelta(days=4)).isoformat()

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1360, 'height': 900})
    context.route('**/*', lambda route: route.continue_() if urlparse(route.request.url).netloc in ('localhost:3102', '127.0.0.1:56421') else route.abort())
    page = context.new_page()
    page.on('dialog', lambda dialog: dialog.accept())
    page.goto(BASE + '/admin/leads/' + lead_id)
    page.locator('input[name=email]').fill('staff@example.test')
    page.locator('input[name=password]').fill('Local-test-password-123!')
    page.get_by_role('button', name='Sign in').click()
    page.wait_for_url(BASE + '/admin/leads/' + lead_id)
    page.get_by_role('heading', name=name).wait_for()
    page.add_style_tag(content='nextjs-portal { display: none !important; }')

    page.get_by_role('button', name='Save as quoted', exact=True).click()
    page.get_by_role('status').filter(has_text='Saved as quoted.').wait_for()
    page.get_by_role('button', name='Book visit', exact=True).click()
    page.locator('.crm-booking-request input[type=date]').fill(first_visit)
    page.get_by_role('button', name='Confirm booking', exact=True).click()
    page.get_by_text('Visit booked and mowing plan started.').first.wait_for()
    page.get_by_text('Update lead and follow-up', exact=True).click()
    page.get_by_label('Note', exact=True).fill('Booking confirmed with customer')
    page.get_by_role('button', name='Add note').click()
    page.get_by_role('status').filter(has_text='Saved.').wait_for()
    assert db('lead_activities?lead_id=eq.' + lead_id + '&kind=eq.note&body=eq.Booking%20confirmed%20with%20customer')
    job = db('bookings?lead_id=eq.' + lead_id)[0]
    assert job['agreement_id']

    # Lead path: customer backs out before the first visit.
    page.get_by_role('button', name='Customer canceled', exact=True).click()
    review = page.get_by_role('group', name='Review cancellation')
    review.wait_for()
    assert review.locator('li').count() == 1
    assert review.get_by_text('Visit 1', exact=False).is_visible()
    review.get_by_role('button', name='Confirm cancellation').click()
    page.get_by_text('Canceled after booking', exact=True).wait_for()
    canceled = db('leads?id=eq.' + lead_id)[0]
    assert canceled['quote_status'] == 'canceled' and canceled['stage'] == 'lost'
    assert canceled['accepted_quote_snapshot'] and canceled['quote_accepted_at']
    assert db('bookings?id=eq.' + job['id'])[0]['status'] == 'canceled'
    assert db('recurring_agreements?id=eq.' + job['agreement_id'])[0]['status'] == 'ended'
    assert all(row['status'] == 'canceled' for row in db('bookings?agreement_id=eq.' + job['agreement_id']))
    assert db('lead_activities?lead_id=eq.' + lead_id + '&outcome=eq.canceled')

    # They come back: book again (no plan this time), then cancel from the job card.
    page.get_by_role('button', name='Book again', exact=True).click()
    page.get_by_label('Start weekly mowing plan', exact=False).uncheck()
    page.get_by_role('button', name='Confirm booking', exact=True).click()
    page.get_by_text('Visit booked.').first.wait_for()
    rebooked = db('leads?id=eq.' + lead_id)[0]
    assert rebooked['quote_status'] == 'accepted' and rebooked['stage'] == 'booked'
    jobs = db('bookings?lead_id=eq.' + lead_id + '&order=created_at')
    assert len(jobs) == 2 and jobs[1]['status'] == 'pending' and jobs[1]['agreement_id'] is None
    page.goto(BASE + '/admin?search=' + urllib.parse.quote(name))
    card = page.locator('.admin-card', has_text=name).filter(has=page.locator('.admin-badge-pending')).first
    card.locator('.admin-card-summary').click()
    card.get_by_role('button', name='Cancel visit').click()
    page.get_by_text('Visit canceled and retained in history.').first.wait_for()
    assert db('bookings?id=eq.' + jobs[1]['id'])[0]['status'] == 'canceled'
    final = db('leads?id=eq.' + lead_id)[0]
    assert final['quote_status'] == 'canceled' and final['stage'] == 'lost'
    page.goto(BASE + '/admin/leads')
    row = page.locator('.crm-lead', has_text=name)
    assert row.get_by_text('Canceled', exact=True).is_visible()
    page.goto(BASE + '/admin/leads/' + lead_id)
    old_snapshots = {row['id']: row['accepted_quote_snapshot'] for row in db('bookings?lead_id=eq.' + lead_id)}
    page.get_by_label('Custom price ($)').fill('87.25')
    page.get_by_role('button', name='Save as quoted', exact=True).click()
    page.get_by_role('status').filter(has_text='Saved as quoted.').wait_for()
    assert page.get_by_role('button', name='Book visit', exact=True).is_visible()
    page.get_by_role('button', name='Book visit', exact=True).click()
    page.get_by_label('Start weekly mowing plan', exact=False).uncheck()
    page.get_by_role('button', name='Confirm booking', exact=True).click()
    page.get_by_text('Visit booked.').first.wait_for()
    revised_jobs = db('bookings?lead_id=eq.' + lead_id)
    assert len(revised_jobs) == 3
    revised = next(row for row in revised_jobs if row['id'] not in old_snapshots)
    assert float(revised['job_total']) == 87.25
    assert revised['accepted_quote_snapshot']['quote_draft']['overridePrice'] == 87.25
    assert all(row['accepted_quote_snapshot'] == old_snapshots[row['id']] for row in revised_jobs if row['id'] in old_snapshots)

    # A completed quoted visit creates a newer plan visit with the same lead ID.
    # Canceling that generated visit must leave the accepted quote alone.
    repeat_name = 'Completed first ' + uuid.uuid4().hex[:8]
    repeat = db('leads', {'name': repeat_name, 'phone': '+1512555' + str(uuid.uuid4().int % 9000 + 1000),
                          'address': '2205 Pearl St, Austin, TX 78705', 'services': ['Mowing'],
                          'sq_ft': 2800, 'frequency': 'Weekly', 'source': 'website-map'})[0]
    page.goto(BASE + '/admin/leads/' + repeat['id'])
    page.get_by_role('button', name='Save as quoted', exact=True).click()
    page.get_by_role('status').filter(has_text='Saved as quoted.').wait_for()
    page.get_by_role('button', name='Book visit', exact=True).click()
    page.locator('.crm-booking-request input[type=date]').fill(first_visit)
    page.get_by_role('button', name='Confirm booking', exact=True).click()
    page.get_by_text('Visit booked and mowing plan started.').first.wait_for()
    original = db('bookings?lead_id=eq.' + repeat['id'])[0]
    page.goto(BASE + '/admin?search=' + urllib.parse.quote(repeat_name))
    first_card = page.locator('.admin-card', has_text=repeat_name).first
    first_card.locator('.admin-card-summary').click()
    first_card.get_by_label('Visit date').fill(first_visit)
    first_card.get_by_role('button', name='Save visit date').click()
    page.get_by_text('Visit confirmed.').first.wait_for()
    first_card = page.locator('.admin-card', has_text=repeat_name).first
    first_card.get_by_label('Date completed').fill(first_visit)
    first_card.get_by_role('button', name='Mark complete').click()
    page.get_by_text('Visit completed.').first.wait_for()
    generated = [row for row in db('bookings?lead_id=eq.' + repeat['id']) if row['id'] != original['id']]
    assert len(generated) == 1 and generated[0]['status'] == 'confirmed'
    page.goto(BASE + '/admin/leads/' + repeat['id'])
    page.locator('.crm-sec-quote .crm-chip').filter(has_text='Booked').wait_for()
    assert page.get_by_role('button', name='Customer canceled', exact=True).count() == 0
    page.goto(BASE + '/admin?search=' + urllib.parse.quote(repeat_name))
    next_card = page.locator('.admin-card', has_text=repeat_name).filter(has=page.locator('.admin-badge-confirmed')).first
    next_card.locator('.admin-card-summary').click()
    next_card.get_by_role('button', name='Cancel visit').click()
    page.get_by_text('Visit canceled and retained in history.').first.wait_for()
    assert db('leads?id=eq.' + repeat['id'])[0]['quote_status'] == 'accepted'
    assert db('bookings?id=eq.' + original['id'])[0]['status'] == 'completed'

    # A quote accepted before a job was created still needs a recovery action
    # after the contact property changes (for example, an interrupted booking).
    recovery_name = 'Changed property ' + uuid.uuid4().hex[:8]
    recovery = db('leads', {'name': recovery_name, 'phone': '+1512555' + str(uuid.uuid4().int % 9000 + 1000),
                            'address': '2205 Pearl St, Austin, TX 78705', 'services': ['Mowing'],
                            'sq_ft': 2800, 'frequency': 'Weekly', 'source': 'website-map'})[0]
    page.goto(BASE + '/admin/leads/' + recovery['id'])
    page.get_by_role('button', name='Save as quoted', exact=True).click()
    page.get_by_role('status').filter(has_text='Saved as quoted.').wait_for()
    saved_recovery = db('leads?id=eq.' + recovery['id'])[0]
    db('rpc/update_lead_workflow', {'p_lead_id': recovery['id'], 'p_expected_updated_at': saved_recovery['updated_at'],
                                    'p_patch': {'quote_status': 'accepted'},
                                    'p_activity': {'kind': 'quote', 'outcome': 'accepted'},
                                    'p_actor_email': 'staff@example.test'})
    page.reload()
    page.get_by_text('Edit contact', exact=True).click()
    page.get_by_label('Property address', exact=True).fill('999 Temporary Test Property, Austin, TX')
    page.get_by_role('button', name='Save contact').click()
    page.get_by_text('Contact address changed.', exact=False).wait_for()
    assert page.get_by_role('button', name='Book visit', exact=True).count() == 0
    page.get_by_role('button', name='Cancel acceptance').click()
    page.get_by_role('status').filter(has_text='Saved.').wait_for()
    assert db('leads?id=eq.' + recovery['id'])[0]['quote_status'] == 'canceled'
    assert page.get_by_role('button', name='Start quote for updated address').is_visible()
    browser.close()

print('PASS: quote cancellation preserves history, rebooking and revised quotes work, generated visits preserve acceptance, address recovery remains available')
