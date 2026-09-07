-- TRACE database schema (SQLite).
-- Mirrors ARCHITECTURE.md Part 4 exactly, with IF NOT EXISTS added to each
-- table so the app can safely call init_db() on every startup against a
-- persisted database file.

-- Product metadata
CREATE TABLE IF NOT EXISTS products (
    product_id TEXT PRIMARY KEY,
    class_name TEXT,
    mass_class TEXT,           -- light/medium/heavy
    fragility TEXT,            -- low/medium/high
    required_orientation TEXT, -- e.g. 'this-side-up' or NULL
    max_stack_height INTEGER
);

-- Scene states (snapshots of the world model)
CREATE TABLE IF NOT EXISTS scene_states (
    state_id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp REAL,
    entities_json TEXT,        -- serialized entity list
    edges_json TEXT            -- serialized support/contact edges
);

-- Events (unifies risk alerts, planner recommendations, behaviour catches)
CREATE TABLE IF NOT EXISTS events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT,
    timestamp REAL,
    event_type TEXT,           -- 'risk' | 'planner_rec' | 'behaviour' | 'near_miss' | 'prevented' | 'confirmed_damage'
    lens TEXT,                 -- 'structural' | 'behaviour' | 'conformance' | 'environmental'
    entity_id TEXT,
    score REAL,
    band TEXT,                 -- Low/Medium/High/Critical
    confidence TEXT,           -- High/Medium/Low
    status TEXT,               -- 'supported' | 'probable' | 'insufficient_evidence' | 'unsupported'
    scenario TEXT,
    factor_breakdown_json TEXT,
    clip_path TEXT,
    reviewed INTEGER DEFAULT 0,
    review_status TEXT,        -- 'confirmed_damage' | 'false_positive' | NULL
    dedup_key TEXT UNIQUE
);

-- Planner recommendations (child of events, for planner-specific fields)
CREATE TABLE IF NOT EXISTS planner_recommendations (
    rec_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER REFERENCES events(event_id),
    candidates_json TEXT,      -- [{position, score, band}]
    recommended_position TEXT,
    expected_delta REAL,
    followed INTEGER,          -- was it followed? (observed post-hoc)
    outcome_state_id INTEGER REFERENCES scene_states(state_id),
    recommendation_json TEXT
);

-- Product rules (micro-training)
CREATE TABLE IF NOT EXISTS product_rules (
    rule_id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT REFERENCES products(product_id),
    rule_type TEXT,            -- 'max_stack_height' | 'required_orientation'
    rule_value TEXT,
    created_by TEXT,
    created_at REAL
);

-- Custom rules (freeform, e.g. "Do not place A on B")
CREATE TABLE IF NOT EXISTS custom_rules (
    rule_id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT,
    condition_json TEXT,       -- machine-readable condition
    created_by TEXT,
    created_at REAL
);

-- False-positive flags (feeds Layer 9)
CREATE TABLE IF NOT EXISTS feedback (
    feedback_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER REFERENCES events(event_id),
    flag_type TEXT,            -- 'false_positive'
    created_at REAL
);

-- Session ratings (human impact metric)
CREATE TABLE IF NOT EXISTS session_ratings (
    rating_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    rating INTEGER,            -- 1-5
    created_at REAL
);

-- Phase 10: Outcome measurements and prevention classification ledger (Layer 8)
CREATE TABLE IF NOT EXISTS outcome_measurements (
    outcome_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(event_id),
    video_id TEXT,
    initial_timestamp REAL NOT NULL,
    outcome_timestamp REAL,
    response_window_sec REAL DEFAULT 5.0,
    classification TEXT NOT NULL, -- 'prevented' | 'near_miss' | 'outcome_unclear' | 'confirmed_damage'
    condition_1_satisfied INTEGER NOT NULL,
    condition_2_satisfied INTEGER NOT NULL,
    condition_3_satisfied INTEGER NOT NULL,
    three_condition_json TEXT NOT NULL,
    initial_score REAL,
    outcome_score REAL,
    initial_band TEXT,
    outcome_band TEXT,
    followed_recommendation INTEGER,
    human_review_status TEXT,
    explanation TEXT,
    evidence_json TEXT,
    limitations_json TEXT,
    evaluated_at REAL NOT NULL,
    dedup_key TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_outcomes_event ON outcome_measurements(event_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_class ON outcome_measurements(classification);
CREATE INDEX IF NOT EXISTS idx_outcomes_video ON outcome_measurements(video_id);

