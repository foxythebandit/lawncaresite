create table if not exists leads (
  id         uuid        default gen_random_uuid() primary key,
  phone      text        not null,
  address    text,
  sq_ft      integer,
  created_at timestamptz default now() not null
);

alter table leads enable row level security;

create policy "public_insert_leads"
  on leads for insert
  with check (true);

create policy "authenticated_read_leads"
  on leads for select
  using (auth.role() = 'authenticated');
;
