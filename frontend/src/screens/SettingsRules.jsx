import { useEffect, useState } from 'react'
import { listProducts } from '../api/videos.js'
import RuleBuilder from './settings-rules-builder.jsx'

export default function SettingsRules() {
  const [products, setProducts] = useState(null)

  useEffect(() => {
    listProducts()
      .then(setProducts)
      .catch(() => setProducts([]))
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <section className="panel">
        <span className="eyebrow mb-3 block">Product rules</span>
        {products === null ? (
          <p className="text-caption text-mute">loading…</p>
        ) : products.length === 0 ? (
          <p className="text-caption text-mute">No product metadata configured.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-caption">
              <thead>
                <tr className="text-left text-label uppercase tracking-[0.04em] text-mute">
                  <th className="border-b border-line py-2 pr-4">SKU</th>
                  <th className="border-b border-line py-2 pr-4">mass</th>
                  <th className="border-b border-line py-2 pr-4">orientation</th>
                  <th className="border-b border-line py-2 pr-4">
                    max stack <span className="font-normal normal-case">(not enforced)</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.product_id} className="border-b border-line last:border-b-0">
                    <td className="py-2 pr-4 font-mono">{p.product_id}</td>
                    <td className="py-2 pr-4">{p.mass_class}</td>
                    <td className="py-2 pr-4 font-mono">{p.required_orientation || 'unconstrained'}</td>
                    <td className="py-2 pr-4 font-mono text-dim">{p.max_stack_height || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-label text-mute">
          Required orientation is enforced by the conformance lens and as a planner hard
          constraint. Max stack height is stored and exported but no lens reads it.
        </p>
      </section>

      <section>
        <span className="eyebrow mb-3 block">Custom rules</span>
        <p className="mb-4 text-caption text-dim">
          A matching rule raises a finding&rsquo;s risk band at runtime and attaches its action —
          shown on the finding as a supervisor-rule notice. It never lowers a band or changes
          evidence status.
        </p>
        <RuleBuilder />
      </section>
    </div>
  )
}
