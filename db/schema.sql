
-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- TABLE 1: users

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR(50)  UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- TABLE 2: query_history  ← heart of the app

CREATE TABLE IF NOT EXISTS query_history (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    raw_query           TEXT NOT NULL,
    dialect             VARCHAR(20) DEFAULT 'postgresql',
    cost_score          NUMERIC(6,2),
    execution_time_ms   INTEGER,
    execution_plan      JSONB,
    tags                TEXT[],
    query_hash          TEXT GENERATED ALWAYS AS (
                            encode(digest(raw_query, 'sha256'), 'hex')
                        ) STORED,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- GIN index for fast JSONB plan queries
CREATE INDEX idx_query_history_plan
    ON query_history USING GIN (execution_plan);

-- GIN index for tag array search
CREATE INDEX idx_query_history_tags
    ON query_history USING GIN (tags);

-- B-tree index for fingerprint deduplication lookups
CREATE INDEX idx_query_history_hash
    ON query_history (query_hash);

-- B-tree index for per-user history queries
CREATE INDEX idx_query_history_user
    ON query_history (user_id, created_at DESC);



-- TABLE 3: execution_plan_nodes  ← stores D3 tree nodes

CREATE TABLE IF NOT EXISTS execution_plan_nodes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id        UUID NOT NULL REFERENCES query_history(id) ON DELETE CASCADE,
    parent_node_id  UUID REFERENCES execution_plan_nodes(id) ON DELETE CASCADE,
    node_type       VARCHAR(100) NOT NULL,   -- "Seq Scan", "Hash Join", etc.
    relation_name   VARCHAR(255),            -- table being scanned (if any)
    total_cost      NUMERIC(12,4),
    startup_cost    NUMERIC(12,4),
    actual_rows     INTEGER,
    plan_rows       INTEGER,
    actual_loops    INTEGER DEFAULT 1,
    heat_score      NUMERIC(4,3)             -- 0.000 to 1.000
        CHECK (heat_score >= 0 AND heat_score <= 1),
    node_details    JSONB,                   -- full node JSON for click-through
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Index to fetch all nodes for a given query fast
CREATE INDEX idx_plan_nodes_query
    ON execution_plan_nodes (query_id);

-- Index for tree traversal (find children of a node)
CREATE INDEX idx_plan_nodes_parent
    ON execution_plan_nodes (parent_node_id);


-- TABLE 4: optimization_suggestions
CREATE TABLE IF NOT EXISTS optimization_suggestions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id                UUID NOT NULL REFERENCES query_history(id) ON DELETE CASCADE,
    original_snippet        TEXT,
    rewritten_snippet       TEXT,
    explanation             TEXT,
    estimated_improvement   VARCHAR(50),     -- e.g. "8x faster"
    actual_improvement_pct  NUMERIC(6,2),    -- filled by regression detector
    regression_flag         BOOLEAN DEFAULT FALSE,
    source                  VARCHAR(20) DEFAULT 'ai'
        CHECK (source IN ('ai', 'static', 'manual')),
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_opt_suggestions_query
    ON optimization_suggestions (query_id);



-- TABLE 5: index_suggestions
CREATE TABLE IF NOT EXISTS index_suggestions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id         UUID NOT NULL REFERENCES query_history(id) ON DELETE CASCADE,
    table_name       VARCHAR(255) NOT NULL,
    column_name      VARCHAR(255) NOT NULL,
    index_type       VARCHAR(20) DEFAULT 'btree'
        CHECK (index_type IN ('btree', 'gin', 'hash', 'brin')),
    severity         VARCHAR(10) DEFAULT 'MEDIUM'
        CHECK (severity IN ('HIGH', 'MEDIUM', 'LOW')),
    reason           TEXT,
    create_statement TEXT NOT NULL,          -- ready-to-run CREATE INDEX SQL
    applied          BOOLEAN DEFAULT FALSE,  -- user can mark as done
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_index_suggestions_query
    ON index_suggestions (query_id);



-- TABLE 6: saved_queries

CREATE TABLE IF NOT EXISTS saved_queries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query_id    UUID NOT NULL REFERENCES query_history(id) ON DELETE CASCADE,
    title       VARCHAR(255) NOT NULL,
    notes       TEXT,
    folder      VARCHAR(100) DEFAULT 'General',
    pinned      BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, query_id)               -- no duplicate bookmarks
);

CREATE INDEX idx_saved_queries_user
    ON saved_queries (user_id, folder);



-- TABLE 7: shared_reports
CREATE TABLE IF NOT EXISTS shared_reports (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id     UUID NOT NULL REFERENCES query_history(id) ON DELETE CASCADE,
    share_token  VARCHAR(64) UNIQUE NOT NULL
                     DEFAULT encode(gen_random_bytes(32), 'hex'),
    is_public    BOOLEAN DEFAULT TRUE,
    view_count   INTEGER DEFAULT 0,
    expires_at   TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shared_reports_token
    ON shared_reports (share_token);

CREATE INDEX idx_shared_reports_query
    ON shared_reports (query_id);



-- TABLE 8: node_annotations  ← collaborative comments

CREATE TABLE IF NOT EXISTS node_annotations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_token  VARCHAR(64) NOT NULL REFERENCES shared_reports(share_token)
                     ON DELETE CASCADE,
    node_id      UUID REFERENCES execution_plan_nodes(id) ON DELETE CASCADE,
    author_name  VARCHAR(100),
    body         TEXT NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_annotations_token
    ON node_annotations (share_token);