create table if not exists quotes (
  id         uuid        default gen_random_uuid() primary key,
  name       text        not null,
  phone      text        not null,
  postcode   text        not null,
  yard_size  text        not null,
  created_at timestamptz default now() not null
);

alter table quotes enable row level security;

-- Allow anyone to submit a quote (public form)
create policy "public_insert_quotes"
  on quotes for insert
  with check (true);

-- Only authenticated users (you, via Supabase dashboard or service role) can read
create policy "authenticated_read_quotes"
  on quotes for select
  using (auth.role() = 'authenticated');
