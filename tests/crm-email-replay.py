"""Confirm through the real staff UI, replay its same action, and count mocked provider sends."""
import json
import os
import pathlib
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

cfg = json.loads(pathlib.Path('/tmp/qg-test-config.json').read_text())
BASE = 'http://localhost:3103'
assert cfg['API_URL'] == 'http://127.0.0.1:56421'
assert urllib.parse.urlsplit(cfg['REST_URL']).netloc == '127.0.0.1:56421'
build = pathlib.Path('/tmp/qg-crm-build-path').read_text().strip()
assert pathlib.Path(build, '.next').exists()
sends = []

class Provider(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != '/emails':
            self.send_error(404)
            return
        payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        sends.append({'to': payload['to'], 'subject': payload['subject']})
        body = b'{"id":"em_disposable_mock"}'
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass

provider = ThreadingHTTPServer(('127.0.0.1', 3188), Provider)
thread = threading.Thread(target=provider.serve_forever, daemon=True)
thread.start()
env = os.environ.copy()
env.update({'RESEND_API_KEY': 're_disposable_dummy', 'RESEND_BASE_URL': 'http://127.0.0.1:3188',
            'NODE_OPTIONS': '--require ' + str(pathlib.Path(__file__).with_name('email-network-guard.cjs'))})
server_log = open('/tmp/qg-email-next.log', 'w')
app = subprocess.Popen([str(pathlib.Path(build, 'node_modules/.bin/next')), 'start', '--port', '3103'],
                       cwd=build, env=env, stdout=server_log, stderr=subprocess.STDOUT)

def db(path, method='GET', body=None):
    headers = {'apikey': cfg['SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + cfg['SERVICE_ROLE_KEY'],
               'Content-Type': 'application/json', 'Prefer': 'return=representation'}
    request = urllib.request.Request(cfg['REST_URL'].rstrip('/') + '/' + path,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.loads(response.read())

try:
    for _ in range(80):
        if app.poll() is not None:
            raise RuntimeError('Isolated Next server exited before becoming ready')
        try:
            with urllib.request.urlopen(BASE + '/admin/login', timeout=1):
                break
        except Exception:
            time.sleep(0.25)
    else:
        raise RuntimeError('Isolated Next server did not become ready')

    marker = uuid.uuid4().hex[:8]
    name = 'Email replay ' + marker
    job = db('bookings', 'POST', {'name': name, 'phone': '5550003988',
        'email': 'email-replay@example.test', 'address': marker + ' Mock Lane',
        'status': 'pending', 'preferred_date': '2027-01-03', 'one_time': True,
        'job_total': '50.00'})[0]

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 390, 'height': 844})
        page.route('**/*', lambda route: route.continue_() if urllib.parse.urlsplit(route.request.url).netloc in ('localhost:3103', '127.0.0.1:56421') else route.abort())
        page.goto(BASE + '/admin/login?next=' + urllib.parse.quote('/admin?search=' + marker, safe=''))
        page.locator('input[name=email]').fill('staff@example.test')
        page.locator('input[name=password]').fill('Local-test-password-123!')
        page.get_by_role('button', name='Sign in').click()
        page.wait_for_url('**/admin/leads')
        page.goto(BASE + '/admin?search=' + marker)
        try:
            page.wait_for_load_state('networkidle', timeout=5000)
        except PlaywrightTimeoutError:
            pass
        card = page.locator('.admin-card', has_text=name)
        card.wait_for(timeout=15000)
        card.locator('.admin-card-summary').click()
        button = card.get_by_role('button', name='Confirm & email customer')
        button.wait_for(timeout=10000)
        with page.expect_request(lambda request: request.method == 'POST'
                                 and request.url.startswith(BASE + '/admin')
                                 and 'next-action' in request.headers) as sent:
            button.click()
        page.get_by_text('Visit confirmed.').wait_for(timeout=15000)
        first = sent.value
        assert len(sends) == 1
        headers = {k: v for k, v in first.all_headers().items()
                   if k.lower() not in ('host', 'content-length', 'cookie')}
        replay = page.request.post(first.url, data=first.post_data, headers=headers)
        assert replay.ok, replay.status
        assert len(sends) == 1, 'Same operation must not resend the email'
        assert db('bookings?id=eq.' + job['id'])[0]['status'] == 'confirmed'
        browser.close()
    print('PASS: confirmed visit sent one mocked email; identical server-action replay sent none')
finally:
    app.terminate()
    try:
        app.wait(timeout=5)
    except subprocess.TimeoutExpired:
        app.kill()
        app.wait(timeout=5)
    server_log.close()
    provider.shutdown()
    provider.server_close()
