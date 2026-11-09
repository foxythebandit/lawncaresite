"""Local browser regression for the staff calendar and exact visit actions.

Run with the feature worktree's `work serve` server and a seeded local database.
Set QG_CALENDAR_SCREEN_DIR to capture desktop and phone evidence.
"""
import json
import os
import re
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from uuid import uuid4
from zoneinfo import ZoneInfo

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("QG_CALENDAR_BASE", "http://localhost:3001").rstrip("/")
LOCAL = {"localhost", "127.0.0.1", "::1"}
assert urlsplit(BASE).scheme == "http" and urlsplit(BASE).hostname in LOCAL
assert urlsplit(BASE).path == ""
ENV = {}
for line in Path(".env.local").read_text().splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        key, value = line.split("=", 1)
        ENV[key.strip()] = value.strip().strip("'\042")
assert not any(ENV.get(key) or os.environ.get(key) for key in (
    "RESEND_API_KEY", "TWILIO_AUTH_TOKEN", "STRIPE_SECRET_KEY",
)), "Use a local server without notification or payment provider credentials"
API = ENV["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
assert urlsplit(API).scheme == "http" and urlsplit(API).hostname in LOCAL
cli = str(Path("node_modules/.bin/supabase").resolve())
status = subprocess.check_output([cli, "status", "--env", "--output-format", "text"], text=True)
assert re.search(r"^API_URL=['\042]?" + re.escape(API) + r"['\042]?$", status, re.M), "App and fixture DB must match"
SECRET = ENV["SUPABASE_SECRET_KEY"]
TODAY = datetime.now(ZoneInfo("America/Chicago")).date()
MONDAY = TODAY + timedelta(days=(-TODAY.weekday()) % 7)
SCREEN_DIR = os.environ.get("QG_CALENDAR_SCREEN_DIR")

def request(path, method="GET", payload=None):
    req = Request(API + "/rest/v1/" + path, method=method, headers={
        "apikey": SECRET, "Content-Type": "application/json", "Prefer": "return=representation",
    }, data=json.dumps(payload).encode() if payload is not None else None)
    try:
        with urlopen(req, timeout=15) as response:
            body = response.read()
            return json.loads(body) if body else None
    except HTTPError as error:
        raise AssertionError(f"{method} {path}: {error.code} {error.read().decode()}") from None

def day(offset):
    return (MONDAY + timedelta(days=offset)).isoformat()

def shot(page, name):
    if SCREEN_DIR:
        path = Path(SCREEN_DIR)
        path.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(path / (name + ".png")), full_page=True, animations="disabled")

def assert_no_overflow(page):
    widths = page.evaluate("() => [document.documentElement.clientWidth, document.documentElement.scrollWidth]")
    assert widths[1] <= widths[0], f"Page overflows: {widths}"

def calendar(view="week", on=None, **extra):
    return BASE + "/admin/jobs?" + urlencode({"view": view, "date": on or day(0), **extra})

def login(page):
    page.get_by_label("Email", exact=True).fill("staff@example.test")
    page.get_by_label("Password", exact=True).fill("password123")
    page.get_by_role("button", name="Sign in", exact=True).click()

def create_visit(customer, name, address, on, arrival, service, price, status="confirmed", **extra):
    booking_id = str(uuid4())
    visit_ids.append(booking_id)
    request("bookings", "POST", {
        "id": booking_id, "customer_id": customer["id"], "property_id": customer["property"],
        "name": name, "phone": customer["phone"], "address": address, "status": status,
        "confirmed_date": on if status != "pending" else None,
        "preferred_date": on, "confirmed_time": arrival if status != "pending" else None,
        "preferred_time": arrival, "job_total": price, "one_time": True, **extra,
    })
    request("job_items", "POST", {"booking_id": booking_id, "kind": "service", "description": service, "amount": price})
    return booking_id

customers = []
lead_ids = []
visit_ids = []
def create_customer(name, address, suffix):
    customer = {"id": str(uuid4()), "name": name, "phone": f"51255501{suffix:02d}", "property": str(uuid4())}
    customers.append(customer)
    request("customers", "POST", {key: customer[key] for key in ("id", "name", "phone")})
    request("properties", "POST", {"id": customer["property"], "customer_id": customer["id"], "address": address})
    return customer

def visit(id_):
    return request(f"bookings?id=eq.{id_}&select=id,status,confirmed_date,job_total,notes,updated_at")[0]

def fixture():
    name, address = "Kelli Alvarez", "104 Cinder Grove Lane, Austin, TX 78745"
    customer = create_customer(name, address, 81)
    mowing = create_visit(customer, name, address, day(1), "Morning", "Lawn care", 85.50,
                          customer_notes="Use the side gate. The dog stays inside on Tuesdays.")
    cleanup = create_visit(customer, name, address, day(1), "14:15", "Leaf cleanup", 250.00)
    long_name = "Christopher and Alexandra Montgomery-Rivera"
    long_addr = "888 Meadowridge Crossing, Unit 12B, Austin, TX 78748"
    long_customer = create_customer(long_name, long_addr, 82)
    create_visit(long_customer, long_name, long_addr, day(2), "Afternoon", "Bed maintenance", 112.25)
    create_visit(long_customer, long_name, long_addr, day(2), "After school pickup", "Hedge trimming", 95.00)
    create_visit(long_customer, long_name, long_addr, day(3), "Any time", "Mulch", 145.00, status="completed",
                 completed_at=f"{day(3)}T15:00:00Z")
    unnamed_addr = "71 Willowbank Walk, Apt 4, Austin, TX 78744"
    unnamed = create_customer("", unnamed_addr, 83)
    unnamed_visit = create_visit(unnamed, unnamed["phone"], unnamed_addr, day(4), None, "Lawn care", 70.00)
    overdue = create_visit(customer, name, address, (TODAY - timedelta(days=8)).isoformat(), None, "Lawn care", 85.50)
    pending = create_visit(unnamed, "", unnamed_addr, None, None, "Leaf cleanup", 130.00, status="pending")
    create_visit(unnamed, "", unnamed_addr, day(2), "Morning", "Lawn care", 70.00, status="pending")

    recurring_name, recurring_address = "Noah Park", "303 Crescent Field Drive, Austin, TX 78749"
    recurring = create_customer(recurring_name, recurring_address, 84)
    first = create_visit(recurring, recurring_name, recurring_address, day(2), "Morning", "Lawn care", 64.00, one_time=False, email="noah@example.test")
    plan = request("rpc/crm_start_agreement", "POST", {
        "p_booking_id": first, "p_expected_updated_at": visit(first)["updated_at"], "p_operation_id": str(uuid4()),
        "p_config": {"anchor_on": day(2), "next_on": day(9), "interval_unit": "week", "interval_count": 1,
                     "items_template": [{"kind": "service", "description": "Lawn care", "amount": "64.00"}]},
    })["agreement_id"]
    moved = request(f"bookings?agreement_id=eq.{plan}&occurrence_on=eq.{day(16)}&select=id")[0]["id"]
    request(f"bookings?id=eq.{moved}", "PATCH", {"confirmed_date": day(100), "preferred_date": day(100)})
    unlinked = create_visit(customer, name, address, None, None, "Lawn care", 80.00, status="pending",
                            customer_id=None, property_id=None)
    lead_id = str(uuid4())
    lead_ids.append(lead_id)
    request("leads", "POST", {"id": lead_id, "phone": unnamed["phone"], "address": unnamed_addr, "source": "staff"})
    return mowing, cleanup, unnamed_visit, overdue, pending, moved, plan, customer, unlinked

def local_browser(browser, width, height):
    context = browser.new_context(viewport={"width": width, "height": height},
                                  timezone_id="America/Chicago", service_workers="block")
    allowed = {urlsplit(BASE).netloc, urlsplit(API).netloc}
    context.route("**/*", lambda route: route.continue_() if urlsplit(route.request.url).netloc in allowed else route.abort())
    return context

def clean_up():
    if not customers:
        return
    ids = ", ".join(f"'{c['id']}'" for c in customers)
    extra_visits = ", ".join(f"'{visit_id}'" for visit_id in visit_ids) or "null"
    owned = f"customer_id in ({ids}) or id in ({extra_visits})"
    for lead_id in lead_ids:
        request(f"leads?id=eq.{lead_id}", "DELETE")
    subprocess.run([cli, "db", "query", "--local", f"""
        do $test$
        begin
          update public.recurring_agreements set schedule_source_booking_id = null where customer_id in ({ids});
          delete from public.crm_operations where target_id in (select id from public.bookings where {owned})
            or target_id in (select id from public.recurring_agreements where customer_id in ({ids}));
          delete from public.job_payments where booking_id in (select id from public.bookings where {owned});
          delete from public.job_items where booking_id in (select id from public.bookings where {owned});
          delete from public.bookings where {owned};
          delete from public.agreement_schedule_revisions where agreement_id in (
            select id from public.recurring_agreements where customer_id in ({ids}));
          delete from public.recurring_agreements where customer_id in ({ids});
          delete from public.properties where customer_id in ({ids});
          delete from public.customers where id in ({ids});
        end $test$;
    """], check=True, capture_output=True, text=True)

try:
    mowing, cleanup, unnamed_visit, overdue, pending, moved, plan, customer, unlinked = fixture()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        errors = []
        desktop = local_browser(browser, 1440, 1000)
        page = desktop.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        geocodes = []
        def stub_geocode(route):
            geocodes.append(route.request.url)
            route.fulfill(json=[{"lat": "30.174", "lon": "-97.812"}])
        page.route("https://nominatim.openstreetmap.org/**", stub_geocode)
        page.goto(f"{BASE}/admin/jobs/{mowing}")
        expect(page.get_by_role("heading", name="Staff sign in")).to_be_visible()
        login(page)
        page.wait_for_url(re.compile(r"/admin/jobs/" + mowing + r"$"))
        expect(page.get_by_role("heading", name="Kelli Alvarez")).to_be_visible()
        shot(page, "visit-desktop")
        page.goto(BASE + "/admin/jobs")
        expect(page.get_by_role("navigation", name="Calendar view").get_by_role("link", name="Week")).to_have_attribute("aria-current", "page")
        page.goto(calendar())
        expect(page.get_by_role("link", name=re.compile(r"Kelli Alvarez, Lawn care, Morning"))).to_be_visible()
        expect(page.get_by_role("link", name=re.compile(r"Kelli Alvarez, Leaf cleanup, 2:15 PM"))).to_be_visible()
        expect(page.get_by_role("link", name=re.compile("Hedge trimming, After school pickup"))).to_be_visible()
        expect(page.get_by_role("link", name=re.compile("71 Willowbank Walk, Apt 4.*Lawn care"))).to_be_visible()
        expect(page.get_by_role("link", name=re.compile("Mulch.*Done"))).to_be_visible()
        assert_no_overflow(page)
        shot(page, "calendar-week-desktop")
        assert not geocodes
        map_button = page.get_by_role("button", name="Map", exact=True)
        map_button.click()
        expect(page.locator("#calendar-map .leaflet-marker-icon").first).to_be_visible()
        assert geocodes
        map_button_count = len(geocodes)
        page.get_by_role("button", name="Hide map").click()
        expect(map_button).to_be_focused()
        map_button.click()
        expect(page.locator("#calendar-map .leaflet-marker-icon").first).to_be_visible()
        assert len(geocodes) == map_button_count
        page.get_by_role("button", name="Hide map").click()
        page.get_by_role("navigation", name="Calendar view").get_by_role("link", name="Month").click()
        expect(page.get_by_role("button", name=re.compile("Tuesday.*2 visits"))).to_be_visible()
        shot(page, "calendar-month-desktop")
        page.goto(calendar("day", day(1)))
        expect(page.get_by_role("link", name=re.compile("Kelli Alvarez, Leaf cleanup"))).to_be_visible()
        shot(page, "calendar-day-desktop")
        page.goto(calendar(attention="schedule_review"))
        expect(page.get_by_role("link", name=re.compile("Noah Park.*moved visit conflicts.*Review schedule"))).to_have_attribute("href", re.compile(moved))
        shot(page, "calendar-review-desktop")
        page.get_by_role("link", name=re.compile("Noah Park.*moved visit conflicts.*Review schedule")).click()
        page.wait_for_url(re.compile("/admin/jobs/" + moved + r"\?"))
        expect(page.get_by_role("heading", name="Noah Park", exact=True)).to_be_visible()
        expect(page.get_by_text("Needs schedule review", exact=True)).to_be_visible()
        page.get_by_role("button", name="Edit schedule", exact=True).click()
        expect(page.get_by_role("region", name="Service schedule").get_by_role("alert")).to_contain_text(day(100))
        page.get_by_role("button", name="Close", exact=True).click()
        page.get_by_role("button", name="Reschedule", exact=True).click()
        page.get_by_label("Visit date", exact=True).fill(day(107))
        page.get_by_role("button", name="Save visit date", exact=True).click()
        expect(page.get_by_role("region", name="Visit date and arrival").get_by_role("alert")).to_contain_text("already has a visit on that date")
        assert visit(moved)["confirmed_date"] == day(100)
        page.goto(calendar(attention="overdue"))
        expect(page.get_by_role("region", name="Overdue").get_by_role("link", name=re.compile("Kelli Alvarez"))).to_have_attribute("href", re.compile(overdue))
        page.goto(calendar(attention="needs_scheduling"))
        expect(page.get_by_role("region", name="Needs scheduling").get_by_role("link", name=re.compile("Willowbank Walk.*Leaf cleanup"))).to_have_attribute("href", re.compile(pending))
        expect(page.get_by_role("region", name="Needs scheduling").get_by_role("link", name=re.compile("Willowbank Walk.*Lawn care.*Requested"))).to_be_visible()
        shot(page, "calendar-requests-desktop")
        page.goto(calendar(search="Willowbank"))
        result = page.get_by_role("region", name="Search results").get_by_role("link", name=re.compile("Willowbank Walk.*Scheduled"))
        expect(result).to_have_attribute("href", re.compile(unnamed_visit))
        result.click()
        page.get_by_role("link", name="Back to calendar").click()
        expect(page.get_by_role("searchbox", name="Search visits")).to_have_value("Willowbank")
        expect(page.get_by_role("region", name="Search results")).to_be_visible()

        for width in (390, 320):
            phone = local_browser(browser, width, 844)
            mobile = phone.new_page()
            mobile.on("pageerror", lambda error: errors.append(str(error)))
            mobile.goto(BASE + "/admin/jobs")
            login(mobile)
            expect(mobile.get_by_role("navigation", name="Calendar view").get_by_role("link", name="Week")).to_have_attribute("aria-current", "page")
            mobile.goto(calendar())
            assert_no_overflow(mobile)
            expect(mobile.get_by_label("Days this week").get_by_role("button")).to_have_count(7)
            assert mobile.locator(".work-cal-canvas").evaluate("(el) => el.scrollWidth > el.clientWidth")
            month = mobile.get_by_role("navigation", name="Calendar view").get_by_role("link", name="Month")
            toolbar = mobile.get_by_role("navigation", name="Calendar view")
            assert month.bounding_box()["x"] + month.bounding_box()["width"] <= toolbar.bounding_box()["x"] + toolbar.bounding_box()["width"] + 1
            mobile.get_by_label("Days this week").get_by_role("button", name=re.compile("^Tuesday")).click()
            mobile.wait_for_url(re.compile("date=" + day(1)))
            if width == 390:
                mobile.reload()
                expect(mobile.get_by_label("Days this week").get_by_role("button", name=re.compile("^Tuesday"))).to_have_attribute("aria-pressed", "true")
            shot(mobile, f"calendar-week-{width}")
            link = mobile.get_by_role("link", name=re.compile("Kelli Alvarez, Lawn care, Morning"))
            link.focus()
            link.press("Enter")
            mobile.wait_for_url(re.compile("/admin/jobs/" + mowing + r"\?"))
            expect(mobile.get_by_role("heading", name="Kelli Alvarez")).to_be_visible()
            assert_no_overflow(mobile)
            shot(mobile, f"visit-{width}")
            mobile.get_by_role("button", name="Reschedule", exact=True).click()
            expect(mobile.get_by_role("heading", name="Visit date and arrival")).to_be_focused()
            assert_no_overflow(mobile)
            shot(mobile, f"visit-reschedule-{width}")
            mobile.get_by_role("button", name="Close", exact=True).click()
            expect(mobile.get_by_role("button", name="Reschedule", exact=True)).to_be_focused()
            mobile.get_by_role("link", name="Back to calendar").click()
            expect(mobile.get_by_role("link", name=re.compile("Kelli Alvarez, Lawn care, Morning"))).to_be_focused()
            assert f"date={day(1)}" in mobile.url and "view=week" in mobile.url
            if width == 390:
                mobile.goto(calendar("month", day(1)))
                expect(mobile.get_by_role("region", name="Selected day").get_by_role("link", name=re.compile("Kelli Alvarez, Leaf cleanup"))).to_be_visible()
                shot(mobile, "calendar-month-390")
                mobile.goto(calendar("day", day(1)))
                expect(mobile.get_by_role("link", name=re.compile("Kelli Alvarez, Lawn care"))).to_be_visible()
                shot(mobile, "calendar-day-390")
                mobile.goto(calendar(attention="needs_scheduling"))
                expect(mobile.get_by_role("region", name="Needs scheduling").get_by_role("link", name=re.compile("Willowbank Walk.*Leaf cleanup"))).to_be_visible()
                shot(mobile, "calendar-requests-390")
                for path, title, filename in (
                    ("/admin/route", "Today", "today-attention"),
                    ("/admin/week", "Next 7 days", "next-seven-days"),
                    (f"/admin/customers/{customer['id']}", "Kelli Alvarez", "customer-visit-links"),
                    ("/admin/revenue", "Revenue", "revenue-visit-links"),
                    ("/admin/leads", "Leads", "leads-identity"),
                ):
                    mobile.goto(BASE + path)
                    expect(mobile.get_by_role("heading", name=title, exact=True)).to_be_visible()
                    assert_no_overflow(mobile)
                    shot(mobile, filename + "-390")
            phone.close()

        page.goto(calendar("day", day(1)))
        page.get_by_role("link", name=re.compile("Kelli Alvarez, Lawn care, Morning")).click()
        page.wait_for_url(re.compile("/admin/jobs/" + mowing + r"\?"))
        other = desktop.new_page()
        other.goto(f"{BASE}/admin/jobs/{mowing}")
        other.get_by_role("button", name="Add note", exact=True).click()
        other.get_by_label("Internal visit note").fill("A stale note should not overwrite the first edit.")
        page.get_by_role("button", name="Add note", exact=True).click()
        page.get_by_label("Internal visit note").fill("Gate latch checked. Leave the path clear.")
        page.get_by_role("button", name="Save note", exact=True).click()
        expect(page.get_by_role("status").get_by_text("Visit note saved.")).to_be_visible()
        other.get_by_role("button", name="Save note", exact=True).click()
        expect(other.get_by_role("region", name="Visit note").get_by_role("alert")).to_contain_text(re.compile("changed|reload", re.I))
        assert visit(mowing)["notes"] == "Gate latch checked. Leave the path clear."
        other.close()
        page.get_by_role("button", name="Mark done", exact=True).click()
        page.get_by_role("button", name="Save completion", exact=True).click()
        expect(page.get_by_role("status").get_by_text("Visit marked done.")).to_be_visible()
        expect(page.get_by_text("Done", exact=True)).to_be_visible()
        expect(page.get_by_text(re.compile("^Completed "))).to_be_visible()
        expect(page.get_by_role("button", name="Mark done", exact=True)).to_have_count(0)
        expect(page.get_by_text("Unpaid", exact=True)).to_be_visible()
        assert visit(mowing)["status"] == "completed" and visit(cleanup)["status"] == "confirmed"
        assert visit(cleanup)["job_total"] == 250
        assert not request(f"job_payments?booking_id=eq.{mowing}&select=id")
        shot(page, "visit-done-desktop")
        page.reload()
        expect(page.get_by_text("Done", exact=True)).to_be_visible()
        expect(page.get_by_text("Unpaid", exact=True)).to_be_visible()
        page.get_by_role("link", name="Back to calendar").click()
        expect(page.get_by_role("navigation", name="Calendar view").get_by_role("link", name="Day")).to_have_attribute("aria-current", "page")
        page.get_by_role("link", name=re.compile("Kelli Alvarez, Leaf cleanup")).click()
        page.get_by_role("button", name="Reschedule", exact=True).click()
        page.get_by_label("Visit date", exact=True).fill(day(5))
        page.get_by_role("button", name="Save visit date", exact=True).click()
        expect(page.get_by_role("status").get_by_text("Visit rescheduled.")).to_be_visible()
        assert visit(cleanup)["confirmed_date"] == day(5)
        page.get_by_role("button", name="Record payment", exact=True).click()
        page.get_by_label("Paid amount").fill("35.25")
        page.get_by_role("button", name="Save payment").click()
        expect(page.get_by_text("Partly paid", exact=True)).to_be_visible()
        assert request(f"job_payments?booking_id=eq.{cleanup}&select=amount")[0]["amount"] == 35.25
        page.goto(f"{BASE}/admin/customers/{customer['id']}")
        expect(page.get_by_role("link", name="104 Cinder Grove Lane, Austin, TX 78745", exact=True)).to_have_attribute("href", f"/admin/jobs/{mowing}")
        shot(page, "customer-visit-links-desktop")
        page.goto(f"{BASE}/admin/jobs/{pending}")
        expect(page.get_by_role("button", name="Confirm first visit", exact=True)).to_be_visible()
        expect(page.get_by_text("Needs scheduling", exact=True)).to_be_visible()
        page.get_by_role("button", name="Confirm first visit", exact=True).click()
        page.get_by_label("Visit date", exact=True).fill(day(6))
        page.get_by_role("button", name="Confirm visit", exact=True).click()
        expect(page.get_by_role("status").get_by_text("Visit confirmed.")).to_be_visible()
        assert visit(pending)["status"] == "confirmed"
        page.goto(f"{BASE}/admin/jobs/{unlinked}")
        page.get_by_role("link", name="Unlinked phone history").click()
        expect(page.get_by_role("link", name="Calendar", exact=True).last).to_be_visible()
        shot(page, "unlinked-visit-history-desktop")
        page.goto(f"{BASE}/admin/jobs/{unlinked}")
        page.get_by_role("button", name="More actions", exact=True).click()
        page.get_by_role("button", name="Link customer and property", exact=True).click()
        page.get_by_label("Customer", exact=True).select_option(customer["id"])
        page.get_by_label("Property", exact=True).select_option(customer["property"])
        page.get_by_role("button", name="Link reviewed identity", exact=True).click()
        expect(page.get_by_role("status").get_by_text("Customer and property linked.")).to_be_visible()
        page.goto(calendar("day", day(107)))
        projected = page.get_by_role("link", name=re.compile("Noah Park, Lawn care"))
        expect(projected).to_have_attribute("href", re.compile("/occurrence/"))
        assert not request(f"bookings?agreement_id=eq.{plan}&occurrence_on=eq.{day(107)}&select=id")
        projected.click()
        expect(page.get_by_role("heading", name="Noah Park")).to_be_visible()
        assert not request(f"bookings?agreement_id=eq.{plan}&occurrence_on=eq.{day(107)}&select=id")
        for action in ("Mark done", "Reschedule", "Add note", "More actions", "Record payment",
                       "Create payment link", "Items and price", "Edit schedule"):
            expect(page.get_by_role("button", name=action, exact=True)).to_be_visible()
        expect(page.get_by_role("link", name="Customer history")).to_be_visible()
        expect(page.get_by_text(re.compile(r"^A moved visit conflicts with the schedule on " + day(100)))).to_be_visible()
        shot(page, "visit-projected-desktop")
        page.get_by_role("button", name="Edit schedule", exact=True).click()
        expect(page.get_by_role("link", name="Review conflicting visits")).to_have_attribute("href", "/admin/jobs?attention=schedule_review")
        page.get_by_role("button", name="Close", exact=True).click()
        page.get_by_role("button", name="Create payment link", exact=True).click()
        expect(page.get_by_role("alert").filter(has_text="Stripe not configured.")).to_be_visible()
        assert not request(f"bookings?agreement_id=eq.{plan}&occurrence_on=eq.{day(107)}&select=id")
        page.get_by_role("button", name="More actions", exact=True).click()
        page.get_by_role("button", name="Send a reminder", exact=True).click()
        expect(page.get_by_role("link", name="Text reminder")).to_have_attribute("href", re.compile("^sms:"))
        page.get_by_role("button", name="Email reminder", exact=True).click()
        expect(page.get_by_role("alert").filter(has_text="Email not configured.")).to_be_visible()
        assert not request(f"bookings?agreement_id=eq.{plan}&occurrence_on=eq.{day(107)}&select=id")
        page.get_by_role("button", name="Close", exact=True).click()
        page.get_by_role("button", name="Add note", exact=True).click()
        page.get_by_label("Internal visit note").fill("Call before entering through the side gate.")
        page.get_by_role("button", name="Save note", exact=True).click()
        page.wait_for_url(re.compile(r"/admin/jobs/[a-f0-9-]{36}\?"))
        expect(page.get_by_text("Call before entering through the side gate.", exact=True)).to_be_visible()
        page.goto(calendar("day", day(114)))
        page.get_by_role("link", name=re.compile("Noah Park, Lawn care")).click()
        page.get_by_role("button", name="Record payment", exact=True).click()
        page.get_by_label("Paid amount").fill("18.25")
        page.get_by_role("button", name="Save payment").click()
        page.wait_for_url(re.compile(r"/admin/jobs/[a-f0-9-]{36}\?"))
        expect(page.get_by_text("Partly paid", exact=True)).to_be_visible()
        expect(page.get_by_text("Scheduled", exact=True)).to_be_visible()
        expect(page.get_by_text("$18.25 recorded · $64.00 visit price")).to_be_visible()
        page.reload()
        expect(page.get_by_text("Partly paid", exact=True)).to_be_visible()
        page.goto(f"{BASE}/admin/route")
        expect(page.get_by_role("navigation", name="Visit attention").get_by_role("link", name=re.compile("Overdue"))).to_be_visible()
        shot(page, "today-attention-desktop")
        page.goto(BASE + "/admin/week")
        expect(page.get_by_role("heading", name="Next 7 days")).to_be_visible()
        shot(page, "next-seven-days-desktop")
        page.goto(BASE + "/admin/revenue")
        expect(page.get_by_role("link", name="Kelli Alvarez", exact=True)).to_have_attribute("href", f"/admin/jobs/{mowing}")
        shot(page, "revenue-visit-links-desktop")
        page.goto(BASE + "/admin/leads")
        expect(page.get_by_role("heading", name="Leads", exact=True)).to_be_visible()
        expect(page.get_by_role("button", name="Add lead", exact=True)).to_be_visible()
        expect(page.get_by_text("71 Willowbank Walk, Apt 4, Austin, TX 78744", exact=True)).to_be_visible()
        expect(page.get_by_text("(512) 555-0183", exact=True)).to_be_visible()
        shot(page, "leads-identity-desktop")
        assert not errors, errors
        desktop.close()
        browser.close()
    print("Calendar browser checks passed at 1440, 390, and 320 px.")
finally:
    clean_up()
