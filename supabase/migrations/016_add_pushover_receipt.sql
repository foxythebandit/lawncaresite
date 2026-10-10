alter table leads    add column if not exists pushover_receipt text;
alter table bookings add column if not exists pushover_receipt text;
