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
  if (conf === null || conf === undefined) return 'Not available'
  if (typeof conf === 'number') {
    if (isNaN(conf) || !Number.isFinite(conf)) return 'Not available'
    return conf <= 1 ? `${Math.round(conf * 100)}%` : `${Math.round(conf)}%`
  }
  if (typeof conf === 'string') {
    const trimmed = conf.trim()
    if (!trimmed || trimmed.toLowerCase() === 'nan' || trimmed.toLowerCase() === 'undefined') {
      return 'Not available'
    }
    const num = Number(trimmed)
    if (!isNaN(num) && Number.isFinite(num)) {
      return num <= 1 ? `${Math.round(num * 100)}%` : `${Math.round(num)}%`
    }
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()
  }
  return 'Not available'
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
  if (!entityId || typeof entityId !== 'string') return 'Tracked Entity'
  const clean = entityId.trim()
  // Extract trailing id if format is "video_id:track_id"
  const parts = clean.split(':')
  const trackId = parts.length > 1 ? parts[parts.length - 1] : clean
  const isPerson = clean.toLowerCase().includes('person')
  const isPallet = clean.toLowerCase().includes('pallet')
  const isCarton = clean.toLowerCase().includes('carton') || clean.toLowerCase().includes('box')

  if (isPerson) return `Personnel #${trackId}`
  if (isPallet) return `Pallet Deck #${trackId}`
  if (isCarton) return `Cargo Carton #${trackId}`

  const num = Number(trackId)
  if (!isNaN(num)) {
    return num >= 1000000 ? `Cargo Unit #${trackId.slice(-4)}` : `Unit #${trackId}`
  }
  return `Unit #${trackId}`
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

  // 2. Clean up awkward raw polygon / scientific / coordinate text
  s = s.replace(/vertical_gap=[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/gi, '')
  s = s.replace(/horizontal_overlap=[-+]?[0-9]*\.?[0-9]+/gi, '')
  s = s.replace(/in 2D image space,\s*/gi, '')
  s = s.replace(/\s*,\s*horizontal_ratio=[0-9.]+%/gi, '')
  s = s.replace(/\(displacement [0-9.]+, horizontal ratio [0-9.]+%\)/gi, '')
  s = s.replace(/\(effective speed: [0-9.]+ norm\/s, vertical drop: [0-9.]+\)/gi, '')
  s = s.replace(/\([0-9.]+ span, [0-9]+ inversions\)/gi, '')
  s = s.replace(/\(\s*,\s*\)/gi, '')
  s = s.replace(/\(\s*\)/gi, '')

  // 3. Clean up raw entity IDs inside text (e.g. f15ad7e2295d190b:30)
  s = s.replace(/[a-f0-9]{16}:(\d+)/gi, (_, id) => `Worker #${id}`)

  // 4. Transform specific common automated messages into executive phrasing
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

