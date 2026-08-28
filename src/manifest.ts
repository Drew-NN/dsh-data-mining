import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** The workflow stages the manifest tracks (DESIGN.md six steps, split apart). */
export type ManifestPhase =
  | 'business'
  | 'data-understanding'
  | 'data-collection'
  | 'data-cleaning'
  | 'split'
  | 'preprocessing'
  | 'modeling'
  | 'evaluation'
  | 'deployment'
  | 'done'

/** The agreed goal, decided in step 1 and confirmed by the user. */
export interface ManifestGoal {
  statement: string
  target: string
  metric: string
  constraints: string[]
}

/** One profiled dataset with the agent's findings. */
export interface ManifestDataset {
  path: string
  notes: string
  recordedAt: string
}

/** Reference to a recorded split (from split_dataset's split.json). */
export interface ManifestSplitRef {
  splitFile: string
  strategy: 'random' | 'chronological' | 'group'
  trainFile: string
  testFile: string
}

/** One recorded decision, stamped with the phase it was made in. */
export interface ManifestDecision {
  text: string
  phase: string
  recordedAt: string
}

/** A phase gate's lifecycle status. */
export type GateStatus = 'locked' | 'unlocked' | 'pending' | 'done'

/** One phase's gate: who confirmed and when, plus any force-through reason. */
export interface PhaseGate {
  status: GateStatus
  confirmedBy?: string
  confirmedAt?: string
  overrideReason?: string
}

/** Per-phase gate states; a missing entry reads as `locked`. */
export type PhaseGates = Partial<Record<ManifestPhase, PhaseGate>>

/** The ordered workflow phases; each phase unlocks only after its predecessor is done. */
export const PHASE_ORDER: readonly ManifestPhase[] = [
  'business',
  'data-understanding',
  'data-collection',
  'data-cleaning',
  'split',
  'preprocessing',
  'modeling',
  'evaluation',
  'deployment',
  'done',
]

/** The phase after `phase` in {@link PHASE_ORDER}, or undefined for the last. */
export function nextPhase(phase: ManifestPhase): ManifestPhase | undefined {
  const i = PHASE_ORDER.indexOf(phase)
  return i === -1 ? undefined : PHASE_ORDER[i + 1]
}

/** The default gate layout: business unlocked, everything else locked. */
export function initPhaseGates(): PhaseGates {
  const gates: PhaseGates = {}
  for (const phase of PHASE_ORDER) {
    gates[phase] = { status: phase === 'business' ? 'unlocked' : 'locked' }
  }
  return gates
}

/** Read one phase's status; missing entries are locked. */
export function gateStatus(gates: PhaseGates, phase: ManifestPhase): GateStatus {
  return gates[phase]?.status ?? 'locked'
}

/** Whether a phase may be executed right now: unlocked (including in-progress) or done. */
export function isGateExecutable(gates: PhaseGates, phase: ManifestPhase): boolean {
  const s = gateStatus(gates, phase)
  return s === 'unlocked' || s === 'done'
}

/**
 * The agent's completion request: an unlocked phase moves to `pending`
 * (awaiting user confirmation). Locked phases cannot be requested.
 */
export function requestComplete(gates: PhaseGates, phase: ManifestPhase): PhaseGates {
  const status = gateStatus(gates, phase)
  if (status !== 'unlocked') {
    throw new Error(`dm: phase "${phase}" is ${status}, only an unlocked phase can be submitted for completion`)
  }
  return { ...gates, [phase]: { ...gates[phase], status: 'pending' } }
}

/**
 * The user's approval: a pending phase becomes `done` and the next phase
 * unlocks. Only the direct successor unlocks.
 */
export function confirmComplete(gates: PhaseGates, phase: ManifestPhase): PhaseGates {
  const status = gateStatus(gates, phase)
  if (status !== 'pending') {
    throw new Error(`dm: phase "${phase}" is ${status}, only a pending phase can be confirmed`)
  }
  const next = nextPhase(phase)
  const result: PhaseGates = {
    ...gates,
    [phase]: { ...gates[phase], status: 'done', confirmedBy: 'user', confirmedAt: new Date().toISOString() },
  }
  if (next !== undefined) {
    result[next] = { ...gates[next], status: 'unlocked' }
  }
  return result
}

/** User asks to redo a phase: it unlocks again and everything after it relocks. */
export function redoPhase(gates: PhaseGates, phase: ManifestPhase): PhaseGates {
  const result: PhaseGates = { ...gates }
  const i = PHASE_ORDER.indexOf(phase)
  if (i === -1) throw new Error(`dm: unknown phase "${phase}"`)
  for (let k = i; k < PHASE_ORDER.length; k++) {
    const p = PHASE_ORDER[k]
    // k is within PHASE_ORDER's bounds; the guard only satisfies
    // noUncheckedIndexedAccess.
    /* v8 ignore next -- k < PHASE_ORDER.length guarantees a defined entry */
    if (p === undefined) continue
    result[p] = { ...gates[p], status: k === i ? 'unlocked' : 'locked' }
  }
  return result
}

/** Human judgment wins: complete a phase regardless of verification, recording why. */
export function forceComplete(gates: PhaseGates, phase: ManifestPhase, reason: string): PhaseGates {
  const confirmed = confirmComplete({ ...gates, [phase]: { ...gates[phase], status: 'pending' } }, phase)
  return {
    ...confirmed,
    [phase]: { ...confirmed[phase], overrideReason: reason },
  }
}

/**
 * Tool-side gate check: throw unless the phase may execute right now. When
 * gates are not enabled (`phaseGates` missing) every tool passes, keeping
 * pre-gate manifests and headless runs backward compatible.
 */
export function assertGateOpen(manifest: Manifest, phase: ManifestPhase): void {
  const gates = manifest.phaseGates
  if (gates === undefined) return
  if (!isGateExecutable(gates, phase)) {
    throw new Error(`🔒 phase "${phase}" is locked: only the currently approved phase may execute. Finish and confirm earlier phases first (dm complete, then user confirm).`)
  }
}

/**
 * The workspace ledger: the agent's durable, cross-step memory. Lives at
 * `<cwd>/dsh_manifest/manifest.json` (the same directory family as
 * `splits/`). DESIGN.md's "storage" mechanism: every decision lands here so
 * later steps can reference it and the final result is reproducible.
 */
export interface Manifest {
  version: 1
  goal: ManifestGoal | null
  phase: ManifestPhase | null
  datasets: ManifestDataset[]
  split: ManifestSplitRef | null
  decisions: ManifestDecision[]
  /**
   * Per-phase gate states. `undefined` means gates are NOT enabled — every
   * tool passes (backward compatible with pre-gate manifests). `dm`'s
   * `enable` action installs this structure and turns enforcement on.
   */
  phaseGates?: PhaseGates
}

/** The manifest file name inside the dsh_manifest directory. */
export const MANIFEST_FILENAME = 'manifest.json'

/** An empty manifest; a missing file loads as this. */
export function emptyManifest(): Manifest {
  return { version: 1, goal: null, phase: null, datasets: [], split: null, decisions: [] }
}

/** Record the agreed goal. */
export function setGoal(m: Manifest, goal: { statement: string; target: string; metric: string; constraints?: string[] }): Manifest {
  return {
    ...m,
    goal: { statement: goal.statement, target: goal.target, metric: goal.metric, constraints: goal.constraints ?? [] },
  }
}

/** Move to a new phase. */
export function setPhase(m: Manifest, phase: ManifestPhase): Manifest {
  return { ...m, phase }
}

/** Append one dataset entry (never overwrites). */
export function addDataset(m: Manifest, dataset: { path: string; notes?: string }): Manifest {
  return {
    ...m,
    datasets: [...m.datasets, { path: dataset.path, notes: dataset.notes ?? '', recordedAt: new Date().toISOString() }],
  }
}

/** Record the split reference (single value, overwrites). */
export function setSplitRef(m: Manifest, split: ManifestSplitRef): Manifest {
  return { ...m, split }
}

/** Append one decision, stamped with the current phase. */
export function recordDecision(m: Manifest, text: string): Manifest {
  return {
    ...m,
    decisions: [...m.decisions, { text, phase: m.phase ?? 'unknown', recordedAt: new Date().toISOString() }],
  }
}

/**
 * Load a manifest from disk; a missing file is an empty manifest. Unknown
 * versions fail loud (a corrupt ledger must not be silently reset).
 * @param filePath - the manifest file path.
 * @returns the parsed manifest.
 */
export async function loadManifest(filePath: string): Promise<Manifest> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyManifest()
    throw error
  }
  const parsed = JSON.parse(raw) as Partial<Manifest>
  if (parsed.version !== 1) throw new Error(`manifest: unsupported version ${String(parsed.version)}`)
  return {
    ...emptyManifest(),
    ...parsed,
    datasets: parsed.datasets ?? [],
    decisions: parsed.decisions ?? [],
  }
}

/** Persist a manifest, creating the directory if needed. */
export async function saveManifest(filePath: string, manifest: Manifest): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(manifest, null, 2))
}
