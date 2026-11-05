-- Local test logins only. This file never runs on production.
-- Password for all of them: password123
--   staff@example.test     can use /admin (it must also be in STAFF_EMAILS, which .env.example sets)
--   customer@example.test  a customer; the portal signs in with an emailed link, shown in the local mail page
--   outsider@example.test  has the staff role but isn't in STAFF_EMAILS, so /admin must refuse it

do $$
declare
  u record;
  uid uuid;
begin
  for u in select * from (values
    ('staff@example.test', 'staff'),
    ('customer@example.test', 'customer'),
    ('outsider@example.test', 'staff')
  ) as t(email, role) loop
    uid := gen_random_uuid();

    -- GoTrue needs these token columns to be '' rather than null, and an identity row, for password login.
    insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, role, aud, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data)
    values (uid, '00000000-0000-0000-0000-000000000000', u.email, extensions.crypt('password123', extensions.gen_salt('bf')), now(), 'authenticated', 'authenticated', now(), now(), '', '', '', '',
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role), '{}');

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', u.email, 'email_verified', true, 'phone_verified', false), 'email', now(), now(), now());
  end loop;
end $$;
