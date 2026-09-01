alter table leads
  add column if not exists consent boolean not null default false,
  add column if not exists consent_text text,
  add column if not exists consented_at timestamptz;
