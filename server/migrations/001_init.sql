-- Timeline initial schema (PostgreSQL 18+: uses native uuidv7()).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Users: humans log in with a password; agents belong to a human (owner_id) and use API keys.
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  kind          text NOT NULL DEFAULT 'human' CHECK (kind IN ('human', 'agent')),
  role          text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  owner_id      uuid REFERENCES users(id) ON DELETE CASCADE,   -- set for agents
  email         text,
  name          text NOT NULL,
  password_hash text,
  avatar_color  text NOT NULL DEFAULT '#6366f1',
  description   text NOT NULL DEFAULT '',                       -- agents: what it was asked to do
  settings      jsonb NOT NULL DEFAULT '{}'::jsonb,
  disabled      boolean NOT NULL DEFAULT false,
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'agent') = (owner_id IS NOT NULL))
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX users_owner_idx ON users (owner_id);

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent  text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE api_keys (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  prefix      text NOT NULL,                 -- first chars, shown in UI
  key_hash    text NOT NULL UNIQUE,
  scopes      text[] NOT NULL DEFAULT ARRAY['read', 'write', 'delete'],
  last_used_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Timeline sharing: owner shares their timeline with viewer; viewer accepts, then can combine.
CREATE TABLE timeline_shares (
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewer_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_comment boolean NOT NULL DEFAULT true,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, viewer_id),
  CHECK (owner_id <> viewer_id)
);
CREATE INDEX timeline_shares_viewer_idx ON timeline_shares (viewer_id);

CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#64748b',
  icon        text NOT NULL DEFAULT 'folder',
  is_private  boolean NOT NULL DEFAULT false,   -- never visible to shared viewers
  sort        int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_owner_name_key ON categories (owner_id, lower(name));

-- Storage backends. owner_id NULL = server-wide (configured by admin / env).
CREATE TABLE storage_backends (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('local', 's3', 'gdrive')),
  name        text NOT NULL,
  config      text NOT NULL,                  -- AES-GCM encrypted JSON
  from_env    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE posts (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- whose timeline
  author_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- who posted (human or agent)
  category_id  uuid REFERENCES categories(id) ON DELETE SET NULL,
  kind         text NOT NULL DEFAULT 'post' CHECK (kind IN ('post', 'reminder')),
  title        text NOT NULL DEFAULT '',
  body         text NOT NULL DEFAULT '',
  source       text NOT NULL DEFAULT 'web',   -- web | android | ios | api | agent | email | import
  source_name  text NOT NULL DEFAULT '',      -- e.g. "instagram.com/@nasa", sender address
  source_url   text,
  source_meta  jsonb NOT NULL DEFAULT '{}'::jsonb,
  ref_post_id  uuid REFERENCES posts(id) ON DELETE SET NULL,          -- reminder card -> linked post
  posted_at    timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  edited_at    timestamptz,
  deleted_at   timestamptz,
  deleted_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  search       tsvector GENERATED ALWAYS AS (
                 setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
                 setweight(to_tsvector('simple', coalesce(body, '')), 'B') ||
                 setweight(to_tsvector('simple', coalesce(source_name, '')), 'C')
               ) STORED
);
-- Keyset pagination over a timeline (the hot path).
CREATE INDEX posts_feed_idx ON posts (owner_id, posted_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX posts_feed_cat_idx ON posts (owner_id, category_id, posted_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX posts_trash_idx ON posts (owner_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX posts_search_idx ON posts USING gin (search);
CREATE INDEX posts_body_trgm_idx ON posts USING gin (body gin_trgm_ops);
-- Agents re-checking a source must not create duplicates (includes deleted posts on purpose).
CREATE UNIQUE INDEX posts_source_url_key ON posts (owner_id, source_url) WHERE source_url IS NOT NULL;

CREATE TABLE post_revisions (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  post_id     uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  title       text NOT NULL,
  body        text NOT NULL,
  category_id uuid,
  tags        text[] NOT NULL DEFAULT '{}',
  edited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_revisions_post_idx ON post_revisions (post_id, created_at DESC);

CREATE TABLE tags (
  id        uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name      text NOT NULL
);
CREATE UNIQUE INDEX tags_owner_name_key ON tags (owner_id, lower(name));

CREATE TABLE post_tags (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX post_tags_tag_idx ON post_tags (tag_id, post_id);

CREATE TABLE attachments (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  uploaded_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  post_id       uuid REFERENCES posts(id) ON DELETE CASCADE,         -- NULL until attached
  sort          int NOT NULL DEFAULT 0,
  filename      text NOT NULL,
  mime          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'pdf', 'document', 'archive', 'other')),
  size          bigint NOT NULL DEFAULT 0,
  sha256        text,
  backend_id    uuid REFERENCES storage_backends(id) ON DELETE SET NULL,
  storage_key   text,                         -- path / object key / drive file id
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'stored', 'failed')),
  spool_path    text,                         -- local temp copy until stored
  width         int,
  height        int,
  duration      real,
  media_status  text NOT NULL DEFAULT 'none' CHECK (media_status IN ('none', 'processing', 'ready', 'failed')),
  has_thumb     boolean NOT NULL DEFAULT false,
  has_hls       boolean NOT NULL DEFAULT false,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX attachments_post_idx ON attachments (post_id, sort);
CREATE INDEX attachments_kind_idx ON attachments (kind, post_id) WHERE deleted_at IS NULL;
CREATE INDEX attachments_orphan_idx ON attachments (created_at) WHERE post_id IS NULL;
CREATE INDEX attachments_filename_trgm_idx ON attachments USING gin (filename gin_trgm_ops);

CREATE TABLE comments (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  post_id     uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES comments(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        text NOT NULL,
  source      text NOT NULL DEFAULT 'web',
  created_at  timestamptz NOT NULL DEFAULT now(),
  edited_at   timestamptz,
  deleted_at  timestamptz,
  deleted_by  uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX comments_post_idx ON comments (post_id, created_at);

CREATE TABLE post_reads (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id  uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  read_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE reminders (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  due_at      timestamptz NOT NULL,
  repeat      text CHECK (repeat IN ('daily', 'weekly', 'monthly', 'yearly')),
  post_id     uuid REFERENCES posts(id) ON DELETE SET NULL,          -- optional linked post
  status      text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'done', 'cancelled')),
  last_fired_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reminders_due_idx ON reminders (due_at) WHERE status = 'scheduled';

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,                  -- agent_post | reminder | comment | share
  post_id     uuid REFERENCES posts(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE push_devices (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform    text NOT NULL CHECK (platform IN ('fcm', 'webpush')),
  token       text NOT NULL UNIQUE,           -- FCM token, or JSON web-push subscription
  label       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

-- Agent task registry: what each agent was asked to do and when it last ran.
CREATE TABLE agent_tasks (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  agent_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  schedule    text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'active',
  last_run_at timestamptz,
  last_result text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX agent_tasks_name_key ON agent_tasks (agent_id, lower(name));

-- Minimal durable job queue (worker claims with FOR UPDATE SKIP LOCKED).
CREATE TABLE jobs (
  id          bigserial PRIMARY KEY,
  type        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_at      timestamptz NOT NULL DEFAULT now(),
  attempts    int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  locked_at   timestamptz,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_ready_idx ON jobs (run_at) WHERE status = 'queued';

CREATE TABLE app_kv (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
