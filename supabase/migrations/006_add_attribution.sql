alter table leads    add column if not exists gclid        text;
alter table leads    add column if not exists utm_source   text;
alter table leads    add column if not exists utm_medium   text;
alter table leads    add column if not exists utm_campaign text;
alter table leads    add column if not exists utm_term     text;
alter table leads    add column if not exists utm_content  text;

alter table bookings add column if not exists gclid        text;
alter table bookings add column if not exists utm_source   text;
alter table bookings add column if not exists utm_medium   text;
alter table bookings add column if not exists utm_campaign text;
alter table bookings add column if not exists utm_term     text;
alter table bookings add column if not exists utm_content  text;
