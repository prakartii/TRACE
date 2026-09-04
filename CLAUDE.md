# TRACE — Claude Code Project Instructions

## 1. PROJECT

Project name: TRACE

Tagline:

> See what's about to go wrong. Know what to do instead.

TRACE is an AI Decision Intelligence system for physical warehouse operations.

TRACE is NOT a generic CCTV dashboard.

TRACE is NOT merely a YOLO detection project.

The central product innovation is the:

# SAFE ACTION PLANNER

TRACE must answer three questions in sequence:

1. WHAT is happening?
2. WHAT is likely to happen next?
3. WHAT should we do now to prevent it?

The product must close the loop:

Video
→ Perception
→ World Model
→ Risk Analysis
→ Prediction
→ Safe Action Recommendation
→ Intervention
→ Outcome Verification
→ Prevention Measurement
→ Learning / Pattern Memory

---

# 2. CANONICAL PRODUCT SPECIFICATION

The complete TRACE product specification is stored in:

`architecture.md`

This file is the canonical source of truth for the product.

Before implementing substantial functionality:

1. Read `architecture.md`.
2. Understand the relevant requirements.
3. Preserve its architecture, terminology, scenarios, features, priorities, and limitations.
4. Do not silently remove, simplify, or replace product requirements.
5. Do not redesign the product into a generic alternative architecture.

If there is ambiguity between implementation convenience and the product specification, prefer the specification and explain the engineering tradeoff.

The specification contains the complete requirements for:

- architecture
- product behavior
- 14 behaviour scenarios
- risk lenses
- Safe Action Planner
- What-if simulation
- micro-training
- near-miss analytics
- prevention measurement
- Responsible AI
- UI screens
- demo storyline
- MVP priorities
- technical stack
- bonus features
- judge objections

---

# 3. DEVELOPMENT PHILOSOPHY

Build TRACE incrementally.

DO NOT attempt to implement the entire project in one pass.

For each major feature:

1. Inspect existing code.
2. Understand the current implementation.
3. Plan the smallest correct change.
4. Implement it.
5. Run tests.
6. Run the application.
7. Verify integration.
8. Fix problems.
9. Only then move to the next feature.

Do not repeatedly rewrite working code.

Do not introduce unnecessary frameworks or infrastructure.

Prefer a small reliable implementation over a complicated fragile implementation.

---

# 4. PRIORITY ORDER

The implementation priority is:

### Phase 1
Repository and application scaffolding

### Phase 2
Video ingestion

### Phase 3
Detection + tracking

### Phase 4
World model / scene graph

### Phase 5
Structural analysis

### Phase 6
Process conformance

### Phase 7
Predictive risk

### Phase 8
Safe Action Planner

### Phase 9
Live intervention

### Phase 10
Outcome verification + prevention measurement

### Phase 11
What-if simulation

### Phase 12
Behaviour recognition

### Phase 13
Micro-training / rule configuration

### Phase 14
Analytics / learning memory

### Phase 15
AI assistant

### Phase 16
Responsible AI and final UX polish

MUST-BUILD functionality takes priority over SHOULD-BUILD and STRETCH functionality.

Do not let stretch features delay the Safe Action Planner.

---

# 5. ARCHITECTURE TO PRESERVE

TRACE has these logical layers:

## Layer 1 — PERCEPTION

Video
→ detection
→ tracking
→ optional pose
→ per-frame entity list

Initial classes:

- box/carton
- pallet
- trolley
- person
- vehicle-bed region

Recommended technology:

- Python 3.10+
- Ultralytics YOLOv8
- ByteTrack
- supervision
- MediaPipe Pose where useful

Perception must remain modular.

Downstream reasoning must not be tightly coupled to raw detector implementation.

---

# 6. LAYER 2 — WORLD MODEL

The World Model is the shared understanding substrate.

Represent:

- entities
- IDs
- classes
- positions
- dimensions
- footprints
- orientations
- timestamps
- support relationships
- contact relationships
- proximity relationships
- zones
- product metadata
- stack/load state

Use a scene graph.

Recommended:

- NetworkX
- NumPy

Downstream reasoning should consume the world model rather than directly reading detector output.

---

# 7. FOUR RISK LENSES

Keep these conceptually and architecturally separate.

## Structural Intelligence

Detect:

- support ratio
- COG offset
- tipping-moment estimate
- pallet overhang
- unsupported placement
- heavy-on-light mismatch
- structural changes after impact

## Behaviour Recognition

Detect actions such as:

- throwing
- dropping
- dragging
- rolling
- stepping on cartons
- straps used as handles
- solo heavy handling

Use temporal signals:

- trajectory
- velocity
- acceleration
- rotation
- pose
- contact
- movement patterns

## Process Conformance

Detect:

- wrong orientation
- stacking-order violations
- improper loading sequence
- wrong equipment usage
- deviation from optimal placement plan

## Environmental Risk

Support:

- wet-floor zones
- dock/vehicle gaps
- zone-level conditions

Environmental risk modifies the severity of concurrent events.

Do not incorrectly claim environmental conditions are automatically learned from video unless that functionality is actually implemented.

---

# 8. PRODUCT-SPECIFIC RISK

Product metadata should support:

- product class
- dimensions
- mass class
- fragility
- required orientation
- stacking constraints
- equipment requirements

Product-specific risk can modify severity of structural and behavioural signals.

---

# 9. PREDICTIVE RISK

Predictive Risk does not need to be a trained ML model for the MVP.

It can use:

- temporal trends
- structural signals
- conformance signals
- behaviour signals
- product risk
- environmental multipliers
- decision tables / rules

Output:

- Low
- Medium
- High
- Critical

Also output:

- triggering lens/lenses
- factor breakdown
- confidence
- timestamp
- affected entities

Temporal reasoning must be visible in the product.

---

# 10. CONFIDENCE

Every important risk event and planner recommendation should expose:

- High
- Medium
- Low

confidence.

Initial confidence can be heuristic using:

- mean detection confidence
- tracking continuity
- tracking ID switches
- geometry calibration state

Do not present this as a learned uncertainty model unless one is actually implemented.

---

# 11. SAFE ACTION PLANNER — CORE PRODUCT

The Safe Action Planner is the most important feature in TRACE.

It must actually perform candidate evaluation.

It must NOT be replaced by:

- a static mockup
- a generic warning
- a hardcoded recommendation
- "always move left"
- an unrelated ML model
- a dashboard-only implementation

Inputs:

- current world-model state
- product being placed
- product metadata
- existing stack/load
- support relationships
- geometry
- conformance rules

Generate a deliberately small set of feasible candidates:

1. proposed placement
2. adjacent alternative
3. another adjacent alternative
4. optional rotated orientation where allowed

Each candidate must be scored using the SAME structural scoring functions used by live monitoring.

Factors include:

- support ratio
- COG offset
- tipping estimate
- conformance
- hard constraints

Hard constraints can include:

- required orientation
- no pallet-edge overhang
- product compatibility
- custom supervisor rules

Return:

- candidate positions
- candidate scores
- risk bands
- feasibility
- recommended candidate
- instruction
- expected stability delta
- factor breakdown
- confidence

Example UI:

Position A → 42 — HIGH RISK
Position B → 86 — SAFE
Position C → 68 — MEDIUM

Recommended:
Position B, rotate 90°

Expected stability gain:
+44

These values are illustrative, not hardcoded product constants.

---

# 12. SINGLE STABILITY ENGINE

Implement one reusable structural scoring engine.

The same calculations must power:

- structural monitoring
- predictive risk inputs
- Safe Action Planner
- what-if simulation
- stability replay

Do not create separate contradictory stability calculations for each feature.

The stability model must be:

- deterministic
- explainable
- testable
- reusable

All stability values must be described as:

> Comparative operational risk indicators based on observed geometry and product metadata — not certified structural engineering calculations.

This limitation must appear in the actual UI.

---

# 13. WHAT-IF SIMULATION

What-if simulation must reuse the same scoring logic as the planner.

Minimum implementation:

1. Load historical sequence.
2. Select one placement event.
3. Modify that placement.
4. Re-run structural/conformance scoring.
5. Generate original stability trajectory.
6. Generate alternative stability trajectory.
7. Compare them visually.

UI should support:

> Replay with alternative

Show:

- original trajectory
- simulated trajectory
- placement markers
- risk transitions
- alerts
- explanation

Do NOT build a separate physics engine.

---

# 14. ALL 14 REQUIRED SCENARIOS

Preserve all 14 scenarios from `architecture.md`.

1. Heavy-on-light stacking
2. Throwing/dropping
3. Dragging instead of lifting
4. Rolling cartons/mattresses
5. Packaging straps used as handles
6. Stepping on cartons
7. Wrong product orientation
8. Pallet overhang
9. Dock/vehicle gap
10. Wet-floor handling
11. Improper/unplanned loading sequence
12. Solo handling of a heavy item
13. Wrong equipment usage
14. Unsupported/bending product placement

Maintain the correct lens ownership.

Do not claim the structural engine detects all 14.

Some scenarios are Behaviour events.

Some are Conformance events.

Some are Environmental events.

Some use Product-specific risk.

This separation is intentional.

---

# 15. PREVENTION MEASUREMENT

An event can only be classified as "Prevented" when ALL three conditions hold:

1. TRACE predicted a meaningful risk.
2. Corrective action occurred within the defined response window.
3. The subsequent world-model state returned to a safer condition before the risky placement/failure completed.

Otherwise classify appropriately as:

- Predicted
- Near-miss
- Outcome unclear
- Confirmed damage

Confirmed Damage requires human review.

Never automatically declare confirmed damage.

Never inflate prevention numbers.

---

# 16. NEAR-MISS

Near-miss is a first-class event type.

It represents a meaningful/high-risk event where:

- TRACE alerted/intervened
- corrective action occurred
- no confirmed failure occurred

Keep near-miss separate from:

- prevented
- confirmed damage
- unclear

---

# 17. MICRO-TRAINING / RULE CONFIGURATION

Supervisors must be able to configure rules.

MVP must support:

### Product rule

At least one:

- maximum stack height
OR
- required orientation

### Custom rule

At least one:

- e.g. "Do not place A on B"

Rules must affect runtime behaviour of:

- conformance
- planner constraints
- risk severity where appropriate

Do not make the rules merely decorative UI.

---

# 18. INTERVENTION

Intervention must be actionable.

Prefer:

> Move Carton B to Position B.

or:

> Rotate 90° and shift left.

Avoid generic:

> WARNING: UNSAFE.

Support:

- visual alert
- planner recommendation
- optional TTS/audio

---

# 19. OUTCOME VERIFICATION

After the worker acts:

- re-evaluate world model
- recompute structural state
- determine whether risk improved
- record outcome

This is required to close the loop.

---

# 20. LEARNING / PATTERN MEMORY

Store and aggregate:

- risky configurations
- behaviours
- zones
- processes
- conformance violations
- near misses
- planner interventions

Use these for:

- heat maps
- scorecards
- training recommendations
- recurring pattern summaries

Do not claim autonomous learning beyond what is actually implemented.

---

# 21. AI ASSISTANT

The AI assistant must be grounded in TRACE data.

The database/event store is the source of truth.

The LLM is NOT the source of truth.

It should answer questions such as:

- What were the most common risks?
- Which bay had the most near misses?
- Why was Carton B risky?
- What did TRACE recommend?
- How many events were prevented?
- Which behaviour occurred most frequently?

Use structured retrieval/function calling where appropriate.

Never invent event data.

---

# 22. RESPONSIBLE AI

Preserve:

- face blur by default
- RBAC
- operator/supervisor distinction
- configurable retention
- actual purge behaviour where feasible
- human review for confirmed damage
- false-positive flagging
- confidence visibility
- factor breakdown
- worker-independent structural/conformance/environmental analysis
- non-punitive coaching language
- team/process-level scorecards
- transparency notice
- stability-model limitation disclosure

Do not create punitive individual worker rankings.

---

# 23. REQUIRED UI

Eventually support:

1. Live View
2. Safe Action Planner
3. Structural 2D View
4. Event Feed
5. Incident Replay
6. Dashboard
7. AI Assistant
8. Responsible AI / Settings
9. What-if Replay
10. Micro-training / Rule Configuration

The Safe Action Planner is the headline screen.

Do not let the dashboard become the product identity.

---

# 24. VIDEO INPUTS

The challenge-provided input videos are important project assets.

They should be incorporated into:

- testing
- scenario validation
- demo playback
- event replay
- what-if demonstration where appropriate

Before implementing scenario-specific video logic, inspect the available videos and establish a mapping:

video
→ scenario
→ entities
→ lens
→ expected event
→ expected output

Do not assume a video demonstrates a scenario until it has been inspected.

Do not fabricate detections that are not supported by the footage.

The system should be honest about which scenarios are:

- demonstrated by provided footage
- demonstrated through controlled demo footage
- simulated
- integration-ready

---

# 25. DEMO-FIRST RELIABILITY

The primary goal is a reliable hackathon demonstration.

A deterministic, reproducible core demo is preferable to fragile unnecessary ML complexity.

The headline flow is:

LIVE VIDEO
→ worker approaches placement
→ planner activates
→ proposed placement scored
→ alternatives scored
→ safe alternative recommended
→ worker follows recommendation
→ world model updates
→ risk improves
→ prevention classification
→ what-if replay

The planner must be reliable before optional features are expanded.

---

# 26. MVP BOUNDARIES

## MUST BUILD

- one-camera video ingestion
- detection
- tracking
- world model
- support/contact relationships
- structural analysis
- conformance
- predictive risk
- confidence estimation
- Safe Action Planner
- 2–3 candidate placements
- intervention
- outcome verification
- prevention measurement
- near-miss classification
- one historical what-if sequence
- one product rule
- one custom rule
- event log
- responsible AI
- grounded AI assistant

## SHOULD BUILD

Only after MUST BUILD is stable:

- second camera
- vehicle-load extension
- multilingual TTS
- heat maps
- scorecards
- stability replay

## STRETCH

Do not allow these to delay core functionality:

- WMS integration
- VMS integration
- PPE detection
- forklift interaction
- learned planner
- learned forecaster
- full 3D digital twin

---

# 27. TECHNICAL STACK

Preferred stack from the product specification:

### Backend

Python 3.10+
FastAPI
WebSocket
SQLite initially

### Perception

Ultralytics YOLOv8
ByteTrack
supervision
MediaPipe Pose

### Reasoning

NumPy
NetworkX
Python rule modules

### Frontend

React
Vite
Tailwind CSS

### Visualization

Canvas
Recharts

### Storage

SQLite/Postgres
Local clip storage

### TTS

pyttsx3 initially

### LLM

Claude API or equivalent

Do not add major infrastructure unless justified.

---

# 28. CODE ORGANIZATION PRINCIPLES

Keep modules separated by responsibility.

Recommended conceptual separation:

backend/
├── perception/
├── world_model/
├── structural/
├── behaviour/
├── conformance/
├── environmental/
├── product_risk/
├── prediction/
├── planner/
├── intervention/
├── outcome/
├── analytics/
├── what_if/
├── rules/
├── assistant/
└── api/

Frontend should similarly separate:

- live view
- planner
- structural view
- events
- replay
- dashboard
- assistant
- settings
- what-if
- training

Exact directory structure can evolve if there is a good engineering reason.

---

# 29. TESTING

Core deterministic logic must have tests.

At minimum test:

- support ratio
- COG calculations
- tipping estimate
- structural score
- candidate generation
- candidate scoring
- hard constraints
- risk classification
- confidence
- prevention classification
- near-miss classification
- what-if transformation
- rule configuration

Do not rely solely on visual manual testing.

---

# 30. HONESTY RULE

TRACE must never fake intelligence.

Never:

- invent detections
- invent metrics
- invent accuracy
- invent prevented events
- claim certified physics
- claim confirmed damage without review
- claim a scenario was detected when it was not
- claim a feature is built when it is only mocked

If a feature is mocked for the demo, label it appropriately.

If a capability is integration-ready but not connected, say so.

If a limitation exists, preserve it rather than hiding it.

---

# 31. DO NOT DO

Never turn TRACE into:

- generic CCTV
- generic object detection
- generic dashboard
- static mockup
- black-box physics simulator
- unexplained risk score
- individual worker punishment system

Never remove:

- Safe Action Planner
- What-if simulation
- near-miss analytics
- micro-training
- prevention measurement
- confidence
- responsible AI
- any of the 14 scenarios

Never let optional features block the core demo.

---

# 32. GIT / CHANGE SAFETY

Before substantial changes:

- inspect git status
- inspect existing code
- avoid destructive operations
- avoid deleting working functionality
- keep changes logically scoped

After major changes:

- run relevant tests
- run build/lint checks where applicable
- report what changed
- report any known limitations

Do not make unrelated refactors while implementing a feature.

---

# 33. FIRST DEVELOPMENT RULE

When the repository is initially empty:

DO NOT immediately implement the complete TRACE application.

First:

1. Read `architecture.md`.
2. Inspect the repository.
3. Create the agreed project structure.
4. Create backend/frontend scaffolding.
5. Create basic configuration.
6. Create initial data/schema definitions where appropriate.
7. Create development documentation.
8. Verify the project runs.
9. Stop and report the result.

Then wait for the next implementation instruction.

---

# 34. FINAL PRODUCT IDENTITY

Always preserve this principle:

> A normal system tells you what went wrong.
>
> TRACE predicts what is about to go wrong, evaluates realistic alternatives, tells the operator what to do instead, verifies whether the intervention improved the state, and learns from the resulting event history.

The Safe Action Planner is the central differentiator.

Everything else should strengthen that story.