"""Behavior checks called by crm-upgrade.py on its disposable migrated database."""
import concurrent.futures
import json
import uuid


def check(sql):
    def scalar(query):
        return sql(query).stdout.strip().splitlines()[0]

    assert scalar("select count(*) from public.customers;") == '0'
    assert scalar("select count(*) from public.properties;") == '0'
    assert scalar("select count(*) from public.job_payments;") == '0'
    assert scalar("select count(*) from public.staff_alerts where channel <> 'sms';") == '0'
    assert scalar("select count(*) from public.staff_alerts where channel = 'sms';") == scalar("select count(*) from public.staff_alerts;")
    for role in ('anon', 'authenticated'):
        assert scalar(f"select has_table_privilege('{role}','public.customers','select');") == 'f'
        assert scalar(f"select has_table_privilege('{role}','public.job_payments','insert');") == 'f'
        assert scalar(f"select has_function_privilege('{role}','public.complete_job(uuid,timestamptz,uuid)','execute');") == 'f'
    assert scalar("select has_table_privilege('service_role','public.job_payments','insert');") == 't'
    assert scalar("select relrowsecurity from pg_class where oid='public.job_payments'::regclass;") == 't'
    assert scalar("select public.crm_next_occurrence('2025-01-31','2025-01-31','month',1);") == '2025-02-28'
    assert scalar("select public.crm_next_occurrence('2025-01-31','2025-02-28','month',1);") == '2025-03-31'

    phone = '5555550100'
    customer_a = scalar(f"insert into public.customers(phone,name) values('{phone}','A') returning id;")
    customer_b = scalar(f"insert into public.customers(phone,name) values('{phone}','B') returning id;")
    assert customer_a != customer_b
    property_a = scalar(f"insert into public.properties(customer_id,address) values('{customer_a}','10 Oak') returning id;")
    property_b = scalar(f"insert into public.properties(customer_id,address) values('{customer_b}','20 Oak') returning id;")
    assert property_a != property_b
    invalid = sql(f"insert into public.properties(customer_id,address) values('{customer_a}','');", check=False)
    assert invalid.returncode

    lead = scalar("insert into public.leads(phone,address,quote_draft,quote_confirmed_at,customer_id,property_id) "
                  f"values('5555550101','10 Oak','{{\"total_cents\":6000}}'::jsonb,now(),'{customer_a}','{property_a}') returning id;")
    version = scalar(f"select updated_at from public.leads where id='{lead}';")
    command = (f"select public.update_lead_workflow('{lead}','{version}',"
               "'{\"quote_status\":\"accepted\",\"stage\":\"quoted\"}'::jsonb,"
               "'{\"kind\":\"quote\",\"body\":\"Customer accepted\"}'::jsonb,'staff@example.test');")
    result = json.loads(scalar(command))
    assert result['lead_id'] == lead
    assert scalar(f"select accepted_quote_snapshot->>'total_cents' from public.leads where id='{lead}';") == '6000'
    assert scalar(f"select data->'accepted_quote'->>'total_cents' from public.lead_activities where lead_id='{lead}';") == '6000'
    stale = sql(command, check=False)
    assert stale.returncode and 'changed since it was opened' in stale.stderr
    version = result['updated_at']
    operation = uuid.uuid4()
    items = '[{"kind":"service","description":"Mow","amount":"60.00"}]'
    create = (f"select public.create_job_from_quote('{lead}','{version}','{operation}',"
              f"'{{}}'::jsonb,'{items}'::jsonb);")
    first = json.loads(scalar(create))
    assert not first['duplicate']
    assert json.loads(scalar(create))['booking_id'] == first['booking_id']
    assert sql(create.replace('60.00', '61.00'), check=False).returncode
    booking = first['booking_id']
    assert scalar(f"select job_total from public.bookings where id='{booking}';") == '60.00'
    assert scalar(f"select count(*) from public.job_items where booking_id='{booking}';") == '1'
    assert sql(f"update public.bookings set accepted_quote_snapshot='{{}}' where id='{booking}';", check=False).returncode

    payment_op = uuid.uuid4()
    pay = (f"select public.record_job_payment('{booking}','{payment_op}',"
           "60.00,'2025-03-01','cash','manual');")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        receipts = list(pool.map(lambda _: scalar(pay), range(2)))
    assert receipts[0] == receipts[1]
    assert scalar(f"select count(*) from public.job_payments where booking_id='{booking}';") == '1'
    assert sql(pay.replace('60.00','61.00'), check=False).returncode

    agreement = scalar("insert into public.recurring_agreements(customer_id,property_id,anchor_on,next_on,interval_unit,interval_count,price_per_visit,items_template) "
                       f"values('{customer_a}','{property_a}','2025-01-31','2025-02-28','month',1,80.00,"
                       "'[{\"kind\":\"service\",\"description\":\"Mow\",\"amount\":\"80.00\"}]'::jsonb) returning id;")
    recurring = scalar("insert into public.bookings(name,phone,address,status,confirmed_date,customer_id,property_id,agreement_id,occurrence_on,job_total,gclid) "
                       f"values('A','{phone}','10 Oak','confirmed','2025-01-31','{customer_a}','{property_a}','{agreement}','2025-01-31',60.00,'test-click') returning id;")
    recurring_version = scalar(f"select updated_at from public.bookings where id='{recurring}';")
    complete_op = uuid.uuid4()
    complete = f"select public.complete_job('{recurring}','{recurring_version}','{complete_op}');"
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        completions = [json.loads(value) for value in pool.map(lambda _: scalar(complete), range(2))]
    assert {value['duplicate'] for value in completions} == {True, False}
    assert len({value['next_booking_id'] for value in completions}) == 1
    assert scalar(f"select count(*) from public.bookings where agreement_id='{agreement}' and occurrence_on='2025-02-28';") == '1'
    assert scalar(f"select job_total || ':' || gclid from public.bookings where agreement_id='{agreement}' and occurrence_on='2025-02-28';") == '80.00:test-click'
    assert scalar(f"select next_on from public.recurring_agreements where id='{agreement}';") == '2025-03-31'
    print('PASS: CRM foundation role isolation, identity, quote history, optimistic guards, exact money, concurrent retry safety, monthly recurrence')
