/**
 * Custom Rule Builder — TRACE Phase 13 (Micro-training / Rule Config).
 *
 * A fully functional operational safety rule builder that:
 * - Lists all custom rules
 * - Creates new rules with structured condition builder (no free-text code)
 * - Edits existing rules
 * - Enables/disables rules
 * - Deletes rules (with confirmation)
 * - Evaluates rules against the live TRACE event database
 *
 * All condition fields and operators come from the backend /api/rules/schema
 * endpoint — the UI only offers choices that the engine actually supports.
 */

import { useEffect, useState } from 'react'
import {
  createRule,
  deleteRule,
  evaluateRule,
  getRuleSchema,
  listRules,
  updateRule,
} from '../api/rules.js'

// ─── Constants ────────────────────────────────────────────────────────────────

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
  Low: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  Medium: 'text-amber-700 bg-amber-50 border-amber-200',
  High: 'text-orange-700 bg-orange-50 border-orange-200',
  Critical: 'text-red-700 bg-red-50 border-red-200',
}

const LENS_LABELS = {
  structural: 'Structural',
  behaviour: 'Behaviour',
  conformance: 'Conformance',
  environmental: 'Environmental',
}

// ─── Small helper components ──────────────────────────────────────────────────

function StatusBadge({ enabled }) {
  return (
    <span
      className={`px-1.5 py-0.5 text-[10px] font-semibold border ${
        enabled
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-neutral-100 text-neutral-500 border-neutral-300'
      }`}
    >
      {enabled ? 'ENABLED' : 'DISABLED'}
    </span>
  )
}

function BandBadge({ band }) {
  if (!band) return null
  const cls = BAND_COLORS[band] || 'text-neutral-600 bg-neutral-50 border-neutral-200'
  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-semibold border ${cls}`}>
      {band.toUpperCase()}
    </span>
  )
}

function Alert({ type, text }) {
  const cls =
    type === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-red-200 bg-red-50 text-red-800'
  return <div className={`p-2 text-xs border ${cls}`}>{text}</div>
}

// ─── Condition display (read-only summary) ────────────────────────────────────

function ConditionSummary({ condition }) {
  if (!condition) return <span className="text-neutral-400 italic">No condition</span>

  if (condition.logic) {
    const parts = (condition.conditions || []).map((c, i) => (
      <span key={i}>
        {i > 0 && (
          <span className="mx-1 font-semibold text-neutral-500">{condition.logic}</span>
        )}
        <ConditionSummary condition={c} />
      </span>
    ))
    return <span className="font-mono text-xs">{parts}</span>
  }

  const { field, operator, value } = condition
  return (
    <span className="font-mono text-xs">
      <span className="text-blue-700">{field}</span>
      <span className="mx-1 text-neutral-500">{operator}</span>
      <span className="text-ink font-semibold">{String(value)}</span>
    </span>
  )
}

// ─── Simple condition editor row ──────────────────────────────────────────────

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

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Field */}
      <select
        disabled={disabled}
        value={condition.field}
        onChange={(e) => handleField(e.target.value)}
        className="border border-line p-1.5 text-xs bg-white font-mono min-w-[140px]"
      >
        {(schema?.supported_fields || []).map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>

      {/* Operator */}
      <select
        disabled={disabled}
        value={condition.operator}
        onChange={(e) => handleOp(e.target.value)}
        className="border border-line p-1.5 text-xs bg-white font-mono w-16"
      >
        {allowedOps.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>

      {/* Value */}
      {isCategorical && allowedValues.length > 0 ? (
        <select
          disabled={disabled}
          value={condition.value}
          onChange={(e) => handleValue(e.target.value)}
          className="border border-line p-1.5 text-xs bg-white font-mono min-w-[140px]"
        >
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
          className="border border-line p-1.5 text-xs font-mono w-28"
        />
      )}

      {/* Field description hint */}
      {fieldInfo.description && (
        <span className="text-[10px] text-neutral-400 italic truncate max-w-[180px]">
          {fieldInfo.description}
        </span>
      )}
    </div>
  )
}

// ─── Compound condition editor ────────────────────────────────────────────────

function CompoundConditionEditor({ condition, onChange, schema, disabled }) {
  const isCompound = !!condition.logic

  function switchToCompound() {
    onChange({
      logic: 'AND',
      conditions: [
        { ...EMPTY_SIMPLE_CONDITION },
        { ...EMPTY_SIMPLE_CONDITION },
      ],
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
    onChange({
      ...condition,
      conditions: [...condition.conditions, { ...EMPTY_SIMPLE_CONDITION }],
    })
  }

  function removeSubCondition(idx) {
    if (condition.conditions.length <= 2) return // minimum 2
    const updated = condition.conditions.filter((_, i) => i !== idx)
    onChange({ ...condition, conditions: updated })
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-neutral-500 font-medium">Condition type:</span>
        <button
          type="button"
          disabled={disabled}
          onClick={isCompound ? switchToSimple : switchToCompound}
          className="text-[11px] border border-line px-2 py-0.5 rounded text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
        >
          {isCompound ? 'Switch to Simple' : 'Switch to Compound (AND/OR)'}
        </button>
      </div>

      {isCompound ? (
        <div className="flex flex-col gap-2 pl-3 border-l-2 border-blue-200">
          {/* Logic selector */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-neutral-500">Combine with:</span>
            <select
              disabled={disabled}
              value={condition.logic}
              onChange={(e) => onChange({ ...condition, logic: e.target.value })}
              className="border border-line p-1 text-xs bg-white font-semibold"
            >
              <option value="AND">AND (all must match)</option>
              <option value="OR">OR (any must match)</option>
            </select>
          </div>

          {/* Sub-conditions */}
          {condition.conditions.map((sub, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="text-[10px] text-neutral-400 w-8 text-right">{idx + 1}.</span>
              <SimpleConditionRow
                condition={sub}
                onChange={(c) => updateSubCondition(idx, c)}
                schema={schema}
                disabled={disabled}
              />
              {condition.conditions.length > 2 && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeSubCondition(idx)}
                  className="text-[11px] text-red-400 hover:text-red-600 px-1"
                  title="Remove this condition"
                >
                  ✕
                </button>
              )}
            </div>
          ))}

          <button
            type="button"
            disabled={disabled}
            onClick={addSubCondition}
            className="self-start text-[11px] border border-line px-2 py-0.5 rounded text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
          >
            + Add condition
          </button>
        </div>
      ) : (
        <SimpleConditionRow
          condition={condition}
          onChange={onChange}
          schema={schema}
          disabled={disabled}
        />
      )}
    </div>
  )
}

// ─── Rule form (create / edit) ────────────────────────────────────────────────

function RuleForm({ initialRule, schema, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initialRule || EMPTY_RULE)
  const [msg, setMsg] = useState(null)

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setMsg(null)

    // Basic client-side guard
    if (!form.name.trim()) {
      setMsg({ type: 'error', text: 'Rule name is required.' })
      return
    }

    // Validate numeric score values aren't empty strings
    const cleanCondition = JSON.parse(JSON.stringify(form.condition))

    try {
      await onSave({ ...form, condition: cleanCondition })
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-xs">
      {msg && <Alert type={msg.type} text={msg.text} />}

      {/* Name */}
      <div>
        <label className="block text-neutral-600 mb-1 font-medium">
          Rule Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          required
          maxLength={120}
          placeholder="e.g. High-Risk Behaviour Escalation"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          className="w-full border border-line p-1.5 text-xs"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-neutral-600 mb-1 font-medium">Description</label>
        <textarea
          rows={2}
          maxLength={1000}
          placeholder="Describe the operational purpose of this rule"
          value={form.description}
          onChange={(e) => update('description', e.target.value)}
          className="w-full border border-line p-1.5 text-xs resize-none"
        />
      </div>

      {/* WHEN block */}
      <div className="border border-blue-200 bg-blue-50/40 p-3 flex flex-col gap-3">
        <div className="text-[11px] font-bold text-blue-800 uppercase tracking-wide">WHEN</div>

        {/* Condition builder */}
        <div>
          <label className="block text-neutral-600 mb-2 font-medium">Condition</label>
          <CompoundConditionEditor
            condition={form.condition}
            onChange={(c) => update('condition', c)}
            schema={schema}
            disabled={saving}
          />
        </div>
      </div>

      {/* THEN block */}
      <div className="border border-emerald-200 bg-emerald-50/40 p-3 flex flex-col gap-3">
        <div className="text-[11px] font-bold text-emerald-800 uppercase tracking-wide">THEN</div>

        <div className="grid grid-cols-2 gap-3">
          {/* Target lens */}
          <div>
            <label className="block text-neutral-600 mb-1 font-medium">Target Lens</label>
            <select
              value={form.lens || ''}
              onChange={(e) => update('lens', e.target.value || null)}
              className="w-full border border-line p-1.5 text-xs bg-white"
            >
              <option value="">Any / Not specified</option>
              {Object.entries(LENS_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Severity band */}
          <div>
            <label className="block text-neutral-600 mb-1 font-medium">Escalate to Band</label>
            <select
              value={form.severity_band || ''}
              onChange={(e) => update('severity_band', e.target.value || null)}
              className="w-full border border-line p-1.5 text-xs bg-white"
            >
              <option value="">Inherit from event</option>
              {['Low', 'Medium', 'High', 'Critical'].map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Action text */}
        <div>
          <label className="block text-neutral-600 mb-1 font-medium">Recommended Action</label>
          <textarea
            rows={2}
            maxLength={500}
            placeholder="e.g. Halt operation. Supervisor review required before continuing."
            value={form.action_text || ''}
            onChange={(e) => update('action_text', e.target.value)}
            className="w-full border border-line p-1.5 text-xs resize-none"
          />
        </div>
      </div>

      {/* Enabled toggle */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="rule-enabled"
          checked={form.enabled}
          onChange={(e) => update('enabled', e.target.checked)}
          className="accent-ink"
        />
        <label htmlFor="rule-enabled" className="text-neutral-600 font-medium">
          Rule enabled
        </label>
        <span className="text-neutral-400 text-[11px]">
          (Disabled rules are saved but not applied)
        </span>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="border border-ink bg-ink text-white px-4 py-1.5 font-medium hover:bg-neutral-800 transition-colors disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save Rule'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="border border-line px-4 py-1.5 text-neutral-600 hover:bg-neutral-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ─── Evaluation result panel ──────────────────────────────────────────────────

function EvaluationPanel({ result, onClose }) {
  if (!result) return null
  const { matched_count, total_evaluated, sample_matches, epistemic_label, notice } = result

  return (
    <div className="border border-blue-200 bg-blue-50 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-blue-900">EVALUATION RESULT</div>
        <button
          onClick={onClose}
          className="text-[11px] text-neutral-500 hover:text-neutral-700"
        >
          ✕ Close
        </button>
      </div>

      {/* Summary counts */}
      <div className="flex gap-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-800 tabular-nums">{matched_count}</div>
          <div className="text-[10px] text-blue-600 uppercase tracking-wide">Matched Events</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-neutral-600 tabular-nums">{total_evaluated}</div>
          <div className="text-[10px] text-neutral-500 uppercase tracking-wide">Total Evaluated</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-neutral-600 tabular-nums">
            {total_evaluated > 0
              ? `${((matched_count / total_evaluated) * 100).toFixed(1)}%`
              : '—'}
          </div>
          <div className="text-[10px] text-neutral-500 uppercase tracking-wide">Match Rate</div>
        </div>
      </div>

      {/* Epistemic label */}
      <div className="flex items-center gap-2">
        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
          {epistemic_label}
        </span>
        <span className="text-[11px] text-neutral-600 italic">{notice}</span>
      </div>

      {/* Sample matches */}
      {sample_matches && sample_matches.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-neutral-600 mb-1">
            Sample matching events (up to 10):
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] border border-line">
              <thead>
                <tr className="border-b border-line text-neutral-400 uppercase text-[10px] bg-white">
                  <th className="px-2 py-1">ID</th>
                  <th className="px-2 py-1">Lens</th>
                  <th className="px-2 py-1">Score</th>
                  <th className="px-2 py-1">Band</th>
                  <th className="px-2 py-1">Scenario</th>
                  <th className="px-2 py-1">Video</th>
                  <th className="px-2 py-1">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sample_matches.map((e) => (
                  <tr key={e.event_id} className="hover:bg-white">
                    <td className="px-2 py-1 font-mono text-neutral-500">#{e.event_id}</td>
                    <td className="px-2 py-1 capitalize">{e.lens}</td>
                    <td className="px-2 py-1 font-mono font-semibold">{e.score ?? '—'}</td>
                    <td className="px-2 py-1">
                      <BandBadge band={e.band} />
                    </td>
                    <td className="px-2 py-1 font-mono text-neutral-500 truncate max-w-[160px]">
                      {e.scenario || '—'}
                    </td>
                    <td className="px-2 py-1 font-mono text-neutral-500">{e.video_id || '—'}</td>
                    <td className="px-2 py-1 font-mono text-neutral-500">
                      {e.timestamp != null ? `${Number(e.timestamp).toFixed(1)}s` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {matched_count === 0 && (
        <p className="text-xs text-neutral-500 italic">
          No current events match this rule's condition.
        </p>
      )}
    </div>
  )
}

// ─── Rule card ────────────────────────────────────────────────────────────────

function RuleCard({ rule, onEdit, onDelete, onEvaluate, evaluating }) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div
      className={`border p-4 flex flex-col gap-3 ${
        rule.enabled ? 'border-line bg-white' : 'border-neutral-200 bg-neutral-50'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-ink text-sm">{rule.name || 'Unnamed Rule'}</span>
            <StatusBadge enabled={rule.enabled} />
            {rule.severity_band && <BandBadge band={rule.severity_band} />}
            {rule.lens && (
              <span className="px-1.5 py-0.5 text-[10px] border border-neutral-300 bg-neutral-50 text-neutral-600 font-medium">
                {LENS_LABELS[rule.lens] || rule.lens}
              </span>
            )}
          </div>
          {rule.description && (
            <p className="text-[11px] text-neutral-500">{rule.description}</p>
          )}
        </div>
        <span className="text-[10px] text-neutral-400 shrink-0 tabular-nums">
          #{rule.rule_id}
        </span>
      </div>

      {/* Condition */}
      <div className="border border-blue-100 bg-blue-50/30 p-2 rounded-sm">
        <div className="text-[10px] text-blue-600 font-bold uppercase mb-1">WHEN</div>
        <ConditionSummary condition={rule.condition} />
      </div>

      {/* Action */}
      {rule.action_text && (
        <div className="border border-emerald-100 bg-emerald-50/30 p-2 rounded-sm">
          <div className="text-[10px] text-emerald-700 font-bold uppercase mb-1">THEN</div>
          <p className="text-[11px] text-neutral-700">{rule.action_text}</p>
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-line">
        <button
          onClick={() => onEvaluate(rule.rule_id)}
          disabled={evaluating}
          className="px-2.5 py-1 text-[11px] border border-blue-300 text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-50 font-medium"
        >
          {evaluating ? 'Testing…' : '▶ Test Rule'}
        </button>
        <button
          onClick={() => onEdit(rule)}
          className="px-2.5 py-1 text-[11px] border border-line text-neutral-600 hover:bg-neutral-50 transition-colors"
        >
          Edit
        </button>
        {confirmDelete ? (
          <div className="inline-flex items-center gap-1.5 ml-auto">
            <button
              onClick={() => onDelete(rule.rule_id)}
              className="px-1.5 py-0.5 text-[10px] font-semibold bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
            >
              Confirm Delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-1.5 py-0.5 text-[10px] bg-neutral-100 text-neutral-600 rounded hover:bg-neutral-200"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="ml-auto text-[11px] text-neutral-400 hover:text-red-600 transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CustomRuleBuilder() {
  const [rules, setRules] = useState([])
  const [schema, setSchema] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editingRule, setEditingRule] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formSuccess, setFormSuccess] = useState(null)

  // Evaluation state per rule
  const [evaluatingId, setEvaluatingId] = useState(null)
  const [evalResults, setEvalResults] = useState({}) // ruleId -> result

  // Load on mount
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
        // Update — only send changed/non-null fields
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
        setRules((prev) =>
          prev.map((r) => (r.rule_id === updated.rule_id ? updated : r)),
        )
        setFormSuccess(`Rule '${updated.name}' updated successfully.`)
      } else {
        const created = await createRule({
          ...formData,
          lens: formData.lens || null,
          severity_band: formData.severity_band || null,
          action_text: formData.action_text || null,
        })
        setRules((prev) => [created, ...prev])
        setFormSuccess(`Rule '${created.name}' created successfully.`)
      }
      closeForm()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(ruleId) {
    await deleteRule(ruleId)
    setRules((prev) => prev.filter((r) => r.rule_id !== ruleId))
    // Clear any evaluation result for this rule
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
    return (
      <div className="p-4 text-xs text-neutral-500">Loading custom rules…</div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-bold text-ink uppercase tracking-wide">
            Custom Rule Builder
          </h2>
          <p className="mt-1 text-[11px] text-neutral-500 max-w-lg">
            Define operational safety rules using structured conditions grounded in real TRACE event
            data. Rules are evaluated deterministically — no code execution.
          </p>
        </div>
        <button
          onClick={openCreateForm}
          className="shrink-0 border border-ink bg-ink text-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-800 transition-colors"
        >
          + New Rule
        </button>
      </div>

      {error && <Alert type="error" text={error} />}
      {formSuccess && <Alert type="success" text={formSuccess} />}

      {/* Form panel */}
      {showForm && (
        <div className="border border-line bg-white p-4">
          <h3 className="text-xs font-bold text-ink mb-4 uppercase tracking-wide">
            {editingRule ? `Edit Rule: ${editingRule.name}` : 'Create New Rule'}
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

      {/* Rule list */}
      {rules.length === 0 ? (
        <div className="border border-dashed border-neutral-300 p-8 text-center">
          <p className="text-sm text-neutral-500">No custom rules configured yet.</p>
          <p className="text-xs text-neutral-400 mt-1">
            Click <strong>+ New Rule</strong> to create your first operational safety rule.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rules.map((rule) => (
            <div key={rule.rule_id}>
              <RuleCard
                rule={rule}
                onEdit={openEditForm}
                onDelete={handleDelete}
                onEvaluate={handleEvaluate}
                evaluating={evaluatingId === rule.rule_id}
              />
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

      {/* Legend / schema summary */}
      {schema && (
        <details className="text-xs">
          <summary className="cursor-pointer text-neutral-400 hover:text-neutral-600 select-none">
            Supported condition fields &amp; operators
          </summary>
          <div className="mt-2 border border-line p-3 bg-white flex flex-col gap-2">
            {schema.supported_fields.map((f) => {
              const info = schema.field_details[f] || {}
              return (
                <div key={f} className="flex gap-3 items-start">
                  <span className="font-mono font-semibold text-blue-700 w-24 shrink-0">{f}</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-neutral-600">{info.description}</span>
                    {info.allowed_values && (
                      <span className="text-neutral-400">
                        Values: {info.allowed_values.join(', ')}
                      </span>
                    )}
                    {info.range && (
                      <span className="text-neutral-400">
                        Range: {info.range[0]}–{info.range[1]}
                      </span>
                    )}
                    <span className="text-neutral-400">
                      Operators: {(info.allowed_operators || []).join('  ')}
                    </span>
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
