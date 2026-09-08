/**
 * Centralized Scenario & Presentation Intelligence Registry for TRACE.
 * 
 * Provides human-first titles, operational risk impact explanations ("Why it matters"),
 * safe action recommendations, and progressive disclosure formatters for all 14
 * operational scenarios defined in ARCHITECTURE.md + supplementary warehouse events.
 */

export const SCENARIO_REGISTRY = {
  heavy_on_light_stacking: {
    key: 'heavy_on_light_stacking',
    title: 'Heavy carton placed on lighter carton',
    lens: 'structural',
    defaultBand: 'High',
    whatIsHappening: 'A heavy cargo package has been stacked on top of a lighter base package.',
    whyItMatters: 'Crushes lower packaging, causes top-heavy stack collapse, and risks load tipping during transport.',
    recommendedAction: 'Place heavier carton at the base tier and verify support footprint.',
    alternativeActions: [
      'Relocate upper carton to an adjacent floor pallet.',
      'Restack pallet tier with heaviest items at the bottom.',
    ],
    whatIfEligible: true,
    whatIfCta: 'SIMULATE INVERTED TIER ORDER →',
  },
  dropping_or_throwing_precursor: {
    key: 'dropping_or_throwing_precursor',
    title: 'Sudden downward drop or throw hazard',
    lens: 'behaviour',
    defaultBand: 'High',
    whatIsHappening: 'Sudden downward acceleration detected indicating package dropping or throwing.',
    whyItMatters: 'High-velocity impact causes severe internal product damage and carton rupture.',
    recommendedAction: 'Lower carton gently using controlled manual or mechanical lowering.',
    alternativeActions: [
      'Use team lifting for bulky cargo.',
      'Set cargo down on designated staging pallet.',
    ],
    whatIfEligible: false,
    whatIfNotice: 'Dynamic motion incident — procedural handling intervention required rather than static repositioning.',
    proceduralNotice: 'Dynamic motion incident — procedural handling intervention required rather than static repositioning.',
  },
  carton_drop: {
    key: 'carton_drop',
    title: 'Carton freefall impact / drop detected',
    lens: 'behaviour',
    defaultBand: 'Critical',
    whatIsHappening: 'Carton freefall impact or uncontrolled release detected.',
    whyItMatters: 'Direct impact shock causes cargo damage, contents breakage, and worker foot injury.',
    recommendedAction: 'Inspect carton contents for breakage immediately before restocking or shipping.',
    alternativeActions: [
      'Quarantine dropped package for supervisor damage assessment.',
      'Check integrity of outer shipping box and structural seals.',
    ],
    whatIfEligible: false,
    whatIfNotice: 'Post-impact incident — cargo inspection protocol applies.',
  },
  dragging_precursor: {
    key: 'dragging_precursor',
    title: 'Carton dragged instead of lifted',
    lens: 'behaviour',
    defaultBand: 'Medium',
    whatIsHappening: 'Carton is being dragged across the warehouse floor instead of carried.',
    whyItMatters: 'Abrasive friction damages carton base, weakens seals, and increases snag hazards.',
    recommendedAction: 'Lift carton completely off the floor or use a pallet jack.',
    alternativeActions: [
      'Transfer cargo onto a hand truck or flatbed cart.',
      'Request team lift if weight exceeds individual ergonomic threshold.',
    ],
    whatIfEligible: false,
    whatIfNotice: 'Ergonomic motion incident — use transport apparatus instead of floor dragging.',
  },
  rolling_precursor: {
    key: 'rolling_precursor',
    title: 'Carton rolled or flipped end-over-end',
    lens: 'behaviour',
    defaultBand: 'Medium',
    whatIsHappening: 'Carton is being rotated or flipped end-over-end along the floor.',
    whyItMatters: 'Inverts fragile contents, damages corners, and violates upright handling rules.',
    recommendedAction: 'Keep carton upright and transport using a hand truck or pallet jack.',
    alternativeActions: [
      'Request team lift for repositioning.',
      'Inspect carton corners for structural damage before restacking.',
    ],
    whatIfEligible: false,
    whatIfNotice: 'Orientation-critical handling incident — keep upright during transport.',
  },
  straps_as_handles: {
    key: 'straps_as_handles',
    title: 'Packaging straps used as lifting handles',
    lens: 'behaviour',
    defaultBand: 'High',
    whatIsHappening: 'Worker is grasping packaging straps to lift or maneuver cargo.',
    whyItMatters: 'Banding straps can snap under tension, causing carton drops and sharp edge lacerations.',
    recommendedAction: 'Lift from underneath carton base with hands or approved lifting equipment.',
    alternativeActions: [
      'Slide hands under lower carton corners.',
      'Use pallet jack or hand truck for transport.',
    ],
    whatIfEligible: false,
    whatIfNotice: 'Handling technique hazard — lift under carton base, not by exterior straps.',
  },
  stepping_on_carton: {
    key: 'stepping_on_carton',
    title: 'Worker standing or stepping on carton',
    lens: 'behaviour',
    defaultBand: 'Critical',
    whatIsHappening: 'Worker weight is applied directly onto carton surface.',
    whyItMatters: 'Crushes internal goods, collapses stack structural integrity, and creates a slip/fall hazard.',
    recommendedAction: 'Step off carton immediately and use certified step stool or warehouse ladder.',
    alternativeActions: [
      'Position mobile warehouse steps for elevated reach.',
      'Stage elevated cargo using order picker.',
    ],
    whatIfEligible: false,
    whatIfNotice: 'Worker safety violation — procedural retreat applies; human motion is not simulated.',
  },
  stepping_on_carton_precursor: {
    key: 'stepping_on_carton_precursor',
    title: 'Worker ascending onto carton base',
    lens: 'behaviour',
    defaultBand: 'High',
    whatIsHappening: 'Worker foot placement detected ascending onto carton foundation.',
    whyItMatters: 'Immediate precursor to stepping on carton; risk of crushing cargo and slip/fall injury.',
    recommendedAction: 'Step back to the floor and use designated access equipment.',
    alternativeActions: [
      'Fetch a safety stepladder for overhead access.',
      'Request forklift retrieval for elevated items.',
    ],
    whatIfEligible: false,
    whatIfNotice: 'Procedural safety intervention — worker must use certified climbing equipment.',
  },
  wrong_product_orientation: {
    key: 'wrong_product_orientation',
    title: 'Package placed in wrong orientation',
    lens: 'conformance',
    defaultBand: 'High',
    whatIsHappening: 'Carton is placed horizontally or upside-down against SKU this-side-up requirements.',
    whyItMatters: 'Liquid leakage, internal component shifting, and compressive collapse of side panels.',
    recommendedAction: 'Rotate package to upright this-side-up orientation indicated on label.',
    alternativeActions: [
      'Check manifest orientation arrow before placing in rack.',
      'Set aside for supervisor verification if labels are obscured.',
    ],
    whatIfEligible: true,
    whatIfCta: 'SIMULATE CORRECT ORIENTATION →',
  },
  box_overhang: {
    key: 'box_overhang',
    title: 'Carton overhangs supporting base',
    lens: 'structural',
    defaultBand: 'High',
    whatIsHappening: 'Carton footprint extends significantly beyond supporting package or pallet base.',
    whyItMatters: 'Cantilever overhang creates eccentric loading, tipping instability, and vehicle collision risk.',
    recommendedAction: 'Re-center carton inward to align footprint with supporting foundation.',
    alternativeActions: [
      'Shift adjacent cartons to create centered support.',
      'Restack load onto a larger pallet deck.',
    ],
    whatIfEligible: true,
    whatIfCta: 'SIMULATE SAFER PLACEMENT →',
  },
  pallet_overhang: {
    key: 'pallet_overhang',
    title: 'Pallet overhangs rack or floor support',
    lens: 'structural',
    defaultBand: 'High',
    whatIsHappening: 'Pallet edge extends beyond the rack beam or designated floor support area.',
    whyItMatters: 'Risk of rack beam displacement, pallet tipping under forklift entry, and aisle obstruction.',
    recommendedAction: 'Re-center pallet onto rack beams with minimum 50mm beam overlap on both sides.',
    alternativeActions: [
      'Re-seat pallet with forklift.',
      'Verify rack load rating before final placement.',
    ],
    whatIfEligible: true,
    whatIfCta: 'SIMULATE RE-CENTERED PALLET →',
  },
  entity_in_dock_edge_zone: {
    key: 'entity_in_dock_edge_zone',
    title: 'Worker or equipment in dock ledge danger zone',
    lens: 'environmental',
    defaultBand: 'Critical',
    whatIsHappening: 'Entity entered the unbarricaded dock-edge fall perimeter.',
    whyItMatters: 'Severe fall hazard to lower vehicle roadway and forklift drive-off catastrophe.',
    recommendedAction: 'Retreat 2.0 meters inward from dock edge immediately until bay door is secured.',
    alternativeActions: [
      'Deploy safety dock chain / barricade across opening.',
      'Verify dock plate is securely locked to trailer before approach.',
    ],
    whatIfEligible: false,
    whatIfNotice: 'Environmental safety perimeter breach — procedural retreat required immediately.',
    proceduralNotice: 'Environmental safety perimeter breach — procedural retreat required immediately.',
  },
  entity_in_wet_floor_zone: {
    key: 'entity_in_wet_floor_zone',
    title: 'Handling cargo in marked wet floor zone',
    lens: 'environmental',
    defaultBand: 'High',
    whatIsHappening: 'Worker or cargo handling detected in an active wet floor slip hazard zone.',
    whyItMatters: 'Reduced shoe/floor traction causes slips, dropped cartons, and sudden impact injuries.',
    recommendedAction: 'Move handling activity outside wet floor perimeter until dried and cleared.',
    alternativeActions: [
      'Erect slip caution cones around the perimeter.',
      'Reroute pedestrian traffic through adjacent dry aisle.',
    ],
    whatIfEligible: false,
    whatIfNotice: 'Environmental slip zone — relocate operation to dry floor area.',
    proceduralNotice: 'Environmental slip zone — relocate operation to dry floor area.',
  },
  unplanned_loading_sequence: {
    key: 'unplanned_loading_sequence',
    title: 'Improper cargo loading sequence',
    lens: 'conformance',
    defaultBand: 'Medium',
    whatIsHappening: 'Cargo loading order deviates from the optimal manifest weight distribution plan.',
    whyItMatters: 'Unbalanced axle loading causes vehicle rollover risk and dynamic load shift in transit.',
    recommendedAction: 'Re-sequence loading order to place heavier foundation cargo first.',
    alternativeActions: [
      'Consult manifest sequence sheet before loading next pallet.',
      'Stage lighter items in buffer zone while loading base tiers.',
    ],
    whatIfEligible: false,
    whatIfNotice: 'Dispatch manifest sequence violation — follow staging schedule; physical placement counterfactual not applicable.',
    proceduralNotice: 'Dispatch manifest sequence violation — follow staging schedule; physical placement counterfactual not applicable.',
  },
  solo_heavy_handling: {
    key: 'solo_heavy_handling',
    title: 'Heavy cargo lifted by single worker without assistance',
    lens: 'behaviour',
    defaultBand: 'High',
    whatIsHappening: 'Single worker attempting to lift or maneuver heavy package exceeding safe ergonomic limit.',
    whyItMatters: 'Musculoskeletal back injury and elevated probability of package drop during lift.',
    recommendedAction: 'Halt solo lift and request two-person team lift or mechanical equipment.',
    alternativeActions: [
      'Request assistance from adjacent aisle co-worker.',
      'Use forklift or scissor lift table to move heavy unit.',
    ],
    whatIfEligible: false,
    whatIfNotice: 'Ergonomic safety rule — solo lift prohibited for heavy cargo tiers.',
    proceduralNotice: 'Ergonomic safety rule — solo lift prohibited for heavy cargo tiers.',
  },
  wrong_equipment_usage: {
    key: 'wrong_equipment_usage',
    title: 'Unapproved handling equipment used for cargo',
    lens: 'conformance',
    defaultBand: 'High',
    whatIsHappening: 'Equipment used is not certified for this cargo classification or weight bracket.',
    whyItMatters: 'Mechanical overload, equipment tip-over, and catastrophic cargo drop.',
    recommendedAction: 'Halt equipment operation and switch to certified handling apparatus.',
    alternativeActions: [
      'Verify equipment load rating against package weight.',
      'Dispatch certified clamp truck or drum handler.',
    ],
    whatIfEligible: false,
    whatIfNotice: 'Equipment certification violation — dispatch certified apparatus; placement counterfactual not applicable.',
    proceduralNotice: 'Equipment certification violation — dispatch certified apparatus; placement counterfactual not applicable.',
  },
  unsupported_bending_placement: {
    key: 'unsupported_bending_placement',
    title: 'Unsupported carton overhang with structural bending',
    lens: 'structural',
    defaultBand: 'High',
    whatIsHappening: 'Overhanging carton section shows structural deflection and lack of bottom support.',
    whyItMatters: 'Creep deformation leads to carton tearing, seam burst, and sudden stack collapse.',
    recommendedAction: 'Provide full bottom support under the deflected carton immediately.',
    alternativeActions: [
      'Slide carton inward until overhang is completely eliminated.',
      'Insert support slip-sheet under deflected section.',
    ],
    whatIfEligible: true,
    whatIfCta: 'SIMULATE SUPPORTED PLACEMENT →',
  },
  max_stack_height_exceeded: {
    key: 'max_stack_height_exceeded',
    title: 'Stack height exceeds safe limit',
    lens: 'conformance',
    defaultBand: 'High',
    whatIsHappening: 'Cargo stack has exceeded the maximum permissible tier height.',
    whyItMatters: 'High center of gravity causes stack tipping and crushes bottom cartons.',
    recommendedAction: 'Remove top tier and start a new pallet stack.',
    alternativeActions: [
      'Split stack into two even pallets.',
      'Secure existing tiers with stretch wrap before moving.',
    ],
    whatIfEligible: true,
    whatIfCta: 'SIMULATE TIER SPLIT →',
  },
  box_displacement_near_person: {
    key: 'box_displacement_near_person',
    title: 'Moving cargo in close proximity to worker',
    lens: 'behaviour',
    defaultBand: 'Medium',
    whatIsHappening: 'Package displacement occurring in immediate perimeter of warehouse personnel.',
    whyItMatters: 'Pinch-point and crush hazard if cargo shifts or falls.',
    recommendedAction: 'Maintain 1.5 meter safe standoff distance while cargo is in motion.',
    alternativeActions: [
      'Signal worker to step clear of cargo trajectory.',
      'Halt movement until aisle is clear.',
    ],
    whatIfEligible: false,
    whatIfNotice: 'Worker proximity condition — maintain clearance perimeter.',
    proceduralNotice: 'Worker proximity condition — maintain clearance perimeter.',
  },
  person_box_sustained_proximity: {
    key: 'person_box_sustained_proximity',
    title: 'Worker in sustained close proximity to cargo',
    lens: 'behaviour',
    defaultBand: 'Low',
    whatIsHappening: 'Continuous proximity between worker and stationary cargo.',
    whyItMatters: 'Sustained presence in staging zone requires active spatial awareness.',
    recommendedAction: 'Maintain clear walking aisle and clear zone when handling operations finish.',
    alternativeActions: [
      'Verify designated pedestrian walkway markings.',
    ],
    whatIfEligible: false,
    whatIfNotice: 'Routine proximity tracking — nominal precaution.',
    proceduralNotice: 'Routine proximity tracking — nominal precaution.',
  },
  image_space_support_hypothesis: {
    key: 'image_space_support_hypothesis',
    title: 'Support alignment under review',
    lens: 'structural',
    defaultBand: 'Low',
    whatIsHappening: 'Camera evaluates support footprint alignment between adjacent stacked packages.',
    whyItMatters: 'Misaligned packages reduce stack stability over time.',
    recommendedAction: 'Align package boundaries with base support footprint.',
    alternativeActions: [
      'Check alignment before adding further layers.',
    ],
    whatIfEligible: true,
    whatIfCta: 'SIMULATE REALIGNED SUPPORT →',
  },
}

/**
 * Returns scenario configuration with robust fallback for unmapped scenarios.
 */
export function getScenarioConfig(scenarioKey) {
  if (!scenarioKey) {
    return {
      key: 'unknown',
      title: 'Observed Operational Condition',
      lens: 'operational',
      defaultBand: 'Medium',
      whatIsHappening: 'Visual sensors detected a notable operational condition.',
      whyItMatters: 'Operational deviations can degrade warehouse safety or process conformance.',
      recommendedAction: 'Inspect physical configuration before proceeding with workflow.',
      alternativeActions: ['Verify against warehouse standard operating procedures.'],
      whatIfEligible: false,
    }
  }

  const clean = scenarioKey.toLowerCase().trim()
  if (SCENARIO_REGISTRY[clean]) {
    return SCENARIO_REGISTRY[clean]
  }

  // Graceful humanization for unknown keys
  const humanTitle = clean
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

  return {
    key: clean,
    title: humanTitle,
    lens: 'operational',
    defaultBand: 'Medium',
    whatIsHappening: `Condition detected: ${humanTitle}.`,
    whyItMatters: 'Operational deviation flagged by computer vision inspection rules.',
    recommendedAction: 'Inspect affected cargo or zone to confirm safety clearance.',
    alternativeActions: ['Consult floor supervisor for handling protocol.'],
    whatIfEligible: false,
  }
}

/**
 * Resolves the definitive human-first title for an incident event.
 * Uses the planner recommendation's risk title if available, otherwise the scenario registry.
 */
export function resolveIncidentTitle(event) {
  if (!event) return 'Recorded Operational Hazard'
  if (event.planner_recommendation?.risk_title) {
    return event.planner_recommendation.risk_title
  }
  const config = getScenarioConfig(event.scenario)
  return config.title || 'Recorded Operational Hazard'
}

export const RISK_BAND_STYLES = {
  Critical: {
    label: 'CRITICAL RISK',
    badge: 'bg-red-600 text-white',
    subtle: 'border-red-400 bg-red-50 text-red-800',
    dot: 'bg-red-600',
  },
  High: {
    label: 'HIGH RISK',
    badge: 'bg-orange-600 text-white',
    subtle: 'border-orange-300 bg-orange-50 text-orange-800',
    dot: 'bg-orange-600',
  },
  Medium: {
    label: 'MEDIUM RISK',
    badge: 'bg-amber-600 text-white',
    subtle: 'border-amber-300 bg-amber-50 text-amber-800',
    dot: 'bg-amber-600',
  },
  Low: {
    label: 'LOW RISK',
    badge: 'bg-neutral-600 text-white',
    subtle: 'border-neutral-300 bg-neutral-50 text-neutral-700',
    dot: 'bg-neutral-500',
  },
}

export const STATUS_STYLES = {
  supported: {
    label: 'SUPPORTED FINDING',
    sublabel: 'Evidence meets confidence threshold',
    style: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    dot: 'bg-emerald-600',
  },
  probable: {
    label: 'PROBABLE FINDING',
    sublabel: 'Physical verification required',
    style: 'border-amber-300 bg-amber-50 text-amber-800',
    dot: 'bg-amber-500',
  },
  insufficient_evidence: {
    label: 'INSUFFICIENT EVIDENCE',
    sublabel: 'Observation under review',
    style: 'border-neutral-300 bg-neutral-100 text-neutral-600',
    dot: 'bg-neutral-400',
  },
  unsupported: {
    label: 'UNSUPPORTED SCENARIO',
    sublabel: 'Sensors cannot safely determine',
    style: 'border-neutral-300 bg-neutral-100 text-neutral-500',
    dot: 'bg-neutral-300',
  },
}

export const EPISTEMIC_LEVELS = {
  OBSERVED: {
    title: 'OBSERVED',
    desc: 'What the camera directly sees in visual frames.',
    badge: 'border-neutral-300 bg-neutral-100 text-neutral-800',
  },
  INFERRED: {
    title: 'INFERRED',
    desc: 'What TRACE calculates from visible spatial and temporal relationships.',
    badge: 'border-amber-300 bg-amber-50 text-amber-800',
  },
  PREDICTED: {
    title: 'PREDICTED',
    desc: 'What simulation estimates for alternative decisions.',
    badge: 'border-blue-300 bg-blue-50 text-blue-800',
  },
  VERIFIED: {
    title: 'VERIFIED',
    desc: 'What subsequent video frames confirm after intervention.',
    badge: 'border-emerald-400 bg-emerald-50 text-emerald-800',
  },
}

const EVIDENCE_KEY_LABELS = {
  overlap_ratio: 'Base Overlap',
  horizontal_overlap_ratio: 'Horizontal Deck Overlap',
  vertical_overlap_ratio: 'Vertical Overlap',
  vertical_gap: 'Vertical Gap',
  overhang_ratio: 'Overhang Fraction',
  support_ratio: 'Support Coverage',
  mass_ordering: 'Weight Distribution',
  mass_ratio: 'Mass Ratio',
  velocity_norm: 'Movement Speed',
  speed: 'Travel Speed',
  acceleration: 'Acceleration',
  duration_s: 'Duration Observed',
  displacement_px: 'Pixel Displacement',
  distance_to_edge: 'Distance to Edge',
  zone_type: 'Zone Classification',
  iou: 'Spatial IoU',
  angle_deg: 'Tilt Angle',
  tier_count: 'Stack Tier Count',
  sku_id: 'Product SKU',
  equipment_type: 'Equipment Type',
  step_count: 'Frame Occurrences',
}

export function formatEvidenceKey(key) {
  if (!key) return ''
  if (EVIDENCE_KEY_LABELS[key]) return EVIDENCE_KEY_LABELS[key]
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function formatEvidenceValue(key, value) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'

  if (typeof value === 'number') {
    const k = key.toLowerCase()
    if (k.includes('ratio') || k.includes('overlap') || k.includes('fraction') || k.includes('percent') || k.includes('coverage')) {
      return value <= 1 ? `${(value * 100).toFixed(1)}%` : `${value.toFixed(1)}%`
    }
    if (k.includes('distance') || k.includes('gap')) {
      return `${value.toFixed(2)}`
    }
    if (k.includes('speed') || k.includes('velocity')) {
      return `${value.toFixed(2)} /s`
    }
    if (k.includes('duration') || k.endsWith('_s')) {
      return `${value.toFixed(1)}s`
    }
    return Number.isInteger(value) ? `${value}` : `${value.toFixed(2)}`
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  return String(value)
}

/**
 * Canonical 7 operational challenge scenarios and their camera/zone mappings.
 * Replaces raw UUIDs and filenames in primary presentation with human-first context.
 */
export const CANONICAL_SCENARIO_VIDEOS = {
  '93e4b1963c6fcd97': {
    id: '93e4b1963c6fcd97',
    scenarioTitle: 'Dock Edge Fall & Dragging Hazard',
    cameraName: 'Dock Bay 4 — Inbound Transfer',
    scenarioKey: 'entity_in_dock_edge_zone',
    riskLevel: 'HIGH RISK',
    riskBand: 'High',
    duration: '31.0s',
    description: 'Cargo dragged near active dock edge transition without mechanical lifting.',
    primaryRisk: 'Personnel and cargo fall hazard from elevated loading dock threshold.',
    recommendedAction: 'Engage dock leveler safety barrier and transport cargo with pallet jack.',
    whatIfEligible: false,
    proceduralNotice: 'Perimeter safety violation — procedural retreat applies; physical repositioning not simulated.',
  },
  'd2984c4eb1cf6b86': {
    id: 'd2984c4eb1cf6b86',
    scenarioTitle: 'Heavy-on-Light Stacking & Floor Dragging',
    cameraName: 'Zone B — Pallet Assembly Deck',
    scenarioKey: 'heavy_on_light_stacking',
    riskLevel: 'HIGH RISK',
    riskBand: 'High',
    duration: '33.7s',
    description: 'Dense heavy crate placed atop lightweight KD flatpacks with manual floor dragging.',
    primaryRisk: 'Compressive crushing of lower packaging and stack destabilization during transit.',
    recommendedAction: 'Restack pallet tier with heaviest items placed directly on pallet base.',
    whatIfEligible: true,
    whatIfCta: 'SIMULATE INVERTED TIER ORDER →',
  },
  '734f165d61afafa0': {
    id: '734f165d61afafa0',
    scenarioTitle: 'Wet Floor Slip & Rolling Hazard',
    cameraName: 'Aisle 3 — Washdown Staging Area',
    scenarioKey: 'wet_floor_handling',
    riskLevel: 'HIGH RISK',
    riskBand: 'High',
    duration: '6.1s',
    description: 'Carton dragged and rolled end-over-end across active wet floor spill zone.',
    primaryRisk: 'High-probability worker slip/fall injury and carton moisture absorption weakening base.',
    recommendedAction: 'Deploy wet-floor warning cones and suspend manual cargo transit until dry.',
    whatIfEligible: false,
    proceduralNotice: 'Environmental surface hazard — deploy floor signage and redirect forklift traffic.',
  },
  'ac99ff34e1bd2c13': {
    id: 'ac99ff34e1bd2c13',
    scenarioTitle: 'Carton Overhang & Freefall Drop',
    cameraName: 'Staging Deck A — Sortation Bay',
    scenarioKey: 'box_overhang',
    riskLevel: 'HIGH RISK',
    riskBand: 'High',
    duration: '9.4s',
    description: 'Carton cantilevered over pallet perimeter edge followed by uncontrolled drop.',
    primaryRisk: 'Eccentric tipping moment causes cargo drop, inventory breakage, and foot crush hazard.',
    recommendedAction: 'Center carton onto pallet deck ensuring 100% base footprint contact.',
    whatIfEligible: true,
    whatIfCta: 'SIMULATE SAFER PLACEMENT →',
  },
  'f15ad7e2295d190b': {
    id: 'f15ad7e2295d190b',
    scenarioTitle: 'Carton Stepping & Orientation Violations',
    cameraName: 'Rack Bay 7 — High-Bay Storage',
    scenarioKey: 'stepping_on_carton',
    riskLevel: 'CRITICAL RISK',
    riskBand: 'Critical',
    duration: '49.0s',
    description: 'Worker standing directly on cargo carton with horizontal placement violating manifest.',
    primaryRisk: 'Carton panel puncture, internal product crushing, and fall from height.',
    recommendedAction: 'Worker step off carton immediately; use warehouse safety stepladder and orient carton upright.',
    whatIfEligible: true,
    whatIfCta: 'SIMULATE CORRECT ORIENTATION →',
  },
  '70063d8b35d1fa9a': {
    id: '70063d8b35d1fa9a',
    scenarioTitle: 'Bulk Cargo Drop & Impact Shock',
    cameraName: 'Loading Dock 2 — Outbound Staging',
    scenarioKey: 'dropping_or_throwing_precursor',
    riskLevel: 'HIGH RISK',
    riskBand: 'High',
    duration: '41.6s',
    description: 'Bulk mattress cargo dropped from height with sudden downward acceleration.',
    primaryRisk: 'Uncontrolled kinetic impact causes cargo seam burst and worker strike hazard.',
    recommendedAction: 'Lower bulk cargo using controlled two-person team lift or dock slide ramp.',
    whatIfEligible: false,
    proceduralNotice: 'Dynamic kinetic hazard — ergonomic team-lift procedure required.',
  },
  '44f245313615d3a1': {
    id: '44f245313615d3a1',
    scenarioTitle: 'Packaging Straps Used as Handles',
    cameraName: 'Bay 1 — Parcel Sortation',
    scenarioKey: 'straps_as_handles',
    riskLevel: 'HIGH RISK',
    riskBand: 'High',
    duration: '15.0s',
    description: 'Worker grasping exterior plastic strapping band to lift and throw seating cartons.',
    primaryRisk: 'Strap tensile failure causes sudden dropped cargo, impact damage, and hand laceration.',
    recommendedAction: 'Lift carton supporting the base deck; use team lift or hand truck for bulky parcels.',
    whatIfEligible: false,
    proceduralNotice: 'Handling technique hazard — lift under carton base, never tension plastic straps.',
  },
}

/**
 * Canonical 14 Operational Scenarios Catalog (ARCHITECTURE.md §9).
 * Contains definitive human-readable metadata, risk lens attribution,
 * video mapping, epistemic level, What-If eligibility, and transparent findings.
 */
export const CANONICAL_14_SCENARIOS = [
  {
    number: 1,
    key: 'heavy_on_light_stacking',
    title: 'Heavy-on-Light Stacking',
    lens: 'Structural',
    lensColor: 'sky',
    status: 'DEMONSTRATED',
    videoId: 'd2984c4eb1cf6b86',
    videoName: 'Zone B — Pallet Assembly Deck',
    videoTag: 'Video 02',
    timestamp: 14.0,
    presetId: 20,
    epistemicLevel: 'INFERRED',
    band: 'High',
    whatIfEligible: true,
    whatIfNotice: null,
    observed: 'Heavy overpack crate placed on top of lightweight KD flatpacks (burned-in challenge tag: "Heavy box kept on top of other packets").',
    inferred: 'Heavy cargo crate stacked atop lightweight KD flatpacks, violating mass-prior stacking hierarchy.',
    riskTitle: 'Inverse mass tiering (heavy carton over lighter base)',
    recommendedAction: 'Reorder stack with heavier cartons at base; do not place heavy loads on lighter packages.',
  },
  {
    number: 2,
    key: 'dropping_or_throwing_precursor',
    title: 'Throwing / Dropping',
    lens: 'Behaviour',
    lensColor: 'purple',
    status: 'DEMONSTRATED',
    videoId: '70063d8b35d1fa9a',
    videoName: 'Loading Dock 2 — Outbound Staging',
    videoTag: 'Video 06',
    secondaryVideo: 'Video 04 (Sortation Bay)',
    timestamp: 14.5,
    presetId: 139,
    epistemicLevel: 'INFERRED',
    band: 'High',
    whatIfEligible: false,
    whatIfNotice: 'Dynamic kinetic incident — procedural handling intervention required rather than static repositioning.',
    observed: 'Rapid downward velocity spike near worker (burned-in challenge tag: "Throwing mattresses on top of each other").',
    inferred: 'Freefall impact or high-velocity projectile release risking package destruction.',
    riskTitle: 'High-velocity carton descent / impact drop precursor',
    recommendedAction: 'Use controlled two-handed lowering technique; do not drop or toss cartons.',
  },
  {
    number: 3,
    key: 'dragging_precursor',
    title: 'Dragging Instead of Lifting',
    lens: 'Behaviour',
    lensColor: 'purple',
    status: 'DEMONSTRATED',
    videoId: '93e4b1963c6fcd97',
    videoName: 'Dock Bay 4 — Inbound Transfer',
    videoTag: 'Video 01',
    secondaryVideo: 'Video 02 & Video 03',
    timestamp: 27.5,
    presetId: 190,
    epistemicLevel: 'INFERRED',
    band: 'Medium',
    whatIfEligible: false,
    whatIfNotice: 'Ergonomic motion incident — use transport apparatus instead of floor dragging.',
    observed: 'Sustained horizontal translation along floor plane without lifting equipment (burned-in challenge tag: "Dragging" / "Improper Handling").',
    inferred: 'Continuous ground abrasion wearing carton base and weakening structural seal integrity.',
    riskTitle: 'Carton dragged horizontally across ground plane',
    recommendedAction: 'Use pallet jack or team lift; do not drag cartons across floor surfaces.',
  },
  {
    number: 4,
    key: 'rolling_precursor',
    title: 'Rolling Cartons / Cylindrical Cargo',
    lens: 'Behaviour',
    lensColor: 'purple',
    status: 'DEMONSTRATED',
    videoId: '734f165d61afafa0',
    videoName: 'Aisle 3 — Washdown Staging Area',
    videoTag: 'Video 03',
    secondaryVideo: 'Video 04 (Sortation Bay)',
    timestamp: 3.0,
    presetId: 98,
    epistemicLevel: 'OBSERVED',
    band: 'Medium',
    whatIfEligible: false,
    whatIfNotice: 'Orientation-critical handling incident — keep upright during transport.',
    observed: 'Worker rotating and rolling carton end-over-end along floor (burned-in challenge tag: "rolling carton").',
    inferred: 'Uncontrolled end-over-end rolling or tumbling across floor creating impact and roll hazards.',
    riskTitle: 'Uncontrolled cylindrical roll hazard across floor',
    recommendedAction: 'Maintain controlled physical hold of cylindrical or rotating packages; prevent roll hazard.',
  },
  {
    number: 5,
    key: 'straps_as_handles',
    title: 'Packaging Straps Used as Handles',
    lens: 'Behaviour',
    lensColor: 'purple',
    status: 'DEMONSTRATED',
    videoId: '44f245313615d3a1',
    videoName: 'Bay 1 — Parcel Sortation',
    videoTag: 'Video 07',
    timestamp: 8.5,
    presetId: 67,
    epistemicLevel: 'OBSERVED',
    band: 'High',
    whatIfEligible: false,
    whatIfNotice: 'Handling technique hazard — lift under carton base, never tension plastic straps.',
    observed: 'Worker pulling and handling cargo by exterior plastic strapping band (burned-in challenge tag: "Holding products using the strap").',
    inferred: 'Packaging straps are sub-pixel in 2D video; confirmed by visible challenge banner and worker hand grasp. Strap tension failure hazard.',
    riskTitle: 'Improper grip: lifting carton by exterior packaging straps',
    recommendedAction: 'Grip package body directly with two hands; never lift or carry items by packaging straps.',
  },
  {
    number: 6,
    key: 'stepping_on_carton',
    title: 'Stepping on Cartons',
    lens: 'Behaviour & Structural',
    lensColor: 'purple',
    status: 'DEMONSTRATED',
    videoId: 'f15ad7e2295d190b',
    videoName: 'Rack Bay 7 — High-Bay Storage',
    videoTag: 'Video 05',
    timestamp: 36.7,
    presetId: 34,
    epistemicLevel: 'INFERRED',
    band: 'Critical',
    whatIfEligible: false,
    whatIfNotice: 'Worker safety violation — procedural retreat applies; human motion is not simulated.',
    observed: 'Worker foot elevation vertically overlapping upper carton boundary across multiple continuous frames.',
    inferred: 'Worker body weight applied to carton surface causing structural collapse and severe fall from height.',
    riskTitle: 'Worker body weight applied to carton surface',
    recommendedAction: 'Step off cartons immediately; packaging structure may collapse under body weight.',
  },
  {
    number: 7,
    key: 'wrong_product_orientation',
    title: 'Wrong Product Orientation',
    lens: 'Conformance',
    lensColor: 'indigo',
    status: 'DEMONSTRATED',
    videoId: 'f15ad7e2295d190b',
    videoName: 'Rack Bay 7 — High-Bay Storage',
    videoTag: 'Video 05',
    timestamp: 4.0,
    presetId: 50,
    epistemicLevel: 'OBSERVED',
    band: 'Medium',
    whatIfEligible: true,
    whatIfNotice: null,
    observed: 'Product positioned horizontally on vehicle bed (burned-in challenge tag: "Vertical product kept horizontally") violating upright SKU manifest rule.',
    inferred: 'SKU manifest specifies vertical upright orientation; horizontal placement risks internal damage and seal failure.',
    riskTitle: 'Non-compliant package orientation against SKU manifest',
    recommendedAction: 'Rotate package to specified upright orientation before placement.',
  },
  {
    number: 8,
    key: 'pallet_overhang',
    title: 'Pallet Overhang',
    lens: 'Structural',
    lensColor: 'sky',
    status: 'DEMONSTRATED',
    videoId: 'ac99ff34e1bd2c13',
    videoName: 'Staging Deck A — Sortation Bay',
    videoTag: 'Video 04',
    timestamp: 3.0,
    presetId: 73,
    epistemicLevel: 'INFERRED',
    band: 'High',
    whatIfEligible: true,
    whatIfNotice: null,
    observed: 'Carton footprint extending past supporting perimeter (overlap ratio between 50% and 75%).',
    inferred: 'Cantilever base overhang creates eccentric loading, tipping instability, and vehicle collision risk.',
    riskTitle: 'Carton overhang beyond pallet perimeter deck',
    recommendedAction: 'Align carton with pallet boundaries; eliminate base overhang before adding upper tiers.',
  },
  {
    number: 9,
    key: 'entity_in_dock_edge_zone',
    title: 'Dock / Vehicle Gap',
    lens: 'Environmental',
    lensColor: 'emerald',
    status: 'DEMONSTRATED',
    videoId: '93e4b1963c6fcd97',
    videoName: 'Dock Bay 4 — Inbound Transfer',
    videoTag: 'Video 01',
    secondaryVideo: 'Video 02 & Video 05',
    timestamp: 16.0,
    presetId: 105,
    epistemicLevel: 'OBSERVED',
    band: 'High',
    whatIfEligible: false,
    whatIfNotice: 'Environmental safety perimeter breach — procedural retreat required immediately.',
    observed: 'Entity spatial coordinate intersection with calibrated dock ledge hazard polygon without physical protective barriers.',
    inferred: 'Severe personnel fall hazard to lower vehicle roadway (1.5x severity multiplier applied).',
    riskTitle: 'Fall hazard: entity positioned within dock ledge boundary',
    recommendedAction: 'Maintain safe clearance from dock edge; verify bridge plate is deployed.',
  },
  {
    number: 10,
    key: 'entity_in_wet_floor_zone',
    title: 'Wet-Floor Handling',
    lens: 'Environmental',
    lensColor: 'emerald',
    status: 'DEMONSTRATED',
    videoId: '734f165d61afafa0',
    videoName: 'Aisle 3 — Washdown Staging Area',
    videoTag: 'Video 03',
    timestamp: 1.5,
    presetId: 206,
    epistemicLevel: 'OBSERVED',
    band: 'Medium',
    whatIfEligible: false,
    whatIfNotice: 'Environmental slip zone — relocate operation to dry floor area.',
    observed: 'Entity spatial coordinate containment within calibrated wet floor hazard polygon.',
    inferred: 'Active floor slip hazard reducing traction and multiplying risk of dropped cargo (1.3x severity multiplier).',
    riskTitle: 'Slip/skid hazard: entity located within wet floor zone',
    recommendedAction: 'Exercise extreme caution on wet surface; report spill for cleanup before continuing.',
  },
  {
    number: 11,
    key: 'unplanned_loading_sequence',
    title: 'Improper / Unplanned Loading Sequence',
    lens: 'Conformance',
    lensColor: 'indigo',
    status: 'DEMONSTRATED',
    videoId: '93e4b1963c6fcd97',
    videoName: 'Dock Bay 4 — Inbound Transfer',
    videoTag: 'Video 01',
    secondaryVideo: 'Video 02 (Pallet Assembly Deck)',
    timestamp: 4.5,
    presetId: 204,
    epistemicLevel: 'INFERRED',
    band: 'Medium',
    whatIfEligible: false,
    whatIfNotice: 'Dispatch manifest sequence violation — follow staging schedule; physical placement counterfactual not applicable.',
    observed: 'Later sequence package (#2) placed beneath earlier sequence package (#1) in spatial tiering.',
    inferred: 'Out-of-order pallet staging creates destination re-handling and dynamic load shifting in transit.',
    riskTitle: 'Out-of-sequence pallet staging order',
    recommendedAction: 'Verify order of staging against operational dispatch manifest sequence.',
  },
  {
    number: 12,
    key: 'solo_heavy_handling',
    title: 'Solo Handling of Heavy Item',
    lens: 'Behaviour',
    lensColor: 'purple',
    status: 'DEMONSTRATED',
    videoId: 'd2984c4eb1cf6b86',
    videoName: 'Zone B — Pallet Assembly Deck',
    videoTag: 'Video 02',
    secondaryVideo: 'Video 01 (Dock Bay 4)',
    timestamp: 28.5,
    presetId: 197,
    epistemicLevel: 'INFERRED',
    band: 'High',
    whatIfEligible: false,
    whatIfNotice: 'Ergonomic safety rule — solo lift prohibited for heavy cargo tiers.',
    observed: 'Single worker tracking in sustained proximity during active translation of heavy mass-class cargo.',
    inferred: 'Exceeds single-person safe lifting threshold, elevating risk of spinal injury and dropped cargo.',
    riskTitle: 'Ergonomic lift hazard: heavy SKU handled by single worker',
    recommendedAction: 'Request team lift or use mechanical pallet jack for heavy items.',
  },
  {
    number: 13,
    key: 'wrong_equipment_usage',
    title: 'Wrong Equipment Usage',
    lens: 'Conformance',
    lensColor: 'indigo',
    status: 'DEMONSTRATED',
    videoId: 'd2984c4eb1cf6b86',
    videoName: 'Zone B — Pallet Assembly Deck',
    videoTag: 'Video 02',
    timestamp: 5.0,
    presetId: 205,
    epistemicLevel: 'OBSERVED',
    band: 'High',
    whatIfEligible: false,
    whatIfNotice: 'Equipment certification violation — dispatch certified apparatus; placement counterfactual not applicable.',
    observed: 'Wooden pallet dragged manually along floor and used as makeshift transport instead of trolley (burned-in challenge tag: "PALETTE IS USED INSTEAD OF TROLLEY").',
    inferred: 'Equipment class violation: pallet used in place of approved wheeled trolley or pallet truck.',
    riskTitle: 'Equipment mismatch: Pallet used instead of trolley',
    recommendedAction: 'Halt manual pallet dragging; use certified wheeled trolley or pallet truck for transport.',
    transparencyNote: 'Directly demonstrated in Video 02 footage at 00:05.0 with burned-in challenge annotation.',
  },
  {
    number: 14,
    key: 'unsupported_bending_placement',
    title: 'Unsupported / Bending Placement',
    lens: 'Structural',
    lensColor: 'sky',
    status: 'DEMONSTRATED',
    videoId: 'ac99ff34e1bd2c13',
    videoName: 'Staging Deck A — Sortation Bay',
    videoTag: 'Video 04',
    timestamp: 3.2,
    presetId: 140,
    epistemicLevel: 'INFERRED',
    band: 'High',
    whatIfEligible: true,
    whatIfNotice: null,
    observed: 'Severe cantilever overhang with horizontal support overlap ratio < 50%.',
    inferred: 'Span deflection and lack of foundation support risking carton tearing and sudden stack collapse.',
    riskTitle: 'Severe cantilever bending under package overhang',
    recommendedAction: 'Ensure at least 75% base support beneath item before releasing.',
  },
]

/**
 * 7 Canonical Video -> Multi-Scenario Interpretations Mapping.
 * Highlights that 1 video produces multiple independent operational safety findings.
 */
export const CANONICAL_VIDEO_MAPPINGS = [
  {
    videoId: '93e4b1963c6fcd97',
    tag: 'Video 01',
    cameraName: 'Dock Bay 4 — Inbound Transfer',
    duration: '31.0s',
    zone: 'Dock 09 Threshold',
    description: 'Active inbound transfer dock. Monitored for edge transition fall risks, floor-level carton friction, and single-operator lift hazards.',
    scenarios: [
      {
        number: 9,
        key: 'entity_in_dock_edge_zone',
        title: 'Dock / Vehicle Gap',
        lens: 'Environmental',
        lensColor: 'emerald',
        band: 'High',
        epistemicLevel: 'OBSERVED',
        timestamp: 16.0,
        presetId: 105,
        whatIfEligible: false,
        summary: 'Worker in unbarricaded dock-edge fall perimeter without safety bridge.',
        action: 'Maintain safe clearance from dock edge; verify bridge plate is deployed.',
      },
      {
        number: 3,
        key: 'dragging_precursor',
        title: 'Dragging Instead of Lifting',
        lens: 'Behaviour',
        lensColor: 'purple',
        band: 'Medium',
        epistemicLevel: 'INFERRED',
        timestamp: 27.5,
        presetId: 190,
        whatIfEligible: false,
        summary: 'Sustained ground translation of wooden cupboard carton without equipment.',
        action: 'Use pallet jack or team lift; do not drag cartons across floor surfaces.',
      },
      {
        number: 11,
        key: 'unplanned_loading_sequence',
        title: 'Improper / Unplanned Loading Sequence',
        lens: 'Conformance',
        lensColor: 'indigo',
        band: 'Medium',
        epistemicLevel: 'INFERRED',
        timestamp: 4.5,
        presetId: 204,
        whatIfEligible: false,
        summary: 'Cupboard staged before flatpacks, violating scheduled route loading sequence order.',
        action: 'Verify order of staging against operational dispatch manifest sequence.',
      },
    ],
  },
  {
    videoId: 'd2984c4eb1cf6b86',
    tag: 'Video 02',
    cameraName: 'Zone B — Pallet Assembly Deck',
    duration: '33.7s',
    zone: 'Dock 09 Inside',
    description: 'Pallet staging and assembly zone. Monitored for inverted load stacking, equipment compliance, and manual handling.',
    scenarios: [
      {
        number: 13,
        key: 'wrong_equipment_usage',
        title: 'Wrong Equipment Usage',
        lens: 'Conformance',
        lensColor: 'indigo',
        band: 'High',
        epistemicLevel: 'OBSERVED',
        timestamp: 5.0,
        presetId: 205,
        whatIfEligible: false,
        summary: 'Pallet used instead of trolley for cargo transport (burned-in tag: "PALETTE IS USED INSTEAD OF TROLLEY").',
        action: 'Halt manual pallet dragging; use certified wheeled trolley or pallet truck for transport.',
      },
      {
        number: 1,
        key: 'heavy_on_light_stacking',
        title: 'Heavy-on-Light Stacking',
        lens: 'Structural',
        lensColor: 'sky',
        band: 'High',
        epistemicLevel: 'INFERRED',
        timestamp: 14.0,
        presetId: 20,
        whatIfEligible: true,
        summary: 'Heavy overpack box stacked directly on lighter KD flatpack packets (burned-in tag: "Heavy box kept on top of other packets").',
        action: 'Reorder stack with heavier cartons at base; do not place heavy loads on lighter packages.',
      },
      {
        number: 12,
        key: 'solo_heavy_handling',
        title: 'Solo Handling of Heavy Item',
        lens: 'Behaviour',
        lensColor: 'purple',
        band: 'High',
        epistemicLevel: 'INFERRED',
        timestamp: 28.5,
        presetId: 197,
        whatIfEligible: false,
        summary: 'Single worker maneuvering heavy mass-class cargo crate without team lift assistance.',
        action: 'Request team lift or use mechanical pallet jack for heavy items.',
      },
    ],
  },
  {
    videoId: '734f165d61afafa0',
    tag: 'Video 03',
    cameraName: 'Aisle 3 — Washdown Staging Area',
    duration: '6.1s',
    zone: 'Dock 08 Washdown',
    description: 'Active wet floor maintenance aisle. Monitored for surface traction hazards, end-over-end rolling of cargo, and ground dragging.',
    scenarios: [
      {
        number: 10,
        key: 'entity_in_wet_floor_zone',
        title: 'Wet-Floor Handling',
        lens: 'Environmental',
        lensColor: 'emerald',
        band: 'Medium',
        epistemicLevel: 'OBSERVED',
        timestamp: 1.5,
        presetId: 206,
        whatIfEligible: false,
        summary: 'Carton and worker positioned inside active wet floor washdown hazard zone (burned-in tag: "wet floor").',
        action: 'Exercise extreme caution on wet surface; report spill for cleanup before continuing.',
      },
      {
        number: 4,
        key: 'rolling_precursor',
        title: 'Rolling Cartons / Cylindrical Cargo',
        lens: 'Behaviour',
        lensColor: 'purple',
        band: 'Medium',
        epistemicLevel: 'OBSERVED',
        timestamp: 3.0,
        presetId: 98,
        whatIfEligible: false,
        summary: 'Worker rotating and rolling carton end-over-end along floor (burned-in tag: "rolling carton").',
        action: 'Maintain controlled physical hold of cylindrical or rotating packages; prevent roll hazard.',
      },
    ],
  },
  {
    videoId: 'ac99ff34e1bd2c13',
    tag: 'Video 04',
    cameraName: 'Staging Deck A — Sortation Bay',
    duration: '9.4s',
    zone: 'Dock 08 Inside',
    description: 'High-speed parcel sortation deck. Monitored for pallet deck overhangs, severe cantilever bending, and kinetic impact drops.',
    scenarios: [
      {
        number: 8,
        key: 'pallet_overhang',
        title: 'Pallet Overhang',
        lens: 'Structural',
        lensColor: 'sky',
        band: 'High',
        epistemicLevel: 'INFERRED',
        timestamp: 3.0,
        presetId: 73,
        whatIfEligible: true,
        summary: 'Carton base overhanging pallet deck boundary by 46.1%.',
        action: 'Align carton with pallet boundaries; eliminate base overhang before adding upper tiers.',
      },
      {
        number: 14,
        key: 'unsupported_bending_placement',
        title: 'Unsupported / Bending Placement',
        lens: 'Structural',
        lensColor: 'sky',
        band: 'High',
        epistemicLevel: 'INFERRED',
        timestamp: 3.2,
        presetId: 140,
        whatIfEligible: true,
        summary: 'Severe cantilever overhang (<50% base support) creating bending failure risk.',
        action: 'Ensure at least 75% base support beneath item before releasing.',
      },
    ],
  },
  {
    videoId: 'f15ad7e2295d190b',
    tag: 'Video 05',
    cameraName: 'Rack Bay 7 — High-Bay Storage',
    duration: '49.0s',
    zone: 'Dock 10 Outbound',
    description: 'High-bay rack storage area. Monitored for human weight-bearing on packaging and manifest orientation non-conformance.',
    scenarios: [
      {
        number: 7,
        key: 'wrong_product_orientation',
        title: 'Wrong Product Orientation',
        lens: 'Conformance',
        lensColor: 'indigo',
        band: 'Medium',
        epistemicLevel: 'OBSERVED',
        timestamp: 4.0,
        presetId: 50,
        whatIfEligible: true,
        summary: 'Product placed horizontally on vehicle bed (burned-in tag: "Vertical product kept horizontally").',
        action: 'Rotate package to specified upright orientation before placement.',
      },
      {
        number: 6,
        key: 'stepping_on_carton',
        title: 'Stepping on Cartons',
        lens: 'Behaviour & Structural',
        lensColor: 'purple',
        band: 'Critical',
        epistemicLevel: 'INFERRED',
        timestamp: 36.7,
        presetId: 34,
        whatIfEligible: false,
        summary: 'Worker standing directly on cargo carton upper boundary to access overhead rack (also tagged at 12.0s).',
        action: 'Step off cartons immediately; packaging structure may collapse under body weight.',
      },
    ],
  },
  {
    videoId: '70063d8b35d1fa9a',
    tag: 'Video 06',
    cameraName: 'Loading Dock 2 — Outbound Staging',
    duration: '41.6s',
    zone: 'Dock 06 Outbound',
    description: 'Bulk cargo outbound dispatch bay. Monitored for bulk throwing, drop impacts, and unassisted manual drops.',
    scenarios: [
      {
        number: 2,
        key: 'dropping_or_throwing_precursor',
        title: 'Throwing / Dropping',
        lens: 'Behaviour',
        lensColor: 'purple',
        band: 'High',
        epistemicLevel: 'INFERRED',
        timestamp: 14.5,
        presetId: 139,
        whatIfEligible: false,
        summary: 'Bulk mattress cargo thrown and dropped from elevated position (burned-in tag: "Throwing mattresses on top of each other").',
        action: 'Lower bulk cargo using controlled two-person team lift or dock slide ramp.',
      },
    ],
  },
  {
    videoId: '44f245313615d3a1',
    tag: 'Video 07',
    cameraName: 'Bay 1 — Parcel Sortation',
    duration: '15.0s',
    zone: 'Dock 06 Sortation',
    description: 'Parcel sorting station. Monitored for non-compliant manual handling technique and packaging strap tension usage.',
    scenarios: [
      {
        number: 5,
        key: 'straps_as_handles',
        title: 'Packaging Straps Used as Handles',
        lens: 'Behaviour',
        lensColor: 'purple',
        band: 'High',
        epistemicLevel: 'OBSERVED',
        timestamp: 8.5,
        presetId: 67,
        whatIfEligible: false,
        summary: 'Worker pulling cargo by exterior plastic straps (burned-in tag: "Holding products using the strap").',
        action: 'Grip package body directly with two hands; never lift or carry items by packaging straps.',
      },
    ],
  },
]

/**
 * Returns clean human-readable scenario metadata for any video ID or filename.
 */
export function getVideoScenarioInfo(videoIdOrFilename) {
  if (!videoIdOrFilename) {
    return {
      scenarioTitle: 'Warehouse Material Handling Inspection',
      cameraName: 'Optical Inspection Bay',
      scenarioKey: 'general_handling',
      riskLevel: 'MEDIUM RISK',
      riskBand: 'Medium',
      duration: '00:00',
      description: 'Continuous optical monitoring of warehouse pallet handling and staging.',
      primaryRisk: 'Material handling compliance and ergonomic review.',
      recommendedAction: 'Verify cargo placement matches warehouse handling standards.',
    }
  }

  for (const [id, info] of Object.entries(CANONICAL_SCENARIO_VIDEOS)) {
    if (videoIdOrFilename === id || videoIdOrFilename.includes(id)) {
      return info
    }
  }

  const str = String(videoIdOrFilename).toLowerCase()
  if (str.includes('dock') || str.includes('cupboard')) return CANONICAL_SCENARIO_VIDEOS['93e4b1963c6fcd97']
  if (str.includes('kd') || str.includes('heavy box')) return CANONICAL_SCENARIO_VIDEOS['d2984c4eb1cf6b86']
  if (str.includes('wet')) return CANONICAL_SCENARIO_VIDEOS['734f165d61afafa0']
  if (str.includes('dropping carton') || str.includes('rolling and dropping')) return CANONICAL_SCENARIO_VIDEOS['ac99ff34e1bd2c13']
  if (str.includes('stepping') || str.includes('vertical product')) return CANONICAL_SCENARIO_VIDEOS['f15ad7e2295d190b']
  if (str.includes('mattress')) return CANONICAL_SCENARIO_VIDEOS['70063d8b35d1fa9a']
  if (str.includes('seating') || str.includes('strap')) return CANONICAL_SCENARIO_VIDEOS['44f245313615d3a1']

  return {
    scenarioTitle: 'Optical Cargo Inspection',
    cameraName: 'Warehouse Sensor Feed',
    scenarioKey: 'general_handling',
    riskLevel: 'LOW RISK',
    riskBand: 'Low',
    duration: '00:00',
    description: 'Active optical monitoring stream.',
    primaryRisk: 'Operational compliance review.',
    recommendedAction: 'Maintain standard warehouse material handling protocol.',
  }
}

/**
 * Generates 2-3 clean decision-support intervention options for What-If simulation.
 */
export function getSimplifiedInterventions(scenarioKey, current, alternatives = []) {
  const clean = (scenarioKey || '').toLowerCase()
  const isHeavyOnLight = clean.includes('heavy_on_light')
  const isOrientation = clean.includes('orientation')
  const currentScore = current?.stability_score ? Math.round(current.stability_score) : 40
  const candidateA = alternatives[0]
  const candidateB = alternatives[1]
  const scoreA = candidateA?.score ? Math.round(candidateA.score) : Math.min(95, currentScore + 46)
  const scoreB = candidateB?.score ? Math.round(candidateB.score) : Math.min(88, currentScore + 35)

  if (isHeavyOnLight) {
    return [
      {
        id: candidateA?.id || 'opt-a',
        optionLabel: 'Option A: Recommended Action',
        badge: 'RECOMMENDED INTERVENTION',
        badgeStyle: 'bg-emerald-600 text-white',
        title: 'Invert Tier Order: Heavy Base Deck',
        predictedRisk: 'LOW RISK',
        predictedRiskStyle: 'text-emerald-700 bg-emerald-50 border-emerald-300',
        score: scoreA,
        scoreDelta: scoreA - currentScore,
        whySafer: 'Relocates heaviest items to base pallet foundation. Completely eliminates compressive crushing pressure on lower cartons and stabilizes center of gravity.',
        cta: 'Apply Recommended Placement',
        candidate: candidateA,
      },
      {
        id: candidateB?.id || 'opt-b',
        optionLabel: 'Option B: Alternative Staging',
        badge: 'ALTERNATIVE ACTION',
        badgeStyle: 'bg-blue-600 text-white',
        title: 'Stage Upper Cargo to Adjacent Pallet',
        predictedRisk: 'LOW RISK',
        predictedRiskStyle: 'text-blue-700 bg-blue-50 border-blue-300',
        score: scoreB,
        scoreDelta: scoreB - currentScore,
        whySafer: 'Separates heavy cargo into dedicated single-tier staging deck, removing multi-tier stack risk entirely.',
        cta: 'Simulate Staging Option',
        candidate: candidateB,
      },
      {
        id: 'opt-c-do-nothing',
        optionLabel: 'Option C: Do Nothing',
        badge: 'STATUS QUO',
        badgeStyle: 'bg-red-600 text-white',
        title: 'Maintain Current Inverted Stack',
        predictedRisk: 'HIGH RISK',
        predictedRiskStyle: 'text-red-700 bg-red-50 border-red-300',
        score: currentScore,
        scoreDelta: 0,
        whySafer: 'No intervention. Lower packaging remains under compressive load, with high probability of collapse during transport.',
        cta: 'Simulate Failure Risk',
        candidate: null,
      },
    ]
  }

  if (isOrientation) {
    return [
      {
        id: candidateA?.id || 'opt-a',
        optionLabel: 'Option A: Recommended Action',
        badge: 'RECOMMENDED INTERVENTION',
        badgeStyle: 'bg-emerald-600 text-white',
        title: 'Rotate Upright ("This Side Up")',
        predictedRisk: 'LOW RISK',
        predictedRiskStyle: 'text-emerald-700 bg-emerald-50 border-emerald-300',
        score: scoreA,
        scoreDelta: scoreA - currentScore,
        whySafer: 'Rotates carton 90° into upright alignment matching SKU manifest specifications. Protects internal liquids from seal leaks and engages vertical corrugation strength.',
        cta: 'Apply Conforming Orientation',
        candidate: candidateA,
      },
      {
        id: candidateB?.id || 'opt-b',
        optionLabel: 'Option B: Alternative Staging',
        badge: 'ALTERNATIVE ACTION',
        badgeStyle: 'bg-blue-600 text-white',
        title: 'Restack on Dedicated Staging Deck',
        predictedRisk: 'LOW RISK',
        predictedRiskStyle: 'text-blue-700 bg-blue-50 border-blue-300',
        score: scoreB,
        scoreDelta: scoreB - currentScore,
        whySafer: 'Stages item upright on flat buffer deck before loading into high-bay storage racks.',
        cta: 'Simulate Staging Option',
        candidate: candidateB,
      },
      {
        id: 'opt-c-do-nothing',
        optionLabel: 'Option C: Do Nothing',
        badge: 'STATUS QUO',
        badgeStyle: 'bg-red-600 text-white',
        title: 'Maintain Non-Conforming Placement',
        predictedRisk: 'HIGH RISK',
        predictedRiskStyle: 'text-red-700 bg-red-50 border-red-300',
        score: currentScore,
        scoreDelta: 0,
        whySafer: 'No intervention. Violates carrier compliance rules; lateral seam load risks carton rupture during transport.',
        cta: 'Simulate Failure Risk',
        candidate: null,
      },
    ]
  }

  // Default: Box overhang / Cantilever placement
  return [
    {
      id: candidateA?.id || 'opt-a',
      optionLabel: 'Option A: Recommended Action',
      badge: 'RECOMMENDED INTERVENTION',
      badgeStyle: 'bg-emerald-600 text-white',
      title: 'Center Carton on Base Deck',
      predictedRisk: 'LOW RISK',
      predictedRiskStyle: 'text-emerald-700 bg-emerald-50 border-emerald-300',
      score: scoreA,
      scoreDelta: scoreA - currentScore,
      whySafer: 'Shifts carton inward to achieve 100% base footprint contact. Eliminates cantilever edge overhang and aligns center of gravity over support deck.',
      cta: 'Apply Recommended Placement',
      candidate: candidateA,
    },
    {
      id: candidateB?.id || 'opt-b',
      optionLabel: 'Option B: Alternative Placement',
      badge: 'ALTERNATIVE ACTION',
      badgeStyle: 'bg-blue-600 text-white',
      title: 'Interlock with Adjacent Pallet Tier',
      predictedRisk: 'LOW RISK',
      predictedRiskStyle: 'text-blue-700 bg-blue-50 border-blue-300',
      score: scoreB,
      scoreDelta: scoreB - currentScore,
      whySafer: 'Bridges support across two adjacent cartons, reducing single-point edge overhang while maintaining loading throughput.',
      cta: 'Simulate Staging Option',
      candidate: candidateB,
    },
    {
      id: 'opt-c-do-nothing',
      optionLabel: 'Option C: Do Nothing',
      badge: 'STATUS QUO',
      badgeStyle: 'bg-red-600 text-white',
      title: 'Maintain Cantilever Overhang',
      predictedRisk: 'HIGH RISK',
      predictedRiskStyle: 'text-red-700 bg-red-50 border-red-300',
      score: currentScore,
      scoreDelta: 0,
      whySafer: 'No intervention. 46% cantilever overhang remains unmitigated with high risk of tipping during pallet movement.',
      cta: 'Simulate Failure Risk',
      candidate: null,
    },
  ]
}

/**
 * Calibrated Demo Presets grounded directly in TRACE's real database records.
 * Timestamps match the exact physical event moments across the 7 distinct canonical videos.
 */
export const DEMO_PRESETS = [
  {
    id: 73,
    videoId: 'ac99ff34e1bd2c13',
    timestamp: 3.0,
    tag: 'Demo 1: Cargo Overhang',
    scenario: 'box_overhang',
    desc: 'Cantilever overhang. Demonstrates What-If alternative simulation with +46.1 stability gain.',
    icon: '📦',
    whatIfCta: 'SIMULATE SAFER PLACEMENT →',
    verified: false,
  },
  {
    id: 75,
    videoId: 'ac99ff34e1bd2c13',
    timestamp: 3.0,
    tag: 'Demo 2: Verified Prevention',
    scenario: 'box_overhang',
    desc: 'Stacking incident with verified intervention. Demonstrates full 3-condition PREVENTED verification in subsequent video.',
    icon: '🛡️',
    whatIfCta: 'SIMULATE SAFER PLACEMENT →',
    verified: true,
  },
  {
    id: 105,
    videoId: '93e4b1963c6fcd97',
    timestamp: 16.0,
    tag: 'Demo 3: Dock Edge Hazard',
    scenario: 'entity_in_dock_edge_zone',
    desc: 'Personnel safety zone incident. Demonstrates urgent Safe Action and why worker movements are not simulated.',
    icon: '⚠️',
    whatIfCta: null,
    proceduralNotice: 'Worker safety perimeter incident — procedural retreat applies; worker motion is not simulated.',
    verified: false,
  },
  {
    id: 20,
    videoId: 'd2984c4eb1cf6b86',
    timestamp: 14.0,
    tag: 'Demo 4: Heavy-on-Light Stacking',
    scenario: 'heavy_on_light_stacking',
    desc: 'Dense crate stacked on light KD packets. Demonstrates inverted tier simulation.',
    icon: '⚖️',
    whatIfCta: 'SIMULATE INVERTED TIER ORDER →',
    verified: false,
  },
  {
    id: 34,
    videoId: 'f15ad7e2295d190b',
    timestamp: 36.7,
    tag: 'Demo 5: Stepping on Carton',
    scenario: 'stepping_on_carton',
    desc: 'Worker standing directly on cargo. Demonstrates immediate ergonomic and fall hazard warning.',
    icon: '🚷',
    whatIfCta: null,
    proceduralNotice: 'Worker safety violation — step off cargo immediately and use certified climbing steps.',
    verified: false,
  },
  {
    id: 67,
    videoId: '44f245313615d3a1',
    timestamp: 8.5,
    tag: 'Demo 6: Straps Used as Handles',
    scenario: 'straps_as_handles',
    desc: 'Banding straps grasped as handles. Demonstrates handling technique hazard warning.',
    icon: '🎗️',
    whatIfCta: null,
    proceduralNotice: 'Handling technique hazard — lift under carton base, never tension plastic straps.',
    verified: false,
  },
]

export function formatTimestamp(seconds) {
  if (typeof seconds !== 'number' || isNaN(seconds)) return '00:00.0'
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1)
  return `${String(m).padStart(2, '0')}:${s.padStart(4, '0')}`
}

export function formatTimestampContext(seconds, windowBefore = 3.0, windowAfter = 3.0) {
  if (typeof seconds !== 'number' || isNaN(seconds)) {
    return {
      formatted: '00:00.0',
      numeric: '0.0s',
      contextText: 'INCIDENT DETECTED: 00:00.0 (0.0s)',
      evidenceWindow: 'Evidence Window: 0.0s — 6.0s',
      startSec: 0,
      endSec: 6.0,
    }
  }
  const formatted = formatTimestamp(seconds)
  const startSec = Math.max(0, seconds - windowBefore)
  const endSec = seconds + windowAfter
  return {
    formatted,
    numeric: `${seconds.toFixed(1)}s`,
    contextText: `INCIDENT DETECTED: ${formatted} (${seconds.toFixed(1)}s)`,
    evidenceWindow: `Evidence Window: ${startSec.toFixed(1)}s — ${endSec.toFixed(1)}s`,
    startSec,
    endSec,
  }
}

export function getPhysicalStackComparison(scenarioKey, current, proposed) {
  const clean = (scenarioKey || '').toLowerCase()
  const isHeavyOnLight = clean.includes('heavy_on_light')
  const isOrientation = clean.includes('orientation')

  if (isHeavyOnLight) {
    return {
      current: {
        top: { label: 'Heavy Cargo Package', status: 'Misplaced Upper Tier', color: 'border-red-300 bg-red-50 text-red-900' },
        arrow: '↓ High compressive crushing pressure',
        bottom: { label: 'Lighter Base Carton', status: 'Crush Hazard Under Load', color: 'border-amber-300 bg-amber-50 text-amber-900' },
        riskBadge: 'HIGH CRUSH RISK',
        riskBadgeStyle: 'bg-red-600 text-white',
      },
      proposed: {
        top: { label: 'Lighter Cargo Package', status: 'Safe Upper Tier', color: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
        arrow: '↓ Stable downward mass distribution',
        bottom: { label: 'Heavy Base Foundation', status: 'Solid Base Support Deck', color: 'border-blue-300 bg-blue-50 text-blue-900' },
        riskBadge: 'BALANCED FOUNDATION',
        riskBadgeStyle: 'bg-emerald-600 text-white',
      },
      claims: [
        'Heaviest tier repositioned to base pallet foundation',
        'Compressive crushing hazard on lower package eliminated',
        'Stack center of gravity lowered for transit stability',
      ],
    }
  }

  if (isOrientation) {
    return {
      current: {
        top: { label: 'Package Horizontal / Inverted', status: 'Violates This-Side-Up Rule', color: 'border-red-300 bg-red-50 text-red-900' },
        arrow: '↓ Lateral seam stress & internal shifting',
        bottom: { label: 'Supporting Deck', status: 'Uneven Surface Contact', color: 'border-neutral-300 bg-neutral-100 text-neutral-800' },
        riskBadge: 'RULE VIOLATION',
        riskBadgeStyle: 'bg-red-600 text-white',
      },
      proposed: {
        top: { label: 'Package Upright ("This Side Up")', status: 'Conforming Label Orientation', color: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
        arrow: '↓ Vertical column compression aligned',
        bottom: { label: 'Supporting Deck', status: 'Even Footprint Distribution', color: 'border-blue-300 bg-blue-50 text-blue-900' },
        riskBadge: 'CONFORMING PLACEMENT',
        riskBadgeStyle: 'bg-emerald-600 text-white',
      },
      claims: [
        'Upright orientation verified against SKU manifest',
        'Liquid seal leakage risk eliminated',
        'Vertical corrugation strength fully utilized',
      ],
    }
  }

  // Default: Box overhang / Stacking support
  const overhangPct = current?.breakdown?.overhang_penalty || 40
  const supportPct = current?.breakdown?.support_alignment || 35
  const propSupportPct = proposed?.score_breakdown?.support_alignment || 95

  return {
    current: {
      top: { label: 'Upper Carton', status: `Cantilever Overhang (${Math.round(overhangPct)}% off base)`, color: 'border-red-300 bg-red-50 text-red-900' },
      arrow: '↓ Eccentric tipping load',
      bottom: { label: 'Weak Deck Support', status: `Only ${Math.round(supportPct)}% Base Contact`, color: 'border-amber-300 bg-amber-50 text-amber-900' },
      riskBadge: 'HIGH TIPPING RISK',
      riskBadgeStyle: 'bg-red-600 text-white',
    },
    proposed: {
      top: { label: 'Upper Carton', status: 'Centered Support Footprint', color: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
      arrow: '↓ Symmetrical downward load',
      bottom: { label: 'Full Base Support', status: `${Math.round(propSupportPct)}% Foundation Coverage`, color: 'border-blue-300 bg-blue-50 text-blue-900' },
      riskBadge: 'STABLE FOUNDATION',
      riskBadgeStyle: 'bg-emerald-600 text-white',
    },
    claims: [
      'Base support coverage improved to full foundation',
      'Cantilever overhang penalty completely eliminated',
      'Center of gravity restored to supporting centerline',
    ],
  }
}
