import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseCsv, readCsvFile } from './profile.ts'

/** The split strategies split_dataset supports. */
export type SplitStrategy = 'random' | 'chronological' | 'group'

/** Options for {@link planSplit}. */
export interface SplitOptions {
  strategy: SplitStrategy
  /** Train share of the data, 0..1. */
  ratio: number
  /** Seed for the deterministic random parts. */
  seed?: number
  /** Stratify a random split by this column's values. */
  stratifyColumn?: string
  /** Chronological split orders by this column (ISO/slash dates). */
  timeColumn?: string
  /** Chronological split drops rows within this many days of the boundary. */
  gapDays?: number
  /** Group split keeps this column's values on one side only. */
  groupColumn?: string
  /** Entity key recorded for cross-split overlap checks. */
  idColumn?: string
}

/** Per-row split membership; exactly one of train/test is true (dropped rows: neither). */
export interface SplitPlan {
  train: boolean[]
  test: boolean[]
  dropped: boolean[]
}

/** The persisted split metadata (`split.json`), version 1. */
export interface SplitMetadata {
  version: 1
  datasetPath: string
  name: string
  strategy: SplitStrategy
  ratio: number
  seed: number
  stratifyColumn: string | null
  timeColumn: string | null
  gapDays: number | null
  groupColumn: string | null
  idColumn: string | null
  totalRows: number
  trainRows: number
  testRows: number
  droppedRows: number
  trainFile: string
  testFile: string
  createdAt: string
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Small stable string hash, for per-group RNG seeds. */
function hashString(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return h >>> 0
}

/** Fisher–Yates shuffle of 0..n-1 with the given RNG. */
function shuffledIndices(n: number, rng: () => number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = idx[i] ?? i
    idx[i] = idx[j] ?? j
    idx[j] = tmp
  }
  return idx
}

/**
 * Compute per-row train/test/dropped membership for one split strategy. All
 * strategies are deterministic for a given (rows, seed, options): the same
 * input reproduces the same split. Rows are never reordered — membership is
 * per original row index.
 *
 * - `random`: seeded shuffle, first `ratio` in train; optional
 *   `stratifyColumn` keeps the share balanced per stratum (per-stratum
 *   seeded shuffle).
 * - `chronological`: order by `timeColumn` (must parse via `Date.parse`),
 *   train = time ≤ cutoff, dropped = within `gapDays` of the cutoff, else
 *   test. Unparseable times fail loud.
 * - `group`: every value of `groupColumn` stays on one side (null group
 *   values fail); group keys are seeded-shuffled and assigned greedily until
 *   the train share reaches `ratio`.
 *
 * @param rows - the parsed table rows.
 * @param headers - the header row.
 * @param options - strategy and parameters.
 * @returns membership arrays.
 */
export function planSplit(rows: readonly (string | null)[][], headers: readonly string[], options: SplitOptions): SplitPlan {
  const n = rows.length
  const train = new Array<boolean>(n).fill(false)
  const test = new Array<boolean>(n).fill(false)
  const dropped = new Array<boolean>(n).fill(false)
  if (n === 0) return { train, test, dropped }
  const ratio = options.ratio
  const seed = options.seed ?? 42

  if (options.strategy === 'random') {
    const rng = mulberry32(seed)
    const col = options.stratifyColumn === undefined ? undefined : headers.indexOf(options.stratifyColumn)
    if (options.stratifyColumn !== undefined && col === -1) {
      throw new Error(`planSplit: stratifyColumn "${options.stratifyColumn}" not found`)
    }
    if (col === undefined) {
      const order = shuffledIndices(n, rng)
      const k = Math.max(1, Math.min(n - 1, Math.round(n * ratio)))
      for (let i = 0; i < k; i++) train[order[i]!] = true
      for (let i = k; i < n; i++) test[order[i]!] = true
    } else {
      const groups = new Map<string, number[]>()
      rows.forEach((row, i) => {
        const key = row[col] ?? '\u0000null'
        const list = groups.get(key) ?? []
        list.push(i)
        groups.set(key, list)
      })
      for (const [key, indices] of groups) {
        const grng = mulberry32((seed + hashString(key)) >>> 0)
        const order = shuffledIndices(indices.length, grng)
        const k = Math.max(0, Math.min(indices.length - 1, Math.round(indices.length * ratio)))
        for (let i = 0; i < k; i++) train[indices[order[i]!]!] = true
        for (let i = k; i < indices.length; i++) test[indices[order[i]!]!] = true
      }
    }
    return { train, test, dropped }
  }

  if (options.strategy === 'chronological') {
    const timeColumn = options.timeColumn
    if (timeColumn === undefined) throw new Error('planSplit: chronological split requires timeColumn')
    const ci = headers.indexOf(timeColumn)
    if (ci === -1) throw new Error(`planSplit: timeColumn "${timeColumn}" not found`)
    const times = rows.map((row, i) => {
      const v = row[ci] ?? null
      if (v === null || v.trim().length === 0) {
        throw new Error(`planSplit: unparseable time at row ${i + 1} of column "${timeColumn}"`)
      }
      const t = Date.parse(v.trim())
      if (Number.isNaN(t)) throw new Error(`planSplit: unparseable time "${v}" at row ${i + 1} of column "${timeColumn}"`)
      return t
    })
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => times[a]! - times[b]! || a - b)
    const k = Math.max(1, Math.min(n - 1, Math.floor(n * ratio)))
    const cutoff = times[order[k - 1]!]!
    const gapMs = (options.gapDays ?? 0) * 86_400_000
    for (const i of order) {
      const t = times[i]!
      if (t <= cutoff) train[i] = true
      else if (gapMs > 0 && t <= cutoff + gapMs) dropped[i] = true
      else test[i] = true
    }
    return { train, test, dropped }
  }

  // group
  const groupColumn = options.groupColumn
  if (groupColumn === undefined) throw new Error('planSplit: group split requires groupColumn')
  const gi = headers.indexOf(groupColumn)
  if (gi === -1) throw new Error(`planSplit: groupColumn "${groupColumn}" not found`)
  const groups = new Map<string, number[]>()
  rows.forEach((row, i) => {
    const v = row[gi] ?? null
    if (v === null || v.length === 0) throw new Error(`planSplit: null group value at row ${i + 1} of column "${groupColumn}"`)
    const list = groups.get(v) ?? []
    list.push(i)
    groups.set(v, list)
  })
  const rng = mulberry32(seed)
  const keys = [...groups.keys()]
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = keys[i]!
    keys[i] = keys[j]!
    keys[j] = tmp
  }
  let trainCount = 0
  for (const key of keys) {
    const indices = groups.get(key)!
    if (trainCount / n < ratio) {
      indices.forEach(i => { train[i] = true })
      trainCount += indices.length
    } else {
      indices.forEach(i => { test[i] = true })
    }
  }
  return { train, test, dropped }
}

/**
 * Serialize one CSV line, quoting cells that contain the delimiter, quotes,
 * or line breaks (double-quoted, with `""` escapes).
 * @param cells - the cell values; `null` renders as an empty field.
 * @param delimiter - the field delimiter.
 * @returns the line.
 */
export function toCsvLine(cells: readonly (string | null)[], delimiter = ','): string {
  return cells.map(cell => {
    if (cell === null) return ''
    if (cell.includes(delimiter) || cell.includes('"') || cell.includes('\n') || cell.includes('\r')) {
      return `"${cell.replaceAll('"', '""')}"`
    }
    return cell
  }).join(delimiter)
}

/** Render the kept rows (original order) as CSV text with the header. */
function renderCsv(headers: readonly string[], rows: readonly (string | null)[][], keep: readonly boolean[]): string {
  const lines = [toCsvLine(headers)]
  rows.forEach((row, i) => { if (keep[i]) lines.push(toCsvLine(row)) })
  return lines.join('\n') + '\n'
}

/**
 * Read a CSV file completely (no sampling) and split it, writing
 * `train.csv`, `test.csv`, and `split.json` into `outDir`. Fails loud when
 * the file exceeds `maxBytes`, because a partial read would produce a
 * silently wrong split.
 * @param path - the dataset.
 * @param signal - cancellation.
 * @param options - strategy, output location, and read cap.
 * @returns the metadata plus the written file paths.
 */
export async function splitDatasetFile(path: string, signal: AbortSignal, options: SplitOptions & {
  name: string
  outDir: string
  maxBytes?: number
}): Promise<{ metadata: SplitMetadata; trainFile: string; testFile: string; splitFile: string }> {
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024
  const { text, truncated } = await readCsvFile(path, signal, { maxBytes })
  if (truncated) {
    throw new Error(`split_dataset: file exceeds the ${maxBytes}-byte read cap; splitting needs the whole file. Raise maxBytes or use Python via bash.`)
  }
  const table = parseCsv(text)
  const plan = planSplit(table.rows, table.headers, options)
  const seed = options.seed ?? 42
  await mkdir(options.outDir, { recursive: true })
  const trainFile = join(options.outDir, 'train.csv')
  const testFile = join(options.outDir, 'test.csv')
  const splitFile = join(options.outDir, 'split.json')
  await writeFile(trainFile, renderCsv(table.headers, table.rows, plan.train))
  await writeFile(testFile, renderCsv(table.headers, table.rows, plan.test))
  const metadata: SplitMetadata = {
    version: 1,
    datasetPath: path,
    name: options.name,
    strategy: options.strategy,
    ratio: options.ratio,
    seed,
    stratifyColumn: options.stratifyColumn ?? null,
    timeColumn: options.timeColumn ?? null,
    gapDays: options.gapDays ?? null,
    groupColumn: options.groupColumn ?? null,
    idColumn: options.idColumn ?? null,
    totalRows: table.rows.length,
    trainRows: plan.train.filter(Boolean).length,
    testRows: plan.test.filter(Boolean).length,
    droppedRows: plan.dropped.filter(Boolean).length,
    trainFile,
    testFile,
    createdAt: new Date().toISOString(),
  }
  await writeFile(splitFile, JSON.stringify(metadata, null, 2))
  return { metadata, trainFile, testFile, splitFile }
}
