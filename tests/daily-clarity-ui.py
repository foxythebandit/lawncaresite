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
from urllib.parse import parse_qs, urlencode, urlsplit
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

def shot(page, name, *, full_page=True):
    if SCREEN_DIR:
        path = Path(SCREEN_DIR)
        path.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(path / (name + ".png")), full_page=full_page, animations="disabled")

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
service_label_ids = []
visit_ids = []
def create_customer(name, address, suffix):
    customer = {"id": str(uuid4()), "name": name, "phone": f"51255501{suffix:02d}", "property": str(uuid4())}
    customers.append(customer)
    request("customers", "POST", {key: customer[key] for key in ("id", "name", "phone")})
    request("properties", "POST", {"id": customer["property"], "customer_id": customer["id"], "address": address})
    return customer

def visit(id_):
    return request(f"bookings?id=eq.{id_}&select=id,status,agreement_id,confirmed_date,completed_at,job_total,notes,updated_at")[0]

def fixture():
    name, address = "Kelli Alvarez", "104 Cinder Grove Lane, Austin, TX 78745"
    customer = create_customer(name, address, 81)
    mowing = create_visit(customer, name, address, day(1), "Morning", "Lawn care", 85.50,
                          customer_notes="Use the side gate. The dog stays inside on Tuesdays.")
    cleanup = create_visit(customer, name, address, day(1), "14:15", "Leaf cleanup", 250.00)
    create_visit(customer, name, address, day(5), "14:00", "Patio cleanup", 75.00)
    create_visit(customer, name, address, day(5), "9:00", "Bed weeding", 105.00)
    create_visit(customer, name, address, day(5), "09:00", "Hedge trimming", 125.00)
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

def search_fixture():
    rows = []
    for offset in [*range(26, 0, -1), 25, None]:
        on = day(40 + offset) if offset is not None else None
        requested = offset is None or offset % 2 == 1
        id_ = str(uuid4())
        visit_ids.append(id_)
        rows.append({
            "id": id_, "name": "Casey Quinn", "phone": "5125550186",
            "address": "28 Marigold Hollow, Austin, TX 78748",
            "status": "pending" if requested else "confirmed",
            "created_at": f"{TODAY.isoformat()}T13:00:00Z",
            "confirmed_date": None if requested else on,
            "preferred_date": on if requested else day(2),
        })
    request("bookings", "POST", rows)
    return sorted(rows, key=lambda row: (row["confirmed_date"] or row["preferred_date"] or "9999-12-31", row["id"]))

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
    labels = ", ".join(f"'{label_id}'" for label_id in service_label_ids) or "null"
    for lead_id in lead_ids:
        request(f"leads?id=eq.{lead_id}", "DELETE")
    subprocess.run([cli, "db", "query", "--local", f"""
        do $test$
        begin
          update public.recurring_agreements set schedule_source_booking_id = null where customer_id in ({ids});
          delete from public.crm_operations where target_id in (select id from public.bookings where {owned})
            or target_id in (select id from public.recurring_agreements where customer_id in ({ids}))
            or target_id in ({ids}, {labels});
          delete from public.job_payments where booking_id in (select id from public.bookings where {owned});
          delete from public.job_items where booking_id in (select id from public.bookings where {owned});
          delete from public.bookings where {owned};
          delete from public.agreement_schedule_revisions where agreement_id in (
            select id from public.recurring_agreements where customer_id in ({ids}));
          delete from public.recurring_agreements where customer_id in ({ids});
          delete from public.properties where customer_id in ({ids});
          delete from public.customers where id in ({ids});
          delete from public.service_labels where id in ({labels});
        end $test$;
    """], check=True, capture_output=True, text=True)

def service_editor_browser():
    customer = create_customer("Kelli Alvarez", "92 Garden Lane, Austin, TX 78704", 77)
    customer_url = f"{BASE}/admin/customers/{customer['id']}"
    year = TODAY.year + 1
    first_date = f"{year}-03-01"
    assert request(f"bookings?customer_id=eq.{customer['id']}&select=id") == []
    pending_customer = create_customer("Pending first visit", "97 Orchard Lane, Austin, TX 78704", 78)
    pending_url = f"{BASE}/admin/customers/{pending_customer['id']}"
    pending_date = (TODAY + timedelta(days=3)).isoformat()
    next_date = (TODAY + timedelta(days=10)).isoformat()
    first_pending = create_visit(pending_customer, pending_customer["name"], "97 Orchard Lane, Austin, TX 78704",
                                 pending_date, "Morning", "Lawn care", 85.50, status="pending", one_time=False)
    pending_plan = request("rpc/crm_start_agreement", "POST", {
        "p_booking_id": first_pending, "p_expected_updated_at": visit(first_pending)["updated_at"], "p_operation_id": str(uuid4()),
        "p_config": {"anchor_on": pending_date, "next_on": next_date, "interval_unit": "week", "interval_count": 1,
                     "items_template": [{"kind": "service", "description": "Lawn care", "amount": "85.50"}]},
    })["agreement_id"]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for width, height in [(1440, 1000), (390, 844), (320, 740)]:
            context = local_browser(browser, width, height)
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(customer_url)
            login(page)
            page.get_by_role("link", name="Add service", exact=True).click()
            expect(page.get_by_role("heading", name="Add service", exact=True)).to_be_visible()
            if width < 500:
                page.evaluate("window.scrollTo(0,0)")
                shot(page, f"service-editor-viewport-{width}", full_page=False)
            page.get_by_label("Service label").select_option(label="Lawn care")
            page.get_by_label("Agreed price per visit ($)").fill("85.50")
            page.get_by_label("Visit date").fill(first_date)
            page.get_by_label("Cadence", exact=True).select_option("paused")
            page.get_by_role("button", name="Add annual period").click()
            page.get_by_role("button", name="Preview changes", exact=True).click()
            expect(page.get_by_role("heading", name="Review before saving")).to_be_visible()
            expect(page.get_by_text("$85.50", exact=True).first).to_be_visible()
            assert_no_overflow(page)
            shot(page, f"service-annual-preview-{width}")
            save = page.get_by_role("button", name="Save reviewed change")
            if width < 500:
                save.scroll_into_view_if_needed()
                save.click(trial=True)
                assert save.bounding_box()["y"] + save.bounding_box()["height"] <= page.locator(".admin-nav").bounding_box()["y"]
                shot(page, f"service-review-save-viewport-{width}", full_page=False)
            if width == 1440:
                save.click()
                schedules = page.get_by_role("region", name="Service schedules")
                expect(schedules.get_by_text("Lawn care · $85.50 per visit")).to_be_visible()
                expect(schedules.get_by_text(re.compile("Seasonal service"))).to_be_visible()
                service = request(f"recurring_agreements?customer_id=eq.{customer['id']}&select=id,schedule_source_booking_id")[0]
                first_mow = service["schedule_source_booking_id"]
                page.goto(calendar("day", first_date))
                page.get_by_role("link", name=re.compile("Kelli Alvarez, Lawn care")).click()
                page.get_by_role("button", name="Reschedule", exact=True).click()
                expect(page.get_by_label("Move this and future visits")).to_have_count(0)
                expect(page.get_by_role("link", name="Edit its future schedule")).to_have_attribute("href", re.compile(service["id"]))
                expect(page.get_by_role("button", name="Save visit date")).to_be_enabled()
                page.goto(customer_url)
                page.get_by_role("link", name="Add service", exact=True).click()
                page.get_by_label("Visit pattern").select_option("once")
                page.get_by_role("button", name="New label", exact=True).click()
                page.get_by_label("Label name", exact=True).fill("Leaf and acorn cleanup")
                page.get_by_role("button", name="Create label", exact=True).click()
                expect(page.get_by_label("Service label").locator("option:checked")).to_have_text("Leaf and acorn cleanup")
                label_query = urlencode({"name": "eq.Leaf and acorn cleanup", "select": "id"})
                label = request("service_labels?" + label_query)[0]["id"]
                service_label_ids.append(label)
                page.get_by_label("Agreed visit price ($)").fill("250.00")
                page.get_by_label("Visit date").fill(first_date)
                page.get_by_label("Visit note (optional)").fill("Collect acorns and leaves by the front gate.")
                page.get_by_role("button", name="Preview changes", exact=True).click()
                expect(page.get_by_text(re.compile(r"First visit.*\$250\.00"))).to_be_visible()
                page.get_by_role("button", name="Save reviewed change").click()
                page.wait_for_url(re.compile(r"/admin/jobs/[0-9a-f-]+$"))
                first_cleanup = page.url.rsplit("/", 1)[1]
                expect(page.get_by_text("$250.00", exact=True).first).to_be_visible()
                assert visit(first_cleanup)["agreement_id"] is None
                assert visit(first_mow)["confirmed_date"] == visit(first_cleanup)["confirmed_date"] == first_date
                page.goto(calendar("day", first_date))
                cleanup = page.get_by_role("link", name=re.compile("Kelli Alvarez, Leaf and acorn cleanup"))
                expect(cleanup).to_be_visible()
                cleanup.click()
                page.wait_for_url(re.compile(first_cleanup))
                exact_visit_url = page.url.removeprefix(BASE)
                page.get_by_role("button", name="Mark done", exact=True).click()
                page.get_by_role("button", name="Save completion", exact=True).click()
                expect(page.get_by_text("Done", exact=True)).to_be_visible()
                page.get_by_role("button", name="Record payment", exact=True).click()
                page.get_by_role("button", name="Save payment", exact=True).click()
                expect(page.get_by_text("Paid in full", exact=True)).to_be_visible()
                assert visit(first_mow)["status"] == "confirmed"
                source_before = visit(first_cleanup)
                page.get_by_role("button", name="Set schedule", exact=True).click()
                start = page.get_by_role("link", name="Start schedule from this visit", exact=True)
                editor = start.get_attribute("href")
                editor_query = parse_qs(urlsplit(editor).query)
                assert editor_query["visit"] == [first_cleanup] and editor_query["origin"] == [exact_visit_url]
                context.clear_cookies()
                page.goto(BASE + editor)
                expect(page.get_by_role("heading", name="Staff sign in")).to_be_visible()
                assert parse_qs(urlsplit(page.url).query)["next"] == [editor]
                login(page)
                page.wait_for_url(BASE + editor)
                expect(page.get_by_role("link", name="Back to visit").first).to_have_attribute("href", exact_visit_url)
                page.get_by_label("Agreed price per visit ($)").fill("190.00")
                page.get_by_role("button", name="Preview changes", exact=True).click()
                expect(page.get_by_role("heading", name="Review before saving")).to_be_visible()
                expect(page.get_by_text(re.compile(r"First visit.*\$250\.00")).last).to_be_visible()
                expect(page.get_by_text("$190.00", exact=True).first).to_be_visible()
                shot(page, "service-keep-cleanup-first-visit-desktop")
                page.get_by_role("button", name="Save reviewed change").click()
                expect(schedules.get_by_text("Leaf and acorn cleanup · $190.00 per visit")).to_be_visible()
                expect(schedules.get_by_text("Lawn care · $85.50 per visit")).to_be_visible()
                saved = visit(first_cleanup)
                assert saved["job_total"] == 250 and saved["status"] == "completed"
                assert saved["completed_at"] == source_before["completed_at"] and saved["notes"] == source_before["notes"]
                assert request(f"job_payments?booking_id=eq.{first_cleanup}&select=amount")[0]["amount"] == 250
                same_day = request(f"bookings?customer_id=eq.{customer['id']}&confirmed_date=eq.{first_date}&select=id")
                assert sorted(row["id"] for row in same_day) == sorted([first_cleanup, first_mow])
                revisions = request(f"agreement_schedule_revisions?agreement_id=eq.{saved['agreement_id']}&select=id,staff_user_id,operation_id")
                assert len(revisions) == 1 and revisions[0]["staff_user_id"] and revisions[0]["operation_id"]
                operations = request(f"crm_operations?id=eq.{revisions[0]['operation_id']}&select=action,result")
                assert operations[0]["action"] == "service_create" and operations[0]["result"]["booking_id"] == first_cleanup
                shot(page, "customer-independent-services-desktop")
                future_date = (datetime.fromisoformat(first_date).date() + timedelta(days=7)).isoformat()
                page.goto(calendar("day", future_date))
                page.get_by_role("link", name=re.compile("Kelli Alvarez, Leaf and acorn cleanup")).click()
                page.get_by_role("button", name="Reschedule", exact=True).click()
                page.get_by_label("Move this and future visits").check()
                new_date = (datetime.fromisoformat(future_date).date() + timedelta(days=1)).isoformat()
                page.get_by_label("Visit date", exact=True).fill(new_date)
                page.get_by_role("button", name="Review dates", exact=True).click()
                expect(page.get_by_role("heading", name="Review before saving")).to_be_visible()
                expect(page.get_by_text("$190.00", exact=True).first).to_be_visible()
                shot(page, "service-series-move-review-desktop")
                page.get_by_role("button", name="Save reviewed dates").click()
                page.wait_for_url(re.compile(r"/admin/jobs/[0-9a-f-]+\?"))
                expect(page.get_by_role("button", name="Reschedule", exact=True)).to_be_visible()
                assert not request(f"bookings?agreement_id=eq.{saved['agreement_id']}&occurrence_on=eq.{future_date}&select=id")
                shifted = request(f"bookings?agreement_id=eq.{saved['agreement_id']}&occurrence_on=eq.{new_date}&select=id")
                assert len(shifted) == 1 and shifted[0]["id"] in page.url

                page.goto(customer_url)
                mow_schedule = schedules.locator(f"#schedule-{service['id']}")
                mow_schedule.get_by_role("link", name="Edit schedule").click()
                page.get_by_role("combobox", name=re.compile(r"^Change(?: |$)")).select_option("pause")
                page.get_by_role("button", name="Preview changes", exact=True).click()
                expect(page.get_by_text("Cancel and keep in history", exact=False).first).to_be_visible()
                page.get_by_role("button", name="Save reviewed change").click()
                expect(mow_schedule.get_by_text("Paused", exact=True)).to_be_visible()
                assert visit(first_mow)["status"] == "canceled"
                mow_schedule.get_by_role("link", name="Edit schedule").click()
                expect(page.get_by_role("combobox", name=re.compile(r"^Change(?: |$)"))).to_have_value("resume")
                page.get_by_role("button", name="Preview changes", exact=True).click()
                expect(page.get_by_text("Restore visit", exact=False).first).to_be_visible()
                shot(page, "service-resume-first-visit-desktop")
                page.get_by_role("button", name="Save reviewed change").click()
                expect(mow_schedule.get_by_text(re.compile("^Next "))).to_be_visible()
                assert (visit(first_mow)["status"], visit(first_mow)["job_total"]) == ("confirmed", 85.50)
                mow_schedule.get_by_role("link", name="Edit schedule").click()
                page.get_by_role("combobox", name=re.compile(r"^Change(?: |$)")).select_option("range")
                page.get_by_label("Apply from", exact=True).fill(first_date)
                page.get_by_label("Through", exact=True).fill(first_date)
                page.get_by_role("button", name="Preview changes", exact=True).click()
                expect(page.get_by_text("Cancel and keep in history", exact=False)).to_be_visible()
                shot(page, "service-skip-first-visit-desktop")
                page.get_by_role("button", name="Save reviewed change").click()
                expect(mow_schedule.get_by_role("link", name="Edit schedule")).to_be_visible()
                assert visit(first_mow)["status"] == "canceled"

            page.goto(pending_url)
            pending_schedule = page.get_by_role("region", name="Service schedules")
            expect(pending_schedule.get_by_text("Awaiting first-visit confirmation")).to_be_visible()
            first_link = pending_schedule.get_by_role("link", name="Confirm first visit", exact=True)
            first_href = f"/admin/jobs/{first_pending}"
            expect(first_link).to_have_attribute("href", first_href)
            expect(pending_schedule.get_by_role("link", name="Edit schedule")).to_have_count(0)
            assert_no_overflow(page)
            shot(page, f"service-awaits-first-confirmation-{width}", full_page=False)
            page.goto(f"{pending_url}/service?schedule={pending_plan}")
            expect(page.get_by_text("Confirm the first visit before editing this schedule.")).to_be_visible()
            expect(page.get_by_role("button", name="Preview changes")).to_have_count(0)
            assert_no_overflow(page)
            shot(page, f"service-first-confirmation-continuation-{width}", full_page=False)
            page.get_by_role("link", name="Confirm first visit", exact=True).click()
            page.wait_for_url(BASE + first_href)
            expect(page.get_by_role("button", name="Confirm first visit", exact=True)).to_be_visible()
            expect(page.get_by_role("button", name="Edit schedule", exact=True)).to_have_count(0)
            if width == 320:
                page.get_by_role("button", name="Confirm first visit", exact=True).click()
                expect(page.get_by_label("Visit date", exact=True)).to_have_value(pending_date)
                page.get_by_role("button", name="Confirm visit", exact=True).click()
                expect(page.get_by_text("Visit confirmed.", exact=True)).to_be_visible()
                assert visit(first_pending)["status"] == "confirmed"
                page.goto(pending_url)
                expect(pending_schedule.get_by_role("link", name="Edit schedule", exact=True)).to_be_visible()
            assert not errors, errors
            context.close()
        browser.close()
    print("Service editor, first-visit confirmation, pause/resume and bounded skip passed at the exercised desktop and phone widths.")


def quote_browser():
    import hashlib
    import hmac

    provider_log = Path(os.environ["QG_QUOTE_PROVIDER_LOG"])
    lead_id, legacy_id, phone_id, cleanup_id = (str(uuid4()) for _ in range(4))
    address = "9 Quote Lane, Austin, TX 78704"
    draft = {"address": address, "contactAddressAtReview": address, "sections": [], "freq": "onetime",
             "jobLatLng": None, "calculatedPrice": 83.55, "calculatedFirstVisit": 58.49, "overridePrice": None,
             "includeMowing": True, "manualLines": [], "discountCents": 0, "totalCents": 8355, "notes": ""}
    ids = f"'{lead_id}', '{legacy_id}', '{phone_id}', '{cleanup_id}'"

    def attempts():
        return [json.loads(line) for line in provider_log.read_text().splitlines()]

    def open_preview(page, body, addon=True, cadence=None):
        page.wait_for_load_state("networkidle")
        page.get_by_role("button", name=re.compile(r"^Email (quote|revised quote)$")).click()
        composer = page.locator(".crm-booking-request").filter(has=page.get_by_role("heading", name="Email quote", exact=True))
        expect(composer).to_be_visible()
        composer.locator("textarea").fill(body)
        if cadence:
            composer.get_by_label("Repeat", exact=True).select_option(cadence)
        if addon:
            page.get_by_role("button", name="+ Add-on", exact=True).click()
            page.get_by_label("Add-on", exact=True).fill("Bagging clippings")
            page.get_by_label("Add-on price", exact=True).fill("10.25")
        page.get_by_role("button", name="Preview email", exact=True).click()
        expect(page.get_by_role("heading", name="Review email before sending")).to_be_visible()
        return page.locator('iframe[title="Email preview"]').get_attribute("srcdoc")

    try:
        for id_ in (lead_id, legacy_id):
            request("leads", "POST", {"id": id_, "name": "Test Jordan", "phone": "5125550199",
                    "email": "jordan@example.test", "address": address, "source": "staff", "quote_draft": draft,
                    "quote_confirmed_at": f"{TODAY.isoformat()}T12:00:00Z", "services": ["Lawn care"],
                    "attribution": {"utm_source": "quote-browser"}})
        request("leads", "POST", {"id": phone_id, "name": "Test Phone Mow", "phone": "5125550188",
                "address": "18 Phone Lane, Austin, TX 78704", "source": "staff", "services": ["Lawn care"]})
        cleanup_address = "19 Cleanup Lane, Austin, TX 78704"
        cleanup_draft = {**draft, "address": cleanup_address, "contactAddressAtReview": cleanup_address,
                         "includeMowing": False, "totalCents": 25000,
                         "manualLines": [{"id": "cleanup", "service": "Leaf cleanup", "amountCents": 25000}]}
        request("leads", "POST", {"id": cleanup_id, "name": "Test Cleanup", "phone": "5125550189",
                "email": "cleanup@example.test", "address": cleanup_address, "source": "staff",
                "quote_draft": cleanup_draft, "quote_confirmed_at": f"{TODAY.isoformat()}T12:00:00Z",
                "services": ["Leaf cleanup"]})
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            staff = local_browser(browser, 1440, 1000)
            page = staff.new_page()
            errors = []
            def staff_page_error(error):
                # Playwright injects its service-worker guard into the scriptless email preview.
                if str(error) != "Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.":
                    errors.append(str(error))
            page.on("pageerror", staff_page_error)
            lead_url = f"{BASE}/admin/leads/{lead_id}"
            page.goto(lead_url)
            login(page)
            page.wait_for_url(lead_url)
            open_preview(page, "Preview that will become stale")
            request(f"leads?id=eq.{lead_id}", "PATCH", {"quote_draft": {**draft, "calculatedPrice": 84.55, "totalCents": 8455}})
            page.get_by_role("button", name="Send quote", exact=True).click()
            expect(page.get_by_role("alert").filter(has_text="This lead changed")).to_be_visible()
            assert not attempts()
            request(f"leads?id=eq.{lead_id}", "PATCH", {"quote_draft": draft})
            page.reload()
            reviewed = open_preview(page, "Introductory fixture email")
            expect(page.frame_locator('iframe[title="Email preview"]').get_by_text("$68.74", exact=False)).to_be_visible()
            assert_no_overflow(page)
            shot(page, "quote-email-preview-desktop")
            for width, height in ((390, 844), (320, 740)):
                page.set_viewport_size({"width": width, "height": height})
                page.get_by_role("button", name="Send quote", exact=True).scroll_into_view_if_needed()
                assert_no_overflow(page)
                shot(page, f"quote-email-preview-{width}", full_page=False)
            page.set_viewport_size({"width": 1440, "height": 1000})
            page.get_by_role("button", name="Send quote", exact=True).click()
            sent = page.get_by_role("region", name="Sent quotes")
            expect(sent.get_by_text("Email delivery unconfirmed", exact=False)).to_be_visible()
            assert len(attempts()) == 1 and attempts()[0]["body"]["html"] == reviewed
            page.reload()
            sent.get_by_role("button", name="Check or retry email").click()
            expect(sent.get_by_text("Email sent", exact=False)).to_be_visible()
            assert attempts()[0] == attempts()[1]
            original = sent.get_by_role("link", name="View sent terms", exact=True).get_attribute("href")
            assert original and original.startswith("/quote/q1.")
            expect(page.locator(".crm-price-card .crm-bignum")).to_contain_text("$68.74")
            expect(page.get_by_text("$93.80 standard price", exact=True)).to_be_visible()
            expect(page.get_by_text("Calculator amount", exact=True)).to_be_visible()
            assert original in page.get_by_role("link", name="Text price", exact=True).get_attribute("href").replace("%2F", "/")
            page.get_by_role("button", name="Book visit", exact=True).click()
            expect(page.get_by_text("Use the exact terms from sent quote 1.", exact=False)).to_be_visible()
            page.get_by_role("button", name="Cancel", exact=True).click()
            shot(page, "quote-sent-desktop")

            request(f"leads?id=eq.{lead_id}", "PATCH", {"quote_draft": {**draft, "calculatedPrice": 100, "totalCents": 10000}})
            page.reload()
            open_preview(page, "Here is the revised quote", addon=False)
            expect(page.get_by_text("Sending this revision replaces the previous open quote.")).to_be_visible()
            page.get_by_role("button", name="Send revised quote", exact=True).click()
            expect(sent.get_by_text("Replaced", exact=False)).to_be_visible()
            revised = sent.get_by_role("link", name="View sent terms", exact=True).first.get_attribute("href")
            assert revised and revised != original
            assert attempts()[2]["key"] != attempts()[0]["key"]
            for width, height in ((1440, 1000), (390, 844), (320, 740)):
                context = local_browser(browser, width, height)
                public = context.new_page()
                public.on("pageerror", lambda error: errors.append(str(error)))
                public.goto(BASE + original)
                expect(public.get_by_role("heading", name="A revised quote is available")).to_be_visible()
                expect(public.get_by_text("$68.74", exact=True)).to_be_visible()
                expect(public.get_by_role("button", name="Request first visit")).to_have_count(0)
                assert_no_overflow(public)
                shot(public, f"quote-original-{width}")
                public.get_by_role("link", name="Review the revised quote").click()
                public.wait_for_url(BASE + revised)
                expect(public.get_by_text("$70", exact=True)).to_be_visible()
                assert_no_overflow(public)
                shot(public, f"quote-current-{width}")
                if width == 320:
                    public.get_by_role("button", name="Pick a date", exact=True).click()
                    public.get_by_label("Preferred first visit").fill(day(4))
                    public.get_by_role("button", name="Request first visit", exact=True).click()
                    expect(public.get_by_role("heading", name="Request received")).to_be_visible()
                    expect(public.get_by_text("We’ll get in touch to confirm your first visit", exact=False)).to_be_visible()
                    shot(public, "quote-request-received-320")
                    public.reload()
                    expect(public.get_by_text("We’ve received your request for this quote", exact=False)).to_be_visible()
                    expect(public.get_by_role("button", name="Request first visit")).to_have_count(0)
                context.close()
            bookings = request(f"bookings?lead_id=eq.{lead_id}&select=id,status,preferred_date,confirmed_date,job_total,attribution")
            assert len(bookings) == 1 and bookings[0]["status"] == "pending" and bookings[0]["confirmed_date"] is None
            assert bookings[0]["preferred_date"] == day(4) and bookings[0]["job_total"] == 70
            assert bookings[0]["attribution"] == {"utm_source": "quote-browser"}
            page.reload()
            expect(sent.get_by_text("Accepted", exact=False)).to_be_visible()
            page.goto(f"{BASE}/admin/jobs/{bookings[0]['id']}")
            for width, height in ((1440, 1000), (390, 844), (320, 740)):
                page.set_viewport_size({"width": width, "height": height})
                page.get_by_role("button", name="Confirm first visit", exact=True).click()
                expect(page.get_by_text(re.compile(r"^First visit \$70\.00$"))).to_be_visible()
                expect(page.get_by_label("Reviewed property address")).to_have_value(address)
                expect(page.get_by_label("Visit date", exact=True)).to_have_value(day(4))
                assert_no_overflow(page)
                shot(page, f"quote-confirm-first-{width}")
                if width < 500:
                    save = page.get_by_role("button", name="Confirm visit", exact=True)
                    save.scroll_into_view_if_needed()
                    save.click(trial=True)
                    assert save.bounding_box()["y"] + save.bounding_box()["height"] <= page.locator(".admin-nav").bounding_box()["y"]
                    shot(page, f"quote-confirm-save-viewport-{width}", full_page=False)
                if width != 320:
                    page.get_by_role("button", name="Close", exact=True).click()
            page.get_by_role("button", name="Confirm visit", exact=True).click()
            customer_history = page.get_by_role("link", name="Customer history", exact=True)
            expect(customer_history).to_be_visible()
            rows = request(f"bookings?lead_id=eq.{lead_id}&select=id,status,customer_id,property_id,confirmed_date,job_total")
            assert len(rows) == 1 and rows[0]["id"] == bookings[0]["id"]
            assert rows[0]["status"] == "confirmed" and rows[0]["confirmed_date"] == day(4)
            assert rows[0]["customer_id"] and rows[0]["property_id"] and rows[0]["job_total"] == 70
            shot(page, "quote-confirmed-320")
            customer_history.click()
            page.wait_for_url(f"{BASE}/admin/customers/{rows[0]['customer_id']}")
            expect(page.get_by_role("heading", name="Test Jordan", exact=True)).to_be_visible()
            page.set_viewport_size({"width": 1440, "height": 1000})

            signature = hmac.new(SECRET.encode(), f"lead:{legacy_id}".encode(), hashlib.sha256).hexdigest()
            context = local_browser(browser, 390, 844)
            legacy = context.new_page()
            legacy.goto(f"{BASE}/quote/{legacy_id}.{signature}")
            expect(legacy.get_by_text("This is an older quote link", exact=False)).to_be_visible()
            expect(legacy.get_by_text("$83.55", exact=True)).to_have_count(0)
            assert_no_overflow(legacy)
            shot(legacy, "quote-legacy-review-390")
            legacy.get_by_role("button", name="Request first visit", exact=True).click()
            expect(legacy.get_by_role("heading", name="Request received")).to_be_visible()
            row = request(f"bookings?lead_id=eq.{legacy_id}&select=status,job_total,accepted_quote_snapshot")[0]
            assert row["status"] == "pending" and row["job_total"] is None
            assert row["accepted_quote_snapshot"]["source"] == "legacy_quote_review"
            expired = str(uuid4())
            request("sent_offers", "POST", {
                "id": expired, "lead_id": legacy_id, "version": 1, "terms": {},
                "message": {"to": "jordan@example.test", "subject": "Expired fixture"},
                "recipient": "jordan@example.test", "state": "unknown",
                "created_at": (datetime.now(ZoneInfo("UTC")) - timedelta(hours=24)).isoformat(),
            })
            page.goto(f"{BASE}/admin/leads/{legacy_id}")
            page.wait_for_load_state("networkidle")
            page.get_by_role("button", name="Check or retry email", exact=True).click()
            expect(page.get_by_text("This attempt is outside the safe retry window.", exact=False)).to_be_visible()
            expect(page.get_by_text("Check the provider’s email history", exact=False)).to_be_visible()
            assert not any(a["key"] == f"quote/{expired}" for a in attempts())

            page.set_viewport_size({"width": 390, "height": 844})
            page.goto(f"{BASE}/admin/leads/{phone_id}")
            page.get_by_role("button", name="Log call", exact=True).first.click()
            page.get_by_role("radio", name="Talked", exact=True).click()
            page.get_by_role("radio", name=re.compile(r"^Booked")).click()
            page.get_by_label("Price", exact=False).fill("82.00")
            page.get_by_role("radio", name="Weekly", exact=True).click()
            page.get_by_label("First visit", exact=True).fill(day(3))
            page.get_by_role("button", name="Review first visit", exact=True).click()
            page.wait_for_url(re.compile(r"/admin/jobs/[0-9a-f-]+"))
            phone_booking = page.url.split("/")[-1]
            phone_request = request(f"bookings?id=eq.{phone_booking}&select=status,lead_id,job_total")[0]
            assert phone_request == {"status": "pending", "lead_id": phone_id, "job_total": 57.00}
            page.get_by_role("button", name="Confirm first visit", exact=True).click()
            expect(page.get_by_text("First visit $57.00", exact=True)).to_be_visible()
            expect(page.get_by_text("Weekly $82.00 per visit", exact=False)).to_be_visible()
            shot(page, "phone-confirm-first-390")
            page.get_by_role("button", name="Confirm visit", exact=True).click()
            expect(page.get_by_role("link", name="Customer history")).to_be_visible()
            phone_series = request(f"bookings?id=eq.{phone_booking}&select=agreement_id")[0]["agreement_id"]
            assert phone_series
            page.get_by_role("button", name="Edit schedule", exact=True).click()
            expect(page.get_by_role("link", name="Add extra visit", exact=True)).to_be_visible()
            future = request(f"bookings?agreement_id=eq.{phone_series}&id=neq.{phone_booking}&order=confirmed_date&limit=2&select=id,job_total,confirmed_date")
            assert [visit["job_total"] for visit in future] == [82, 82]
            page.goto(f"{BASE}/admin/jobs/{future[0]['id']}")
            page.get_by_role("button", name="Mark done", exact=True).click()
            page.get_by_label("Date completed", exact=True).fill(future[0]["confirmed_date"])
            page.get_by_role("button", name="Save completion", exact=True).click()
            expect(page.get_by_role("alert").filter(has_text="Resolve the earlier scheduled mow first")).to_be_visible()
            page.get_by_role("link", name="Review the earlier visit").click()
            page.wait_for_url(re.compile(phone_booking))
            page.get_by_role("button", name="More actions", exact=True).click()
            page.once("dialog", lambda dialog: dialog.accept())
            page.get_by_role("button", name="Skip this visit", exact=True).click()
            expect(page.get_by_text("Skipped", exact=True)).to_be_visible()
            assert request(f"bookings?id=eq.{future[0]['id']}&select=job_total")[0]["job_total"] == 57.00
            page.goto(f"{BASE}/admin/jobs/{future[0]['id']}")
            page.get_by_role("button", name="Mark done", exact=True).click()
            page.get_by_label("Date completed", exact=True).fill(future[0]["confirmed_date"])
            page.get_by_role("button", name="Save completion", exact=True).click()
            expect(page.get_by_text("Done", exact=True)).to_be_visible()
            page.goto(f"{BASE}/admin/jobs/{future[1]['id']}")
            page.get_by_role("button", name="Mark done", exact=True).click()
            page.get_by_label("Date completed", exact=True).fill(day(2))
            page.get_by_role("button", name="Save completion", exact=True).click()
            expect(page.get_by_text("This completion is earlier than", exact=False)).to_be_visible()
            expect(page.get_by_role("button", name="Save reviewed completion", exact=True)).to_be_enabled()
            assert_no_overflow(page)
            shot(page, "intro-backdated-review-390")
            page.get_by_role("button", name="Save reviewed completion", exact=True).click()
            expect(page.get_by_text("Done", exact=True)).to_be_visible()
            assert request(f"bookings?id=eq.{future[1]['id']}&select=status,job_total")[0] == {"status": "completed", "job_total": 82}

            page.goto(f"{BASE}/admin/leads/{cleanup_id}")
            open_preview(page, "Agreed monthly leaf cleanup", addon=False, cadence="monthly")
            email = page.frame_locator('iframe[title="Email preview"]')
            expect(email.get_by_text("Leaf cleanup · Monthly", exact=True)).to_be_visible()
            expect(email.get_by_text("$250", exact=True).first).to_be_visible()
            assert_no_overflow(page)
            shot(page, "quote-monthly-cleanup-preview-390")
            page.get_by_role("button", name="Send quote", exact=True).click()
            cleanup_sent = page.get_by_role("region", name="Sent quotes")
            expect(cleanup_sent.get_by_text("Email sent", exact=False)).to_be_visible()
            cleanup_link = cleanup_sent.get_by_role("link", name="View sent terms").get_attribute("href")
            public = context.new_page()
            public.goto(BASE + cleanup_link)
            expect(public.get_by_text("Leaf cleanup · Monthly", exact=True)).to_be_visible()
            expect(public.get_by_text("$250 / visit", exact=True)).to_be_visible()
            assert_no_overflow(public)
            shot(public, "quote-monthly-cleanup-public-390")
            public.get_by_role("button", name="Request first visit", exact=True).click()
            expect(public.get_by_role("heading", name="Request received")).to_be_visible()
            row = request(f"bookings?lead_id=eq.{cleanup_id}&select=id,status,job_total")[0]
            assert row["status"] == "pending" and row["job_total"] == 250
            page.goto(f"{BASE}/admin/jobs/{row['id']}")
            page.get_by_role("button", name="Confirm first visit", exact=True).click()
            page.get_by_label("Service label", exact=True).select_option(label="Leaf cleanup")
            page.get_by_label("Visit date", exact=True).fill(day(4))
            expect(page.get_by_text("Monthly $250.00 per visit", exact=False)).to_be_visible()
            shot(page, "quote-monthly-cleanup-confirm-390")
            page.get_by_role("button", name="Confirm visit", exact=True).click()
            expect(page.get_by_role("link", name="Customer history")).to_be_visible()
            saved_cleanup = request(f"bookings?id=eq.{row['id']}&select=agreement_id,customer_id,status,job_total")[0]
            assert saved_cleanup["status"] == "confirmed" and saved_cleanup["job_total"] == 250
            assert saved_cleanup["agreement_id"] and saved_cleanup["customer_id"]
            future_cleanup = request(f"bookings?agreement_id=eq.{saved_cleanup['agreement_id']}&id=neq.{row['id']}&select=job_total")
            assert future_cleanup and all(visit["job_total"] == 250 for visit in future_cleanup)
            assert request(f"crm_intro_grants?customer_id=eq.{saved_cleanup['customer_id']}&select=source_booking_id") == []
            assert not errors, errors
            browser.close()
        print("Quote delivery, first-visit review, and introductory completion passed in Chromium at 1440/390/320.")
    finally:
        subprocess.run([cli, "db", "query", "--local", f"""
        do $fixture$ declare fixture_customers uuid[]; begin
          select array_agg(distinct customer_id) into fixture_customers
          from public.bookings where lead_id in ({ids}) and customer_id is not null;
          update public.recurring_agreements set schedule_source_booking_id = null where customer_id = any(fixture_customers);
          delete from public.crm_intro_grants where customer_id = any(fixture_customers);
          delete from public.crm_operations where target_id in (select id from public.bookings where lead_id in ({ids}))
            or target_id in ({ids});
          delete from public.staff_texts where lead_id in ({ids});
          delete from public.lead_calls where lead_id in ({ids});
          delete from public.staff_alerts where event_id in (select id from public.intake_events where lead_id in ({ids}));
          delete from public.intake_events where lead_id in ({ids});
          delete from public.sent_offers where lead_id in ({ids});
          delete from public.lead_activities where lead_id in ({ids});
          delete from public.job_items where booking_id in (select id from public.bookings where lead_id in ({ids}));
          delete from public.bookings where lead_id in ({ids});
          delete from public.leads where id in ({ids});
          delete from public.agreement_schedule_revisions where agreement_id in (select id from public.recurring_agreements
            where customer_id = any(fixture_customers));
          delete from public.recurring_agreements where customer_id = any(fixture_customers);
          delete from public.properties where customer_id = any(fixture_customers);
          delete from public.customers where id = any(fixture_customers);
        end $fixture$;
        """], check=True, capture_output=True, text=True)


if os.environ.get("QG_QUOTE_ONLY") == "1":
    quote_browser()
    raise SystemExit(0)

if os.environ.get("QG_SERVICE_EDITOR_ONLY") == "1":
    try:
        service_editor_browser()
    finally:
        clean_up()
    raise SystemExit(0)

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
        search_url = calendar("month", day(2), search="Park")
        page.goto(search_url)
        expect(page.get_by_role("heading", name="Staff sign in")).to_be_visible()
        assert parse_qs(urlsplit(page.url).query)["next"] == [search_url.removeprefix(BASE)]
        login(page)
        page.wait_for_url(search_url)
        expect(page.get_by_role("navigation", name="Calendar view").get_by_role("link", name="Month")).to_have_attribute("aria-current", "page")
        expect(page.get_by_role("searchbox", name="Search visits")).to_have_value("Park")
        shot(page, "calendar-signed-in-context-desktop")

        desktop.clear_cookies()
        visit_back = calendar("day", day(1), search="Kelli Alvarez").removeprefix(BASE)
        visit_url = f"{BASE}/admin/jobs/{mowing}?" + urlencode({"returnTo": visit_back})
        page.goto(visit_url)
        expect(page.get_by_role("heading", name="Staff sign in")).to_be_visible()
        assert parse_qs(urlsplit(page.url).query)["next"] == [visit_url.removeprefix(BASE)]
        login(page)
        page.wait_for_url(visit_url)
        expect(page.get_by_role("heading", name="Kelli Alvarez")).to_be_visible()
        expect(page.get_by_role("link", name="Back to calendar")).to_have_attribute("href", visit_back)
        shot(page, "visit-desktop")
        page.get_by_role("link", name="Back to calendar").click()
        page.wait_for_url(BASE + visit_back)
        expect(page.get_by_role("searchbox", name="Search visits")).to_have_value("Kelli Alvarez")
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
        page.goto(calendar("day", day(5)))
        day_region = page.get_by_role("region", name=re.compile("^Saturday"))
        arrivals = day_region.get_by_role("link", name=re.compile("Kelli Alvarez"))
        expect(arrivals).to_have_count(3)
        times = [entry.split(", ")[2] for entry in arrivals.evaluate_all("(links) => links.map(link => link.ariaLabel)")]
        assert times == ["9:00 AM", "9:00 AM", "2:00 PM"], times
        shot(page, "calendar-exact-times-desktop")
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
        projected_url = projected.get_attribute("href")
        assert projected_url and projected_url.startswith("/admin/jobs/occurrence/")
        desktop.clear_cookies()
        page.goto(BASE + projected_url)
        expect(page.get_by_role("heading", name="Staff sign in")).to_be_visible()
        assert parse_qs(urlsplit(page.url).query)["next"] == [projected_url]
        login(page)
        page.wait_for_url(BASE + projected_url)
        expect(page.get_by_role("heading", name="Noah Park")).to_be_visible()
        expect(page.get_by_role("link", name="Back to calendar")).to_have_attribute("href", parse_qs(urlsplit(projected_url).query)["returnTo"][0])
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
        ordered_search = search_fixture()
        page.goto(calendar(search="Casey Quinn"))
        results = page.get_by_role("region", name="Search results")
        search_links = results.get_by_role("link", name=re.compile("Casey Quinn"))
        expect(search_links).to_have_count(25)
        first_page = search_links.evaluate_all("(links) => links.map(link => new URL(link.href).pathname.split('/').pop())")
        assert first_page == [row["id"] for row in ordered_search[:25]]
        page.get_by_role("link", name="Next page", exact=True).click()
        expect(search_links).to_have_count(3)
        next_page = search_links.evaluate_all("(links) => links.map(link => new URL(link.href).pathname.split('/').pop())")
        assert next_page == [row["id"] for row in ordered_search[25:]]
        expect(search_links.last).to_contain_text("No date set")
        assert not errors, errors
        desktop.close()
        browser.close()
    print("Calendar browser checks passed at 1440, 390, and 320 px.")
finally:
    clean_up()
