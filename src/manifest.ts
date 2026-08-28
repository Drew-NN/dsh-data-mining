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
  // Older gate-era manifests carried a `phaseGates` key; it no longer exists
  // and must not leak into returned values or the tool's output schema.
  const legacy = parsed as Partial<Manifest> & { phaseGates?: unknown }
  const { phaseGates: _legacy, ...rest } = legacy
  return {
    ...emptyManifest(),
    ...rest,
    datasets: rest.datasets ?? [],
    decisions: rest.decisions ?? [],
  }
}

/** Persist a manifest, creating the directory if needed. */
export async function saveManifest(filePath: string, manifest: Manifest): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(manifest, null, 2))
}
