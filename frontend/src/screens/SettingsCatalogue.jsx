import { useEffect, useState } from 'react'
import { API_BASE_URL } from '../config.js'
import { createZone, deleteProduct, deleteZone, listManifests, listProducts, listZones } from '../api/videos.js'

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1 text-caption text-dim">
      {label}
      {children}
    </label>
  )
}
const inputCls = 'rounded border border-line-strong bg-bg px-2 py-1 text-caption text-ink focus:border-ink'

export default function SettingsCatalogue() {
  const [products, setProducts] = useState([])
  const [zones, setZones] = useState([])
  const [manifests, setManifests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [msg, setMsg] = useState(null)

  const [sku, setSku] = useState({
    product_id: '',
    class_name: 'carton',
    mass_class: 'heavy',
    fragility: 'medium',
    required_orientation: 'vertical',
    max_stack_height: 2,
  })
  const [zone, setZone] = useState({
    zone_id: '',
    zone_type: 'dock_edge',
    severity_multiplier: 1.5,
    polygon_text: '[[0.0, 0.75], [1.0, 0.75], [1.0, 1.0], [0.0, 1.0]]',
  })

  function load() {
    setLoading(true)
    Promise.all([listProducts(), listZones(), listManifests()])
      .then(([p, z, m]) => {
        setProducts(p)
        setZones(z)
        setManifests(m)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  async function addProduct(e) {
    e.preventDefault()
    setMsg(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/config/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sku),
      })
      if (!res.ok) throw new Error((await res.json()).detail || `HTTP ${res.status}`)
      const created = await res.json()
      setProducts((prev) => [...prev.filter((p) => p.product_id !== created.product_id), created])
      setMsg({ ok: true, text: `product '${created.product_id}' registered` })
      setSku((s) => ({ ...s, product_id: '' }))
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    }
  }

  async function removeProduct(id) {
    try {
      await deleteProduct(id)
      setProducts((prev) => prev.filter((p) => p.product_id !== id))
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    }
  }

  async function addZone(e) {
    e.preventDefault()
    setMsg(null)
    try {
      let polygon
      try {
        polygon = JSON.parse(zone.polygon_text)
      } catch {
        throw new Error('Polygon must be valid JSON — an array of [x, y] pairs in 0.0–1.0.')
      }
      if (!Array.isArray(polygon) || polygon.length < 3) throw new Error('Polygon needs at least 3 vertices.')
      const created = await createZone({
        zone_id: zone.zone_id.trim(),
        zone_type: zone.zone_type,
        polygon,
        severity_multiplier: Number(zone.severity_multiplier),
      })
      setZones((prev) => [...prev.filter((z) => z.zone_id !== created.zone_id), created])
      setMsg({ ok: true, text: `zone '${created.zone_id}' registered` })
      setZone((z) => ({ ...z, zone_id: '' }))
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    }
  }

  async function removeZone(id) {
    try {
      await deleteZone(id)
      setZones((prev) => prev.filter((z) => z.zone_id !== id))
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    }
  }

  if (loading) return <p className="text-caption text-mute">loading…</p>
  if (error) return <p className="font-mono text-caption text-crit">[error] {error}</p>

  return (
    <div className="flex flex-col gap-6">
      {msg && (
        <p className={`text-caption ${msg.ok ? 'text-ok' : 'text-crit'}`}>{msg.text}</p>
      )}

      {/* Products */}
      <section className="panel">
        <span className="eyebrow mb-3 block">Product catalogue ({products.length})</span>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-caption">
            <thead>
              <tr className="text-left text-label uppercase tracking-[0.04em] text-mute">
                <th className="border-b border-line py-2 pr-4">SKU</th>
                <th className="border-b border-line py-2 pr-4">class</th>
                <th className="border-b border-line py-2 pr-4">mass</th>
                <th className="border-b border-line py-2 pr-4">orientation</th>
                <th className="border-b border-line py-2 pr-4">max stack (not enforced)</th>
                <th className="border-b border-line py-2" />
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.product_id} className="border-b border-line last:border-b-0">
                  <td className="py-2 pr-4 font-mono">{p.product_id}</td>
                  <td className="py-2 pr-4">{p.class_name}</td>
                  <td className="py-2 pr-4">{p.mass_class}</td>
                  <td className="py-2 pr-4 font-mono">{p.required_orientation || 'unconstrained'}</td>
                  <td className="py-2 pr-4 font-mono text-dim">{p.max_stack_height || '—'}</td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeProduct(p.product_id)}
                      className="text-label text-mute hover:text-crit"
                    >
                      delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form onSubmit={addProduct} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <Field label="product id">
            <input required value={sku.product_id} onChange={(e) => setSku({ ...sku, product_id: e.target.value })} className={`${inputCls} font-mono`} placeholder="appliances_fridge_box" />
          </Field>
          <Field label="class">
            <input required value={sku.class_name} onChange={(e) => setSku({ ...sku, class_name: e.target.value })} className={inputCls} />
          </Field>
          <Field label="mass">
            <select value={sku.mass_class} onChange={(e) => setSku({ ...sku, mass_class: e.target.value })} className={inputCls}>
              <option value="light">light</option>
              <option value="medium">medium</option>
              <option value="heavy">heavy</option>
            </select>
          </Field>
          <Field label="orientation">
            <select
              value={sku.required_orientation || ''}
              onChange={(e) => setSku({ ...sku, required_orientation: e.target.value || null })}
              className={inputCls}
            >
              <option value="">unconstrained</option>
              <option value="vertical">vertical</option>
              <option value="horizontal">horizontal</option>
            </select>
          </Field>
          <Field label="max stack">
            <input type="number" value={sku.max_stack_height} onChange={(e) => setSku({ ...sku, max_stack_height: Number(e.target.value) })} className={`${inputCls} w-16`} />
          </Field>
          <button type="submit" className="rounded-md border border-ink bg-ink px-3 py-1.5 text-caption font-semibold text-bg">
            add
          </button>
        </form>
      </section>

      {/* Zones */}
      <section className="panel">
        <span className="eyebrow mb-3 block">Hazard zones ({zones.length})</span>
        <div className="flex flex-col gap-2">
          {zones.map((z) => (
            <div key={z.zone_id} className="flex items-start justify-between gap-3 rounded border border-line p-2.5 text-caption">
              <div>
                <span className="font-mono">{z.zone_id}</span>{' '}
                <span className="text-mute">{z.zone_type} · {z.severity_multiplier}×</span>
                <p className="mt-0.5 font-mono text-label text-mute">
                  {JSON.stringify(z.polygon.map(([x, y]) => [Number(x.toFixed(2)), Number(y.toFixed(2))]))}
                </p>
              </div>
              <button type="button" onClick={() => removeZone(z.zone_id)} className="text-label text-mute hover:text-crit">
                delete
              </button>
            </div>
          ))}
        </div>

        <form onSubmit={addZone} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <Field label="zone id">
            <input required value={zone.zone_id} onChange={(e) => setZone({ ...zone, zone_id: e.target.value })} className={`${inputCls} font-mono`} placeholder="dock_edge_bay_3" />
          </Field>
          <Field label="type">
            <select value={zone.zone_type} onChange={(e) => setZone({ ...zone, zone_type: e.target.value })} className={inputCls}>
              {['dock_edge', 'wet_floor', 'pedestrian_walkway', 'traffic_lane', 'restricted_area'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="severity ×">
            <input type="number" step="0.1" value={zone.severity_multiplier} onChange={(e) => setZone({ ...zone, severity_multiplier: e.target.value })} className={`${inputCls} w-16`} />
          </Field>
          <Field label="polygon JSON">
            <input value={zone.polygon_text} onChange={(e) => setZone({ ...zone, polygon_text: e.target.value })} className={`${inputCls} w-80 font-mono`} />
          </Field>
          <button type="submit" className="rounded-md border border-ink bg-ink px-3 py-1.5 text-caption font-semibold text-bg">
            add
          </button>
        </form>
      </section>

      {/* Manifests */}
      <section className="panel">
        <span className="eyebrow mb-3 block">Source manifests ({manifests.length})</span>
        {manifests.length === 0 ? (
          <p className="text-caption text-mute">No manifests in force.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-caption">
            {manifests.map((m) => (
              <li key={m.source_id} className="rounded border border-line p-2.5">
                <span className="font-medium">{m.bay_name}</span>{' '}
                <span className="font-mono text-label text-mute">{m.manifest_id}</span>
                {m.origin && <span className="ml-1 text-label text-mute">· {m.origin}</span>}
                <p className="mt-0.5 font-mono text-label text-mute">
                  {m.source_filename || m.source_id} · {m.product_count} products · {m.zone_count} zones
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
