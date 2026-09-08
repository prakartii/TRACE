# TRACE — Demo Runbook

The 4-minute demo (ARCHITECTURE.md §13) runs off the **seeded event log + cached
perception**, not live re-detection. Every beat below was verified end to end
against a live server (`.venv/bin/python -m uvicorn backend.main:app`).

## Reliable path (drive the demo from these screens)

| Beat | Screen | Backing endpoint | Notes |
|---|---|---|---|
| 0:00–0:15 — live view | **Live View** | `/api/videos`, `/api/videos/{id}/stream` | Pick "Rolling and dropping carton" (`ac99ff34e1bd2c13`). Faces are blurred by default. |
| 0:15–0:45 — planner card | **Action Center** | `GET /api/actions/73` | Event-driven, deterministic. Returns risk band, title, `immediate_action`, 3 steps, `what_if_eligible`. Also works for #20, #50, #140. |
| 0:45–1:15 — follow + prevented | **Incident Replay** (#73) + **Dashboard** | `/api/measurement/summary` | Prevention buckets are separate: `prevented 1 / near_miss 0 / unclear 0 / confirmed_damage 0`. The 3-condition JSON is on `/api/measurement/events/75/outcome`. |
| 1:15–1:45 — what-if replay | **What-If Simulation** (#73) | `GET /api/planner/whatif/73?model=pilot` | `High Risk (54.4) → Low Risk (11.2)`, +43.2 pts, 1 feasible candidate. Observed vs counterfactual curve. |
| 1:45–2:45 — breadth | **Scenario Coverage** + **Event Feed** | `/api/events` | 16 seeded incidents across the 14 scenarios / 4 lenses. Filter by lens to show behaviour vs structural vs conformance. |
| 2:45–3:30 — supervisor layer | **Dashboard** (scroll to Pattern Memory) + **Assistant** | `/api/learning/heatmap`, `/api/learning/patterns`, `POST /api/assistant/ask` | Heat map = source × scenario. Ask the assistant "how many events were prevented?" / "which bay had the most high-risk events?". Micro-training: **Settings → custom rules**. |
| 3:30–3:45 — Responsible AI | **Responsible AI** | `GET /api/responsible-ai/status` | Face-blur status, human-review queue (confirm-damage is a click), confidence/epistemic distributions, retention control, disclosures. Toggle the supervisor/operator view in the header. |
| 3:45–4:00 — close | **Dashboard** | — | "incidents CSV" / "shift summary" export links in the hero. |

## Do NOT drive the demo from

- **Live View → click a live finding → What-If panel.** Live perception at an
  arbitrary timestamp often yields `Low` / `insufficient_evidence` findings, and
  the epistemic gate then (correctly) refuses the simulation. The panel now
  offers an **"open the full What-If Replay"** button that jumps to the reliable
  event-driven screen — use that, or navigate straight to **What-If Simulation**.
- Expecting the pilot model to reproduce a specific seeded scenario at a specific
  second. It will not, deterministically.

## Fallback runbook (ARCHITECTURE.md §15)

- **Backend flaky / offline:** the frontend degrades — Dashboard, Event Feed and
  Incident Replay still render from their last successful fetch; the header shows
  "backend offline".
- **Perception weights missing on the demo box:** `/api/videos/{id}/frame`
  fails **closed** (503, no un-redacted frame). The streamed-video face overlay
  falls back to a full-frame blur. Trajectory What-If and Action Center are
  unaffected (event-driven).
- **Re-seed the demo DB:** `PYTHONPATH=. .venv/bin/python -c "from backend.db.db import create_database; create_database().close()"`
  — idempotent; restores the 16 canonical events and the #75 prevented outcome
  (which is seeded with `evaluated_at = 0` so no retention purge can age it out).
- **Assistant with no `ANTHROPIC_API_KEY`:** answers are the deterministic
  retrieval layer verbatim — still fully grounded, just not rephrased.

## Voice alerts (multilingual)

Header → **🔊 voice** toggle (only shown when the browser supports
`speechSynthesis`). Enabling it plays a short confirmation (this is the required
user gesture, so subsequent auto-speech is not blocked by autoplay policy). Pick
a language (English / Español / हिन्दी / Français / Deutsch); a NEW High/Critical
alert is then spoken once from a fixed table of reviewed safety phrases
(`frontend/src/lib/voiceAlerts.js`). The banner also has a per-alert speaker
button. Phrases without a reviewed translation are read in English. If the demo
machine has no installed voice for the chosen language the toggle tooltip says
so and it falls back to English.
