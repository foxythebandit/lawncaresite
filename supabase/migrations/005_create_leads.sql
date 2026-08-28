create table if not exists leads (
  id         uuid        default gen_random_uuid() primary key,
  phone      text        not null,
  address    text,
  sq_ft      integer,
  created_at timestamptz default now() not null
);

alter table leads enable row level security;

-- Anyone can submit a lead (public quote-builder form)
create policy "public_insert_leads"
  on leads for insert
  with check (true);

-- Only authenticated users (you, via Supabase dashboard) can read
create policy "authenticated_read_leads"
  on leads for select
  using (auth.role() = 'authenticated');
