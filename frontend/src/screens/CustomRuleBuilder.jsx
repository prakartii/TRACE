/**
 * Custom Rule Builder — TRACE Phase 13 (Micro-training / Rule Config).
 *
 * A fully functional operational safety rule builder backed by /api/rules.
 */

import { useEffect, useState } from 'react'
import { ArrowRight, ListChecks, Plus, Trash2 } from 'lucide-react'
import {
  createRule,
  deleteRule,
  evaluateRule,
  getRuleSchema,
  listRules,
  updateRule,
} from '../api/rules.js'

const EMPTY_SIMPLE_CONDITION = { field: 'score', operator: '>=', value: '' }

const EMPTY_RULE = {
  name: '',
  description: '',
  lens: '',
  severity_band: '',
  enabled: true,
  action_text: '',
  condition: EMPTY_SIMPLE_CONDITION,
  created_by: 'operator',
}

const BAND_COLORS = {
  Low: 'text-ok bg-ok/10 border-ok/40',
  Medium: 'text-steel bg-steel/10 border-steel/40',
  High: 'text-[#8a5f00] bg-signal/10 border-signal/40',
  Critical: 'text-danger bg-danger/10 border-danger/40',
}

const LENS_LABELS = {
  structural: 'Structural',
  behaviour: 'Behaviour',
  conformance: 'Conformance',
  environmental: 'Environmental',
}

function StatusBadge({ enabled }) {
  return (
    <span
      className={`border px-1.5 py-0.5 text-label font-medium ${
        enabled ? 'border-ok/40 bg-ok/10 text-ok' : 'border-line bg-paper text-ink-faint'
      }`}
    >
      {enabled ? 'Active' : 'Paused'}
    </span>
  )
}

function BandBadge({ band }) {
  if (!band) return null
  const cls = BAND_COLORS[band] || 'border-line bg-paper text-ink-soft'
  return <span className={`border px-1.5 py-0.5 text-label font-medium ${cls}`}>{band}</span>
}

function Alert({ type, text }) {
  const cls =
    type === 'success'
      ? 'border-ok/40 bg-ok/10 text-ok'
      : 'border-danger bg-danger/5 text-danger'
  return <div className={`border p-2 text-caption ${cls}`}>{text}</div>
}

function ConditionSummary({ condition }) {
  if (!condition) return <span className="italic text-ink-faint">no condition</span>

  if (condition.logic) {
    const parts = (condition.conditions || []).map((c, i) => (
      <span key={i}>
        {i > 0 && <span className="mx-1 font-medium text-ink-faint">{condition.logic}</span>}
        <ConditionSummary condition={c} />
      </span>
    ))
    return <span className="font-mono text-caption">{parts}</span>
  }

  const { field, operator, value } = condition
  return (
    <span className="font-mono text-caption">
      <span className="text-steel">{field}</span>
      <span className="mx-1 text-ink-faint">{operator}</span>
      <span className="font-medium text-ink">{String(value)}</span>
    </span>
  )
}

function SimpleConditionRow({ condition, onChange, schema, disabled }) {
  const fieldInfo = schema?.field_details?.[condition.field] || {}
  const allowedOps = fieldInfo.allowed_operators || schema?.supported_operators || []
  const isNumeric = fieldInfo.type === 'numeric'
  const isCategorical = fieldInfo.type === 'categorical' || fieldInfo.type === 'ordinal'
  const allowedValues = fieldInfo.allowed_values || []

  function handleField(newField) {
    const newFieldInfo = schema?.field_details?.[newField] || {}
    const defaultOp = (newFieldInfo.allowed_operators || ['=='])[0]
    const defaultValue = newFieldInfo.type === 'numeric' ? '' : (newFieldInfo.allowed_values || [''])[0]
    onChange({ field: newField, operator: defaultOp, value: defaultValue })
  }

  function handleOp(newOp) {
    onChange({ ...condition, operator: newOp })
  }

  function handleValue(rawVal) {
    const parsed = isNumeric ? (rawVal === '' ? '' : Number(rawVal)) : rawVal
    onChange({ ...condition, value: parsed })
  }

  const selectCls = 'border border-line bg-surface p-1.5 font-mono text-caption text-ink focus:border-ink'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select disabled={disabled} value={condition.field} onChange={(e) => handleField(e.target.value)} className={`${selectCls} min-w-[140px]`}>
        {(schema?.supported_fields || []).map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>

      <select disabled={disabled} value={condition.operator} onChange={(e) => handleOp(e.target.value)} className={`${selectCls} w-16`}>
        {allowedOps.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>

      {isCategorical && allowedValues.length > 0 ? (
        <select disabled={disabled} value={condition.value} onChange={(e) => handleValue(e.target.value)} className={`${selectCls} min-w-[140px]`}>
          {allowedValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : (
        <input
          disabled={disabled}
          type={isNumeric ? 'number' : 'text'}
          min={isNumeric ? 0 : undefined}
          max={isNumeric ? 100 : undefined}
          step={isNumeric ? 1 : undefined}
          placeholder={isNumeric ? '0–100' : 'value'}
          value={condition.value}
          onChange={(e) => handleValue(e.target.value)}
          className={`${selectCls} w-28`}
        />
      )}

      {fieldInfo.description && (
        <span className="max-w-[180px] truncate text-caption italic text-ink-faint">{fieldInfo.description}</span>
      )}
    </div>
  )
}

function CompoundConditionEditor({ condition, onChange, schema, disabled }) {
  const isCompound = !!condition.logic

  function switchToCompound() {
    onChange({
      logic: 'AND',
      conditions: [{ ...EMPTY_SIMPLE_CONDITION }, { ...EMPTY_SIMPLE_CONDITION }],
    })
  }

  function switchToSimple() {
    onChange({ ...EMPTY_SIMPLE_CONDITION })
  }

  function updateSubCondition(idx, newCond) {
    const updated = [...condition.conditions]
    updated[idx] = newCond
    onChange({ ...condition, conditions: updated })
  }

  function addSubCondition() {
    onChange({ ...condition, conditions: [...condition.conditions, { ...EMPTY_SIMPLE_CONDITION }] })
  }

  function removeSubCondition(idx) {
    if (condition.conditions.length <= 2) return
    const updated = condition.conditions.filter((_, i) => i !== idx)
    onChange({ ...condition, conditions: updated })
  }

  return (
    <div className="flex flex-col gap-2">
      {!isCompound && <SimpleConditionRow condition={condition} onChange={onChange} schema={schema} disabled={disabled} />}

      {isCompound ? (
        <div className="flex flex-col gap-2 border-l-2 border-steel/40 pl-3">
          <div className="flex items-center gap-2">
            <span className="text-caption text-ink-soft">Match</span>
            <select
              disabled={disabled}
              value={condition.logic}
              onChange={(e) => onChange({ ...condition, logic: e.target.value })}
              className="border border-line bg-surface p-1 font-medium text-caption text-ink focus:border-ink"
            >
              <option value="AND">all of these</option>
              <option value="OR">any of these</option>
            </select>
          </div>

          {condition.conditions.map((sub, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="w-8 text-right text-caption text-ink-faint">{idx + 1}.</span>
              <SimpleConditionRow condition={sub} onChange={(c) => updateSubCondition(idx, c)} schema={schema} disabled={disabled} />
              {condition.conditions.length > 2 && (
                <button type="button" disabled={disabled} onClick={() => removeSubCondition(idx)} className="px-1 text-caption text-ink-faint hover:text-danger cursor-pointer" title="Remove this condition">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}

          <div className="flex items-center gap-3">
            <button type="button" disabled={disabled} onClick={addSubCondition} className="border border-line px-2 py-0.5 text-caption text-ink-soft hover:bg-paper disabled:opacity-50 cursor-pointer">
              + Add another condition
            </button>
            <button type="button" disabled={disabled} onClick={switchToSimple} className="text-caption text-ink-faint hover:text-ink disabled:opacity-50 cursor-pointer">
              Use a single condition instead
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={switchToCompound}
          className="self-start text-caption text-ink-faint hover:text-ink disabled:opacity-50 cursor-pointer"
        >
          + Match more than one condition
        </button>
      )}
    </div>
  )
}

function RuleForm({ initialRule, schema, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initialRule || EMPTY_RULE)
  const [msg, setMsg] = useState(null)

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setMsg(null)

    if (!form.name.trim()) {
      setMsg({ type: 'error', text: 'Rule name is required.' })
      return
    }

    const cleanCondition = JSON.parse(JSON.stringify(form.condition))

    try {
      await onSave({ ...form, condition: cleanCondition })
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    }
  }

  const labelCls = 'mb-1 block text-caption text-ink-soft'
  const inputCls = 'w-full border border-line bg-surface p-1.5 text-small text-ink focus:border-ink'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {msg && <Alert type={msg.type} text={msg.text} />}

      <div>
        <label className={labelCls}>Rule name <span className="text-danger">*</span></label>
        <input type="text" required maxLength={120} placeholder="e.g. Escalate repeated dock-edge exposure" value={form.name} onChange={(e) => update('name', e.target.value)} className={inputCls} />
      </div>

      <div>
        <label className={labelCls}>What is this rule for?</label>
        <textarea rows={2} maxLength={1000} placeholder="A short note for other supervisors on why this rule exists" value={form.description} onChange={(e) => update('description', e.target.value)} className={`${inputCls} resize-none`} />
      </div>

      <div className="flex flex-col gap-3 border border-steel/40 bg-steel/5 p-3">
        <div className="text-label font-bold uppercase tracking-wider text-steel">If a detected event matches…</div>
        <CompoundConditionEditor condition={form.condition} onChange={(c) => update('condition', c)} schema={schema} disabled={saving} />
      </div>

      <div className="flex flex-col gap-3 border border-ok/40 bg-ok/5 p-3">
        <div className="text-label font-bold uppercase tracking-wider text-ok">Then…</div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Applies to</label>
            <select value={form.lens || ''} onChange={(e) => update('lens', e.target.value || null)} className={inputCls}>
              <option value="">Any risk lens</option>
              {Object.entries(LENS_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Set risk level to</label>
            <select value={form.severity_band || ''} onChange={(e) => update('severity_band', e.target.value || null)} className={inputCls}>
              <option value="">Keep the detected level</option>
              {['Low', 'Medium', 'High', 'Critical'].map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelCls}>Tell the supervisor to</label>
          <textarea rows={2} maxLength={500} placeholder="e.g. Halt the operation. Supervisor review required before continuing." value={form.action_text || ''} onChange={(e) => update('action_text', e.target.value)} className={`${inputCls} resize-none`} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input type="checkbox" id="rule-enabled" checked={form.enabled} onChange={(e) => update('enabled', e.target.checked)} className="accent-ink" />
        <label htmlFor="rule-enabled" className="text-caption text-ink-soft">Rule is active</label>
        <span className="text-caption text-ink-faint">(paused rules are saved but don't affect live scoring)</span>
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="border border-ink bg-ink px-4 py-1.5 text-small font-medium text-paper transition-colors hover:bg-ink-soft disabled:opacity-60 cursor-pointer">
          {saving ? 'Saving…' : 'Save Rule'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="border border-line px-4 py-1.5 text-small text-ink-soft transition-colors hover:bg-paper cursor-pointer">
          Cancel
        </button>
      </div>
    </form>
  )
}

function EvaluationPanel({ result, onClose }) {
  if (!result) return null
  const { matched_count, total_evaluated, sample_matches, epistemic_label, notice } = result

  return (
    <div className="flex flex-col gap-3 border border-steel/40 bg-steel/5 p-4">
      <div className="flex items-center justify-between">
        <div className="text-small font-bold uppercase tracking-wider text-steel">Test Result</div>
        <button onClick={onClose} className="text-caption text-ink-faint hover:text-ink cursor-pointer">close</button>
      </div>

      <div className="flex gap-6">
        <div>
          <div className="text-xl font-semibold tabular-nums text-steel">{matched_count}</div>
          <div className="text-caption text-ink-soft">events matched</div>
        </div>
        <div>
          <div className="text-xl font-semibold tabular-nums text-ink">{total_evaluated}</div>
          <div className="text-caption text-ink-soft">events checked</div>
        </div>
        <div>
          <div className="text-xl font-semibold tabular-nums text-ink">
            {total_evaluated > 0 ? `${((matched_count / total_evaluated) * 100).toFixed(1)}%` : '—'}
          </div>
          <div className="text-caption text-ink-soft">match rate</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="border border-signal/40 bg-signal/10 px-1.5 py-0.5 text-label font-medium text-[#8a5f00]">{epistemic_label}</span>
        <span className="text-caption italic text-ink-soft">{notice}</span>
      </div>

      {sample_matches && sample_matches.length > 0 && (
        <div>
          <div className="mb-1 text-caption font-medium text-ink-soft">Sample matches (up to 10)</div>
          <div className="overflow-x-auto">
            <table className="w-full border border-line text-left text-caption">
              <thead>
                <tr className="border-b border-line bg-surface text-label text-ink-faint">
                  <th className="px-2 py-1 font-medium">id</th>
                  <th className="px-2 py-1 font-medium">lens</th>
                  <th className="px-2 py-1 font-medium">score</th>
                  <th className="px-2 py-1 font-medium">band</th>
                  <th className="px-2 py-1 font-medium">scenario</th>
                  <th className="px-2 py-1 font-medium">video</th>
                  <th className="px-2 py-1 font-medium">time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sample_matches.map((e) => (
                  <tr key={e.event_id} className="hover:bg-surface">
                    <td className="px-2 py-1 font-mono text-ink-faint">#{e.event_id}</td>
                    <td className="px-2 py-1 capitalize text-ink-soft">{e.lens}</td>
                    <td className="px-2 py-1 font-mono font-medium text-ink">{e.score ?? '—'}</td>
                    <td className="px-2 py-1">
                      <BandBadge band={e.band} />
                    </td>
                    <td className="max-w-[160px] truncate px-2 py-1 font-mono text-ink-faint">{e.scenario || '—'}</td>
                    <td className="px-2 py-1 font-mono text-ink-faint">{e.video_id || '—'}</td>
                    <td className="px-2 py-1 font-mono text-ink-faint">{e.timestamp != null ? `${Number(e.timestamp).toFixed(1)}s` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {matched_count === 0 && <p className="text-caption italic text-ink-soft">No current events match this rule's condition.</p>}
    </div>
  )
}

function RuleCard({ rule, onEdit, onDelete, onEvaluate, evaluating }) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className={`flex flex-col gap-3 border p-4 ${rule.enabled ? 'border-line bg-surface' : 'border-line bg-paper'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-title font-semibold text-ink">{rule.name || 'Unnamed rule'}</span>
            <StatusBadge enabled={rule.enabled} />
            {rule.severity_band && <BandBadge band={rule.severity_band} />}
            {rule.lens && (
              <span className="border border-line bg-paper px-1.5 py-0.5 text-label text-ink-soft">
                {LENS_LABELS[rule.lens] || rule.lens}
              </span>
            )}
          </div>
          {rule.description && <p className="text-caption text-ink-soft">{rule.description}</p>}
        </div>
        <span className="shrink-0 font-mono text-caption tabular-nums text-ink-faint">#{rule.rule_id}</span>
      </div>

      <div className="border border-steel/40 bg-steel/5 p-2">
        <div className="mb-1 text-label font-bold uppercase tracking-wider text-steel">If</div>
        <ConditionSummary condition={rule.condition} />
      </div>

      {rule.action_text && (
        <div className="border border-ok/40 bg-ok/5 p-2">
          <div className="mb-1 flex items-center gap-1 text-label font-bold uppercase tracking-wider text-ok">
            <ArrowRight size={11} />
            Then
          </div>
          <p className="text-caption text-ink-soft">{rule.action_text}</p>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-line pt-2">
        <button onClick={() => onEvaluate(rule.rule_id)} disabled={evaluating} className="border border-steel/40 px-2.5 py-1 text-caption font-medium text-steel transition-colors hover:bg-steel/10 disabled:opacity-50 cursor-pointer">
          {evaluating ? 'Testing…' : 'Test Against Real Events'}
        </button>
        <button onClick={() => onEdit(rule)} className="border border-line px-2.5 py-1 text-caption text-ink-soft transition-colors hover:bg-paper cursor-pointer">
          Edit
        </button>
        {confirmDelete ? (
          <div className="ml-auto inline-flex items-center gap-1.5">
            <button onClick={() => onDelete(rule.rule_id)} className="bg-danger px-1.5 py-0.5 text-label font-medium text-paper hover:opacity-90 cursor-pointer">
              Confirm Delete
            </button>
            <button onClick={() => setConfirmDelete(false)} className="bg-paper px-1.5 py-0.5 text-label text-ink-soft hover:bg-line cursor-pointer">
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="ml-auto text-caption text-ink-faint transition-colors hover:text-danger cursor-pointer">
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

export default function CustomRuleBuilder() {
  const [rules, setRules] = useState([])
  const [schema, setSchema] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [showForm, setShowForm] = useState(false)
  const [editingRule, setEditingRule] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formSuccess, setFormSuccess] = useState(null)

  const [evaluatingId, setEvaluatingId] = useState(null)
  const [evalResults, setEvalResults] = useState({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([listRules(), getRuleSchema()])
      .then(([ruleList, schemaData]) => {
        if (cancelled) return
        setRules(ruleList)
        setSchema(schemaData)
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  function openCreateForm() {
    setEditingRule(null)
    setFormSuccess(null)
    setShowForm(true)
  }

  function openEditForm(rule) {
    setEditingRule(rule)
    setFormSuccess(null)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingRule(null)
  }

  async function handleSave(formData) {
    setSaving(true)
    try {
      if (editingRule) {
        const updates = {
          name: formData.name,
          description: formData.description,
          lens: formData.lens || null,
          severity_band: formData.severity_band || null,
          enabled: formData.enabled,
          action_text: formData.action_text || null,
          condition: formData.condition,
        }
        const updated = await updateRule(editingRule.rule_id, updates)
        setRules((prev) => prev.map((r) => (r.rule_id === updated.rule_id ? updated : r)))
        setFormSuccess(`Rule '${updated.name}' updated.`)
      } else {
        const created = await createRule({
          ...formData,
          lens: formData.lens || null,
          severity_band: formData.severity_band || null,
          action_text: formData.action_text || null,
        })
        setRules((prev) => [created, ...prev])
        setFormSuccess(`Rule '${created.name}' created.`)
      }
      closeForm()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(ruleId) {
    await deleteRule(ruleId)
    setRules((prev) => prev.filter((r) => r.rule_id !== ruleId))
    setEvalResults((prev) => {
      const next = { ...prev }
      delete next[ruleId]
      return next
    })
  }

  async function handleEvaluate(ruleId) {
    setEvaluatingId(ruleId)
    try {
      const result = await evaluateRule(ruleId)
      setEvalResults((prev) => ({ ...prev, [ruleId]: result }))
    } catch (err) {
      setEvalResults((prev) => ({ ...prev, [ruleId]: { error: err.message } }))
    } finally {
      setEvaluatingId(null)
    }
  }

  if (loading) {
    return <div className="p-4 text-small text-ink-soft">Loading custom rules…</div>
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-ink text-paper">
            <ListChecks size={14} />
          </span>
          <div>
            <h2 className="text-title font-bold text-ink">Custom Safety Rules</h2>
            <p className="mt-1 max-w-lg text-caption text-ink-soft">
              Site-specific rules that apply on top of TRACE's built-in checks — test them against real
              detected events before saving, and they take effect immediately, no restart needed.
            </p>
          </div>
        </div>
        <button onClick={openCreateForm} className="inline-flex shrink-0 items-center gap-1.5 border border-ink bg-ink px-3 py-1.5 text-small font-medium text-paper transition-colors hover:bg-ink-soft cursor-pointer">
          <Plus size={14} />
          New Rule
        </button>
      </div>

      {error && <Alert type="error" text={error} />}
      {formSuccess && <Alert type="success" text={formSuccess} />}

      {showForm && (
        <div className="border border-line bg-surface p-4">
          <h3 className="mb-4 text-small font-bold text-ink">
            {editingRule ? `Edit Rule: ${editingRule.name}` : 'Create a New Rule'}
          </h3>
          <RuleForm
            initialRule={
              editingRule
                ? {
                    name: editingRule.name || '',
                    description: editingRule.description || '',
                    lens: editingRule.lens || '',
                    severity_band: editingRule.severity_band || '',
                    enabled: editingRule.enabled ?? true,
                    action_text: editingRule.action_text || '',
                    condition: editingRule.condition || EMPTY_SIMPLE_CONDITION,
                    created_by: editingRule.created_by || 'operator',
                  }
                : undefined
            }
            schema={schema}
            onSave={handleSave}
            onCancel={closeForm}
            saving={saving}
          />
        </div>
      )}

      {rules.length === 0 ? (
        <div className="border border-dashed border-line-strong p-8 text-center">
          <p className="text-title font-semibold text-ink">No custom rules yet</p>
          <p className="mt-1 text-caption text-ink-soft">Click "New Rule" to add your first site-specific safety rule.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rules.map((rule) => (
            <div key={rule.rule_id}>
              <RuleCard rule={rule} onEdit={openEditForm} onDelete={handleDelete} onEvaluate={handleEvaluate} evaluating={evaluatingId === rule.rule_id} />
              {evalResults[rule.rule_id] && (
                <div className="mt-1">
                  {evalResults[rule.rule_id].error ? (
                    <Alert type="error" text={evalResults[rule.rule_id].error} />
                  ) : (
                    <EvaluationPanel
                      result={evalResults[rule.rule_id]}
                      onClose={() =>
                        setEvalResults((prev) => {
                          const next = { ...prev }
                          delete next[rule.rule_id]
                          return next
                        })
                      }
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {schema && (
        <details className="text-small">
          <summary className="cursor-pointer text-caption text-ink-faint select-none hover:text-ink">
            What can a condition check?
          </summary>
          <div className="mt-2 flex flex-col gap-2 border border-line bg-surface p-3">
            {schema.supported_fields.map((f) => {
              const info = schema.field_details[f] || {}
              return (
                <div key={f} className="flex items-start gap-3">
                  <span className="w-24 shrink-0 font-mono font-medium text-steel">{f}</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-caption text-ink-soft">{info.description}</span>
                    {info.allowed_values && <span className="text-caption text-ink-faint">Values: {info.allowed_values.join(', ')}</span>}
                    {info.range && <span className="text-caption text-ink-faint">Range: {info.range[0]}–{info.range[1]}</span>}
                    <span className="text-caption text-ink-faint">Operators: {(info.allowed_operators || []).join('  ')}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </details>
      )}
    </div>
  )
}
