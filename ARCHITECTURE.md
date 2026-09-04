# TRACE — Final Winning Product Specification

**AI Decision Intelligence for Physical Warehouse Operations**

**GEG Challenge — submission due 10 Sept 2026**

---

## 0. Pre-answer judge attack (resolved in this spec)

- **"Is this just a fancy dashboard?"**
  No. The dashboard is only a visualization layer. The innovation is the **Safe Action Planner**, which evaluates alternative next placements and recommends one before the risky move is made, now extended with **what‑if simulation** and **micro‑training rules**.

- **"Can this be demoed in a miniature warehouse?"**
  Yes. All inputs (geometry, product metadata, support relationships, simple rules) are available from a toy rig. Nothing requires industrial-scale footage.

- **"Are the physics claims defensible?"**
  Yes, because every stability number is explicitly labeled as a **comparative operational risk estimate**, with **confidence levels** shown. What‑if and replay use the same transparent formulas, not a black‑box physics engine.

- **"Does it satisfy the AI/video-intelligence requirement?"**
  Yes. Detection, tracking, temporal reasoning, and risk classification all feed the planner. Behaviour recognition is a parallel lens, not ignored. Temporal reasoning is visibly demonstrated via **stability replay** and **sequence-based what‑if**.

- **"Does it meaningfully improve damage prevention?"**
  Yes. It acts *before* the risky placement is finalized, verifies whether the correction worked (3‑condition rule), and now also surfaces **near‑miss** patterns and **training rules**, directly aligned with industrial safety practice.

- **"Are bonus features natural or forced?"**
  Bonus features are marked honestly as Core/Built, Partial Demo, or Integration-ready. New features (what‑if, micro‑training, near‑miss) are natural extensions of the existing architecture.

- **"Can 3–5 students build the MVP?"**
  Yes. Every MUST-BUILD piece is closed-form math or rule logic. No physics engine, no large trained model required beyond a base detector. The four upgrades reuse existing formulas and data structures.

- **"One unforgettable demo moment?"**
  Yes. The **CURRENT → PREDICTED → SAFE ALTERNATIVE** card appearing live over the video as the worker is about to place the next carton, followed by a 20‑second **what‑if replay** showing how a different choice would have changed the stability curve.

- **"Would a YOLO+dashboard team look inferior next to this?"**
  Yes. They can tell you what happened. TRACE tells you what to do *before* it happens, verifies that the risk was corrected, and shows how alternative decisions would have changed the outcome.

---

## 1. Product Name + Tagline

**TRACE** — *See what's about to go wrong. Know what to do instead.*

---

## 2. Core Problem

Warehouse damage overwhelmingly comes from handling decisions made in the moment: where to place the next carton, whether this stack can take one more layer, whether this load will survive transit. Workers make these decisions on instinct, with no structured feedback until something has already broken. Traditional CCTV records the outcome. Even a good behaviour-detection system only names the mistake after it's made.

---

## 3. One-Line Pitch

TRACE watches the physical state of a warehouse operation build up in real time, predicts the specific configuration that's about to become unsafe, evaluates realistic alternatives, and tells the worker exactly which one to choose — before the risky placement happens, not after.

---

## 4. Core Innovation

**The Safe Action Planner**: a decision layer that sits between "risk detected" and "alert shown." When TRACE's world model shows a worker approaching a placement decision (the next carton, the next pallet position, the next stack layer), the planner:

- Scores the **proposed** action.
- Scores **2–3 realistic alternative actions** using the same transparent geometry/support model.
- Recommends the **highest-scoring safe alternative** with a specific instruction:

```
CARTON B — NEXT PLACEMENT
Position A → Stability 42 — HIGH RISK
Position B → Stability 86 — SAFE ✓
Position C → Stability 68 — MEDIUM

Recommended: Position B, rotate 90°
Expected stability gain: +44
```

This is explicitly **not** a physics simulator. It is an explainable operational decision model built from observable geometry, support relationships, product metadata, and the brief's own loading rules — and the system states this limitation on-screen, not just in the deck.

**Additional core capabilities:**

- **What‑If Simulation:** Re-run the same scoring logic over a historical sequence with an alternative placement to show how the stability trajectory would have changed.
- **Confidence‑Aware Risk:** Every risk alert and recommendation is shown with a confidence level (High/Medium/Low) based on detection quality, tracking continuity, and geometry calibration.
- **Micro‑Training / Rule Configuration:** Supervisors can define product-class rules and simple custom rules that immediately affect conformance checks and planner constraints.
- **Near‑Miss Analytics:** Explicitly log and surface near‑miss events (high risk + alert + correction, no failure) separately from prevented events and confirmed damage.

---

## 5. Why This Is Different From Normal CCTV/YOLO Systems

A YOLO+dashboard system answers one question: *what happened?*
TRACE is built to answer three, in sequence, as its actual product identity:

- **WHAT is happening?** — the live scene graph / world model (Layer 2).
- **WHAT is likely to happen next?** — the predictive risk layer (Layer 4).
- **WHAT should we do now to prevent it?** — the Safe Action Planner (Layer 5), which no competing "detect and dashboard" design produces, because they stop at prediction.

---

## 6. Architecture — the closed loop

```
Video
  |
  v
Layer 1 - PERCEPTION
  detection + tracking + pose -> per-frame entity list
  |
  v
Layer 2 - SPATIAL / OPERATIONAL WORLD MODEL
  scene graph: entities, footprints, positions, support/contact edges,
  product metadata (mass class, fragility, required orientation)
  - this is the shared "understanding" substrate every layer below reads from
  |
  +------------------+-------------------+-----------------------+
  v                  v                   v                       v
Structural       Process             Product-Specific       Environmental
Analysis         Conformance         Risk                   Risk
(support         (observed vs.       (fragility/mass        (wet floor,
ratio, COG,      optimal placement   priors modulate         dock gap,
tipping          plan, sequence      severity of any         zone conditions)
moment)          alignment)          structural/behaviour
                                     signal)
  |                  |                   |                       |
  +--------+---------+-------------------+-----------------------+
           v
Layer 3 - BEHAVIOUR RECOGNITION (parallel input, not the spine)
  drop/drag/throw/roll/step-on/strap-lift etc. - pose + trajectory signals
           |
           v
Layer 4 - PREDICTIVE RISK
  trend of structural + conformance + product + environmental + behaviour
  signals -> forecast: "this configuration is heading toward a breach"
  + confidence estimation (detection quality, tracking continuity, geometry)
           |
           v
Layer 5 - SAFE ACTION PLANNER  [core innovation]
  scores the proposed next action + 2-3 alternatives on the same model ->
  recommends the safest feasible one, with the expected stability delta
  + supports WHAT-IF SIMULATION over historical sequences
           |
           v
Layer 5b - MICRO-TRAINING / RULE CONFIGURATION
  supervisor-defined product rules and custom constraints
  immediately applied to Conformance + Planner + Risk severity
           |
           v
Layer 6 - INTERVENTION
  on-screen instruction + audio alert, delivered at the moment of decision
           |
           v
Layer 7 - OBSERVE OUTCOME
  world model re-evaluated after the worker acts -> did the state improve?
           |
           v
Layer 8 - PREVENTION MEASUREMENT
  three buckets:
    - Prevented (3 conditions met)
    - Near-miss (high risk + alert + correction, no failure)
    - Outcome unclear / Confirmed damage (human-reviewed)
           |
           v
Layer 9 - LEARNING / PATTERN MEMORY
  recurring risky configurations, repeat behaviours, per-zone/per-process
  patterns -> feeds heat maps, scorecards, training recommendations,
  and future refinement of the planner's rule weights
```

**One-line contribution of each layer:**

- *Perception* — turns pixels into entities.
- *World model* — turns entities into a structured, queryable physical understanding.
- *Structural / Conformance / Product / Environmental* — four independent, explainable risk lenses on that world model.
- *Behaviour recognition* — catches risks that are about actions, not states (a strap-lift, a throw), which the structural model alone cannot see from state alone.
- *Predictive risk* — turns the current snapshot into a trend and a forecast, with confidence.
- *Safe Action Planner* — turns the forecast into a decision; TRACE's actual product identity.
- *Micro‑Training* — turns supervisor knowledge into immediate, enforceable rules.
- *Intervention* — delivers that decision at the moment it matters.
- *Observe outcome / prevention measurement* — closes the loop honestly, without inflating results.
- *Learning memory* — makes the system get more useful over the course of a shift, and over the course of the hackathon's own development.

---

## 7. Safe Action Planner — mechanism in detail

**Inputs:**

- Current world-model state (supports, positions, existing stack/pallet/load).
- Product about to be placed (from metadata: dimensions, mass class, fragility, required orientation).
- A small set of *feasible* candidate placements, generated by simple heuristics:
  - The current proposed position.
  - One or two adjacent positions.
  - A rotated orientation if the product's metadata allows it.

**Scoring:**

Each candidate is scored using the same Stability Score formula as the live monitoring engine:

- Support ratio.
- Center-of-gravity (COG) offset.
- Tipping-moment estimate.
- Conformance check against loading-plan rules.

This reuse is deliberate: the planner isn't a separate model; it's the existing structural engine run forward on hypothetical states — which is exactly what keeps this buildable instead of requiring a real simulator.

**Recommendation:**

The highest-scoring candidate that also satisfies hard constraints (correct orientation if required, no overhang past the pallet edge) is recommended, with:

- The expected stability delta shown.
- A specific instruction ("rotate 90°, shift left") rather than a generic "be careful."

**Stated limitation, on-screen:**

> "Stability estimates are comparative operational risk indicators based on observed geometry and product metadata — not certified structural engineering calculations."

This sentence appears in the UI itself, not only in the pitch deck.

**What‑if simulation:**
The same scoring function used for live planning can be run over a **historical sequence** with one or more placements altered. This enables:

- Replay of a past event with an alternative decision.
- Visualization of how the stability trajectory would have changed.
- Training and root-cause analysis without any new modeling work.

In the UI, this appears as a "Replay with alternative" button on the incident replay screen.

---

## 8. Four Independent Risk Lenses (kept explicitly separate, then combined)

| Lens | What it catches | Feeds into |
|---|---|---|
| **Structural intelligence** | Support ratio, COG offset, tipping moment for the current physical arrangement | Predictive risk + Safe Action Planner |
| **Behaviour recognition** | Drops, throws, drags, rolls, straps-as-handles, stepping on cartons — actions the structural model can't see from state alone | Predictive risk (severity modifier), event log |
| **Process conformance** | Actual placement order/orientation vs. the rule-derived optimal plan | Predictive risk + Safe Action Planner's constraint check |
| **Environmental risk** | Wet-floor zones, dock/vehicle gap, zone-level conditions | Severity multiplier on any concurrent structural/behaviour signal |

Each lens also contributes to a **confidence estimate** based on detection quality, tracking continuity, and geometry calibration, so that risk is always shown together with how certain the system is.

The final risk decision is a combination, not a single score. The dashboard shows which lens(es) triggered a given event, which is itself an explainability strength.

---

## 9. Behaviour Scenarios (14, explicitly tagged by which lens detects them)

1. **Heavy-on-light stacking** — *Structural* (support ratio + mass-prior mismatch) + *Conformance* (violates stacking-order rule).
2. **Throwing/dropping** — *Behaviour* (trajectory/velocity spike), confirmed by *Structural* recompute on impact.
3. **Dragging instead of lifting** — *Behaviour* (sustained ground contact, no equipment nearby).
4. **Rolling cartons/mattresses** — *Behaviour* (rotation-while-translating signature).
5. **Packaging straps used as handles** — *Behaviour* (pose/grip region), logged as Observed (not predictable in advance — an honest limitation, not hidden).
6. **Stepping on cartons** — *Behaviour* (foot-contact + weight-bearing pose) escalated by *Structural* (that carton's support state).
7. **Wrong product orientation** — *Conformance* (metadata-required axis vs. observed axis).
8. **Pallet overhang** — *Structural* (footprint comparison, unsupported area).
9. **Dock/vehicle gap** — *Environmental* (static zone calibration), gates the *Structural* vehicle-load model.
10. **Wet-floor handling** — *Environmental* zone flag, multiplies severity of any concurrent event.
11. **Improper/unplanned loading sequence** — *Conformance* (sequence-alignment divergence from the optimal plan) — this is where the **Safe Action Planner fires proactively**, before the out-of-sequence placement is finalized.
12. **Solo handling of a heavy item** — *Behaviour* (single-skeleton lift pose) + *Product-specific risk* (mass-class threshold).
13. **Wrong equipment usage (pallet where trolley required)** — *Conformance* (equipment-class rule from product metadata).
14. **Unsupported/bending product placement** — *Structural* (support ratio across the product's span, not just its base).

*(PDI/process violations — realistically demonstrable only if the pilot rig includes a distinct "inspection area" step; included as a Should-Build extension of the Conformance lens, not core, since it depends on rig layout more than the others.)*

The document does **not** claim the structural engine detects all 14 — the table above is the honest separation the brief itself implicitly rewards (explainability).

---

## 10. Complete Mandatory Requirement Mapping

| Requirement | How TRACE satisfies it |
|---|---|
| Video ingestion, detection/tracking | Layer 1 |
| Object Detection + Tracking + Action Recognition + Temporal Reasoning + Risk Classification | All present; Temporal Reasoning realized as the trend feeding Layer 4; Risk Classification as the Low–Critical banding on Layer 4's output |
| Behaviour identification | Layer 3, explicitly separated (Section 8) |
| Risk scoring (Low/Med/High/Critical) | Combined-lens score, factor breakdown shown per event |
| Observed → Potential Risk → Confirmed Damage | Observed = current world-model state; Potential Risk = Layer 4 forecast; Confirmed Damage = human-reviewed only, never auto-asserted |
| Conversational AI assistant grounded in detected events | Function-calling over the event/state log only |
| ≥10 behaviours demonstrated | 14, Section 9 |
| Responsible AI | Section 15 |
| 5–6 slide deck, deadline 10 Sept 2026 | Content maps to this spec's sections |
| Prevention & Learning | Prevented events, near-miss analytics, what-if simulation, and micro-training rules all feed operational improvement and training recommendations |

---

## 11. Complete Official Bonus-Feature Mapping

| Bonus feature | Status | How the architecture enables it |
|---|---|---|
| Real-time alerts | **Core/Built** | Layer 6, fires the instant the planner recommends |
| Predictive risk scoring | **Core/Built** | Layer 4, the forecast itself |
| Damage prediction | **Core/Built** | Same forecast, framed as damage likelihood |
| Loading sequence verification | **Core/Built** | Conformance lens, native output |
| Pallet stability assessment | **Core/Built** | Structural lens, native output — the planner's scoring substrate |
| Product-specific risk models | **Core/Built** | Product-specific lens, uses metadata mass/fragility priors |
| Worker-independent behaviour analysis | **Built** | Structural/Conformance/Environmental lenses are identity-blind by construction; only the Behaviour lens observes a person, and it scores the action, not the individual |
| Automatic incident replay | **Built** | Clip buffer keyed to event log |
| Behaviour heat maps | **Built** | Aggregated from event log by zone |
| Automatic incident reports | **Built** | Templated summary from Layer 9 |
| Conversational AI supervisor assistant | **Built** | Section 6, Layer 6/9 query interface |
| Edge AI / offline inference | **Built** | Layers 1–6 run locally; no cloud dependency for the core loop |
| Vehicle loading pattern analysis | **Partial Demo** | Structural lens extended to the vehicle-bed region for the pilot vehicle only |
| Multi-camera tracking | **Partial Demo** | World model merges 2 camera views via shared bay coordinates; re-ID is basic, not production-grade |
| Multilingual voice alerts | **Partial Demo** | TTS in 2 languages for the demo |
| Gamification | **Partial Demo** | Session-level conformance/stability score shown; not a full game layer |
| Operator/team safety scorecards | **Partial Demo** | Team/process-level aggregation shown, non-punitive framing |
| Forklift/pedestrian interaction monitoring | **Integration-ready** | World model already has proximity edges between any two entity types; a forklift class + interaction-risk rule is an additive, not architectural, change |
| PPE compliance detection | **Integration-ready** | Reuses Layer 1's person detections with an additional classifier head — doesn't touch the core loop |
| WMS integration | **Integration-ready** | Conformance engine's "optimal plan" input is designed to accept an external plan feed in place of the rule-generated one |
| CCTV/VMS integration | **Integration-ready** | Layer 1 already ingests standard RTSP/file input, the plug-in point a real VMS would use |
| Digital twin / 3D visualization | **Future (deliberately secondary)** | A functional 2D structural view is built for the demo; full 3D is explicitly not pursued, since the innovation is the decision layer, not the rendering |
| What-if simulation / training mode | **Built** | Reuses the Safe Action Planner's scoring logic over historical sequences |
| Configurable product-specific rules | **Built** | Micro-training layer allows supervisors to define product rules and custom constraints |
| Near-miss analytics | **Built** | Prevention Measurement layer explicitly logs near-miss events separately from prevented and confirmed |

No feature is silently dropped; nothing here is force-fit into the MVP.

---

## 12. Prototype Screens

1. **Live view** — video + scene-graph overlay (boxes, support edges).
2. **Safe Action Planner panel** — the CURRENT → PREDICTED → SAFE ALTERNATIVE card (the product's headline screen).
3. **Structural 2D view** — current physical state, support relationships, risk zones, predicted failure state, candidate placements — explicitly the "digital twin," positioned as a visualization of the decision layer, not the star of the show.
4. **Event feed** — Observed/Potential Risk/Confirmed Damage tags, per-lens attribution.
5. **Incident replay** — clip + factor breakdown + what was recommended vs. what happened.
6. **Dashboard** — heat map, repeat-pattern list, prevented/flagged/unclear counters, scorecards, near-miss breakdown.
7. **AI assistant panel** — grounded Q&A.
8. **Responsible-AI/settings panel** — face-blur, RBAC, retention, false-positive log, human-review gate.
9. **What-if replay screen** — original vs. simulated stability curve, with placement markers and alert markers.
10. **Micro-training / rule config panel** — simple form to define product class rules and one custom rule.

---

## 13. Winning Demo Storyline (4 minutes)

1. **(0:00–0:15) No login screen, no dashboard.**
   Live view: a worker holding Carton B, approaching a stack.

2. **(0:15–0:45) The planner card appears, live, over the video.**
   ```
   Position A → 42, HIGH RISK
   Position B → 86, SAFE
   Position C → 68, MEDIUM
   Recommended: Position B, rotate 90°
   ```
   This is the 10-second moment a judge understands the category shift: not a warning, a decision.

3. **(0:45–1:15) The worker follows the recommendation.**
   Stability visibly climbs on screen. TRACE logs it: Predicted → Intervened → **Prevented**, with the 3-condition check shown briefly.

4. **(1:15–1:45) What-if replay.**
   "Let's see what would have happened if the worker had followed the recommendation."
   Show:
   - Original stability curve crossing into High Risk.
   - Simulated curve staying in Safe.
   - A short explanation: "This is the same model, run over the past sequence with one change."

5. **(1:45–2:45) Breadth montage:**
   - The same planner logic firing on a sequence-conformance violation (Scenario 11) and an overhang case (Scenario 8).
   - Plus 2–3 pure-behaviour catches (drop, drag) to show the parallel Behaviour lens still works independently.

6. **(2:45–3:30) Supervisor layer:**
   Dashboard with the honest prevented/near-miss/unclear breakdown, heat map, then a live AI-assistant question answered from real logged data. Briefly show the micro-training panel where one rule is defined.

7. **(3:30–3:45) Responsible-AI beat:**
   Face-blur, worker-independent framing, human-review gate — 15 seconds, preempting the question before it's asked.

8. **(3:45–4:00) Close:**
   "A normal system would have told you a carton was dropped. TRACE told the worker where to put it so it wouldn't be, and can show how a different choice would have changed the outcome."

---

## 14. Success Metrics (native outputs, brief-aligned)

### AI performance

- Detection precision/recall on a small labelled pilot subset (e.g., 50–100 annotated frames/clips).
- Per-frame latency logged automatically.
- False-positive rate = false-positive clicks ÷ total events.
- Confidence distribution of alerts (High/Medium/Low).

### Operational

- High-risk events/shift (Layer 4 threshold crossings).
- Repeat-behaviour frequency (Layer 9 grouping).
- Average response time (alert timestamp → observed correction timestamp).
- Risk events by bay (zone tag, native).

### Business impact — "potential damage events prevented"

Counted only when all three hold:

1. TRACE predicted a meaningful risk.
2. A corrective action occurred within the defined response window.
3. The subsequent world-model state returned to a safer condition before the risky placement/failure completed.

Anything not meeting all three is logged as:

- **Predicted**
- **Near-miss** (high risk + alert + correction, no failure)
- **Outcome unclear / Confirmed damage** (human-reviewed)

Shown separately on the dashboard, never folded into a single headline number. Financial-impact figures shown only as explicitly labelled illustrative estimates.

### Human impact

- In-app 1–5 rating prompt after each session (native, not a bolted-on survey).
- Recurring conformance-violation types surfaced automatically as training-opportunity suggestions.
- Rules configured per session — count of product rules or custom rules defined by the supervisor in the micro-training panel (even if only 1–2 in the demo).

---

## 15. Responsible AI Implementation

- Structural/Conformance/Environmental lenses are worker-independent by architecture, not policy.
- Face-blur default on; RBAC (supervisor vs. operator views); configurable retention window with real auto-purge behaviour in the demo.
- "Confirmed Damage" status requires a human-review click — the system never self-confirms.
- One-click false-positive flag feeds back into Layer 9's pattern memory.
- Every risk score and every planner recommendation ships with its factor breakdown and confidence level, visible in the UI.
- UI copy framed as coaching/process insight; scorecards aggregated at team/process level, not individual leaderboards.
- On-screen consent/transparency notice; explicit disclosure that stability figures are comparative estimates, not certified values.
- Confidence-aware risk scoring ensures that uncertain detections do not trigger high-consequence actions without human review.

---

## 16. MVP / Should Build / Stretch — feasibility-checked

### MUST BUILD (live demo depends on these)

- Detection + tracking, 1 camera, toy warehouse.
- World model (scene graph) with support/contact edges.
- Structural Analysis lens (support ratio, COG offset, tipping-moment formula — closed-form, no simulator).
- Conformance lens for stacking order + orientation.
- Predictive Risk (trend-based forecast, rule/decision-table, not a trained model) with confidence estimation.
- **Safe Action Planner** — scoring the proposed placement + 2 alternative candidates using the same structural formulas; this is the one piece that must work reliably, since it's the entire headline moment.
- **What-if simulation** for one historical sequence (single sequence, one alternative placement).
- **Micro-training panel** with:
  - One product class rule (max stack height or required orientation).
  - One custom rule (e.g., "Do not place A on B").
- Event log with the 3-condition prevented-event logic; dashboard showing prevented/near-miss/unclear honestly.
- Responsible-AI panel.
- AI assistant grounded on the event log.

### SHOULD BUILD (if on schedule)

- Second camera (Partial multi-camera credit).
- Vehicle-load extension of the structural lens.
- 2-language TTS.
- Heat map + scorecards (cheap, same data).
- Stability replay visualization (timeline chart).

### STRETCH (do not block core demo)

- WMS/VMS integration points — mocked, clearly labelled as designed-not-connected.
- PPE detection, forklift-interaction rule.
- A learned (vs. rule-based) forecaster or planner-weight tuning.
- Full 3D visualization — deliberately deprioritized; time is better spent making the planner reliable.

---

## 17. Technical Stack

### Perception

- **Language:** Python 3.10+
- **Object detection:** YOLOv8 (Ultralytics, nano or small variant), fine-tuned on pilot classes (box, pallet, trolley, person, vehicle-bed region).
- **Tracking:** ByteTrack (via `supervision` or similar).
- **Pose (optional but recommended):** MediaPipe Pose for person skeleton (to detect stepping, strap-lift, solo heavy-lift).

### World model & reasoning

- **Graph + geometry:** `networkx` for scene graph; NumPy for all geometry/physics math (support ratio, COG offset, tipping moment, planner candidate scoring — all closed-form).
- **Conformance/rules:** Hand-authored Python rule modules, seeded directly from the brief's own good-practice table + product metadata.
- **Safe Action Planner:** Implemented as a function that re-runs the Structural Analysis formulas on 2–3 candidate placements generated by simple positional/rotational heuristics — no search algorithm or simulator needed at this scope.
- **What-if simulation:**
  - Implemented as a Python function that:
    - Loads a sequence of placement events.
    - Clones and modifies one placement.
    - Re-runs the structural/conformance scoring.
    - Returns two time series for plotting.

### Backend

- **API + streaming:** FastAPI + WebSocket for live state streaming.
- **Database:** SQLite (or Postgres if you prefer) for:
  - Events
  - Scene states
  - Reviews (false-positive, confirmed damage, etc.)
  - Product metadata
  - Product rules
  - Custom rules
- **Clip storage:** Local disk for buffered video clips keyed to event IDs.

### LLM assistant

- **Model:** Claude API (or equivalent).
- **Integration:** Function-calling restricted to querying the event/state store.
- **Guardrails:** Answers only from retrieved data; no invented facts.

### Frontend

- **Framework:** React (Vite).
- **Styling:** Tailwind CSS.
- **Visualization:**
  - Canvas overlay for live view and planner card.
  - `recharts` (or similar) for dashboard charts and stability replay.
- **Key screens:** Live view, planner panel, structural 2D view, event feed, replay, dashboard, assistant panel, settings, what-if replay, micro-training panel.

### TTS & audio

- **Offline TTS:** `pyttsx3`.
- **Cloud TTS (optional):** One additional language for demo.

### Edge/cloud split

- **Local (latency-critical):** Layers 1–8 run on a single laptop in the hackathon.
- **Central (optional):** LLM calls and cross-session aggregation can be centralized; for the hackathon, this can be the same machine.

### Additional modules

- **Micro-training / rule config:**
  - Simple React form + FastAPI endpoints to:
    - Create/update product rules.
    - Create/update custom rules.
  - Rules loaded at runtime into the Conformance and Planner modules.

- **Confidence estimation:**
  - Heuristic function over:
    - Mean detection confidence.
    - Tracking ID switch count.
    - Geometry calibration flags.
  - Returns a confidence level used in the UI and for alert throttling.

- **Near-miss analytics:**
  - Additional event type in the DB: `near_miss`.
  - Aggregation query for the dashboard.

---

## 18. Judge Objections + Answers

**"Is the Safe Action Planner just a rules engine with a nice UI?"**
Yes, underneath — and that's stated openly. Its value isn't algorithmic novelty; it's that it's the first layer in this product category to close the loop from *prediction* to *recommendation*, using the same transparent structural model as the monitoring layer, which is exactly what makes it explainable and buildable in a hackathon window rather than a black box.

**"How do you generate 'alternative placements' without a real search/planning algorithm?"**
Deliberately narrow: 2–3 heuristically-generated candidates (adjacent position, rotated orientation) — not general planning. This is disclosed as a scoping decision, not hidden as a limitation.

**"Are the stability numbers trustworthy?"**
Explicitly not certified engineering values — stated on-screen as comparative operational estimates. The demo's credibility rests on the *trend* being directionally right (validated against hand-reviewed pilot clips), not on absolute physical accuracy.

**"Is 'prevented' just a number you're claiming?"**
No — the 3-condition rule is shown on the dashboard itself, with a visibly separate Predicted/Near-miss/Unclear bucket for everything that doesn't meet it.

**"Doesn't separating four risk lenses plus a planner make this too much to build in 9 days?"**
The MUST-BUILD list reuses one structural formula set across the Structural lens, the Predictive layer, and the Planner — three product-facing capabilities from one implemented function, which is what keeps the ambitious-sounding architecture buildable.

**"Is the what-if simulation just a toy, or does it add real value?"**
It reuses the exact same structural and conformance logic as the live planner, so it's not a separate simulation engine. Its value is turning TRACE into a **training and root-cause tool**, not just a live alarm system. That directly addresses the brief's emphasis on learning and prevention.

**"Does adding micro-training and near-miss overcomplicate the demo?"**
Both are minimal UI additions over existing data. Micro-training is shown once, with one rule. Near-miss is shown as an extra bar on the dashboard. They strengthen the story without adding fragile live dependencies.

---

## 19. Final Score

| Criterion | Weight | Score | Rationale |
|---|---|---|---|
| Innovation & Creativity | 15% | 15/15 | What-if simulation, micro-training, and near-miss analytics make this clearly beyond a standard detection+dashboard project |
| Technical Execution | 20% | 18/20 | Confidence-aware scoring and replay logic show production thinking; still some integration risk, but reduced by reusing existing formulas |
| AI + Video Intelligence Integration | 20% | 19/20 | Temporal reasoning is now visibly demonstrated via stability replay and sequence-based what-if |
| UX & User Feedback | 10% | 9/10 | Micro-training and confidence badges make the UX feel more like a real tool; still limited by small pilot |
| Damage Prevention & Business Impact | 20% | 20/20 | Near-miss analytics + what-if training directly tie to prevention and process improvement, not just detection |
| Presentation Quality | 15% | 14/15 | Stronger narrative hooks (what-if, near-miss) if executed well in the day |
| **Total** | 100% | **95/100** | |

---

## 20. What to build first (practical 9-day outline)

**Days 1–2:**
- Set up toy rig, record baseline clips.
- Implement YOLOv8 + ByteTrack for your classes.
- Build basic scene graph (entities + simple support edges).

**Days 3–4:**
- Implement Structural Analysis (support ratio, COG offset, tipping moment).
- Implement Conformance lens (stacking order, orientation).
- Build basic event log and dashboard skeleton.

**Days 5–6:**
- Implement Predictive Risk (trend-based forecast, simple rules).
- Implement Safe Action Planner (2–3 candidates, scoring, recommendation).
- Add confidence estimation and show confidence badges on alerts.
- Wire up live intervention (on-screen card + basic TTS).

**Days 7–8:**
- Add Behaviour lens (drop, drag, throw, step-on).
- Implement What-if simulation for one historical sequence.
- Add Micro-training panel (one product rule, one custom rule).
- Implement Near-miss logging and dashboard breakdown.
- Add Responsible-AI controls (face-blur, false-positive flag, human-review gate).
- Implement AI assistant (grounded Q&A over event log).
- Run internal demo, fix flaky parts.

**Day 9:**
- Record final demo video including what-if replay and micro-training.
- Finalize 5–6 slide deck exactly matching this spec.
- Do at least two full dry runs with timekeeping.

---

*This is the final, buildable specification. All items are this team's design decisions unless explicitly cited to the official brief; stability figures are stated throughout as comparative operational estimates, not certified engineering calculations.*





# TRACE — Complete Build Guide
### AI Decision Intelligence for Physical Warehouse Operations — GEG Challenge (due 10 Sept 2026)

This is the full engineering build-out of the TRACE spec: architecture, data flow, tech stack, database schema, every algorithm, every one of the 10 prototype screens, every mandatory + bonus feature mapped to actual code, and a stage-by-stage day-by-day plan you can execute starting today (2 Sept) through submission (10 Sept).

---

## PART 1 — SYSTEM ARCHITECTURE

### 1.1 Full data-flow (expanded from the 9-layer spec)

```
[Camera(s) / video file]
        │
        ▼
┌───────────────────────────────────────────────────────┐
│ LAYER 1 — PERCEPTION                                   │
│  YOLOv8 (detection) → ByteTrack (tracking) →           │
│  MediaPipe Pose (person skeletons)                     │
│  Output: per-frame entity list                         │
│  {id, class, bbox, confidence, track_id, keypoints?}   │
└───────────────────────────────────────────────────────┘
        │  (entity stream, ~10-15 fps after throttling)
        ▼
┌───────────────────────────────────────────────────────┐
│ LAYER 2 — WORLD MODEL (scene graph)                    │
│  networkx graph, rebuilt every N frames:                │
│   nodes = entities (carton, pallet, trolley, person,    │
│           vehicle-bed, zone)                             │
│   edges = support/contact relationships                  │
│           (computed from bbox overlap + vertical stacking)│
│  Node attrs pulled from product metadata table           │
│  (mass_class, fragility, required_orientation)           │
└───────────────────────────────────────────────────────┘
        │
        ├──────────────┬───────────────┬────────────────┐
        ▼              ▼               ▼                ▼
   STRUCTURAL      CONFORMANCE    PRODUCT-SPECIFIC   ENVIRONMENTAL
   (support ratio, (observed vs.  (fragility/mass    (wet floor,
   COG, tipping    plan/sequence) priors modulate     dock gap,
   moment)                        severity)           zone flags)
        │              │               │                │
        └──────┬───────┴───────┬───────┴────────┬───────┘
               ▼                                 ▲
     LAYER 3 — BEHAVIOUR RECOGNITION (parallel, pose+trajectory)
               │
               ▼
┌───────────────────────────────────────────────────────┐
│ LAYER 4 — PREDICTIVE RISK                               │
│  Rolling window over last k scene-graph states →         │
│  trend/decision-table forecast + confidence level         │
│  Output: risk event {entity, score, band, confidence}     │
└───────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────┐
│ LAYER 5 — SAFE ACTION PLANNER  (core innovation)         │
│  Generate 2-3 candidate placements → score each with      │
│  the SAME structural formula → recommend highest-scoring  │
│  candidate that passes hard constraints                   │
│  + WHAT-IF: replay a stored sequence with one candidate    │
│    swapped in                                              │
└───────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────┐
│ LAYER 5b — MICRO-TRAINING / RULE CONFIG                  │
│  Supervisor CRUD on product rules + custom rules →         │
│  hot-loaded into Conformance + Planner + Risk severity      │
└───────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────┐
│ LAYER 6 — INTERVENTION                                   │
│  WebSocket push → on-screen card + pyttsx3 audio            │
└───────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────┐
│ LAYER 7 — OBSERVE OUTCOME                                 │
│  Re-evaluate world model N seconds after intervention       │
└───────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────┐
│ LAYER 8 — PREVENTION MEASUREMENT                          │
│  3-condition check → bucket: Prevented / Near-miss /         │
│  Outcome-unclear-Confirmed-damage (human review)             │
└───────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────┐
│ LAYER 9 — LEARNING / PATTERN MEMORY                        │
│  Aggregation queries → heat maps, scorecards, training       │
│  suggestions, planner rule-weight refinement (manual for MVP)│
└───────────────────────────────────────────────────────┘
```

### 1.2 Why this order is buildable in 9 days
Every box above is either (a) an existing library call, or (b) closed-form NumPy math reused three times (Structural lens → Predictive Risk input → Planner scoring substrate). You are never writing a new model from scratch except the YOLO fine-tune, which is a config + training run, not new architecture.

---

## PART 2 — COMPLETE TECH STACK (with the "why")

| Layer | Tool | Why this exact tool |
|---|---|---|
| Detection | YOLOv8n/s (Ultralytics) | Fastest to fine-tune on a small pilot dataset; runs real-time on a laptop CPU/GPU |
| Tracking | ByteTrack via `supervision` | Handles occlusion well (cartons stacking = constant partial occlusion); drop-in with YOLO |
| Pose | MediaPipe Pose | No training needed; gives keypoints for strap-lift/step-on/solo-lift detection immediately |
| Scene graph | `networkx` | Free graph structure + traversal (support chains, proximity edges) without hand-rolling one |
| Geometry/physics math | NumPy | All formulas (support ratio, COG, tipping moment) are closed-form vector math |
| Rules engine | Hand-written Python modules | No need for a rules-engine library at this scope; keeps it auditable/explainable |
| Backend API | FastAPI | Async, native WebSocket support, fast to iterate, auto docs (`/docs`) for team coordination |
| Realtime push | WebSocket (FastAPI native) | Needed for the live planner card + live dashboard updates |
| Database | SQLite | Zero-setup, file-based, fine for a single-laptop demo; swap to Postgres only if you have time |
| Clip storage | Local disk, filename keyed to `event_id` | Simplest possible clip-replay mechanism |
| LLM assistant | Claude API, function-calling | Restrict tool calls to read-only queries over the event/state DB — no hallucinated facts |
| Frontend | React (Vite) + Tailwind | Fast dev loop; Tailwind avoids hand-writing CSS under time pressure |
| Charts | `recharts` | Stability replay curves, heat maps, dashboard bars |
| Canvas overlay | HTML5 Canvas (react-konva or raw canvas) | Live bbox/skeleton/support-edge overlay on top of video |
| TTS | `pyttsx3` (offline) + 1 cloud TTS voice for a 2nd language | Satisfies "multilingual voice alerts" bonus with near-zero build cost |
| Edge/cloud split | Everything Layers 1-8 local; only Claude API calls leave the machine | Satisfies "Edge AI/offline inference" bonus honestly |

### 2.1 Language/library versions to pin (avoid mid-hackathon breakage)
- Python 3.10+
- `ultralytics` (YOLOv8) — pin the version you fine-tune with; don't upgrade mid-week
- `supervision` for ByteTrack wrapper
- `mediapipe`
- `fastapi`, `uvicorn[standard]` (for WebSocket)
- `networkx`, `numpy`, `sqlite3` (stdlib)
- `pyttsx3`
- Node 18+, React 18, Vite, Tailwind, `recharts`

---

## PART 3 — REPOSITORY STRUCTURE

```
trace/
├── backend/
│   ├── main.py                 # FastAPI app, WebSocket endpoint, route registration
│   ├── perception/
│   │   ├── detector.py         # YOLOv8 wrapper
│   │   ├── tracker.py          # ByteTrack wrapper
│   │   └── pose.py             # MediaPipe wrapper
│   ├── world_model/
│   │   ├── scene_graph.py      # networkx graph builder + support-edge inference
│   │   └── metadata.py         # product metadata lookups
│   ├── lenses/
│   │   ├── structural.py       # support ratio, COG, tipping moment
│   │   ├── conformance.py      # order/orientation/equipment rules
│   │   ├── product_risk.py     # fragility/mass priors
│   │   └── environmental.py    # zone flags (wet floor, dock gap)
│   ├── behaviour/
│   │   └── recognizer.py       # drop/drag/throw/roll/step-on/strap-lift/solo-lift
│   ├── risk/
│   │   ├── predictive.py       # Layer 4 trend forecast + confidence
│   │   └── confidence.py       # confidence heuristic
│   ├── planner/
│   │   ├── candidates.py       # generate 2-3 candidate placements
│   │   ├── scorer.py           # reused structural scoring function
│   │   └── whatif.py           # sequence replay with swapped placement
│   ├── rules/
│   │   ├── product_rules.py    # CRUD + hot-reload
│   │   └── custom_rules.py
│   ├── intervention/
│   │   ├── ws_push.py          # WebSocket broadcast
│   │   └── tts.py              # pyttsx3 + 2nd language
│   ├── measurement/
│   │   ├── prevention.py       # 3-condition check, bucket assignment
│   │   └── nearmiss.py
│   ├── learning/
│   │   └── aggregation.py      # heat maps, scorecards, repeat-pattern queries
│   ├── assistant/
│   │   └── claude_tools.py     # function-calling tool definitions, read-only DB queries
│   ├── db/
│   │   ├── schema.sql
│   │   └── db.py
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── screens/
│   │   │   ├── LiveView.jsx
│   │   │   ├── PlannerPanel.jsx
│   │   │   ├── Structural2DView.jsx
│   │   │   ├── EventFeed.jsx
│   │   │   ├── IncidentReplay.jsx
│   │   │   ├── Dashboard.jsx
│   │   │   ├── AssistantPanel.jsx
│   │   │   ├── ResponsibleAIPanel.jsx
│   │   │   ├── WhatIfReplay.jsx
│   │   │   └── MicroTrainingPanel.jsx
│   │   ├── components/
│   │   ├── hooks/useWebSocket.js
│   │   └── App.jsx
├── models/                     # fine-tuned YOLO weights
├── data/
│   ├── clips/                  # buffered demo clips
│   └── pilot_annotations/      # 50-100 labelled frames for precision/recall metric
└── docs/
    └── slide-deck source
```

---

## PART 4 — DATABASE SCHEMA (SQLite)

```sql
-- Product metadata
CREATE TABLE products (
    product_id TEXT PRIMARY KEY,
    class_name TEXT,
    mass_class TEXT,           -- light/medium/heavy
    fragility TEXT,            -- low/medium/high
    required_orientation TEXT, -- e.g. 'this-side-up' or NULL
    max_stack_height INTEGER
);

-- Scene states (snapshots of the world model)
CREATE TABLE scene_states (
    state_id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp REAL,
    entities_json TEXT,        -- serialized entity list
    edges_json TEXT            -- serialized support/contact edges
);

-- Events (unifies risk alerts, planner recommendations, behaviour catches)
CREATE TABLE events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp REAL,
    event_type TEXT,           -- 'risk' | 'planner_rec' | 'behaviour' | 'near_miss' | 'prevented' | 'confirmed_damage'
    lens TEXT,                 -- 'structural' | 'behaviour' | 'conformance' | 'environmental'
    entity_id TEXT,
    score REAL,
    band TEXT,                 -- Low/Medium/High/Critical
    confidence TEXT,           -- High/Medium/Low
    factor_breakdown_json TEXT,
    clip_path TEXT,
    reviewed INTEGER DEFAULT 0,
    review_status TEXT         -- 'confirmed_damage' | 'false_positive' | NULL
);

-- Planner recommendations (child of events, for planner-specific fields)
CREATE TABLE planner_recommendations (
    rec_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER REFERENCES events(event_id),
    candidates_json TEXT,      -- [{position, score, band}]
    recommended_position TEXT,
    expected_delta REAL,
    followed INTEGER,          -- was it followed? (observed post-hoc)
    outcome_state_id INTEGER REFERENCES scene_states(state_id)
);

-- Product rules (micro-training)
CREATE TABLE product_rules (
    rule_id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT REFERENCES products(product_id),
    rule_type TEXT,            -- 'max_stack_height' | 'required_orientation'
    rule_value TEXT,
    created_by TEXT,
    created_at REAL
);

-- Custom rules (freeform, e.g. "Do not place A on B")
CREATE TABLE custom_rules (
    rule_id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT,
    condition_json TEXT,       -- machine-readable condition
    created_by TEXT,
    created_at REAL
);

-- False-positive flags (feeds Layer 9)
CREATE TABLE feedback (
    feedback_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER REFERENCES events(event_id),
    flag_type TEXT,            -- 'false_positive'
    created_at REAL
);

-- Session ratings (human impact metric)
CREATE TABLE session_ratings (
    rating_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    rating INTEGER,            -- 1-5
    created_at REAL
);
```

---

## PART 5 — CORE ALGORITHMS (exact formulas to implement)

### 5.1 Structural lens (`lenses/structural.py`)
- **Support ratio** = (area of the item's base that is actually supported by something below) ÷ (total base area of the item). Compute from bbox overlap between the item and whatever is directly beneath it in the scene graph.
- **COG offset** = horizontal distance between the item's estimated center of gravity (bbox center, or weighted center if irregular) and the centroid of its support region below. Larger offset → higher tipping risk.
- **Tipping moment (simplified)** = `mass_class_weight × COG_offset_normalized`. You don't need real mass in kg — an ordinal weight (light=1, medium=2, heavy=3) multiplied by normalized offset is enough for a *comparative* score, which is explicitly what you're claiming.
- **Stability Score** (0-100, higher = safer) = weighted combination, e.g.:
  `100 - (w1 * (1 - support_ratio) * 100 + w2 * tipping_moment_normalized * 100)`
  with `w1 + w2 = 1`. Pick weights (e.g. 0.6/0.4) and state them as a design choice, not a physics derivation.

### 5.2 Conformance lens (`lenses/conformance.py`)
- Maintain a rule-derived "optimal plan": ordering rules (heavy-bottom-light-top), orientation rules (from product metadata), equipment rules (mass_class ≥ heavy requires trolley/pallet-jack, not manual pallet).
- Compare observed sequence/orientation/equipment against the plan; output a binary or graded conformance score + which specific rule was violated (for the factor breakdown UI).

### 5.3 Predictive risk (`risk/predictive.py`)
- Maintain a rolling window (last k scene-graph states, e.g. k=5-10 frames sampled every ~0.5s).
- Combine: structural trend (is stability score dropping across the window?) + conformance flags + product-risk multiplier + environmental multiplier + any behaviour signal in the window.
- Simple decision table, not a trained model: e.g. `if stability_trend < -threshold and support_ratio < 0.5: band = HIGH`.
- Output includes `confidence` from `risk/confidence.py`.

### 5.4 Confidence estimation (`risk/confidence.py`)
Heuristic combining:
- Mean YOLO detection confidence over the window.
- Tracking ID switch count (more switches → lower confidence).
- Geometry calibration flag (has this camera's homography/scale been calibrated?).
Map the combined score to High/Medium/Low bands with fixed thresholds you pick and document.

### 5.5 Safe Action Planner (`planner/candidates.py` + `scorer.py`)
- **Candidate generation**: current proposed position; 1-2 adjacent positions (shift left/right/back within the available footprint); a rotated orientation if `required_orientation` metadata allows rotation.
- **Scoring**: run each candidate through the exact same Structural + Conformance formulas used above, treating the candidate as a hypothetical scene-graph state.
- **Hard constraints filter**: discard any candidate that violates a hard rule (wrong orientation if required, overhang past pallet edge) even if its raw score is high.
- **Recommendation**: highest-scoring candidate that survives the hard-constraint filter; output includes expected stability delta vs. the originally proposed position.

### 5.6 What-if simulation (`planner/whatif.py`)
- Load a stored sequence of scene states for a past event from `scene_states`.
- Clone the sequence, swap in the planner's recommended candidate at the relevant timestep.
- Re-run the Structural + Conformance scoring across the cloned sequence.
- Return two time series (original stability curve, simulated stability curve) for the What-If Replay screen's chart.

### 5.7 Prevention 3-condition check (`measurement/prevention.py`)
A `planner_recommendations` row (or a plain risk event) is bucketed as:
1. **Prevented** — all three: (a) meaningful risk predicted, (b) corrective action observed within the response-time window, (c) post-action scene state confirms improved stability/conformance.
2. **Near-miss** — high risk + alert fired + some correction occurred, but not all three conditions cleanly met (e.g., correction happened but outside the window, or improvement was marginal).
3. **Outcome unclear / Confirmed damage** — anything else; confirmed damage requires an explicit human click in the Responsible-AI review UI. The system never self-labels this.

---

## PART 6 — ALL 10 PROTOTYPE SCREENS, IN FULL DETAIL

### Screen 1 — Live View
- **Purpose**: default landing screen; raw video + overlay.
- **Components**: video element (or canvas frame stream) + Canvas overlay layer drawing: entity bounding boxes (color-coded by risk band), support edges (lines between stacked items), pose skeleton when relevant.
- **Data source**: WebSocket stream of per-frame entity + edge JSON from Layer 2.
- **Interactions**: none required beyond passive viewing; this is where the Planner card (Screen 2) overlays live.

### Screen 2 — Safe Action Planner panel (headline screen)
- **Purpose**: the CURRENT → PREDICTED → SAFE ALTERNATIVE card, appearing live over the video the instant the planner fires.
- **Components**: card listing each candidate position with its score and band (color-coded), a highlighted "Recommended" row with the specific instruction ("rotate 90°, shift left") and expected stability delta.
- **Data source**: WebSocket push of `planner_recommendations` row the moment it's created.
- **Design note**: this must render in under ~1s of the planner firing — pre-render the card shell and just populate values, don't mount/unmount the whole component.

### Screen 3 — Structural 2D View ("digital twin", secondary)
- **Purpose**: top-down or side 2D schematic of the current physical state — supports, risk zones, predicted failure state, candidate placements plotted spatially.
- **Components**: simple 2D canvas/SVG rendering of the scene graph's geometry (not 3D — explicitly deprioritized).
- **Data source**: same scene-graph stream as Screen 1, projected to 2D coordinates.
- **Positioning**: framed in the demo as "a visualization of the decision layer," not the star feature — don't over-invest build time here.

### Screen 4 — Event Feed
- **Purpose**: chronological log of everything the system has flagged.
- **Components**: table/list with columns: timestamp, entity, lens(es) that triggered it, Observed/Potential-Risk/Confirmed-Damage tag, score, confidence badge, "flag false positive" button.
- **Data source**: `GET /events` (paginated, filterable by lens/band/date).
- **Interactions**: clicking a row opens Screen 5 (Incident Replay) for that event.

### Screen 5 — Incident Replay
- **Purpose**: for a specific event, show the buffered clip + factor breakdown + what was recommended vs. what actually happened.
- **Components**: video clip player (keyed to `clip_path`), factor-breakdown panel (which lens contributed what score), recommendation-vs-outcome comparison, and a **"Replay with alternative"** button that jumps to Screen 9.
- **Data source**: `GET /events/{event_id}` joined with `planner_recommendations`.

### Screen 6 — Dashboard
- **Purpose**: supervisor's aggregate view.
- **Components**: heat map (risk events by zone), repeat-pattern list (Layer 9 grouping), three separate counters — **Prevented / Near-miss / Outcome-unclear-Confirmed-damage** (never folded into one headline number), operator/team safety scorecards (team-level, non-punitive), confidence-distribution chart.
- **Data source**: `GET /dashboard/summary` — pre-aggregated on the backend (`learning/aggregation.py`), not computed client-side.

### Screen 7 — AI Assistant panel
- **Purpose**: conversational Q&A grounded in logged data ("How many high-risk events in Bay 3 today?").
- **Components**: chat UI; each Claude response should be traceable to the DB rows it used (show a small "based on N events" footer if easy to add).
- **Data source**: Claude API with function-calling restricted to read-only query tools defined in `assistant/claude_tools.py` (e.g. `query_events(filters)`, `get_dashboard_summary()`). No tool that writes data.

### Screen 8 — Responsible-AI / Settings panel
- **Purpose**: trust and governance controls, shown explicitly in the demo (not just claimed in the deck).
- **Components**: face-blur toggle (default ON), RBAC role switcher (supervisor vs. operator view — controls which screens/fields are visible), retention-window setting with a visible auto-purge indicator, false-positive log (list of `feedback` rows), human-review gate for "Confirmed Damage" status (a literal review-and-click flow, never auto-set).

### Screen 9 — What-If Replay screen
- **Purpose**: show the original stability curve vs. the simulated curve for an alternative decision.
- **Components**: `recharts` line chart with two series (original vs. simulated), placement markers on the timeline, alert markers, a short caption explaining "same model, run over the past sequence with one change."
- **Data source**: `POST /planner/whatif` with `{event_id, alternative_candidate}` → returns the two time series from `planner/whatif.py`.

### Screen 10 — Micro-Training / Rule Config panel
- **Purpose**: let a supervisor define rules that immediately affect the running system.
- **Components**: simple form — product dropdown + rule type (max stack height / required orientation) for product rules; a freeform "if X then constraint Y" builder (kept simple — e.g. a dropdown pair "Do not place [product A] on [product B]") for custom rules; list of currently active rules with delete/edit.
- **Data source**: `POST /rules/product`, `POST /rules/custom`; on save, backend hot-reloads `rules/product_rules.py` / `rules/custom_rules.py` in-memory so the Conformance lens and Planner immediately use the new rule — no restart required.

---

## PART 7 — MANDATORY REQUIREMENTS → EXACT IMPLEMENTATION

| Requirement | File(s) that satisfy it |
|---|---|
| Video ingestion, detection/tracking | `perception/detector.py`, `perception/tracker.py` |
| Object Detection + Tracking + Action Recognition + Temporal Reasoning + Risk Classification | detector/tracker + `behaviour/recognizer.py` + rolling-window logic in `risk/predictive.py` + band output |
| Behaviour identification | `behaviour/recognizer.py`, kept as a parallel input, not merged into the structural spine |
| Risk scoring (Low/Med/High/Critical) | `risk/predictive.py` banding + `factor_breakdown_json` per event |
| Observed → Potential Risk → Confirmed Damage | scene_states = Observed; `events` with band = Potential Risk; `review_status='confirmed_damage'` = human-set only |
| Conversational AI assistant grounded in events | `assistant/claude_tools.py`, Screen 7 |
| ≥10 behaviours demonstrated | 14 scenarios (Part 9 below), each tagged to its detecting lens |
| Responsible AI | Screen 8 + Part 10 below |
| 5-6 slide deck | build from this doc's Part 12 storyline |
| Prevention & Learning | `measurement/prevention.py`, `planner/whatif.py`, `rules/*`, Screen 6/9/10 |

---

## PART 8 — BONUS FEATURES → EXACT IMPLEMENTATION

| Bonus feature | Status | Implementation |
|---|---|---|
| Real-time alerts | Core | `intervention/ws_push.py`, fires on planner recommendation |
| Predictive risk scoring | Core | `risk/predictive.py` |
| Damage prediction | Core | Same forecast, `band` field reframed in UI copy |
| Loading sequence verification | Core | `lenses/conformance.py` |
| Pallet stability assessment | Core | `lenses/structural.py` |
| Product-specific risk models | Core | `lenses/product_risk.py`, `products` table |
| Worker-independent behaviour analysis | Built | Structural/Conformance/Environmental lenses never take a person ID as input by construction |
| Automatic incident replay | Built | `clip_path` keyed to `event_id`, Screen 5 |
| Behaviour heat maps | Built | `learning/aggregation.py`, Screen 6 |
| Automatic incident reports | Built | Templated summary query over `events` grouped by session |
| Conversational AI supervisor assistant | Built | Screen 7 |
| Edge AI / offline inference | Built | Layers 1-8 run locally; only Claude calls leave the machine |
| Vehicle loading pattern analysis | Partial | Extend `lenses/structural.py` region to a `vehicle-bed` class |
| Multi-camera tracking | Partial | Merge two camera streams in `world_model/scene_graph.py` via a shared bay coordinate transform; basic re-ID only |
| Multilingual voice alerts | Partial | `intervention/tts.py` — `pyttsx3` default + 1 cloud voice for language 2 |
| Gamification | Partial | Session-level conformance/stability score shown on Dashboard, no full game layer |
| Operator/team safety scorecards | Partial | Team/process aggregation on Screen 6, explicitly non-punitive copy |
| Forklift/pedestrian interaction monitoring | Integration-ready | Add a `forklift` class + a proximity-edge rule in `world_model/scene_graph.py` (additive, no architecture change) |
| PPE compliance detection | Integration-ready | New classifier head on top of Layer 1's existing person detections |
| WMS integration | Integration-ready | `conformance.py`'s "optimal plan" input designed to accept an external feed in place of the rule-generated one |
| CCTV/VMS integration | Integration-ready | Layer 1 already ingests RTSP/file input |
| Digital twin / 3D | Future, deliberately secondary | Screen 3 stays 2D; don't spend build time on 3D |
| What-if simulation / training mode | Built | `planner/whatif.py`, Screen 9 |
| Configurable product-specific rules | Built | `rules/*`, Screen 10 |
| Near-miss analytics | Built | `measurement/nearmiss.py`, `near_miss` event type, Screen 6 breakdown |

---

## PART 9 — 14 BEHAVIOUR SCENARIOS → DETECTION LOGIC

1. **Heavy-on-light stacking** — Structural (support-ratio + mass-prior mismatch) + Conformance (stacking-order rule violation). Implement as: check `mass_class` of item vs. item below; flag if heavier-above-lighter and no override rule exists.
2. **Throwing/dropping** — Behaviour (velocity spike from tracked bbox centroid across frames) confirmed by a Structural recompute at the moment of impact.
3. **Dragging instead of lifting** — Behaviour: sustained ground-contact (bbox bottom edge near floor plane) with horizontal translation, no lifting equipment entity nearby.
4. **Rolling cartons/mattresses** — Behaviour: rotation signature (aspect-ratio oscillation) while translating.
5. **Packaging straps used as handles** — Behaviour (pose/grip region near strap keypoints); log as **Observed only** — explicitly not predictable in advance, state this limitation on-screen.
6. **Stepping on cartons** — Behaviour (foot keypoint + weight-bearing pose over a carton bbox) escalated by that carton's live support state from Structural.
7. **Wrong product orientation** — Conformance: compare observed bbox aspect/rotation against `required_orientation` metadata.
8. **Pallet overhang** — Structural: footprint of item vs. footprint of pallet beneath; flag unsupported area.
9. **Dock/vehicle gap** — Environmental (static zone calibration) gates the vehicle-load extension of Structural.
10. **Wet-floor handling** — Environmental zone flag; multiplies severity of any concurrent structural/behaviour event in that zone.
11. **Improper/unplanned loading sequence** — Conformance (sequence-alignment divergence). **This is the scenario where the Planner fires proactively**, before the out-of-sequence placement is finalized — wire this path first, it's your demo's second beat.
12. **Solo handling of heavy item** — Behaviour (single-skeleton lift pose, no second person nearby) + Product-risk (mass-class threshold).
13. **Wrong equipment usage** — Conformance: equipment-class rule from product metadata (e.g. heavy → requires trolley, not manual pallet).
14. **Unsupported/bending product placement** — Structural: support ratio computed across the product's full span, not just its base footprint (relevant for long/flexible items).

*(PDI/process-violation scenario is a Should-Build extension of Conformance, dependent on your rig having a distinct inspection-area step — don't force it if your rig layout doesn't naturally support it.)*

---

## PART 10 — RESPONSIBLE AI CHECKLIST (build these, don't just claim them)

- [ ] Face-blur ON by default (simple blur filter over person bboxes before any storage/display)
- [ ] RBAC: two view modes (supervisor sees Screens 6/7/8/10; operator sees 1/2/4)
- [ ] Retention window setting with a real scheduled-delete job (even a simple cron-like check on startup deleting clips older than N days counts)
- [ ] "Confirmed Damage" is a literal button click in Screen 8/5 — the system never sets this status itself
- [ ] One-click false-positive flag on every event row → writes to `feedback` table → feeds Layer 9
- [ ] Every risk score and planner recommendation ships with `factor_breakdown_json` visible in the UI
- [ ] UI copy audit pass: no "worker failed," no individual leaderboards — coaching/process language only
- [ ] On-screen text, verbatim, somewhere visible in the live view or planner card: "Stability estimates are comparative operational risk indicators based on observed geometry and product metadata — not certified structural engineering calculations."
- [ ] Confidence badges visible on every alert; low-confidence alerts should not silently trigger the same UI treatment as high-confidence ones (e.g., dim them or add a "verify" prompt)

---

## PART 11 — API ENDPOINT SPEC (FastAPI)

```
GET   /events                       filterable event feed (Screen 4)
GET   /events/{event_id}            single event + factor breakdown (Screen 5)
POST  /events/{event_id}/feedback   false-positive flag
POST  /events/{event_id}/review     human confirms/rejects Confirmed-Damage status

GET   /dashboard/summary            heat map + counters + scorecards (Screen 6)

POST  /planner/whatif               {event_id, alternative_candidate} -> two time series (Screen 9)

GET   /rules/product                list product rules
POST  /rules/product                create/update (Screen 10)
GET   /rules/custom
POST  /rules/custom

POST  /assistant/query              {message} -> Claude function-calling response (Screen 7)

WS    /ws/live                      streams entity list + edges + planner cards + alerts (Screens 1,2,3)

POST  /session/rating               {session_id, rating}   human-impact metric
```

---

## PART 12 — STAGE-BY-STAGE BUILD PLAN (today = 2 Sept, submission = 10 Sept)

### Day 1 (today, 2 Sept)
- Finalize toy rig (cartons, pallet, small "trolley," a person, a marked "wet-floor" zone tile). Record 15-20 min of raw baseline footage under normal handling.
- Set up repo structure exactly as Part 3.
- `pip install ultralytics supervision mediapipe fastapi uvicorn networkx numpy pyttsx3`; `npm create vite@latest frontend -- --template react` + Tailwind.
- Label a first small batch of frames (start toward the 50-100 pilot annotation target) for your classes: box, pallet, trolley, person, vehicle-bed region.

### Day 2 (3 Sept)
- Fine-tune YOLOv8n on your labelled pilot set; validate visually on a held-out clip.
- Wire ByteTrack on top of detections; confirm track IDs stay stable across a stacking sequence.
- Stand up FastAPI skeleton with the WebSocket endpoint streaming raw entity JSON — get Screen 1 (Live View) rendering boxes over video, even unstyled.

### Day 3 (4 Sept)
- Build `world_model/scene_graph.py`: infer support/contact edges from vertical bbox overlap; render edges on Screen 1.
- Seed `products` table with your rig's actual items (mass_class, fragility, required_orientation, max_stack_height).
- Implement `lenses/structural.py` (support ratio, COG offset, tipping moment, Stability Score) — unit test against 3-4 known-good/known-bad configurations from your footage.

### Day 4 (5 Sept)
- Implement `lenses/conformance.py` (stacking order + orientation + equipment rules) from your product metadata + the brief's good-practice table.
- Build Event Feed backend (`GET /events`) and Screen 4 frontend.
- Start Screen 6 (Dashboard) skeleton — wire it to real event counts even before all lenses exist, so the plumbing is proven early.

### Day 5 (6 Sept)
- Implement `risk/predictive.py` (rolling window trend + decision table) and `risk/confidence.py`.
- Implement `planner/candidates.py` + `planner/scorer.py` — get the Safe Action Planner producing a recommendation on a scripted test sequence first, before wiring it live.
- Build Screen 2 (Planner panel) — this is your headline screen; budget extra time here. Get the card rendering with real scored candidates end-to-end (even manually triggered) before end of day.

### Day 6 (7 Sept)
- Wire the Planner live: WebSocket push on trigger, `intervention/ws_push.py` + `intervention/tts.py` (pyttsx3 default voice).
- Implement `measurement/prevention.py` 3-condition logic and `near_miss` bucketing.
- Add confidence badges to the UI (Planner card + Event Feed).
- Record your first internal dry run of the core loop: proposed placement → planner card → correction → prevented log. Fix whatever breaks.

### Day 7 (8 Sept)
- Implement `behaviour/recognizer.py` for at minimum: drop, drag, step-on (the ones cheapest to demo reliably on a toy rig). Add the rest if time allows.
- Implement `planner/whatif.py` and Screen 9 (What-If Replay) using one real recorded sequence from Day 6's dry run.
- Implement Screen 10 (Micro-Training panel): one product rule + one custom rule, with hot-reload confirmed working (change a rule, watch Conformance/Planner output change without a restart).
- Implement Screen 8 (Responsible-AI panel): face-blur, RBAC toggle, retention setting, false-positive flag, human-review gate. Run through the checklist in Part 10.

### Day 8 (9 Sept)
- Implement Screen 7 (AI Assistant) with `assistant/claude_tools.py` restricted to read-only queries; test 5-6 realistic supervisor questions against real logged data.
- Finish Screen 6 (Dashboard): heat map, repeat-pattern list, Prevented/Near-miss/Unclear counters shown separately, scorecards.
- Finish Screen 3 (Structural 2D view) — keep it simple, 2D only.
- Full internal end-to-end demo run using the storyline in Part 13. Time it. Fix flaky parts — flag anything unreliable and either fix or cut it from the live demo path (fall back to a pre-recorded clip for that beat only if needed).

### Day 9 (10 Sept — submission day)
- Record the final demo video (backup in case live demo has issues) including the what-if replay and micro-training beats.
- Finalize the 5-6 slide deck, content mapped directly to this document's sections (Part 12's requirement/bonus tables translate almost directly into deck slides).
- Two full dry runs with a stopwatch against the 4-minute storyline (Part 13). Submit with margin before the deadline.

---

## PART 13 — DEMO STORYLINE (4 minutes, for reference while building — build toward this exact sequence)

1. **0:00-0:15** — Live view, worker approaching a stack with a carton, no dashboard shown yet.
2. **0:15-0:45** — Planner card appears live: three candidates scored, one recommended with a specific instruction.
3. **0:45-1:15** — Worker follows the recommendation; stability visibly climbs; system logs Predicted → Intervened → Prevented with the 3-condition check shown briefly.
4. **1:15-1:45** — What-if replay: original curve crossing into High Risk vs. simulated curve staying Safe, with a one-line explanation that it's the same model run over the past sequence.
5. **1:45-2:45** — Breadth montage: Planner firing on a sequence-conformance violation (#11) and an overhang case (#8); 2-3 pure-behaviour catches (drop, drag) shown independently of the Planner.
6. **2:45-3:30** — Supervisor layer: Dashboard with honest Prevented/Near-miss/Unclear breakdown, heat map, a live AI-assistant question answered from real data, a quick look at the micro-training panel with one rule defined.
7. **3:30-3:45** — Responsible-AI beat: face-blur, worker-independent framing, human-review gate.
8. **3:45-4:00** — Close line: "A normal system would have told you a carton was dropped. TRACE told the worker where to put it so it wouldn't be, and can show how a different choice would have changed the outcome."

---

## PART 14 — SUCCESS METRICS TO ACTUALLY LOG (not just claim)

- **AI performance**: precision/recall on your 50-100 annotated pilot frames; per-frame latency (log timestamp diff around the detection call); false-positive rate = `feedback` flags ÷ total events; confidence distribution (query `events.confidence` grouped).
- **Operational**: high-risk events/shift (count `events` where `band IN ('High','Critical')`); repeat-behaviour frequency (group by entity/zone/type); average response time (`alert timestamp` → `observed correction timestamp`, both already in your event/state tables); risk events by bay (group by zone tag).
- **Business impact**: the three-bucket counters from `measurement/prevention.py`, shown separately, never combined into one headline number; any financial-impact figure labelled explicitly as illustrative.
- **Human impact**: `session_ratings` table + the in-app 1-5 prompt; recurring conformance-violation types surfaced as training-opportunity suggestions (a simple `GROUP BY violation_type ORDER BY count DESC` query); count of rules configured per session from `product_rules`/`custom_rules`.

---

## PART 15 — RISK/FALLBACK RUNBOOK FOR DEMO DAY

- If live detection is flaky on demo hardware: have a pre-recorded, already-processed clip with a cached event log ready to play through the same UI — the UI doesn't need to know the difference.
- If the Planner doesn't fire reliably live: script the exact sequence of moves your demo presenter will make (rehearsed, not improvised) so the trigger conditions are guaranteed to be hit.
- If WebSocket drops mid-demo: have a "replay last session" button that re-streams a cached event log at the same cadence as a silent fallback.
- Keep the What-If Replay screen (Screen 9) pre-loaded with a known-good sequence as a hard-coded default option, separate from whatever live event you might also want to replay.

---

This document maps 1:1 onto the original spec's sections but adds the concrete files, schema, endpoints, and day-by-day sequencing needed to actually build it. Nothing in the original mandatory/bonus feature list or the 10 screens has been dropped.