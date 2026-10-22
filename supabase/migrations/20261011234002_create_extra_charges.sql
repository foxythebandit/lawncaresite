create table if not exists extra_charges (
  id             uuid        default gen_random_uuid() primary key,
  created_at     timestamptz default now() not null,
  charged_on     date        not null default current_date,
  client_name    text        not null,
  phone          text,
  description    text        not null,
  amount         numeric(10,2) not null check (amount >= 0),
  payment_method text
);
alter table extra_charges enable row level security;;
