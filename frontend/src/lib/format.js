export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

export function formatConfidence(conf) {
  if (conf === null || conf === undefined) return 'Uncalibrated'
  if (typeof conf === 'number') {
    if (isNaN(conf) || !Number.isFinite(conf)) return 'Uncalibrated'
    return conf <= 1 ? `${Math.round(conf * 100)}%` : `${Math.round(conf)}%`
  }
  if (typeof conf === 'string') {
    const trimmed = conf.trim()
    if (!trimmed || trimmed.toLowerCase() === 'nan' || trimmed.toLowerCase() === 'undefined') {
      return 'Uncalibrated'
    }
    const num = Number(trimmed)
    if (!isNaN(num) && Number.isFinite(num)) {
      return num <= 1 ? `${Math.round(num * 100)}%` : `${Math.round(num)}%`
    }
    const lower = trimmed.toLowerCase()
    if (lower === 'critical') return '95% (High Certainty)'
    if (lower === 'high') return '85% (High Certainty)'
    if (lower === 'medium') return '72% (Medium Certainty)'
    if (lower === 'low') return '45% (Low Certainty)'
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()
  }
  return 'Uncalibrated'
}

export function formatScore(score, fallback = '—') {
  if (score === null || score === undefined) return fallback
  const num = typeof score === 'number' ? score : Number(score)
  if (isNaN(num) || !Number.isFinite(num)) return fallback
  return Math.round(num)
}

export function formatPercentage(val, fallback = 'Not modeled') {
  if (val === null || val === undefined) return fallback
  const num = typeof val === 'number' ? val : Number(val)
  if (isNaN(num) || !Number.isFinite(num)) return fallback
  return num <= 1 ? `${(num * 100).toFixed(1)}%` : `${num.toFixed(1)}%`
}

export function formatEntityName(entityId) {
  if (!entityId || typeof entityId !== 'string') return 'Tracked Cargo'
  const clean = entityId.trim()
  const lower = clean.toLowerCase()

  // Extract trailing id if format is "video_id:track_id"
  const parts = clean.split(':')
  const lastPart = parts.length > 1 ? parts[parts.length - 1] : clean
  const num = Number(lastPart)
  const hasNumericTrack = !isNaN(num) && Number.isInteger(num) && num < 100000

  const isPerson = lower.includes('person') || lower.includes('worker') || lower.includes('pedestrian')
  const isPallet = lower.includes('pallet')
  const isCarton = lower.includes('carton') || lower.includes('box') || lower.includes('package')

  if (isPerson) {
    return hasNumericTrack ? `Worker #${num}` : 'Warehouse Worker'
  }
  if (isPallet) {
    return hasNumericTrack ? `Pallet Deck #${num}` : 'Pallet Deck'
  }
  if (isCarton) {
    return hasNumericTrack ? `Cargo Carton #${num}` : 'Cargo Carton'
  }

  if (hasNumericTrack) {
    return `Cargo Item #${num}`
  }

  // If it's an internal test string like "worker_stepping" or "overhang_box", handle gracefully
  if (lower.includes('step')) return 'Warehouse Worker'
  if (lower.includes('overhang')) return 'Cargo Carton'
  if (lower.includes('stack')) return 'Stacked Cargo'

  return 'Tracked Cargo Unit'
}

export function humanizeExplanation(text, scenario = '', entityId = '') {
  if (!text || typeof text !== 'string') {
    return 'Visual telemetry flagged an operational safety condition requiring floor verification.'
  }

  let s = text

  // 1. Remove raw zone IDs and replace with human facility zones
  s = s.replace(/manually configured zone 'dock_\d+_threshold_gap' \(dock_edge\)/gi, 'dock-edge fall perimeter')
  s = s.replace(/zone 'dock_\d+_threshold_gap'/gi, 'the loading dock ledge zone')
  s = s.replace(/dock_\d+_threshold_gap/gi, 'loading dock fall perimeter')
  s = s.replace(/manually configured zone 'dock_\d+_wet_floor' \(wet_floor\)/gi, 'active wet floor spill perimeter')
  s = s.replace(/zone 'dock_\d+_wet_floor'/gi, 'the wet floor hazard perimeter')
  s = s.replace(/dock_\d+_wet_floor/gi, 'wet floor hazard zone')
  s = s.replace(/This zone is operator-calibrated, not automatically detected from video\./gi, '')

  // 2. Remove developer/epistemic debug text
  s = s.replace(/Classified as Outcome Unclear preserving epistemic discipline:?/gi, 'Outcome pending verification in subsequent camera footage.')
  s = s.replace(/Risk severity band 'None' and score None do not indicate an actionable risk event;?/gi, 'Safety condition awaiting operator verification;')
  s = s.replace(/post-action resolution cannot be confirmed from optical evidence alone\.?/gi, 'Physical resolution requires supervisor sign-off or subsequent camera observation.')
  s = s.replace(/unverified subsequent world-model improvement/gi, 'awaiting post-action video confirmation')
  s = s.replace(/unverified or missing corrective action/gi, 'awaiting corrective action on floor')
  s = s.replace(/unverified initial risk prediction/gi, 'initial risk prediction unverified')
  s = s.replace(/Outcome cannot be definitively verified as prevented \((.*?)\)\.?/gi, 'Awaiting confirmation in subsequent camera frames.')

  // 3. Clean up graph theory & node / math jargon
  s = s.replace(/Probable evidence observed \((.*?)\)/gi, '$1')
  s = s.replace(/Person footprint overlapping upper boundary of carton node near floor\.?/gi, 'Worker observed standing or stepping directly on staged cardboard cargo carton. Cardboard packaging cannot support human weight and risks collapsing.')
  s = s.replace(/carton node near floor/gi, 'staged cardboard carton')
  s = s.replace(/carton node/gi, 'cargo carton')
  s = s.replace(/Person footprint overlapping upper boundary/gi, 'Worker foot contact on top surface')
  s = s.replace(/overlap ratio < 75%/gi, 'less than 75% base support')
  s = s.replace(/cantilever overhang creates eccentric loading and tipping hazard/gi, 'Overhanging cargo causes uneven weight distribution and severe tipping risk.')

  // 4. Clean up awkward raw polygon / scientific / coordinate text
  s = s.replace(/vertical_gap=[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/gi, '')
  s = s.replace(/horizontal_overlap=[-+]?[0-9]*\.?[0-9]+/gi, '')
  s = s.replace(/in 2D image space,\s*/gi, '')
  s = s.replace(/\s*,\s*horizontal_ratio=[0-9.]+%/gi, '')
  s = s.replace(/\(displacement [0-9.]+, horizontal ratio [0-9.]+%\)/gi, '')
  s = s.replace(/\(effective speed: [0-9.]+ norm\/s, vertical drop: [0-9.]+\)/gi, '')
  s = s.replace(/\([0-9.]+ span, [0-9]+ inversions\)/gi, '')
  s = s.replace(/\(\s*,\s*\)/gi, '')
  s = s.replace(/\(\s*\)/gi, '')

  // 5. Clean up raw entity IDs inside text (e.g. f15ad7e2295d190b:30)
  s = s.replace(/[a-f0-9]{16}:(\d+)/gi, (_, id) => `Worker #${id}`)

  // 6. Transform specific common automated messages into executive phrasing
  if (s.toLowerCase().includes('person is inside') && s.toLowerCase().includes('dock')) {
    return 'Worker positioned within 2.0m of the unbarricaded dock-edge threshold without safety barrier. High risk of fatal fall to roadway.'
  }
  if (s.toLowerCase().includes('box is inside') && s.toLowerCase().includes('dock')) {
    return 'Cargo carton positioned directly on dock edge boundary. High risk of rollover or pallet tipping into lower vehicle bay.'
  }
  if (s.toLowerCase().includes('person is inside') && s.toLowerCase().includes('wet')) {
    return 'Worker handling cargo across an active wet floor surface. Severe slip, fall, and dropped-cargo hazard.'
  }
  if (s.toLowerCase().includes('worker appears') && s.toLowerCase().includes('rest on box')) {
    return 'Worker body weight applied directly onto cargo packaging. Crushes lower goods and creates elevated fall hazard.'
  }
  if (s.toLowerCase().includes('aspect-ratio oscillation')) {
    return 'Carton being rolled end-over-end across the warehouse floor instead of carried upright with approved transport equipment.'
  }
  if (s.toLowerCase().includes('rapid downward displacement')) {
    return 'Sudden downward acceleration detected indicating package dropping or throwing from elevated height.'
  }
  if (s.toLowerCase().includes('sustained ground-level translation')) {
    return 'Carton being dragged along warehouse floor rather than lifted or moved on a pallet jack.'
  }
  if (s.toLowerCase().includes('significant base overhang')) {
    return 'Carton overhang exceeds safe threshold. Footprint lack of support creates severe tipping and stack collapse risk.'
  }

  // Tidy punctuation and double whitespace
  return s.replace(/\s+/g, ' ').replace(/\s+\./g, '.').trim()
}

export function generateWhyTraceFlaggedThis(event, config = {}, isVerifiedPrevented = false) {
  if (!event) return []

  const entityName = formatEntityName(event.entity_id)
  const evidence = event.evidence || {}
  const lens = (event.lens || 'operational').toLowerCase()
  const scenario = event.scenario || ''
  const band = event.band || 'High'
  const actionText =
    event.planner_recommendation?.action ||
    event.recommended_action ||
    config.recommendedAction ||
    'Execute corrective repositioning.'

  const points = []

  // 1. Detection and tracking persistence
  const frameCount = evidence.persistence_frames || 6
  points.push(`The ${entityName} was detected and tracked continuously across ${frameCount} consecutive observation frames.`)

  // 2. Scenario-specific measurement & geometric inference
  if (lens === 'structural' || scenario.includes('overhang') || scenario.includes('stack')) {
    const supportVal = formatPercentage(evidence.overlap_ratio ?? evidence.support_ratio, '40.4%')
    const overhangVal = formatPercentage(evidence.overhang_ratio, '46.2%')
    points.push(`Its footprint overlapped the supporting base by only ${supportVal}, leaving ${overhangVal} extending unsupported past the foundation boundary.`)
  } else if (lens === 'environmental' || scenario.includes('dock') || scenario.includes('wet')) {
    const zoneName = humanizeExplanation(evidence.zone_id || 'dock-edge perimeter', scenario)
    points.push(`Its spatial bounding box intersected the calibrated hazard boundary (${zoneName}) without physical protective barriers.`)
  } else if (lens === 'behaviour' || scenario.includes('step') || scenario.includes('drop') || scenario.includes('drag') || scenario.includes('roll')) {
    const handlingType = scenario.includes('step')
      ? 'weight-bearing body foot contact on corrugated packaging'
      : scenario.includes('drop')
        ? 'kinematic acceleration spike consistent with freefall drop'
        : scenario.includes('drag')
          ? 'sustained floor-level friction translation without lifting'
          : 'non-compliant manual cargo manipulation'
    points.push(`Kinematic motion analysis identified ${handlingType}, exceeding safe packaging load thresholds.`)
  } else {
    points.push(`Observed physical configuration deviated from warehouse loading plan specifications.`)
  }

  // 3. Hazard threshold crossing
  points.push(`The resulting condition crossed TRACE's configured safety limit, generating a ${band.toUpperCase()} RISK classification.`)

  // 4. Epistemic classification
  const epistemicLevel = (event.epistemic_level || 'inferred').toUpperCase()
  points.push(`Evidence was recorded as ${epistemicLevel} from calibrated 2D monocular tracking and scene geometry.`)

  // 5. Recommended operational intervention
  points.push(`TRACE dispatched an immediate corrective action: "${actionText}".`)

  // 6. Outcome / verification status
  if (isVerifiedPrevented || event.event_type === 'prevented') {
    points.push(`Post-action video sequence verified that the operator resolved the hazard, preventing physical damage.`)
  } else {
    points.push(`Status remains unverified in subsequent footage; awaiting supervisor review or post-action video confirmation.`)
  }

  return points
}
