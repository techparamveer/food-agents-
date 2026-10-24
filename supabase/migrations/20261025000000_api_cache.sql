-- TTL cache for Places API and Gemini responses (lib/restaurants/cache.ts).
-- Written and read only by the server with the secret key; no client access.
create table if not exists public.api_cache (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists api_cache_expires_at_idx on public.api_cache (expires_at);

alter table public.api_cache enable row level security;
-- No policies: anon and authenticated roles get nothing; the service role bypasses RLS.
