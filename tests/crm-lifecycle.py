"""Exercise lifecycle RPCs against the isolated upgraded Postgres database."""
import json
import uuid


def check(sql):
    def scalar(query):
        return sql(query).stdout.strip().splitlines()[0]

    def fails(query, message=None):
        result = sql(query, check=False)
        assert result.returncode, query
        if message:
            assert message in result.stderr, result.stderr

    for role in ('anon', 'authenticated'):
        assert scalar(f"select has_function_privilege('{role}','public.crm_job_command(uuid,timestamptz,uuid,text,jsonb)','execute');") == 'f'
        assert scalar(f"select has_table_privilege('{role}','public.crm_operations','select');") == 'f'
    fails("select public.crm_validate_items('[{\"kind\":\"service\",\"description\":\"A\",\"amount\":\"0.005\"},{\"kind\":\"service\",\"description\":\"B\",\"amount\":\"0.005\"}]'::jsonb);", 'Invalid priced item')

    customer = scalar("insert into public.customers(name,phone) values('Lifecycle A','5550003000') returning id;")
    property_id = scalar(f"insert into public.properties(customer_id,address) values('{customer}','30 Oak') returning id;")
    other = scalar("insert into public.customers(name,phone) values('Lifecycle B','5550003000') returning id;")
    other_property = scalar(f"insert into public.properties(customer_id,address) values('{other}','31 Oak') returning id;")
    assert customer != other
    booking = scalar("insert into public.bookings(name,phone,address,status,confirmed_date,price_per_visit,last_mow,addon_interest) "
                     "values('Lifecycle A','5550003000','30 Oak','confirmed','2027-01-31',60,'old mowing date','{\"leaf\":true}') returning id;")
    version = scalar(f"select updated_at from public.bookings where id='{booking}';")
    link_op = uuid.uuid4()
    link = (f"select public.crm_link_job('{booking}','{version}','{link_op}',"
            f"'{customer}','{property_id}',null,null);")
    assert json.loads(scalar(link))['customer_id'] == customer
    assert json.loads(scalar(link))['customer_id'] == customer
    fails(link.replace(str(property_id), str(other_property)), 'operation conflict')
    assert scalar(f"select customer_id from public.bookings where id='{booking}';") == customer
    version = scalar(f"select updated_at from public.bookings where id='{booking}';")
    bad_link = (f"select public.crm_link_job('{booking}','{version}','{uuid.uuid4()}',"
                f"'{customer}','{other_property}',null,null);")
    fails(bad_link, 'Property belongs to another customer')
    assert scalar(f"select count(*) from public.customers where phone='5550003000';") == '2'

    items = '[{"kind":"service","description":"Mow","amount":"60.00"}]'
    price_op = uuid.uuid4()
    price = f"select public.crm_replace_job_items('{booking}','{version}','{price_op}','{items}'::jsonb);"
    assert json.loads(scalar(price))['job_total'] == 60
    assert json.loads(scalar(price))['job_total'] == 60
    fails(price.replace('60.00', '61.00'), 'operation conflict')
    version = scalar(f"select updated_at from public.bookings where id='{booking}';")
    agreement_items = '[{"kind":"service","description":"Mow","amount":"80.00"}]'
    config = json.dumps({'anchor_on':'2027-01-31','next_on':'2027-02-28','interval_unit':'month',
                         'interval_count':1,'items_template':json.loads(agreement_items)})
    start_op = uuid.uuid4()
    start = f"select public.crm_start_agreement('{booking}','{version}','{start_op}','{config}'::jsonb);"
    agreement = json.loads(scalar(start))['agreement_id']
    assert json.loads(scalar(start))['agreement_id'] == agreement
    mismatched = sql("insert into public.bookings(name,phone,address,status,customer_id,property_id,agreement_id,occurrence_on) "
                     f"values('Wrong','555','31 Oak','confirmed','{other}','{other_property}','{agreement}','2027-04-30');",check=False)
    assert mismatched.returncode
    fails("insert into public.recurring_agreements(customer_id,property_id,anchor_on,next_on,interval_unit,interval_count,items_template) "
          f"values('{customer}','{property_id}','2027-01-01','2027-02-01','month',1,"
          "'[{\"kind\":\"service\",\"description\":\"Bad\",\"amount\":\"0.005\"}]');")

    agreement_version = scalar(f"select updated_at from public.recurring_agreements where id='{agreement}';")
    template = json.dumps({'items_template':[{'kind':'service','description':'Mow','amount':'90.00'}]})
    template_op = uuid.uuid4()
    scalar(f"select public.crm_agreement_command('{agreement}','{agreement_version}','{template_op}',"
           f"'price_template','{template}'::jsonb);")
    assert scalar(f"select job_total from public.bookings where id='{booking}';") == '60.00'
    version = scalar(f"select updated_at from public.bookings where id='{booking}';")
    complete_op = uuid.uuid4()
    complete = f"select public.complete_job('{booking}','{version}','{complete_op}','2027-01-31');"
    next_id = json.loads(scalar(complete))['next_booking_id']
    assert json.loads(scalar(complete))['duplicate']
    fails(complete.replace("'2027-01-31');", "'2027-02-01');"), 'operation conflict')
    assert scalar(f"select job_total from public.bookings where id='{next_id}';") == '90.00'
    assert scalar(f"select addon_interest is null from public.bookings where id='{next_id}';") == 't'
    assert scalar(f"select last_mow from public.bookings where id='{next_id}';") == '2027-01-31'
    assert scalar(f"select count(*) from public.bookings where agreement_id='{agreement}';") == '2'

    next_version = scalar(f"select updated_at from public.bookings where id='{next_id}';")
    skip_op = uuid.uuid4()
    skipped = json.loads(scalar(f"select public.crm_job_command('{next_id}','{next_version}',"
                                f"'{skip_op}','skip','{{}}'::jsonb);"))
    third_id = skipped['next_booking_id']
    assert scalar(f"select status from public.bookings where id='{next_id}';") == 'skipped'
    assert scalar(f"select occurrence_on from public.bookings where id='{third_id}';") == '2027-03-31'
    third_version = scalar(f"select updated_at from public.bookings where id='{third_id}';")
    reschedule = json.dumps({'date':'2027-04-02','time':'10:00'})
    scalar(f"select public.crm_job_command('{third_id}','{third_version}','{uuid.uuid4()}',"
           f"'reschedule','{reschedule}'::jsonb);")
    assert scalar(f"select occurrence_on || ':' || confirmed_date from public.bookings where id='{third_id}';") == '2027-03-31:2027-04-02'
    agreement_version = scalar(f"select updated_at from public.recurring_agreements where id='{agreement}';")
    preview = json.dumps({'future_job_ids':[third_id]})
    fails(f"select public.crm_agreement_command('{agreement}','{agreement_version}','{uuid.uuid4()}',"
          "'pause','{\"future_job_ids\":[]}'::jsonb);", 'preview changed')
    scalar(f"select public.crm_agreement_command('{agreement}','{agreement_version}','{uuid.uuid4()}',"
           f"'pause','{preview}'::jsonb);")
    assert scalar(f"select status from public.bookings where id='{third_id}';") == 'canceled'
    agreement_version = scalar(f"select updated_at from public.recurring_agreements where id='{agreement}';")
    resumed = json.dumps({'next_on':'2027-03-31'})
    resume_id = json.loads(scalar(f"select public.crm_agreement_command('{agreement}',"
                                  f"'{agreement_version}','{uuid.uuid4()}','resume','{resumed}'::jsonb);"))['next_booking_id']
    assert resume_id == third_id
    assert scalar(f"select confirmed_date from public.bookings where id='{resume_id}';") == '2027-03-31'
    assert scalar(f"select status from public.bookings where id='{third_id}';") == 'confirmed'
    assert scalar(f"select lifecycle_note from public.bookings where id='{third_id}';") == 'Resumed after agreement pause'
    assert scalar(f"select status from public.recurring_agreements where id='{agreement}';") == 'active'

    payment_op = uuid.uuid4()
    payment = f"select public.record_job_payment('{booking}','{payment_op}',25.00,'2027-02-02','cash','manual');"
    fails(payment.replace('25.00', '25.005'), 'exact cents')
    assert scalar(payment) == scalar(payment)
    scalar(f"select public.record_job_payment('{booking}','{uuid.uuid4()}',35.00,'2027-02-09','cash','manual');")
    assert scalar(f"select sum(amount) from public.job_payments where booking_id='{booking}';") == '60.00'
    assert scalar(f"select count(*) from public.job_payments where booking_id='{booking}';") == '2'
    print('PASS: CRM lifecycle explicit identity, exact cents, immutable job price, recurrence transitions, operation retries, partial payments')
