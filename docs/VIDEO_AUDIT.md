# TRACE Input Video Audit

**Audit date:** 2026-09-04
**Scope:** `data/challenge_videos/` only. No perception, detection, tracking, scenario logic, or frontend changes were implemented for this audit.
**Method:** Every file was opened and decoded (not inferred from filename). Container/stream metadata was read with `ffmpeg` (a portable binary obtained locally via the `imageio-ffmpeg` Python package, used read-only for this inspection — no YOLO/Ultralytics/MediaPipe dependency was added). Five representative frames per file (0%, 25%, 50%, 75%, ~97% of duration) were extracted with OpenCV (`opencv-python-headless`, installed for inspection only) and visually reviewed.

**Note on tooling install:** No `ffmpeg`/`ffprobe`/OpenCV was present on this machine. `opencv-python-headless` and `imageio-ffmpeg` were installed into the global user Python environment to perform this audit (per the task's allowance for tooling "purely for inspection"). This upgraded the system's global `numpy` and produced pip dependency-conflict warnings against three unrelated pre-existing packages (`numba`, `scipy`, `vectorbt`) that are not part of this project. Nothing in the TRACE repo (requirements.txt, pyproject.toml) was changed. Flagging this so the user can decide whether to pin/restore their global `numpy` version outside of this project.

## 1. Audit Summary

The previous audit run (superseded by this one) found all 8 files at 0 bytes. **That is no longer the case.** All 8 files now contain real video: 1280×720, 30 fps, H.264/AAC, 6–49 seconds each, totaling ~3m41s of footage.

The single most important finding, not knowable from filenames: **these are not raw CCTV exports.** Every clip is a phone/camera recording of a computer monitor playing back footage inside an NVMS (Network Video Management System) application, and every clip already has hazard-callout graphics (red circles/arrows and caption text, e.g. "Dragging", "Heavy box kept on top of other packets", "Gap between dock and vehicle") burned into the video by whoever prepared this dataset. In effect, these look like an "answer key" — pre-labeled hazard-highlight clips — rather than unlabeled live camera feed. This materially changes what Phase 2/3 should assume about the input (see §8).

7 distinct scenes exist across the 8 files: `Throwing seating cartons, using strap to hold.mp4` and `Throwing seating cartons, using strap to hold (1).mp4` are byte-identical duplicates (MD5 `18d4d1803523a828a97e52d6b31445e7` for both).

## 2. Video Inventory

| Video | Size | Duration | Resolution | FPS | Frame count | Codec/Container | Audio |
|---|---|---|---|---|---|---|---|
| Dock level, dragging cupboard.mp4 | 34.98 MB | 31.00s | 1280×720 | 30 | 930 | H.264 (avc1, Main) / MP4 | AAC-LC, 48kHz stereo, 192kbps |
| KD packets dragged, heavy box kept on other packets.mp4 | 37.70 MB | 33.73s | 1280×720 | 30 | 1012 | H.264 (avc1, Main) / MP4 | AAC-LC, 48kHz stereo, 192kbps |
| Rolling and dragging on wet floor.mp4 | 6.74 MB | 6.10s | 1280×720 | 30 | 183 | H.264 (avc1, Main) / MP4 | AAC-LC, 48kHz stereo, 192kbps |
| Rolling and dropping carton.mp4 | 10.15 MB | 9.40s | 1280×720 | 30 | 282 | H.264 (avc1, Main) / MP4 | AAC-LC, 48kHz stereo, 192kbps |
| Stepping on cartons, vertical product kept horizontally, heavy product kept on top.mp4 | 54.18 MB | 49.03s | 1280×720 | 30 | 1471 | H.264 (avc1, Main) / MP4 | AAC-LC, 48kHz stereo, 192kbps |
| Throwing Mattresses.mp4 | 46.47 MB | 41.63s | 1280×720 | 30 | 1249 | H.264 (avc1, Main) / MP4 | AAC-LC, 48kHz stereo, 192kbps |
| Throwing seating cartons, using strap to hold.mp4 | 16.54 MB | 15.03s | 1280×720 | 30 | 451 | H.264 (avc1, Main) / MP4 | AAC-LC, 48kHz stereo, 192kbps |
| Throwing seating cartons, using strap to hold (1).mp4 | 16.54 MB | 15.03s | 1280×720 | 30 | 451 | H.264 (avc1, Main) / MP4 | AAC-LC, 48kHz stereo, 192kbps |

All 8 opened and decoded cleanly (first and last frame both readable) with no corruption detected. Audio track *presence* was confirmed via stream inspection; audio *content* was not reviewed (out of scope for a visual perception audit — flagged as unclear/not reviewed).

Bitrate is consistently ~9–9.5 Mb/s across all files, and duration/frame-count/fps are internally consistent (`fps × duration ≈ frame_count` in every case), indicating uniform, non-corrupted encodes — likely produced by the same recording/export process.

## 3. Observed Content

Frames were sampled at 0%, 25%, 50%, 75%, ~97% of each video's duration. Because only 5 of up to ~1471 frames were reviewed per file, findings below describe what those samples show, not a frame-complete account. Camera/channel labels quoted below are the NVMS on-screen overlays, read directly from frame text.

### Dock level, dragging cupboard.mp4
Single fixed camera, "Dock 09 inside" — an elevated, angled overhead view of a loading dock/yard with a pallet-truck ramp on the left. 2 people visible. A worker drags a large branded carton ("AURADINE") using a pallet jack across a visibly uneven transition where the dock meets the yard floor. In-video captions (added by the dataset author, not by TRACE) read "Uneven dock level due to absence of a leveler", "Gap between dock and vehicle", "Improper Handling", and "Dragging". Lighting is daytime/adequate. No wet floor or standing water visible in sampled frames.

### KD packets dragged, heavy box kept on other packets.mp4
Same fixed camera, "Dock 09 inside" / "Dock 08 out 02" (NVMS channel selector visible mid-clip). 2–3 workers manipulating a pallet of flat "KD" (knock-down/flat-pack furniture) packets with a single large strapped carton set on top of them. In-video captions read "Heavy box kept on top of other packets" and (implied by the file browser panel) an event labeled around dragging of the flat packets. One frame (~97%) shows a single worker alone leaning into/pushing the large box without help. Lighting adequate, moderate occlusion when workers cluster around the pallet.

### Rolling and dragging on wet floor.mp4
Shortest clip (6.1s). Unlike the others, this one is a **multi-camera grid view** ("Dock 08 out 01" top pane, "Dock 07 inside" bottom pane, both visible simultaneously) played back at 4× in the NVMS UI (green ">>4" indicators visible). A truck is being unloaded at "Dock 08 out 01"; captions read "rolling carton" and "dragging". A public street, a bus, and a delivery truck are visible in the background of the top pane, indicating the dock opens onto a public road. **No wet or reflective floor surface was visible in any of the 5 sampled frames** — the ground in "Dock 08 out 01" looks dry. This does not rule out a wet-floor moment elsewhere in the 183-frame clip, but it means the "wet floor" claim in the filename is **not corroborated by the sampled frames** and should be marked unclear rather than assumed.

### Rolling and dropping carton.mp4
Single camera, "Dock 09 inside", but zoomed out further than other "Dock 09" clips — the physical monitor bezel and a textured wall are visible around the video pane (phone held further back). Densely crowded scene: 5–6 people cluster tightly around a large strapped carton on a pallet, including one person (orange lanyard, seated) who appears to be observing rather than working, and one uniformed individual with an ID badge (possibly security/supervisor). Captions read "Rolling and dropping the carton". Heavy mutual occlusion between the 5–6 people makes individual pose/limb attribution difficult in this clip specifically.

### Stepping on cartons, vertical product kept horizontally, heavy product kept on top.mp4
Longest clip (49s). Single camera, "Dock 10 out 02" — an elevated view looking into the open back of a red shipping/container-style truck bed backed up to a raised dock, with a ramp and safety-striped posts. 4–6 workers cycle in and out of frame loading the truck. Interior of the truck bed is noticeably darker/underexposed relative to the dock platform. Captions read "stepping on cartons while loading" (a worker climbs onto stacked cartons at the truck threshold) and "dropped heavy carton on another carton". The filename's third claim ("vertical product kept horizontally") was **not directly corroborated by an in-video caption in the 5 sampled frames** — worth confirming with a full pass before treating it as ground truth.

### Throwing Mattresses.mp4
Second-longest clip (41.6s). Single camera, "...RU SMART NVMS" branded UI, channel "Dock 1? out 01"/"...inside". Overhead dock view with a truck backed to the dock; wet-looking reflective pavement is visible in the yard beyond the platform in this clip (unlike "Rolling and dragging on wet floor.mp4"). One worker repeatedly throws/shoves large plastic-wrapped mattresses into a dark truck interior where a second, partially visible person receives them. Captions read "Throwing mattresses", "Throwing mattresses on top of each other", and "Rolling" (appearing twice). This is a single repeated action type (throw → land on prior mattress → repeat) rather than a varied sequence.

### Throwing seating cartons, using strap to hold.mp4 (and its byte-identical duplicate "(1)")
Single camera, "...ck 06 out 01". 3–4 workers unload/load cartons ("seating" product) between a container truck and a covered dock area with visible blue tarp on the floor. Notably higher color-fringing/moiré artifacts on the right portion of the frame (rainbow-banded distortion), the worst image-quality among the 8 clips, consistent with a lower-quality phone recapture of the monitor at this angle/lighting. Captions read "THROWING SEATING CARTONS WHILE LOADING" and "Holding products using the strap" (a worker visibly grips a packaging strap as a handle while lifting a carton).

## 4. Scenario Mapping

Confidence reflects only what was directly observed (an in-video caption or unambiguous action) in the sampled frames — not the filename.

| # | Scenario | Video(s) | Evidence | Confidence | TRACE Lens |
|---|---|---|---|---|---|
| 1 | Heavy-on-light stacking | KD packets dragged...mp4; Stepping on cartons...mp4 | Captions "Heavy box kept on top of other packets"; "dropped heavy carton on another carton" | HIGH | Structural |
| 2 | Throwing/dropping | Rolling and dropping carton.mp4; Throwing Mattresses.mp4; Throwing seating cartons...mp4; Stepping on cartons...mp4 | Captions "Rolling and dropping the carton"; "Throwing mattresses"; "THROWING SEATING CARTONS WHILE LOADING"; "dropped heavy carton on another carton" | HIGH | Behaviour |
| 3 | Dragging instead of lifting | Dock level, dragging cupboard.mp4; KD packets dragged...mp4; Rolling and dragging on wet floor.mp4 | Captions "Dragging" (×2 clips); pallet-jack/hand-dragging of flat packets observed | HIGH | Behaviour |
| 4 | Rolling cartons/mattresses | Rolling and dropping carton.mp4; Rolling and dragging on wet floor.mp4; Throwing Mattresses.mp4 | Captions "rolling carton"; "Rolling"; "Rolling and dropping the carton" | HIGH | Behaviour |
| 5 | Packaging straps used as handles | Throwing seating cartons, using strap to hold.mp4 | Caption "Holding products using the strap"; worker visibly gripping a strap | HIGH | Behaviour |
| 6 | Stepping on cartons | Stepping on cartons...mp4 | Caption "stepping on cartons while loading"; worker climbing onto stacked cartons | HIGH | Behaviour |
| 7 | Wrong product orientation | Stepping on cartons...mp4 (filename claim: "vertical product kept horizontally") | Filename only; no in-video caption for this specific claim seen in the 5 sampled frames | LOW | Conformance |
| 8 | Pallet overhang | — | Not observed in any sampled frame across any of the 8 videos | NOT PRESENT | Structural |
| 9 | Dock/vehicle gap | Dock level, dragging cupboard.mp4 | Captions "Uneven dock level due to absence of a leveler"; "Gap between dock and vehicle" | HIGH | Environmental |
| 10 | Wet-floor handling | Rolling and dragging on wet floor.mp4 (filename claim) | No wet/reflective floor visible in the 5 sampled frames of this clip; some incidental wet-looking pavement appears in the unrelated "Throwing Mattresses.mp4" background instead | LOW / unclear | Environmental |
| 11 | Improper/unplanned loading sequence | Dock level, dragging cupboard.mp4 | Generic caption "Improper Handling" — does not specifically depict a sequence/ordering violation | LOW | Conformance |
| 12 | Solo handling of a heavy item | KD packets dragged...mp4 | ~97%-mark frame shows one worker alone maneuvering the large strapped box (earlier in the clip it is handled by a group) | MEDIUM | Behaviour / Product-specific |
| 13 | Wrong equipment usage | — | Hand pallet trucks/trolleys observed being used in an apparently ordinary manner in all clips; no misuse caption or clearly incorrect equipment use observed | NOT PRESENT | Conformance |
| 14 | Unsupported/bending product placement | — | Not clearly distinguished from scenario 1 (heavy-on-light) in sampled frames; no caption specifically depicts unsupported overhang/bending | NOT PRESENT / insufficient evidence | Structural |

**Not covered by any of the 8 clips with usable confidence: scenarios 7, 8, 10, 11, 13, 14.** This is a real gap the team should decide how to handle (e.g., staged/controlled footage for Phase 2B, as CLAUDE.md §24 anticipates) rather than something to paper over.

## 5. Demo Candidate Ranking

Ranked for the headline **CURRENT → PREDICTED RISK → SAFE ALTERNATIVE → INTERVENTION → OUTCOME → WHAT-IF REPLAY** narrative.

**Important honesty note up front:** none of the 8 clips contain a genuine *pre-decision* moment of the kind the Safe Action Planner narrative implies (worker approaching an empty spot, planner scoring candidates, worker then choosing). All 8 clips are recordings of hazardous handling *already occurring or already completed*. The clips that come closest are the ones with a clean, single, identifiable placement event (heavy box placed onto packets; heavy carton dropped onto another carton) — these are usable as the "before/after" pair for **What-If Replay** (§13 of the spec: load a historical sequence, take the real placement event as the baseline trajectory, and generate an alternative trajectory) rather than as raw material for a live, forward-looking planner run. A live/forward planner demo will need either controlled restaging or synthetic scene state, consistent with CLAUDE.md §24's requirement to be honest about which scenarios are demonstrated by real footage vs. simulated.

1. **KD packets dragged, heavy box kept on other packets.mp4** — Strongest overall candidate. Single fixed camera, 34s, two clearly captioned hazards (heavy-on-light stacking + dragging) plus a plausible solo-handling moment, and — critically — a clean, single, unambiguous placement event (the heavy box going onto the packets) that is exactly the shape of event the What-If Replay and structural-scoring engine need as a "before/after" pair.
2. **Stepping on cartons, vertical product kept horizontally, heavy product kept on top.mp4** — Richest multi-hazard clip (2 confirmed hazards, 1 unconfirmed), longest duration, single camera. Good for Event Feed / Incident Replay breadth, but heavier occlusion (up to 6 people) and a dark truck interior make it a harder perception target than #1.
3. **Throwing seating cartons, using strap to hold.mp4** — Two confirmed hazards (throwing, strap-as-handle) in a compact 15s single-camera clip. Good length for a quick demo cut; usable despite being the visually noisiest clip (color-fringing artifacts).
4. **Dock level, dragging cupboard.mp4** — Only clip that clearly demonstrates the Environmental lens (dock/vehicle gap) alongside a Behaviour lens (dragging), single camera, 31s. Valuable specifically for showing lens diversity in the demo, not just repeating Behaviour hazards.
5. **Throwing Mattresses.mp4** — Two confirmed hazards but a single repeated action (throw, land, repeat) over 41.6s; less narrative variety, though the large distinct object (mattress) is a good stress-test for perception at a different aspect ratio/size than cartons.
6. **Rolling and dropping carton.mp4** — Confirmed hazard but the most heavily occluded clip (5–6 people in a tight cluster) in only 9.4s; usable but the weakest for clean single-entity tracking.
7. **Rolling and dragging on wet floor.mp4** — Weakest candidate: shortest clip, the only one that switches between two camera panes mid-sequence (breaks the fixed-single-camera assumption), worst-corroborated hazard claim (wet floor not visible in samples), and played back at 4× in-app (so the underlying real-time motion characteristics are altered relative to the other 7 clips, which is important context for tuning velocity/acceleration-based Behaviour detection).
8. **Throwing seating cartons, using strap to hold (1).mp4** — Exclude; confirmed byte-identical duplicate of #3.

## 6. Perception / Data Limitations

- **Recording-of-a-recording.** Every clip is a phone/camera capture of a monitor running NVMS playback software, not a direct camera export. This introduces: visible monitor bezel and surrounding room in wider shots; slight keystone/perspective distortion; moiré and color-fringing artifacts (worst in "Throwing seating cartons..." and "Rolling and dragging on wet floor"); and NVMS UI chrome (menus, playback controls, calendar, channel list, timeline scrubber) occupying a variable but often substantial fraction of the frame, sometimes overlapping the actual scene content.
- **Burned-in hazard annotations.** All 8 clips already contain red circles/arrows and caption text added by the dataset author, labeling the specific hazard. This is a double-edged finding: it gives high-confidence, human-verified ground truth for scenario mapping (used throughout §4), but it also means these exact frames are not representative of the *unannotated* live input TRACE's perception layer will actually receive at inference time — the overlays themselves would need to be excluded/cropped, and no equivalent "helpful label" will exist on live camera feed.
- **Camera-burned timestamp/channel-name text** ("Dock 09 inside", date/time) occupies a frame region and could be parsed as metadata, but is not a substitute for actual capture-time synchronization since it reflects the *original* CCTV recording time, not the phone-recording time (the two on-screen timestamps — NVMS clock, top-right, vs. embedded camera date/time — visibly differ within the same frame in several clips).
- **Camera discontinuity mid-clip.** "Rolling and dragging on wet floor.mp4" shows two camera panes simultaneously and is played back at 4× — both a departure from the fixed-single-camera assumption used elsewhere and a motion-speed distortion relevant to any velocity/acceleration-based behaviour detection.
- **Occlusion.** Clips with 4–6 workers clustered around a single carton/pallet ("Rolling and dropping carton.mp4", "Stepping on cartons...mp4") have significant mutual occlusion, which will challenge both detection-box stability and pose estimation for any individual worker.
- **Uneven exposure.** Truck/container interiors are consistently darker than the dock platform in the same shot ("Stepping on cartons...mp4", "Throwing Mattresses.mp4"), which will reduce detection confidence for people/objects once they move inside the vehicle bed.
- **No scale/calibration reference.** Yellow floor markings are visible in some dock shots ("Dock 09 inside", "Dock 10 out 02") but no ruler, checkerboard, or other explicit scale reference exists in any clip, so absolute-metric geometry (needed for COG offset, tipping-moment estimates, etc.) cannot be derived from these clips alone without an assumed/calibrated ground-plane scale.
- **Effective resolution is lower than the nominal 1280×720.** Because the useful CCTV content is a sub-region of a screen-recorded frame (monitor bezel, UI chrome, and burned-in captions all consume pixels), the actual pixel budget available for small/distant objects is smaller than the container resolution suggests.
- **Audio was not reviewed.** All 8 files carry an AAC stereo track; its content (ambient noise, possible narration) was not assessed as part of this visual audit.

## 7. Recommended Video Set for MVP

Use 4 of the 8 files, prioritizing lens diversity and clip quality over exhaustive coverage:

1. `KD packets dragged, heavy box kept on other packets.mp4` — Structural (heavy-on-light) + Behaviour (dragging) + What-If Replay source.
2. `Throwing seating cartons, using strap to hold.mp4` — Behaviour (throwing, strap-as-handle); drop the identical `(1)` copy.
3. `Dock level, dragging cupboard.mp4` — Environmental (dock/vehicle gap) + Behaviour (dragging).
4. `Stepping on cartons, vertical product kept horizontally, heavy product kept on top.mp4` — Behaviour (stepping on cartons) + Structural (heavy-on-light); accept the higher occlusion as a stress test.

This set gives HIGH-confidence coverage of scenarios 1, 2, 3, 5, 6, and 9. `Throwing Mattresses.mp4` and `Rolling and dropping carton.mp4` are reasonable second-tier additions if scenario 4 (rolling) needs its own dedicated clip rather than piggybacking on the 4 above (rolling also appears, more weakly, in "Rolling and dragging on wet floor.mp4"). `Rolling and dragging on wet floor.mp4` is the weakest of the 8 (camera discontinuity, 4× playback, unconfirmed wet-floor claim) and should be the last one reached for.

Scenarios 7, 8, 10, 11, 13, 14 have no HIGH/MEDIUM-confidence footage in this set at all and should be flagged to the team as needing either controlled/staged capture or explicit "integration-ready, not yet demonstrated" labeling in the product, per CLAUDE.md §24 and §30.

## 8. Implications for Phase 2/3

- **Ingestion (Phase 2)** should expect to decode standard 1280×720/30fps H.264/AAC MP4 — no unusual container/codec handling is needed. But because every clip already carries burned-in graphics/text, ingestion should not assume "clean" camera frames; if these specific files are ever used for automated detector testing (as opposed to human/demo review), a cropped region-of-interest excluding the top NVMS toolbar and the caption banners would need to be established per clip, since those overlays are not part of the physical scene and would otherwise be mis-detected or would occlude real content.
- **Detection/tracking (Phase 3)** should be validated against the specific challenges observed here: moderate-to-heavy occlusion in crowded clips, underexposed truck-interior regions, and one clip with a mid-sequence camera-pane switch plus altered (4×) playback speed. A single generic confidence threshold tuned on the cleanest clip (KD packets) is unlikely to transfer well to the noisiest one (Throwing seating cartons, or Rolling and dragging on wet floor).
- **World model / geometry (Phase 4 onward)** cannot assume any absolute-scale calibration is available from these clips — floor markings exist in some shots but no metric reference does. Any COG/tipping/support-ratio computation on this footage will need either an assumed reference dimension (e.g., a known carton or pallet size, since some captions/labels like "Interio" branding are legible) or should be presented as relative/comparative only, consistent with the required stability-model disclosure in CLAUDE.md §12.
- **Scenario coverage is uneven and must be represented honestly in the product.** 6 of the 8 clips have no direct HIGH-confidence scenario, and 6 of the 14 scenarios (7, 8, 10, 11, 13, 14) have no solid footage at all across the full set. The product should not claim broader footage-driven detection than what's in §4.
- **The Safe Action Planner's live "propose → score → recommend → follow" loop cannot be demonstrated with this footage as-is** — every clip captures a hazard already in progress, not a pre-placement decision point. The two clips with a clean single placement event (KD packets; Stepping on cartons' "dropped heavy carton" moment) are good source material for **What-If Replay** (retrospective: "here's what happened, here's what the planner would have recommended instead"), but a live/forward planner walkthrough for the demo will need either controlled restaging with a live camera or a scripted/synthetic scene state layered on top of the real structural-scoring engine, and should be labeled as such rather than presented as footage-driven.

---

*This audit describes the video assets only. No detections, metrics, accuracy figures, or scenario "detections" have been claimed — the scenario mappings in §4 are derived entirely from human-authored captions already present in the footage, not from any TRACE component.*
