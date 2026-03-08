-- conversations
create table conversations (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- messages
create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz not null default now()
);

create index messages_conversation_id_created_at_idx
  on messages (conversation_id, created_at);

-- cfbd_cache
create table cfbd_cache (
  key           text primary key,
  response_json jsonb not null,
  created_at    timestamptz not null default now()
);

create index cfbd_cache_created_at_idx
  on cfbd_cache (created_at);
