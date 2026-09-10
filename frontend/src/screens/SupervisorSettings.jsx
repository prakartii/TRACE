import { useEffect, useState } from 'react'
import { API_BASE_URL } from '../config.js'
import {
  createZone,
  deleteProduct,
  deleteZone,
  listManifests,
  listProducts,
  listZones,
} from '../api/videos.js'
import CustomRuleBuilder from './CustomRuleBuilder.jsx'

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
    ['rules', 'custom rules'],
    ['products', `product catalog (${products.length})`],
    ['zones', `hazard zones (${zones.length})`],
    ['manifests', `manifests (${manifests.length})`],
  ]

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h1 className="text-2xl font-bold text-ink">settings</h1>
        <p className="mt-1 text-body text-ink-soft">
          Manage product metadata, camera-calibrated hazard zones, and operational source manifests.
        </p>
      </section>

      {error && <div className="border border-danger bg-danger/5 p-3 text-small text-danger">{error}</div>}

      <div className="flex flex-wrap gap-px border border-line bg-line">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-small font-medium transition-colors ${
              activeTab === key ? 'bg-ink text-paper' : 'bg-surface text-ink-soft hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'rules' && <CustomRuleBuilder />}

      {activeTab === 'products' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
          <div className="border border-line bg-surface p-4">
            <h2 className="mb-3 text-small font-semibold text-ink">configured SKU specifications</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-small">
                <thead>
                  <tr className="border-b border-line text-caption text-ink-faint">
                    <th className="py-2 font-medium">SKU id</th>
                    <th className="py-2 font-medium">class</th>
                    <th className="py-2 font-medium">mass class</th>
                    <th className="py-2 font-medium">fragility</th>
                    <th className="py-2 font-medium">orientation</th>
                    <th className="py-2 font-medium">max stack <span className="font-normal text-ink-faint">(not enforced)</span></th>
                    <th className="py-2 text-right font-medium">action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {products.map((p) => (
                    <tr key={p.product_id} className="hover:bg-paper">
                      <td className="py-2 font-mono font-medium text-ink">{p.product_id}</td>
                      <td className="py-2 text-ink-soft">{p.class_name}</td>
                      <td className="py-2 font-mono">
                        <span
                          className={`border px-1.5 py-0.5 text-label font-medium ${
                            p.mass_class === 'heavy'
                              ? 'border-danger/40 bg-danger/10 text-danger'
                              : p.mass_class === 'medium'
                                ? 'border-signal/40 bg-signal/10 text-[#8a5f00]'
                                : 'border-line bg-paper text-ink-soft'
                          }`}
                        >
                          {p.mass_class}
                        </span>
                      </td>
                      <td className="py-2 text-ink-soft">{p.fragility}</td>
                      <td className="py-2 font-mono text-ink-soft">{p.required_orientation || 'unconstrained'}</td>
                      <td className="py-2 font-mono text-ink-soft">{p.max_stack_height || '—'}</td>
                      <td className="py-2 text-right">
                        {deleteConfirmId === p.product_id ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button type="button" onClick={() => handleDeleteProduct(p.product_id)} className="bg-danger px-1.5 py-0.5 text-label font-medium text-paper hover:opacity-90">
                              confirm
                            </button>
                            <button type="button" onClick={() => setDeleteConfirmId(null)} className="bg-paper px-1.5 py-0.5 text-label text-ink-soft hover:bg-line">
                              cancel
                            </button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setDeleteConfirmId(p.product_id)} className="text-caption text-ink-faint hover:text-danger">
                            delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <FormPanel title="register new product / SKU" message={formMsg}>
            <form onSubmit={handleCreateProduct} className="flex flex-col gap-2.5">
              <Input label="product id (unique)" placeholder="e.g. appliances_fridge_box" value={newSku.product_id} onChange={(v) => setNewSku({ ...newSku, product_id: v })} mono required />
              <Input label="class name" placeholder="e.g. carton / appliance" value={newSku.class_name} onChange={(v) => setNewSku({ ...newSku, class_name: v })} required />
              <Select label="mass class" value={newSku.mass_class} onChange={(v) => setNewSku({ ...newSku, mass_class: v })} options={[['light', 'light (< 10 kg)'], ['medium', 'medium (10–25 kg)'], ['heavy', 'heavy (> 25 kg)']]} />
              <Select label="required orientation" value={newSku.required_orientation || ''} onChange={(v) => setNewSku({ ...newSku, required_orientation: v || null })} options={[['', 'unconstrained'], ['vertical', 'vertical (this side up)'], ['horizontal', 'horizontal (flatpack)']]} />
              <Input label="max stack height" type="number" value={newSku.max_stack_height} onChange={(v) => setNewSku({ ...newSku, max_stack_height: Number(v) })} />
              {/* CLAUDE.md §30: stored and exported, but no lens reads it. Counting
                  stack tiers needs vertical support-chain depth that single-camera
                  2D geometry cannot resolve reliably, so TRACE says so rather than
                  implying the limit is being checked. Orientation, by contrast, is
                  enforced by the conformance lens and as a planner hard constraint. */}
              <p className="-mt-1 text-caption text-ink-faint">
                Stored on the SKU and included in exports, but not currently enforced —
                no risk lens evaluates stack height. Required orientation is enforced.
              </p>
              <button type="submit" className="mt-2 border border-ink bg-ink py-1.5 text-small font-medium text-paper transition-colors hover:bg-ink-soft">
                register SKU metadata
              </button>
            </form>
          </FormPanel>
        </div>
      )}

      {activeTab === 'zones' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
          <div className="border border-line bg-surface p-4">
            <h2 className="mb-3 text-small font-semibold text-ink">calibrated camera hazard zones</h2>
            <div className="flex flex-col gap-3">
              {zones.map((z) => (
                <div key={z.zone_id} className="flex items-start justify-between border border-line bg-paper p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-small font-medium text-ink">{z.zone_id}</span>
                      <span className="border border-line bg-surface px-1.5 py-0.5 text-label text-ink-soft">{z.zone_type}</span>
                    </div>
                    <p className="mt-1 text-caption text-ink-faint">
                      polygon vertices ({z.polygon.length} points):{' '}
                      <span className="font-mono">{JSON.stringify(z.polygon.map(([x, y]) => [Number(x.toFixed(2)), Number(y.toFixed(2))]))}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-caption text-ink-soft">
                      severity: <span className="font-mono tabular-nums">{z.severity_multiplier}x</span>
                    </span>
                    {deleteConfirmZoneId === z.zone_id ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button type="button" onClick={() => handleDeleteZone(z.zone_id)} className="bg-danger px-1.5 py-0.5 text-label font-medium text-paper hover:opacity-90">
                          confirm
                        </button>
                        <button type="button" onClick={() => setDeleteConfirmZoneId(null)} className="bg-paper px-1.5 py-0.5 text-label text-ink-soft hover:bg-line">
                          cancel
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setDeleteConfirmZoneId(z.zone_id)} className="text-caption text-ink-faint hover:text-danger">
                        delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <FormPanel title="register calibrated zone" message={zoneMsg}>
            <form onSubmit={handleCreateZone} className="flex flex-col gap-2.5">
              <Input label="zone id (unique)" placeholder="e.g. dock_edge_bay_3" value={newZone.zone_id} onChange={(v) => setNewZone({ ...newZone, zone_id: v })} mono required />
              <Select label="zone type" value={newZone.zone_type} onChange={(v) => setNewZone({ ...newZone, zone_type: v })} options={[['dock_edge', 'dock_edge'], ['wet_floor', 'wet_floor'], ['pedestrian_walkway', 'pedestrian_walkway'], ['traffic_lane', 'traffic_lane'], ['restricted_area', 'restricted_area']]} />
              <Input label="severity multiplier" type="number" step="0.1" value={newZone.severity_multiplier} onChange={(v) => setNewZone({ ...newZone, severity_multiplier: v })} required />
              <div>
                <label className="mb-1 block text-caption text-ink-soft">normalized polygon JSON</label>
                <textarea
                  rows={3}
                  required
                  value={newZone.polygon_text}
                  onChange={(e) => setNewZone({ ...newZone, polygon_text: e.target.value })}
                  className="w-full border border-line bg-surface p-1.5 font-mono text-caption text-ink focus:border-ink"
                  placeholder="[[0.0, 0.75], [1.0, 0.75], [1.0, 1.0], [0.0, 1.0]]"
                />
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="text-caption text-ink-faint">presets:</span>
                  <button type="button" onClick={() => setNewZone({ ...newZone, polygon_text: '[[0.0, 0.75], [1.0, 0.75], [1.0, 1.0], [0.0, 1.0]]' })} className="border border-line px-1.5 py-0.5 text-caption text-ink-soft hover:bg-paper">
                    dock edge strip
                  </button>
                  <button type="button" onClick={() => setNewZone({ ...newZone, polygon_text: '[[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]' })} className="border border-line px-1.5 py-0.5 text-caption text-ink-soft hover:bg-paper">
                    center region
                  </button>
                </div>
              </div>
              <button type="submit" className="mt-2 border border-ink bg-ink py-1.5 text-small font-medium text-paper transition-colors hover:bg-ink-soft">
                register calibrated zone
              </button>
            </form>
          </FormPanel>
        </div>
      )}

      {activeTab === 'manifests' && (
        <div className="border border-line bg-surface p-4">
          <h2 className="mb-3 text-small font-semibold text-ink">camera source to operational manifest links</h2>
          <div className="flex flex-col gap-3">
            {manifests.length === 0 ? (
              <p className="text-small text-ink-soft">No dynamic manifests registered via API.</p>
            ) : (
              manifests.map((m) => (
                <div key={m.source_id} className="flex items-start justify-between border border-line bg-paper p-3">
                  <div>
                    <span className="text-small font-medium text-ink">{m.bay_name}</span>
                    <span className="ml-2 font-mono text-caption text-ink-faint">({m.manifest_id})</span>
                    <p className="mt-1 text-caption text-ink-soft">
                      source id: <span className="font-mono">{m.source_id}</span>
                    </p>
                    <p className="mt-0.5 text-caption text-ink-faint">
                      primary product: <span className="font-mono">{m.primary_product_id || 'none'}</span> ·{' '}
                      {m.product_count} products · {m.zone_count} zones
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
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
