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

export default function SupervisorSettings() {
  const [products, setProducts] = useState([])
  const [zones, setZones] = useState([])
  const [manifests, setManifests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('products') // 'products' | 'zones' | 'manifests'

  // Form states for creating a new product
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

  // Form states for creating a new zone
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
      setFormMsg({ type: 'success', text: `Product '${created.product_id}' registered successfully.` })
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
      setFormMsg({ type: 'success', text: `Product '${productId}' deleted successfully.` })
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
      setZoneMsg({ type: 'success', text: `Zone '${created.zone_id}' registered successfully.` })
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
      setZoneMsg({ type: 'success', text: `Zone '${zoneId}' deleted successfully.` })
    } catch (err) {
      setZoneMsg({ type: 'error', text: err.message })
    } finally {
      setDeleteConfirmZoneId(null)
    }
  }


  if (loading) {
    return <div className="p-4 text-xs text-neutral-500">Loading supervisor configuration…</div>
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-ink">Supervisor Operational Configuration</h1>
        <p className="mt-1 text-xs text-neutral-500">
          Manage product metadata catalogs, camera-calibrated hazard zones, and operational source manifests.
        </p>
      </div>

      {error && <div className="border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      {/* Tabs */}
      <div className="flex border-b border-line gap-2">
        <button
          onClick={() => setActiveTab('products')}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'products'
              ? 'border-ink text-ink font-semibold'
              : 'border-transparent text-neutral-500 hover:text-ink'
          }`}
        >
          Product Catalog ({products.length})
        </button>
        <button
          onClick={() => setActiveTab('zones')}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'zones'
              ? 'border-ink text-ink font-semibold'
              : 'border-transparent text-neutral-500 hover:text-ink'
          }`}
        >
          Calibrated Environmental Zones ({zones.length})
        </button>
        <button
          onClick={() => setActiveTab('manifests')}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'manifests'
              ? 'border-ink text-ink font-semibold'
              : 'border-transparent text-neutral-500 hover:text-ink'
          }`}
        >
          Operational Manifests ({manifests.length})
        </button>
      </div>

      {/* Tab: Products */}
      {activeTab === 'products' && (
        <div className="grid grid-cols-[1fr_340px] gap-6">
          <div className="border border-line bg-white p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-3">
              Configured SKU Specifications
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-neutral-400 uppercase text-[10px]">
                    <th className="py-2">SKU ID</th>
                    <th className="py-2">Class</th>
                    <th className="py-2">Mass Class</th>
                    <th className="py-2">Fragility</th>
                    <th className="py-2">Required Orientation</th>
                    <th className="py-2">Max Stack</th>
                    <th className="py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {products.map((p) => (
                    <tr key={p.product_id} className="hover:bg-neutral-50">
                      <td className="py-2 font-mono font-medium text-ink">{p.product_id}</td>
                      <td className="py-2 text-neutral-600">{p.class_name}</td>
                      <td className="py-2 font-mono">
                        <span
                          className={`px-1.5 py-0.5 text-[10px] font-medium ${
                            p.mass_class === 'heavy'
                              ? 'bg-red-50 text-red-700 border border-red-200'
                              : p.mass_class === 'medium'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-neutral-50 text-neutral-600 border border-line'
                          }`}
                        >
                          {p.mass_class.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2 text-neutral-600">{p.fragility}</td>
                      <td className="py-2 text-neutral-600 font-mono">
                        {p.required_orientation || 'unconstrained'}
                      </td>
                      <td className="py-2 text-neutral-600 font-mono">{p.max_stack_height || '—'}</td>
                      <td className="py-2 text-right">
                        {deleteConfirmId === p.product_id ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleDeleteProduct(p.product_id)}
                              className="px-1.5 py-0.5 text-[10px] font-semibold bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(null)}
                              className="px-1.5 py-0.5 text-[10px] bg-neutral-100 text-neutral-600 rounded hover:bg-neutral-200"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(p.product_id)}
                            className="text-[11px] text-neutral-400 hover:text-red-600 transition-colors font-medium"
                            title={`Delete SKU ${p.product_id}`}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Add Product Form */}
          <div className="border border-line bg-white p-4 flex flex-col gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Register New Product / SKU
            </h2>
            {formMsg && (
              <div
                className={`p-2 text-xs border ${
                  formMsg.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-red-200 bg-red-50 text-red-800'
                }`}
              >
                {formMsg.text}
              </div>
            )}
            <form onSubmit={handleCreateProduct} className="flex flex-col gap-2.5 text-xs">
              <div>
                <label className="block text-neutral-600 mb-1">Product ID (Unique):</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. appliances_fridge_box"
                  value={newSku.product_id}
                  onChange={(e) => setNewSku({ ...newSku, product_id: e.target.value })}
                  className="w-full border border-line p-1.5 font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-neutral-600 mb-1">Class Name:</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. carton / appliance"
                  value={newSku.class_name}
                  onChange={(e) => setNewSku({ ...newSku, class_name: e.target.value })}
                  className="w-full border border-line p-1.5 text-xs"
                />
              </div>

              <div>
                <label className="block text-neutral-600 mb-1">Mass Class:</label>
                <select
                  value={newSku.mass_class}
                  onChange={(e) => setNewSku({ ...newSku, mass_class: e.target.value })}
                  className="w-full border border-line p-1.5 text-xs bg-white"
                >
                  <option value="light">Light (&lt; 10 kg)</option>
                  <option value="medium">Medium (10–25 kg)</option>
                  <option value="heavy">Heavy (&gt; 25 kg)</option>
                </select>
              </div>

              <div>
                <label className="block text-neutral-600 mb-1">Required Orientation:</label>
                <select
                  value={newSku.required_orientation || ''}
                  onChange={(e) =>
                    setNewSku({ ...newSku, required_orientation: e.target.value || null })
                  }
                  className="w-full border border-line p-1.5 text-xs bg-white"
                >
                  <option value="">Unconstrained</option>
                  <option value="vertical">Vertical (This Side Up)</option>
                  <option value="horizontal">Horizontal (Flatpack)</option>
                </select>
              </div>

              <div>
                <label className="block text-neutral-600 mb-1">Max Stack Height:</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={newSku.max_stack_height}
                  onChange={(e) => setNewSku({ ...newSku, max_stack_height: Number(e.target.value) })}
                  className="w-full border border-line p-1.5 text-xs"
                />
              </div>

              <button
                type="submit"
                className="mt-2 border border-ink bg-ink text-white py-1.5 font-medium hover:bg-neutral-800 transition-colors"
              >
                Register SKU Metadata
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Tab: Zones */}
      {activeTab === 'zones' && (
        <div className="grid grid-cols-[1fr_340px] gap-6">
          <div className="border border-line bg-white p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-3">
              Calibrated Camera Hazard Zones
            </h2>
            <div className="flex flex-col gap-3">
              {zones.map((z) => (
                <div key={z.zone_id} className="border border-line p-3 flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-ink text-xs">{z.zone_id}</span>
                      <span className="border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-neutral-600">
                        {z.zone_type}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-500">
                      Polygon Vertices (<span className="font-mono tabular-nums">{z.polygon.length}</span> points):{' '}
                      <span className="font-mono text-[10px]">{JSON.stringify(z.polygon.map(([x, y]) => [Number(x.toFixed(2)), Number(y.toFixed(2))]))}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-neutral-700">
                      Severity: <span className="font-mono tabular-nums">{z.severity_multiplier}x</span>
                    </span>
                    {deleteConfirmZoneId === z.zone_id ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleDeleteZone(z.zone_id)}
                          className="px-1.5 py-0.5 text-[10px] font-semibold bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmZoneId(null)}
                          className="px-1.5 py-0.5 text-[10px] bg-neutral-100 text-neutral-600 rounded hover:bg-neutral-200"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmZoneId(z.zone_id)}
                        className="text-[11px] text-neutral-400 hover:text-red-600 transition-colors font-medium"
                        title={`Delete Zone ${z.zone_id}`}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Add Zone Form */}
          <div className="border border-line bg-white p-4 flex flex-col gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Register Calibrated Zone
            </h2>
            {zoneMsg && (
              <div
                className={`p-2 text-xs border ${
                  zoneMsg.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-red-200 bg-red-50 text-red-800'
                }`}
              >
                {zoneMsg.text}
              </div>
            )}
            <form onSubmit={handleCreateZone} className="flex flex-col gap-2.5 text-xs">
              <div>
                <label className="block text-neutral-600 mb-1">Zone ID (Unique):</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. dock_edge_bay_3"
                  value={newZone.zone_id}
                  onChange={(e) => setNewZone({ ...newZone, zone_id: e.target.value })}
                  className="w-full border border-line p-1.5 font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-neutral-600 mb-1">Zone Type:</label>
                <select
                  value={newZone.zone_type}
                  onChange={(e) => setNewZone({ ...newZone, zone_type: e.target.value })}
                  className="w-full border border-line p-1.5 text-xs bg-white"
                >
                  <option value="dock_edge">dock_edge</option>
                  <option value="wet_floor">wet_floor</option>
                  <option value="pedestrian_walkway">pedestrian_walkway</option>
                  <option value="traffic_lane">traffic_lane</option>
                  <option value="restricted_area">restricted_area</option>
                </select>
              </div>

              <div>
                <label className="block text-neutral-600 mb-1">Severity Multiplier:</label>
                <input
                  type="number"
                  step="0.1"
                  min="1.0"
                  max="5.0"
                  required
                  value={newZone.severity_multiplier}
                  onChange={(e) => setNewZone({ ...newZone, severity_multiplier: e.target.value })}
                  className="w-full border border-line p-1.5 text-xs font-mono"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-neutral-600">Normalized Polygon JSON:</label>
                </div>
                <textarea
                  rows="3"
                  required
                  value={newZone.polygon_text}
                  onChange={(e) => setNewZone({ ...newZone, polygon_text: e.target.value })}
                  className="w-full border border-line p-1.5 font-mono text-[11px]"
                  placeholder="[[0.0, 0.75], [1.0, 0.75], [1.0, 1.0], [0.0, 1.0]]"
                />
                <div className="flex flex-wrap gap-1 mt-1">
                  <span className="text-[10px] text-neutral-400 self-center">Presets:</span>
                  <button
                    type="button"
                    onClick={() =>
                      setNewZone({
                        ...newZone,
                        polygon_text: '[[0.0, 0.75], [1.0, 0.75], [1.0, 1.0], [0.0, 1.0]]',
                      })
                    }
                    className="text-[10px] border border-line px-1.5 py-0.5 rounded text-neutral-600 hover:bg-neutral-100"
                  >
                    Dock Edge Strip
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setNewZone({
                        ...newZone,
                        polygon_text: '[[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]',
                      })
                    }
                    className="text-[10px] border border-line px-1.5 py-0.5 rounded text-neutral-600 hover:bg-neutral-100"
                  >
                    Center Region
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="mt-2 border border-ink bg-ink text-white py-1.5 font-medium hover:bg-neutral-800 transition-colors"
              >
                Register Calibrated Zone
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Tab: Manifests */}
      {activeTab === 'manifests' && (
        <div className="border border-line bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-3">
            Camera Source to Operational Manifest Links
          </h2>
          <div className="flex flex-col gap-3">
            {manifests.length === 0 ? (
              <p className="text-xs text-neutral-500">No dynamic manifests registered via API.</p>
            ) : (
              manifests.map((m) => (
                <div key={m.source_id} className="border border-line p-3 flex justify-between items-start">
                  <div>
                    <span className="font-bold text-ink text-xs">{m.bay_name}</span>
                    <span className="ml-2 font-mono text-[11px] text-neutral-400">({m.manifest_id})</span>
                    <p className="mt-1 text-[11px] text-neutral-600">
                      Source ID: <span className="font-mono">{m.source_id}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-neutral-500">
                      Primary Product: <span className="font-mono font-medium">{m.primary_product_id || 'None'}</span> •{' '}
                      {m.product_count} Products • {m.zone_count} Zones
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
