import { join } from 'node:path'
import { MANIFEST_FILENAME, loadManifest, type Manifest } from './manifest.ts'

/** Minimal command-invocation shape (subset of dsh-commands) used by /dm. */
export interface DmCommandInvocation {
  rawInput: string
  agent?: { session?: { header?: { cwd?: string } } }
}

/** Minimal command-result shape used by /dm. */
export type DmCommandResult = { kind: 'success' | 'error'; text: string }

/** The worker stages the dock shows, in order, with their manifest data source. */
export const WORKER_STAGES = [
  { phase: 'business', label: '目标', key: 'goal' as const },
  { phase: 'data-understanding', label: '数据理解', key: 'datasets' as const },
  { phase: 'data-cleaning', label: '清洗', key: 'datasets' as const },
  { phase: 'split', label: '切分', key: 'split' as const },
  { phase: 'modeling', label: '建模', key: 'phase' as const },
  { phase: 'evaluation', label: '评估', key: 'phase' as const },
  { phase: 'deployment', label: '交付', key: 'phase' as const },
] as const

/** Ledger order used to derive progress for phase-keyed stages. */
const PHASE_ORDER = [
  'business', 'data-understanding', 'data-collection', 'data-cleaning', 'split',
  'preprocessing', 'modeling', 'evaluation', 'deployment', 'done',
] as const

/**
 * Mechanically derive one stage's status from the ledger.
 * - record-keyed stages (goal/datasets/split): done when the record exists
 * - phase-keyed stages (modeling/evaluation/deployment): done when the
 *   ledger's current phase has passed them, in-progress when it is on them
 */
export function stageStatus(m: Manifest, phase: string, key: 'goal' | 'datasets' | 'split' | 'phase'): 'done' | 'in-progress' | 'not-started' {
  if (key === 'phase') {
    const cur = PHASE_ORDER.indexOf((m.phase ?? '') as (typeof PHASE_ORDER)[number])
    const target = PHASE_ORDER.indexOf(phase as (typeof PHASE_ORDER)[number])
    if (cur > target) return 'done'
    if (cur === target) return 'in-progress'
    return 'not-started'
  }
  const recordDone = key === 'goal'
    ? m.goal !== null
    : key === 'datasets'
      ? m.datasets.length > 0
      : m.split !== null
  return recordDone ? 'done' : 'not-started'
}

/** Render a compact, human-readable ledger status block for the /dm status command. */
export function renderLedgerStatus(m: Manifest): string {
  const lines = WORKER_STAGES.map(({ phase, label, key }) => {
    const status = stageStatus(m, phase, key)
    const dot = status === 'done' ? '✅' : status === 'in-progress' ? '🔄' : '⬜'
    return `${dot} ${label} (${phase})`
  })
  const goal = m.goal === null ? '（未设置）' : `“${m.goal.statement}” 目标=${m.goal.target} 指标=${m.goal.metric}`
  return [
    `目标: ${goal}`,
    `当前阶段: ${m.phase ?? '（未开始）'}`,
    `数据集: ${m.datasets.length} 个已记录 | 切分: ${m.split === null ? '未切分' : `${m.split.strategy} (${m.split.splitFile})`} | 决策: ${m.decisions.length} 条`,
    ...lines,
  ].join('\n')
}

/** Handler for `/dm status`: read the session workspace ledger and summarize it. */
export function dmStatusCommand(invocation: DmCommandInvocation): Promise<DmCommandResult> {
  const cwd = invocation.agent?.session?.header?.cwd
  if (cwd === undefined) {
    return Promise.resolve({ kind: 'error', text: '/dm status: no session workspace available' })
  }
  const file = join(cwd, 'dsh_manifest', MANIFEST_FILENAME)
  return loadManifest(file)
    .then(m => ({ kind: 'success' as const, text: renderLedgerStatus(m) }))
    .catch(() => ({ kind: 'error' as const, text: '/dm status: could not read the workspace ledger' }))
}
