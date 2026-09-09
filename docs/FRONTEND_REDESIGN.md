# TRACE — Frontend Redesign Plan

Status: **wireframe / planning**. No code yet. Backend is out of scope — not one
route, model, or behaviour changes. This is a full replacement of the frontend's
information architecture and visual design.

---

## 1. Why

The current frontend has **10 nav items** with heavy overlap (Dashboard vs
Scenario Coverage vs Incidents; Action Center vs What-If Simulation), and every
screen is a mega-screen — `IncidentReplay.jsx` is 1438 lines, `EventFeed.jsx`
1056, `WhatIfReplay.jsx` 735. Each one tries to show everything, wrapped in
nested bordered boxes, hazard-tape gradients, `gap-px` bento grids, asymmetric
12-column heroes, three font families, and uppercase micro-labels everywhere.
There is no clear "what do I do on this screen", no URLs, no back button.

## 2. Goals

- **Understandable flow.** Five task areas, not ten feature screens. Every view
  answers one question.
- **Minimal, plain design.** System font, near-monochrome, one accent for risk,
  thin single borders, whitespace. No gradients, no bento, no display font.
- **Real routing.** URLs, deep links, back button.
- **Nothing lost.** Every current capability keeps a home (§7 mapping table).
- **Honesty properties stay visible** (§8) — epistemic status, the four
  prevention buckets kept separate, no worker rankings, disclosures.

## 3. Information architecture

Five areas. App opens on **Monitor**.

| Area | Question it answers | Absorbs today's screens |
|---|---|---|
| **Monitor** | What's happening right now, and what should we do? | Live View, Safe Action Planner, intervention alerts, "what's likely next" |
| **Incidents** | What has been flagged — and let me work through one | Event Feed, Incident Replay, What-If Replay, outcome verification |
| **Patterns** | What does the history tell us? | Dashboard, Scenario Coverage, Learning Insights |
| **Assistant** | Ask the data a question | AI Assistant |
| **Settings** | Configure rules, govern privacy, edit the catalogue | Supervisor Settings, Custom Rule Builder, Responsible AI |

CLAUDE.md §23 requires the Safe Action Planner to be the headline, "not the
dashboard". Handled: the app opens on Monitor with the planner front and centre;
the dashboard content is demoted to Patterns, area 3 of 5.

### Routes

```
/monitor                     default
/incidents                   list + filter bar
/incidents/:id               incident detail — Overview tab
/incidents/:id/replay        incident detail — Replay tab
/incidents/:id/what-if       incident detail — What-If tab
/patterns                    prevention + learning + coverage
/assistant
/settings/rules              product + custom rules
/settings/governance         responsible-AI, retention, review queue, view mode
/settings/catalogue          SKUs, hazard zones, manifests
```

Add `react-router-dom`. Retire the home-grown `navigateTo` / screen-alias
machinery in `App.jsx` and `LiveViewContext.jsx`.

## 4. Wireframes

Plain box-drawing. One accent colour (risk band). `[· ·]` = muted/secondary.

### 4.1 App shell

```
┌──────────────────────────────────────────────────────────────────────┐
│ TRACE            ● live monitoring        ⚠ 2 active        ⚙ settings │
├────────────┬─────────────────────────────────────────────────────────┤
│            │                                                         │
│  Monitor   │                                                         │
│  Incidents │                  ( active area )                        │
│  Patterns  │                                                         │
│  Assistant │                                                         │
│            │                                                         │
│  ────────  │                                                         │
│  Settings  │                                                         │
│            │                                                         │
└────────────┴─────────────────────────────────────────────────────────┘
```

- Header: wordmark · live-stream dot · active-alert count (click → Monitor,
  interventions strip) · settings gear. Backend-offline shows here.
- Left nav: 4 primary + Settings. Operator view mode (§8) hides all but Monitor
  and Incidents.
- No hazard-tape strip, no tagline in the header.

### 4.2 Monitor  `/monitor`

```
┌─ MONITOR ────────────────────────────────────────────────────────────┐
│ Camera:  [ Dock 4 — Inbound Transfer  ▾ ]        overlays: ☑ boxes    │
│                                                  ☑ scene  ☑ faces     │
│ ┌───────────────────────────────────┐  ┌──────────────────────────┐   │
│ │                                   │  │ ACTIVE RISKS  (2)        │   │
│ │        live video viewport        │  │ ─────────────────────    │   │
│ │        (face blur on)             │  │ ▸ Pallet overhang   HIGH │   │
│ │                                   │  │   dock bay · 00:12       │   │
│ │                                   │  │   Dropping precursor MED │   │
│ └───────────────────────────────────┘  │   worker A · 00:15       │   │
│  ├──────●────────────────────┤ 00:12   └──────────────────────────┘   │
│  ◀ ▶  1×                                                             │
│                                                                      │
│ ┌─ SAFE ACTION — Pallet overhang ────────────────────────────────┐   │
│ │ Why: load extends past the deck edge; tipping moment rises as   │   │
│ │      the stack grows. Confidence: medium.  [supported]          │   │
│ │                                                                │   │
│ │ Options            stability    risk                           │   │
│ │  A  as placed         42        HIGH                           │   │
│ │  B  shift 20cm in     86        LOW    ◀ recommended            │   │
│ │  C  rotate + centre   68        MED                            │   │
│ │                                                                │   │
│ │ Do this:  Move the load ~20 cm toward the pallet centre        │   │
│ │           before adding the next carton.   expected +44        │   │
│ │                                                                │   │
│ │ evidence ▾   supervisor rule ▾   (none)                        │   │
│ └────────────────────────────────────────────────────────────────┘   │
│                                                                      │
│ ┌─ ACTIVE INTERVENTIONS ─────────────────────────────────────────┐   │
│ │ #alert_…_105  dock edge zone   NEW      [ acknowledge ]  [ ✕ ]  │   │
│ └────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

- Left: viewport + `PlaybackControls` + overlay toggles (reuse
  `video/VideoViewport`, `SceneOverlay`, `PerceptionOverlay`,
  `FaceRedactionOverlay`).
- Right: **Active Risks** — findings at the playhead, ranked (reuse
  `FindingsPanel` logic, restyled). Selecting one loads the **Safe Action**
  panel below.
- **Safe Action** = today's `PlannerView`, stripped to: why + confidence +
  status chip, the candidate table, the instruction + expected delta, and
  collapsible `evidence` / `SupervisorRuleNotice`. No fabricated fields (already
  cleaned in the audit).
- **Active Interventions** — inline, not a floating banner. Full lifecycle
  (acknowledge → progress → verify → resolve, dismiss → false positive).
- Optional one-line "what's likely next" strip from `getTemporalSummary` — a
  sentence, not the 688-line `TemporalRiskPanel`.

### 4.3 Incidents — list  `/incidents`

```
┌─ INCIDENTS ──────────────────────────────────────────────────────────┐
│ lens [ all ▾ ]  band [ all ▾ ]  status [ all ▾ ]  review [ all ▾ ]   │
│ camera [ all ▾ ]                              [ export CSV (filtered) ]│
│ ────────────────────────────────────────────────────────────────────  │
│  #34   Stepping on carton         CRITICAL   probable    unreviewed   │
│  #105  Entity in dock edge zone   HIGH       supported   unreviewed   │
│  #20   Heavy-on-light stacking    HIGH       supported   unreviewed   │
│  #73   Box overhang               HIGH       supported   prevented ✓  │
│  #50   Wrong product orientation  MEDIUM     supported   unreviewed   │
│  …                                                                    │
│                                             15 findings · page 1/1    │
└──────────────────────────────────────────────────────────────────────┘
```

- One flat table. Columns: id · title · band · epistemic status · review/outcome.
- Filter bar drives both the list and the CSV export from **one** `activeFilters`
  object (the drift bug is already fixed on `main`).
- Row → `/incidents/:id`.
- No "recommended demos triage" block, no inline detail pane — detail is its own
  route.

### 4.4 Incidents — detail  `/incidents/:id`

```
┌─ #73  Box overhang ─────────────────────────  HIGH · supported ──────┐
│  Overview | Replay | What-If                                         │
│ ────────────────────────────────────────────────────────────────────│
│  OVERVIEW                                                            │
│                                                                     │
│  Camera   Dock 4 — Inbound Transfer        Time  00:11.4            │
│  Lens     structural                        Confidence  medium       │
│                                                                     │
│  Why this matters                                                    │
│   The carton base extends past the pallet edge. As the stack grows   │
│   the centre of gravity moves outboard and the tipping moment …      │
│                                                                     │
│  Safe action                                                         │
│   Move the load ~20 cm toward the pallet centre.   expected +44      │
│   Options:  A 42 HIGH · B 86 LOW ◀ · C 68 MED                        │
│                                                                     │
│  Evidence ▾    Factor breakdown ▾    Supervisor rule ▾               │
│                                                                     │
│  Outcome    prevented ✓   (verified — all three conditions held)     │
└─────────────────────────────────────────────────────────────────────┘
```

```
┌─ #73  Box overhang ───  Overview | [Replay] | What-If ──────────────┐
│  ┌─────────────────────────────┐   Outcome check — CLAUDE.md §15     │
│  │   video @ 00:11  (blur on)  │   1 ✓ meaningful risk predicted     │
│  │   scene overlay ☑           │   2 ✓ corrective action in window   │
│  │                             │   3 ✓ safer state before completion │
│  └─────────────────────────────┘   → classification: prevented       │
│   ├───●────────────┤  ◀ ▶  1×                                        │
│                                                                     │
│  Review        ( human-review gate — §22 )                          │
│   [ mark reviewed ]  [ false positive ]  [ confirm damage ]         │
└─────────────────────────────────────────────────────────────────────┘
```

```
┌─ #73  Box overhang ───  Overview | Replay | [What-If] ──────────────┐
│  Replay with alternative:  [ B — shift 20cm inboard ▾ ]             │
│                                                                     │
│  risk                                                               │
│   60 ┤        ╭─╮ observed                                          │
│   40 ┤   ╭────╯ ╰──────────                                         │
│   20 ┤───╯      ╭──────────  simulated (alternative)               │
│    0 ┼──────────┴───────────────────────────────────                │
│      0s        placement          end                               │
│                                                                     │
│  High Risk (54.4) → Low Risk (11.2)      +43.2 stability            │
│                                                                     │
│  ⓘ Comparative operational risk indicators from observed geometry   │
│    and product metadata — not certified structural calculations.    │
└─────────────────────────────────────────────────────────────────────┘
```

- Three tabs on one route family. Overview is text + the plan; Replay is
  video + the **real** 3-condition check (ported from `IncidentReplay.jsx`,
  already de-faked) + review actions; What-If is the observed-vs-simulated
  curve (ported from `WhatIfReplay.jsx`).
- When What-If is not applicable, the tab shows the honest refusal reason
  (e.g. "no feasible alternative for this frame", "scenario is behaviour, not
  structural") — not an error.

### 4.5 Patterns  `/patterns`

```
┌─ PATTERNS ───────────────────────────────────────────────────────────┐
│                                                                      │
│  Prevention             ( four buckets — never summed )              │
│   prevented   1     near-miss   0     unclear   0    confirmed   0    │
│   "Prevented" = risk predicted + action in window + safer state      │
│   before completion.  "Confirmed damage" is set only by human review.│
│                                                                      │
│  Evidence-backed findings   21          Logged observations   38      │
│   (supported / probable drive the numbers below; the rest stay in    │
│    the log with their status)                                        │
│                                                                      │
│  Recurring configurations                Behaviour frequency         │
│   box_overhang        ×3 (2 high)         dragging_precursor    ×2    │
│   dock_edge_zone      ×6 (6 high)         …                          │
│                                                                      │
│  Source × scenario heat map              ( not a spatial pixel map ) │
│   ┌──────────────┬────┬────┬────┐                                    │
│   │ Dock 4       │ 2  │ .  │ 1  │   darker = more findings           │
│   │ Dock 8 wet   │ .  │ 3  │ .  │                                    │
│   └──────────────┴────┴────┴────┘                                    │
│                                                                      │
│  Scenario coverage      13 demonstrated in footage · 1 rule-ready    │
│   [ 14-cell grid, one per scenario, lens-coloured ]                  │
│                                                                      │
│  [ export incidents CSV ]   [ export shift summary ]                 │
└──────────────────────────────────────────────────────────────────────┘
```

- Plain stacked sections, no bento. Folds in `Dashboard`, `ScenarioCoverage`,
  `LearningInsights`.
- Process scorecards are **per source**, never per worker (§22) — keep that
  label visible.

### 4.6 Assistant  `/assistant`

```
┌─ ASSISTANT ──────────────────────────────────────────────────────────┐
│  Grounded in the event store. Answers are retrieval-only unless an    │
│  ANTHROPIC_API_KEY is set — then the LLM only rephrases the same rows.│
│                                                                      │
│  Try:  "most common risks"  ·  "how many prevented"  ·  "dock bay?"   │
│ ────────────────────────────────────────────────────────────────────  │
│  you   Which behaviour occurred most frequently?                     │
│                                                                      │
│  TRACE The most frequently detected behaviour is dragging_precursor  │
│        (2). Based on 5 records.   sources ▾                          │
│ ────────────────────────────────────────────────────────────────────  │
│  [ ask a question…                                        ] [ send ] │
└──────────────────────────────────────────────────────────────────────┘
```

- Today's `AiAssistant`, restyled. Keep the "based on N records" line and the
  expandable grounding. Keep the §22 guard's process-level answer for
  "who is the worst worker" style questions.

### 4.7 Settings  `/settings/{rules,governance,catalogue}`

```
┌─ SETTINGS ───────────────────────────────────────────────────────────┐
│  [ Rules ]  Governance   Catalogue                                   │
│ ────────────────────────────────────────────────────────────────────  │
│  Product rules      ( required orientation, max stack height )       │
│   carton_standard   orientation: vertical    max stack: 3 (not       │
│                                              enforced)               │
│                                                                      │
│  Custom rules       ( these change risk band + action at runtime )   │
│   ▸ High-risk behaviour escalation   behaviour · score ≥ 70 → HIGH   │
│     [ enabled ]  [ edit ]  [ delete ]                               │
│   [ + new rule ]                                                     │
└──────────────────────────────────────────────────────────────────────┘
```

```
   Governance
    Face redaction     on by default · fails closed (503) if perception
                       is unavailable · streamed video falls back to
                       full-frame blur
    Review queue       4 high-risk findings awaiting review  [ open ]
    Retention          window [ 30 ] days   auto-purge ☐
                       [ preview purge ]  →  then  [ confirm ]
    Distributions      confidence  High 11 · Med 5     epistemic …
    View mode          ( supervisor ▾ )  presentation filter, not auth
```

- Three sub-tabs. `CustomRuleBuilder` (696 lines) becomes a simpler add/edit
  form. Governance = today's `ResponsibleAI`. Catalogue = SKU + zones +
  manifests from `SupervisorSettings`, with the "not enforced" label on max
  stack height (already in the audit fix) and the manifest list now drilling in
  (also fixed).

## 5. Design system

Replace the `tailwind.config.js` theme wholesale.

### Colour

| token | value | use |
|---|---|---|
| `bg` | `#FFFFFF` | page |
| `bg-raised` | `#FAFAFA` | panels, table header |
| `text` | `#1A1A1A` | primary |
| `text-dim` | `#6B6B6B` | secondary, labels |
| `text-mute` | `#9A9A9A` | captions, disabled |
| `border` | `#E4E4E4` | default 1px |
| `border-strong` | `#CFCFCF` | inputs, active |
| `crit` | `#B4231A` | Critical band only |
| `high` | `#C77700` | High band only |
| `ok` | `#2E7D46` | prevented / verified, sparingly |

Medium and Low bands render in `text-dim` / `text-mute` — deliberately not
alarming. That's the whole palette. No gradients. No `repeating-linear-gradient`.

### Type

- Font: `-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
- Mono (ids, scores, timestamps, code): `ui-monospace, "SF Mono", Menlo, monospace`.
- Scale, three sizes: `page-title` 21px/600, `section` 15px/600, `body` 13px/400.
  Caption 12px/400 for metadata lines. Drop `display-xl/lg/md`, drop Barlow
  Condensed.
- Uppercase only in the left nav and one-word section eyebrows, `letter-spacing:
  0.04em`, `text-dim`. Nowhere else.

### Layout & primitives

- 4px spacing base. 24px between sections, 16px inside a panel, 8px between rows.
- One card: `.panel` — `bg-raised`, `1px solid border`, `border-radius: 6px`,
  `padding: 16px`. Replaces every ad-hoc `border border-line bg-surface`.
- Tables: no vertical rules, 1px row separators, `bg-raised` header, generous
  row height (36–40px).
- No shadows except the one modal.
- Max content width ~1180px; nav 208px; single-column stacking below ~900px.
- Collapsibles (`evidence ▾`) are a native `<details>` or a tiny disclosure —
  no accordion library.

## 6. Component inventory

**Keep, restyle only** — `api/*` (all), `hooks/*`, `lib/scenarios.js`
(has the evidence formatters from the audit), `lib/format.js`,
`video/VideoViewport`, `video/PlaybackControls`, `video/SceneOverlay`,
`video/PerceptionOverlay`, `video/FaceRedactionOverlay`,
`video/HypotheticalOverlay`, `components/SupervisorRuleNotice`,
`intervention/InterventionStatusChip`, `InterventionContext` (drop the screen
routing it doesn't own).

**Split / rebuild**

| today | → |
|---|---|
| `IncidentReplay.jsx` 1438 | `IncidentDetail` shell + `OverviewTab` + `ReplayTab` + `OutcomeCheck` + `ReviewActions` |
| `EventFeed.jsx` 1056 | `IncidentList` + `FilterBar` (detail leaves for `IncidentDetail`) |
| `WhatIfReplay.jsx` 735 | `WhatIfTab` under `IncidentDetail` |
| `PlannerView.jsx` 562 | `SafeActionPanel` — used by Monitor and `OverviewTab` |
| `Dashboard.jsx` 502 + `ScenarioCoverage.jsx` 307 + `LearningInsights.jsx` 215 | `PatternsView` |
| `CustomRuleBuilder.jsx` 696 | `RulesSettings` — simpler form |
| `TemporalRiskPanel.jsx` 688 | one-line "likely next" strip in Monitor |
| `AiAssistant.jsx` 201 | `AssistantView` — restyle |
| `ResponsibleAI.jsx` 369 | `GovernanceSettings` |
| `SupervisorSettings.jsx` 418 | `CatalogueSettings` |

**Delete** — `NavRail.jsx`, `Header.jsx` (both replaced by `AppShell`),
`PlaceholderScreen.jsx`, the `SCREENS` / `SECONDARY_SCREENS` / `SCREEN_ALIASES`
machinery.

## 7. Backend → frontend map

No endpoint changes. Frontend calls the same `api/*.js` wrappers.

| View | Endpoints (via `api/*.js`) |
|---|---|
| **Monitor** | `listVideos`, `streamUrl`, `frameUrl`, `getScene`, `getEntities`, `getFindings`, `getActionPlan` / `evaluateActionPlan`, `getTemporalSummary`, `listActiveInterventions` + `acknowledge/progress/verify/resolve/dismiss` |
| **Incidents · list** | `listEvents`, `incidentsCsvUrl` |
| **Incidents · Overview** | `getEvent`, `getActionPlan`, `getEventOutcome` |
| **Incidents · Replay** | `streamUrl`, `frameUrl`, `getScene`, `getEventOutcome` / `verifyEventOutcome`, `submitReview` |
| **Incidents · What-If** | `getEventTrajectory` / `getTrajectoryWhatIf` |
| **Patterns** | `getPreventionSummary`, `listOutcomes`, `getPatterns`, `getHeatmap`, `getScorecards`, `listBehaviourScenarios`, `getShiftSummary`, `shiftSummaryMdUrl`, `incidentsCsvUrl` |
| **Assistant** | `askAssistant`, `getAssistantSuggestions` |
| **Settings · Rules** | `getRuleSchema`, `listRules`, `getRule`, `createRule`, `updateRule`, `deleteRule`, `evaluateRule`, `listProducts` |
| **Settings · Governance** | `getGovernanceStatus`, `getRetention`, `putRetention`, `runPurge` |
| **Settings · Catalogue** | `listProducts`, `deleteProduct`, `listZones`, `createZone`, `deleteZone`, `listManifests` |
| **Shell** | `/health`, `useWebSocket` (live stream dot), `InterventionContext` (alert count) |

Unused after redesign (kept in `api/` for later): `simulatePlacement`,
`getPredictiveRisk` / `getTemporalPatterns` (folded into the one-line strip),
`getBehaviourScenario`, `seedActiveInterventions`, `evaluateEventIntervention`.

## 8. What does NOT change

- **Backend** — no route, schema, seed, or logic touched.
- **Honesty properties stay on screen:**
  - epistemic status chip on every finding (`supported` / `probable` /
    `insufficient_evidence` / `unsupported`)
  - "evidence-backed findings" vs "logged observations" split in Patterns
  - the four prevention buckets shown separately, never summed
  - process scorecards per source, **never** per worker
  - stability-model disclaimer text wherever a stability number appears
  - "max stack height: not enforced" in the catalogue
  - `SupervisorRuleNotice` wherever a rule raised a band
  - face-redaction status + fail-closed messaging in Governance
  - what-if refusal states shown as honest reasons, not errors
  - assistant "retrieval-only without a key" note, and its §22 process-level
    answer for individual-ranking questions
- **`api/*.js`** wrappers — signatures unchanged.

## 9. Implementation phases

### Phase 1 — shell + Monitor + Incidents + Replay

1. **Tokens.** Rewrite `tailwind.config.js` theme (§5). Add `react-router-dom`.
   Minimal `index.css`: resets, `.panel`, `.eyebrow`.
2. **`AppShell`.** Header + 5-item nav + `<Routes>`. Retire `NavRail`, `Header`,
   `PlaceholderScreen`, and the alias machinery.
3. **Monitor.** Camera picker + viewport + scrubber + Active Risks +
   `SafeActionPanel` + Active Interventions strip.
4. **Incidents list.** `IncidentList` + `FilterBar` + CSV export.
5. **Incident detail.** `IncidentDetail` with Overview + Replay tabs; port the
   real 3-condition check and review actions.
6. **Bridge.** A temporary "More" menu renders the old What-If / Patterns /
   Assistant / Settings screens inside the new shell so nothing is unreachable.

Exit: the core loop (see a risk → read the plan → replay → verify) works end to
end in the new design.

### Phase 2 — What-If + Patterns + Assistant

7. **What-If tab** under `IncidentDetail`; delete `WhatIfReplay.jsx`.
8. **`PatternsView`** — prevention buckets, heat map, recurring configs,
   scorecards, coverage grid, exports. Delete `Dashboard.jsx`,
   `ScenarioCoverage.jsx`, `LearningInsights.jsx`.
9. **`AssistantView`** — restyle. Remove the "More" menu.

### Phase 3 — Settings + governance + polish

10. **Settings** with `rules` / `governance` / `catalogue` sub-routes. Simplify
    `CustomRuleBuilder`. Move view-mode into Governance; operator view gates the
    nav to Monitor + Incidents.
11. **Polish** — responsive pass, loading / empty / error states, keyboard nav
    and a11y labels, delete dead CSS and components, final visual sweep.

## 10. Risks

- **Monitor is doing a lot.** Live video + risks + planner + interventions on one
  screen. Mitigation: the planner only appears once a risk is selected;
  interventions collapse when none are active.
- **`IncidentDetail` tab state + routing** — three tabs on one route family with
  deep links. Keep tab = route segment, no local tab state.
- **Video overlays are the fragile part.** Keep the `video/*` components as-is in
  phase 1; restyle only their chrome, not their canvas logic.
- **The bridge menu** must not become permanent — it's deleted at the end of
  phase 2.
