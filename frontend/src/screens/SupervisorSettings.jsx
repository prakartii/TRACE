import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  Camera,
  Construction,
  Droplets,
  Footprints,
  ListChecks,
  Lock,
  MapPinned,
  Package,
  Settings as SettingsIcon,
  ShieldQuestion,
  Trash2,
  TrafficCone,
  Volume2,
} from 'lucide-react'
import { API_BASE_URL } from '../config.js'
import {
  createZone,
  deleteProduct,
  deleteZone,
  listManifests,
  listProducts,
  listZones,
} from '../api/videos.js'
import { getAlertText } from '../api/intervention.js'
import { useSpeech } from '../hooks/useSpeech.js'
import CustomRuleBuilder from './CustomRuleBuilder.jsx'

// Turns a technical identifier ("appliances_fridge_box") into a readable
// product name ("Appliances Fridge Box") for the catalog card — the raw id
// stays visible underneath, in muted text, for anyone who needs it.
function humanize(id) {
  if (!id) return ''
  return id
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

const PRODUCT_ICON = (classNameRaw) => {
  const c = (classNameRaw || '').toLowerCase()
  if (c.includes('appliance') || c.includes('fridge') || c.includes('machine')) return SettingsIcon
  return Package
}

const MASS_STYLE = {
  heavy: 'border-danger/40 bg-danger/10 text-danger',
  medium: 'border-signal/50 bg-signal/15 text-[#8a5f00]',
  light: 'border-ok/40 bg-ok/10 text-ok',
}

const FRAGILITY_STYLE = {
  high: 'border-danger/40 bg-danger/10 text-danger',
  medium: 'border-signal/50 bg-signal/15 text-[#8a5f00]',
  low: 'border-line bg-paper text-ink-soft',
}

const ZONE_META = {
  dock_edge: { icon: AlertTriangle, label: 'Dock Edge', style: 'text-danger bg-danger/10 border-danger/30' },
  wet_floor: { icon: Droplets, label: 'Wet Floor', style: 'text-sky-600 bg-sky-500/10 border-sky-500/30' },
  pedestrian_walkway: { icon: Footprints, label: 'Walkway', style: 'text-ink-soft bg-paper border-line' },
  traffic_lane: { icon: TrafficCone, label: 'Traffic Lane', style: 'text-orange-600 bg-orange-500/10 border-orange-500/30' },
  restricted_area: { icon: Lock, label: 'Restricted Area', style: 'text-danger bg-danger/10 border-danger/30' },
}
function zoneMeta(zoneType) {
  return ZONE_META[zoneType] || { icon: ShieldQuestion, label: zoneType || 'Zone', style: 'text-ink-soft bg-paper border-line' }
}

export default function SupervisorSettings() {
  const [products, setProducts] = useState([])
  const [zones, setZones] = useState([])
  const [manifests, setManifests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('rules')

  const [newSku, setNewSku] = useState({
    product_id: '',
    class_name: 'carton',
    mass_class: 'heavy',
    fragility: 'medium',
    required_orientation: 'vertical',
    max_stack_height: 2,
  })
  const [formMsg, setFormMsg] = useState(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)

  const [newZone, setNewZone] = useState({
    zone_id: '',
    zone_type: 'dock_edge',
    severity_multiplier: 1.5,
    polygon_text: '[[0.0, 0.75], [1.0, 0.75], [1.0, 1.0], [0.0, 1.0]]',
  })
  const [zoneMsg, setZoneMsg] = useState(null)
  const [deleteConfirmZoneId, setDeleteConfirmZoneId] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([listProducts(), listZones(), listManifests()])
      .then(([pList, zList, mList]) => {
        if (cancelled) return
        setProducts(pList)
        setZones(zList)
        setManifests(mList)
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  async function handleCreateProduct(e) {
    e.preventDefault()
    setFormMsg(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/config/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSku),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || `HTTP ${res.status}`)
      }
      const created = await res.json()
      setProducts((prev) => [...prev.filter((p) => p.product_id !== created.product_id), created])
      setFormMsg({ type: 'success', text: `product '${created.product_id}' registered.` })
      setNewSku({
        product_id: '',
        class_name: 'carton',
        mass_class: 'heavy',
        fragility: 'medium',
        required_orientation: 'vertical',
        max_stack_height: 2,
      })
    } catch (err) {
      setFormMsg({ type: 'error', text: err.message })
    }
  }

  async function handleDeleteProduct(productId) {
    setFormMsg(null)
    try {
      await deleteProduct(productId)
      setProducts((prev) => prev.filter((p) => p.product_id !== productId))
      setFormMsg({ type: 'success', text: `product '${productId}' deleted.` })
    } catch (err) {
      setFormMsg({ type: 'error', text: err.message })
    } finally {
      setDeleteConfirmId(null)
    }
  }

  async function handleCreateZone(e) {
    e.preventDefault()
    setZoneMsg(null)
    try {
      let polygon
      try {
        polygon = JSON.parse(newZone.polygon_text)
      } catch {
        throw new Error('Polygon must be valid JSON array of [x, y] coordinate pairs.')
      }
      if (!Array.isArray(polygon) || polygon.length < 3) {
        throw new Error('Polygon must contain at least 3 [x, y] coordinate pairs.')
      }
      for (const pt of polygon) {
        if (!Array.isArray(pt) || pt.length !== 2 || typeof pt[0] !== 'number' || typeof pt[1] !== 'number') {
          throw new Error('Each polygon vertex must be a [number, number] pair in range 0.0–1.0.')
        }
        if (pt[0] < 0 || pt[0] > 1 || pt[1] < 0 || pt[1] > 1) {
          throw new Error('Coordinates must be normalized between 0.0 and 1.0.')
        }
      }

      const payload = {
        zone_id: newZone.zone_id.trim(),
        zone_type: newZone.zone_type,
        polygon,
        severity_multiplier: Number(newZone.severity_multiplier),
      }
      const created = await createZone(payload)
      setZones((prev) => [...prev.filter((z) => z.zone_id !== created.zone_id), created])
      setZoneMsg({ type: 'success', text: `zone '${created.zone_id}' registered.` })
      setNewZone({
        zone_id: '',
        zone_type: 'dock_edge',
        severity_multiplier: 1.5,
        polygon_text: '[[0.0, 0.75], [1.0, 0.75], [1.0, 1.0], [0.0, 1.0]]',
      })
    } catch (err) {
      setZoneMsg({ type: 'error', text: err.message })
    }
  }

  async function handleDeleteZone(zoneId) {
    setZoneMsg(null)
    try {
      await deleteZone(zoneId)
      setZones((prev) => prev.filter((z) => z.zone_id !== zoneId))
      setZoneMsg({ type: 'success', text: `zone '${zoneId}' deleted.` })
    } catch (err) {
      setZoneMsg({ type: 'error', text: err.message })
    } finally {
      setDeleteConfirmZoneId(null)
    }
  }

  if (loading) {
    return <div className="p-4 text-small text-ink-soft">loading supervisor configuration…</div>
  }

  const tabs = [
    ['rules', 'Custom Rules', ListChecks],
    ['products', `Product Catalog (${products.length})`, Boxes],
    ['zones', `Hazard Zones (${zones.length})`, MapPinned],
    ['manifests', `Cameras (${manifests.length})`, Camera],
    ['alerts', 'Voice Alerts', Volume2],
  ]

  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-ink text-paper">
            <SettingsIcon size={15} />
          </span>
          <h1 className="text-xl font-bold text-ink">Warehouse Configuration</h1>
        </div>
        <p className="mt-1 text-small text-ink-soft">
          The products, hazard zones, and rules TRACE actively checks against — changes apply immediately, no restart needed.
        </p>
      </section>

      {error && <div className="border border-danger bg-danger/5 p-3 text-small text-danger">{error}</div>}

      <div className="flex flex-wrap gap-px border border-line bg-line">
        {tabs.map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-small font-medium transition-colors cursor-pointer ${
              activeTab === key ? 'bg-ink text-paper' : 'bg-surface text-ink-soft hover:text-ink'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'rules' && <CustomRuleBuilder />}

      {activeTab === 'products' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
          <div>
            <h2 className="mb-3 text-small font-semibold text-ink">
              {products.length} product{products.length === 1 ? '' : 's'} registered
            </h2>
            {products.length === 0 ? (
              <div className="border border-dashed border-line bg-surface p-6 text-center text-small text-ink-soft">
                No products registered yet. Add one on the right so TRACE knows how it should be handled.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {products.map((p) => {
                  const Icon = PRODUCT_ICON(p.class_name)
                  return (
                    <div key={p.product_id} className="border border-line bg-surface p-3.5 shadow-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-paper border border-line text-ink-soft">
                            <Icon size={15} />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-small font-bold text-ink">{humanize(p.product_id)}</div>
                            <div className="truncate font-mono text-[11px] text-ink-faint">{p.product_id}</div>
                          </div>
                        </div>

                        {deleteConfirmId === p.product_id ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <button type="button" onClick={() => handleDeleteProduct(p.product_id)} className="bg-danger px-1.5 py-0.5 text-label font-medium text-paper hover:opacity-90 cursor-pointer">
                              confirm
                            </button>
                            <button type="button" onClick={() => setDeleteConfirmId(null)} className="bg-paper px-1.5 py-0.5 text-label text-ink-soft hover:bg-line cursor-pointer">
                              cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(p.product_id)}
                            title="Remove product"
                            className="shrink-0 text-ink-faint hover:text-danger cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <span className={`border px-1.5 py-0.5 text-label font-medium capitalize ${MASS_STYLE[p.mass_class] || MASS_STYLE.light}`}>
                          {p.mass_class} weight
                        </span>
                        <span className={`border px-1.5 py-0.5 text-label font-medium capitalize ${FRAGILITY_STYLE[p.fragility] || FRAGILITY_STYLE.low}`}>
                          {p.fragility} fragility
                        </span>
                        {p.required_orientation ? (
                          <span className="border border-line bg-paper px-1.5 py-0.5 text-label font-medium text-ink-soft">
                            {p.required_orientation === 'vertical' ? 'This side up' : 'Must lie flat'}
                          </span>
                        ) : (
                          <span className="border border-line bg-paper px-1.5 py-0.5 text-label font-medium text-ink-faint">
                            Any orientation
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <FormPanel title="Add a product" message={formMsg}>
            <form onSubmit={handleCreateProduct} className="flex flex-col gap-2.5">
              <Input label="Product ID (unique, no spaces)" placeholder="e.g. appliances_fridge_box" value={newSku.product_id} onChange={(v) => setNewSku({ ...newSku, product_id: v })} mono required />
              <Input label="Category" placeholder="e.g. carton, appliance" value={newSku.class_name} onChange={(v) => setNewSku({ ...newSku, class_name: v })} required />
              <Select label="Weight class" value={newSku.mass_class} onChange={(v) => setNewSku({ ...newSku, mass_class: v })} options={[['light', 'Light (< 10 kg)'], ['medium', 'Medium (10–25 kg)'], ['heavy', 'Heavy (> 25 kg)']]} />
              <Select label="Required orientation" value={newSku.required_orientation || ''} onChange={(v) => setNewSku({ ...newSku, required_orientation: v || null })} options={[['', 'Any orientation'], ['vertical', 'This side up'], ['horizontal', 'Must lie flat']]} />
              <button type="submit" className="mt-2 border border-ink bg-ink py-1.5 text-small font-medium text-paper transition-colors hover:bg-ink-soft cursor-pointer">
                Add to catalog
              </button>
            </form>
          </FormPanel>
        </div>
      )}

      {activeTab === 'zones' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
          <div>
            <h2 className="mb-3 text-small font-semibold text-ink">
              {zones.length} hazard zone{zones.length === 1 ? '' : 's'} marked on camera
            </h2>
            {zones.length === 0 ? (
              <div className="border border-dashed border-line bg-surface p-6 text-center text-small text-ink-soft">
                No hazard zones marked yet. Draw one on the right (e.g. a wet-floor spill area or a dock edge).
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {zones.map((z) => {
                  const meta = zoneMeta(z.zone_type)
                  const Icon = meta.icon
                  return (
                    <div key={z.zone_id} className="flex items-start justify-between border border-line bg-surface p-3.5 shadow-xs">
                      <div className="flex items-start gap-2.5">
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border ${meta.style}`}>
                          <Icon size={15} />
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-small font-bold text-ink">{meta.label}</span>
                            <span className="font-mono text-[11px] text-ink-faint">{z.zone_id}</span>
                          </div>
                          <p className="mt-0.5 text-caption text-ink-soft">
                            {z.severity_multiplier}× severity on any hazard detected inside this area
                          </p>
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[11px] text-ink-faint hover:text-ink-soft">
                              boundary ({z.polygon.length} points)
                            </summary>
                            <span className="block font-mono text-[10px] text-ink-faint mt-0.5">
                              {JSON.stringify(z.polygon.map(([x, y]) => [Number(x.toFixed(2)), Number(y.toFixed(2))]))}
                            </span>
                          </details>
                        </div>
                      </div>
                      {deleteConfirmZoneId === z.zone_id ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <button type="button" onClick={() => handleDeleteZone(z.zone_id)} className="bg-danger px-1.5 py-0.5 text-label font-medium text-paper hover:opacity-90 cursor-pointer">
                            confirm
                          </button>
                          <button type="button" onClick={() => setDeleteConfirmZoneId(null)} className="bg-paper px-1.5 py-0.5 text-label text-ink-soft hover:bg-line cursor-pointer">
                            cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmZoneId(z.zone_id)}
                          title="Remove zone"
                          className="shrink-0 text-ink-faint hover:text-danger cursor-pointer"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <FormPanel title="Mark a hazard zone" message={zoneMsg}>
            <form onSubmit={handleCreateZone} className="flex flex-col gap-2.5">
              <Input label="Zone name (unique)" placeholder="e.g. dock_edge_bay_3" value={newZone.zone_id} onChange={(v) => setNewZone({ ...newZone, zone_id: v })} mono required />
              <Select
                label="Hazard type"
                value={newZone.zone_type}
                onChange={(v) => setNewZone({ ...newZone, zone_type: v })}
                options={Object.entries(ZONE_META).map(([val, m]) => [val, m.label])}
              />
              <Input label="Severity multiplier" type="number" step="0.1" value={newZone.severity_multiplier} onChange={(v) => setNewZone({ ...newZone, severity_multiplier: v })} required />
              <div>
                <label className="mb-1 block text-caption text-ink-soft">
                  Area boundary <span className="text-ink-faint">(pick a preset, or edit the coordinates)</span>
                </label>
                <div className="mb-1.5 flex flex-wrap items-center gap-1">
                  <button type="button" onClick={() => setNewZone({ ...newZone, polygon_text: '[[0.0, 0.75], [1.0, 0.75], [1.0, 1.0], [0.0, 1.0]]' })} className="border border-line px-1.5 py-0.5 text-caption text-ink-soft hover:bg-paper cursor-pointer">
                    bottom strip
                  </button>
                  <button type="button" onClick={() => setNewZone({ ...newZone, polygon_text: '[[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]' })} className="border border-line px-1.5 py-0.5 text-caption text-ink-soft hover:bg-paper cursor-pointer">
                    center region
                  </button>
                </div>
                <textarea
                  rows={2}
                  required
                  value={newZone.polygon_text}
                  onChange={(e) => setNewZone({ ...newZone, polygon_text: e.target.value })}
                  className="w-full border border-line bg-surface p-1.5 font-mono text-caption text-ink focus:border-ink"
                  placeholder="[[0.0, 0.75], [1.0, 0.75], [1.0, 1.0], [0.0, 1.0]]"
                />
              </div>
              <button type="submit" className="mt-2 border border-ink bg-ink py-1.5 text-small font-medium text-paper transition-colors hover:bg-ink-soft cursor-pointer">
                Mark this zone
              </button>
            </form>
          </FormPanel>
        </div>
      )}

      {activeTab === 'manifests' && (
        <div>
          <h2 className="mb-3 text-small font-semibold text-ink">
            Cameras with an operating profile ({manifests.length})
          </h2>
          <p className="mb-3 text-caption text-ink-soft max-w-2xl">
            Each camera bay can be linked to a default product and its own hazard zones — set up automatically
            for the supplied footage, and extendable to a new camera via the API.
          </p>
          <div className="flex flex-col gap-3">
            {manifests.length === 0 ? (
              <div className="border border-dashed border-line bg-surface p-6 text-center text-small text-ink-soft">
                No camera bay profiles configured yet.
              </div>
            ) : (
              manifests.map((m) => (
                <div key={m.source_id} className="flex items-start gap-2.5 border border-line bg-surface p-3.5 shadow-xs">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-paper border border-line text-ink-soft">
                    <Camera size={15} />
                  </span>
                  <div>
                    <span className="text-small font-bold text-ink">{m.bay_name}</span>
                    <p className="mt-0.5 text-caption text-ink-soft">
                      Default product: <strong className="text-ink font-medium">{m.primary_product_id ? humanize(m.primary_product_id) : 'none set'}</strong>
                      {' · '}{m.product_count} product{m.product_count === 1 ? '' : 's'} · {m.zone_count} hazard zone{m.zone_count === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'alerts' && <AlertLanguageSettings />}
    </div>
  )
}

function AlertLanguageSettings() {
  const voice = useSpeech()
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)

  async function handlePreview() {
    setPreviewing(true)
    setPreview(null)
    try {
      const result = await getAlertText(null, voice.lang)
      setPreview(result)
      voice.speak({ scenario: null, immediate_action: null, alert_id: 'settings_preview' }, { force: true })
    } catch (err) {
      setPreview({ error: err.message })
    } finally {
      setPreviewing(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[420px_1fr]">
      <div className="flex flex-col gap-3 border border-line bg-surface p-4">
        <h2 className="text-small font-semibold text-ink">alert language</h2>
        <p className="text-caption text-ink-soft">
          The language TRACE uses for spoken safety alerts. Applies to every intervention alert —
          the spoken text always matches what was actually detected.
        </p>

        {!voice.supported ? (
          <div className="border border-line bg-paper p-2.5 text-caption text-ink-soft">
            Audio playback is not available in this browser. Alerts still appear as text.
          </div>
        ) : (
          <>
            <Select
              label="language"
              value={voice.lang}
              onChange={voice.setLang}
              options={voice.langs.map((l) => [l.code, l.label])}
            />

            <label className="flex items-center gap-2 text-small text-ink">
              <input
                type="checkbox"
                checked={voice.enabled}
                onChange={(e) => voice.setEnabled(e.target.checked)}
                className="h-4 w-4"
              />
              Speak Critical and High-risk alerts aloud
            </label>
            <p className="text-[11px] text-ink-faint">
              Medium and Low-risk events stay visual-only, so voice alerts don&apos;t talk over every detection.
            </p>

            <button
              type="button"
              onClick={handlePreview}
              disabled={previewing}
              className="mt-1 self-start border border-line bg-paper px-3 py-1.5 text-caption font-semibold text-ink hover:border-ink disabled:opacity-50"
            >
              {previewing ? 'loading preview…' : 'play a sample alert'}
            </button>

            {preview && !preview.error && (
              <div className="border border-line bg-paper p-2.5 text-caption text-ink">
                <span className="text-ink-faint">spoken text: </span>
                {preview.text}
              </div>
            )}
            {preview?.error && (
              <div className="border border-danger bg-danger/5 p-2.5 text-caption text-danger">{preview.error}</div>
            )}
          </>
        )}
      </div>

      <div className="border border-line bg-surface p-4 text-caption text-ink-soft">
        <h2 className="mb-2 text-small font-semibold text-ink">how this works</h2>
        <p>
          TRACE renders the selected language as real speech from the same detected-event pipeline that
          drives Active Hazards and the Safe Action Planner — the spoken instruction always corresponds to
          the actual event, never a generic warning.
        </p>
        <p className="mt-2">
          Critical alerts speak immediately. High-risk alerts speak when intervention is warranted. Medium
          and Low-risk events are shown but not read aloud, and a repeated detection of the same hazard is
          spoken once, not on every frame it is observed.
        </p>
      </div>
    </div>
  )
}

function FormPanel({ title, message, children }) {
  return (
    <div className="flex flex-col gap-3 border border-line bg-surface p-4">
      <h2 className="text-small font-semibold text-ink">{title}</h2>
      {message && (
        <div className={`border p-2 text-caption ${message.type === 'success' ? 'border-ok/40 bg-ok/10 text-ok' : 'border-danger bg-danger/5 text-danger'}`}>
          {message.text}
        </div>
      )}
      {children}
    </div>
  )
}

function Input({ label, mono, ...rest }) {
  return (
    <div>
      <label className="mb-1 block text-caption text-ink-soft">{label}</label>
      <input {...rest} className={`w-full border border-line bg-surface p-1.5 text-small text-ink focus:border-ink ${mono ? 'font-mono' : ''}`} />
    </div>
  )
}

function Select({ label, value, onChange, options }) {
  return (
    <div>
      <label className="mb-1 block text-caption text-ink-soft">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-line bg-surface p-1.5 text-small text-ink focus:border-ink">
        {options.map(([val, text]) => (
          <option key={val} value={val}>
            {text}
          </option>
        ))}
      </select>
    </div>
  )
}
