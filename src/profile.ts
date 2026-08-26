import { open } from 'node:fs/promises'

export type ColumnKind = 'number' | 'boolean' | 'string' | 'datetime'

/** One parsed CSV cell: `null` for an empty field. */
type Cell = string | null

/** One parsed CSV row: the header values and cell values by column index. */
interface Table {
  headers: string[]
  rows: Cell[][]
  /** Real data rows seen (excluding the header and blank lines), even when row sampling kept fewer. */
  totalDataLines: number
  /** True when row sampling kept fewer rows than `totalDataLines`. */
  sampled: boolean
}

/**
 * Distribution statistics for a numeric column, computed on the non-missing
 * values of the rows actually read (which may be a sample; `sampled`/
 * `truncated` on the dataset profile say how approximate the numbers are).
 */
export interface NumericStats {
  /** Number of non-missing values the statistics were computed on. */
  n: number
  min: number
  max: number
  mean: number
  /** Sample standard deviation (ddof=1); `null` when `n < 2`. */
  std: number | null
  /** Linear-interpolation quartiles, matching numpy/pandas defaults. */
  p25: number
  p50: number
  p75: number
}

/** A column profile, in model-facing canonical value shape. */
export interface ColumnProfile {
  name: string
  kind: ColumnKind
  missing: number
  missingRate: number
  unique: number
  sample: string[]
  /** Present only for `number` columns. */
  stats?: NumericStats
}

/** The `profile_dataset` canonical result. */
export interface DatasetProfile {
  path: string
  rowCount: number
  columnCount: number
  bytes: number
  /** Rows actually profiled; may be less than `rowCount` when `sampled`. */
  rowsProfiled: number
  /** True when the profile was computed on a row sample, not every row. */
  sampled: boolean
  columns: ColumnProfile[]
}

/** The `sample_rows` canonical result. */
export interface SampleRows {
  path: string
  offset: number
  rows: Record<string, string | null>[]
  totalRows: number
}

/** One top-frequency value with its count and share of non-missing values. */
export interface ValueCount {
  value: string
  count: number
  /** `count / total`, where total is the non-missing value count. */
  rate: number
}

/** The `value_counts` per-column distribution, before read-level flags. */
export interface ValueCounts {
  kind: ColumnKind
  /** Non-missing values in the rows read. */
  total: number
  missing: number
  /** Distinct non-missing values in the rows read. */
  unique: number
  /** Distinct values not shown (unique − values.length). */
  omitted: number
  values: ValueCount[]
}

/** Delimiters considered by auto-detection, in preference order. */
const DELIMITERS = [',', '\t', ';', '|'] as const
/** How many lines auto-detection inspects. */
const DETECT_LINES = 5

/** Default cap on bytes read from a CSV file (64 MiB). */
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024

/**
 * Split one CSV line into fields, honoring double-quoted fields containing
 * the delimiter. Unbalanced quotes return the raw line as a single field; the
 * caller reports malformed rows through its own error path.
 * @param line - one physical CSV line without its line terminator.
 * @param delimiter - the field delimiter (defaults to comma).
 * @returns the split fields.
 */
export function splitLine(line: string, delimiter = ','): string[] {
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    // The loop bound guarantees a defined character; the guard only
    // satisfies noUncheckedIndexedAccess.
    /* v8 ignore next -- i < line.length guarantees a defined character */
    if (ch === undefined) continue
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"' && field.length === 0) {
      quoted = true
    } else if (ch === delimiter) {
      fields.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  fields.push(field)
  return fields
}

/**
 * Guess the field delimiter from sample lines: the candidate with the most
 * lines agreeing on the same field count (> 1). Ties prefer the earlier
 * candidate in {@link DELIMITERS}; when nothing agrees, comma wins.
 * @param lines - non-empty CSV lines to inspect.
 * @returns the detected delimiter.
 */
export function detectDelimiter(lines: string[]): string {
  let best = ','
  let bestScore = -1
  for (const candidate of DELIMITERS) {
    const counts = lines.slice(0, DETECT_LINES).map(line => splitLine(line, candidate).length)
    const tally = new Map<number, number>()
    for (const count of counts) tally.set(count, (tally.get(count) ?? 0) + 1)
    let score = 0
    for (const [count, n] of tally) {
      if (count > 1 && n > score) score = n
    }
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}

/** Options for {@link parseCsv}. */
export interface ParseCsvOptions {
  /** Explicit field delimiter; when absent, one is auto-detected. */
  delimiter?: string
  /**
   * Cap on rows kept for profiling. When the file has more data rows, the
   * first half of the budget is kept as head rows and the rest are sampled
   * every `k`-th row across the whole file (deterministic). Never affects
   * {@link Table.totalDataLines}.
   */
  maxRows?: number
}

/** Convert one data line into a row padded/truncated to the header width. */
function toRow(line: string, headers: string[], delimiter: string): Cell[] {
  const fields = splitLine(line, delimiter)
  const row: Cell[] = []
  for (let j = 0; j < headers.length; j++) {
    const field = fields[j]
    row.push(field === undefined || field.length === 0 ? null : field)
  }
  return row
}

/**
 * Parse CSV text into headers and rows. The first line is the header row.
 * Rows with fewer fields than headers are padded with nulls; rows with more
 * fields are truncated (the parser keeps the first `headers.length` fields).
 * A leading UTF-8 BOM is stripped.
 * @param text - the full CSV file text.
 * @param opts - delimiter and row-sampling options.
 * @returns the parsed table, including the true data-line count.
 */
export function parseCsv(text: string, opts: ParseCsvOptions = {}): Table {
  // Strip a UTF-8 byte-order mark that Excel-produced CSVs often carry.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const lines = text.split(/\r\n|\n|\r/).filter(line => line.length > 0)
  const delimiter = opts.delimiter ?? detectDelimiter(lines)
  // split of any array yields a non-empty array; the fallback only satisfies
  // noUncheckedIndexedAccess.
  /* v8 ignore next -- lines[0] is undefined only for an empty file */
  const headers = splitLine(lines[0] ?? '', delimiter)
  const dataLines = lines.slice(1)

  const rows: Cell[][] = []
  let sampled = false
  if (opts.maxRows !== undefined && dataLines.length > opts.maxRows) {
    // Head + equidistant sampling: keep the first half of the budget as head
    // rows, then every k-th remaining row so the sample spans the file.
    sampled = true
    const head = Math.floor(opts.maxRows / 2)
    const remaining = Math.max(1, opts.maxRows - head)
    const stride = Math.max(1, Math.ceil((dataLines.length - head) / remaining))
    for (let i = 0; i < dataLines.length && rows.length < opts.maxRows; i++) {
      const line = dataLines[i]
      // The loop bound guarantees a defined line; the check only satisfies
      // noUncheckedIndexedAccess.
      /* v8 ignore next -- i < dataLines.length guarantees a defined line */
      if (line === undefined) continue
      if (i < head || (i - head) % stride === 0) {
        rows.push(toRow(line, headers, delimiter))
      }
    }
  } else {
    for (const line of dataLines) {
      rows.push(toRow(line, headers, delimiter))
    }
  }
  return { headers, rows, totalDataLines: dataLines.length, sampled }
}

/** Padded ISO dates/timestamps (`2024-01-01`, `2024-01-01T10:30:00Z`, space-separated times). */
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
/** Padded slash dates (`2024/01/01`, with optional time). */
const SLASH_DATE_RE = /^\d{4}\/\d{2}\/\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/

/**
 * Whether a cell value looks like a calendar date or timestamp. The regex
 * pins the shape (so bare years like `2024` stay numbers); `Date.parse`
 * rejects impossible dates like `2024-13-01`.
 * @param value - the cell value.
 * @returns true for ISO or slash dates with an optional time component.
 */
export function isDatetimeValue(value: string): boolean {
  const trimmed = value.trim()
  if (!DATETIME_RE.test(trimmed) && !SLASH_DATE_RE.test(trimmed)) return false
  return !Number.isNaN(Date.parse(trimmed))
}

/** Infer the column kind from its non-empty values. */
export function inferKind(values: Cell[]): ColumnKind {
  let hasNumber = false
  let hasBoolean = false
  let hasDatetime = false
  let hasString = false
  for (const v of values) {
    if (v === null) continue
    if (v === 'true' || v === 'false') {
      hasBoolean = true
      continue
    }
    if (isDatetimeValue(v)) {
      hasDatetime = true
      continue
    }
    if (v.length > 0 && Number.isFinite(Number(v))) {
      hasNumber = true
      continue
    }
    hasString = true
  }
  if (hasString) return 'string'
  // A column mixing kinds (dates + numbers, numbers + booleans, …) is not one
  // clean type; treat it as text rather than guess.
  if ((hasNumber ? 1 : 0) + (hasBoolean ? 1 : 0) + (hasDatetime ? 1 : 0) > 1) return 'string'
  if (hasNumber) return 'number'
  if (hasDatetime) return 'datetime'
  if (hasBoolean) return 'boolean'
  return 'string'
}

/**
 * Linear-interpolation percentile of a sorted array (numpy's default).
 * @param sorted - ascending values, non-empty.
 * @param q - quantile in [0, 1].
 * @returns the interpolated value.
 */
function percentile(sorted: number[], q: number): number {
  const pos = q * (sorted.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  // The array is non-empty, so both indices are defined; the checks only
  // satisfy noUncheckedIndexedAccess.
  /* v8 ignore next -- a non-empty array guarantees defined indices */
  if (lo === hi) return sorted[lo] ?? NaN
  /* v8 ignore next -- same guarantee */
  return (sorted[lo] ?? NaN) + (pos - lo) * ((sorted[hi] ?? NaN) - (sorted[lo] ?? NaN))
}

/**
 * Distribution statistics over the numeric subset of a column's cells.
 * Non-numeric and missing cells are skipped. `undefined` when nothing
 * numeric remains.
 * @param values - the column cells.
 * @returns the statistics, or undefined for an all-missing/all-text column.
 */
export function numericStats(values: Cell[]): NumericStats | undefined {
  const nums: number[] = []
  for (const v of values) {
    if (v === null) continue
    const n = Number(v)
    if (Number.isFinite(n)) nums.push(n)
  }
  if (nums.length === 0) return undefined
  nums.sort((a, b) => a - b)
  const min = nums[0] ?? NaN
  const max = nums[nums.length - 1] ?? NaN
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length
  let std: number | null = null
  if (nums.length >= 2) {
    const variance = nums.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (nums.length - 1)
    std = Math.sqrt(variance)
  }
  return {
    n: nums.length,
    min,
    max,
    mean,
    std,
    p25: percentile(nums, 0.25),
    p50: percentile(nums, 0.5),
    p75: percentile(nums, 0.75),
  }
}

/**
 * Profile one column: kind, missing counts, unique-value count, and up to
 * `maxSample` distinct sample values in first-seen order.
 * @param name - the header name.
 * @param values - the column cells.
 * @param maxSample - how many distinct sample values to keep.
 * @returns the column profile.
 */
export function profileColumn(name: string, values: Cell[], maxSample: number): ColumnProfile {
  const kind = inferKind(values)
  let missing = 0
  const seen = new Set<string>()
  const sample: string[] = []
  for (const v of values) {
    if (v === null) {
      missing++
      continue
    }
    if (!seen.has(v)) {
      seen.add(v)
      if (sample.length < maxSample) sample.push(v)
    }
  }
  const base = {
    name,
    kind,
    missing,
    missingRate: values.length === 0 ? 0 : missing / values.length,
    unique: seen.size,
    sample,
  }
  if (kind === 'number') {
    const stats = numericStats(values)
    if (stats !== undefined) return { ...base, stats }
  }
  return base
}

/**
 * Profile a parsed table into the canonical {@link DatasetProfile}. The
 * `path` and `bytes` fields come from the caller (file read metadata).
 * @param table - the parsed table.
 * @param path - the file path as the model named it.
 * @param bytes - the number of bytes read.
 * @param maxSample - sample values kept per column.
 * @returns the dataset profile.
 */
export function buildProfile(table: Table, path: string, bytes: number, maxSample: number): DatasetProfile {
  const columns: ColumnProfile[] = []
  for (let c = 0; c < table.headers.length; c++) {
    const header = table.headers[c]
    // The loop bound guarantees a defined header; the check only satisfies
    // noUncheckedIndexedAccess.
    /* v8 ignore next -- c < headers.length guarantees a defined header */
    if (header === undefined) continue
    const values = table.rows.map(row => row[c] ?? null)
    columns.push(profileColumn(header, values, maxSample))
  }
  return {
    path,
    rowCount: table.totalDataLines,
    columnCount: table.headers.length,
    bytes,
    rowsProfiled: table.rows.length,
    sampled: table.sampled,
    columns,
  }
}

/**
 * Tally one column's value distribution: top frequencies with rates. Counts
 * reflect the rows present in `table` (which may be a sample). Missing cells
 * are counted separately and never appear in `values`.
 * @param table - the parsed table.
 * @param columnIndex - the column to tally.
 * @param topK - how many top values to return.
 * @returns the distribution.
 */
export function valueCounts(table: Table, columnIndex: number, topK: number): ValueCounts {
  const cells = table.rows.map(row => row[columnIndex] ?? null)
  const kind = inferKind(cells)
  const tally = new Map<string, number>()
  let missing = 0
  for (const v of cells) {
    if (v === null) {
      missing++
      continue
    }
    tally.set(v, (tally.get(v) ?? 0) + 1)
  }
  const total = cells.length - missing
  const entries = [...tally.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const values: ValueCount[] = entries.slice(0, topK).map(([value, count]) => ({
    value,
    count,
    rate: total === 0 ? 0 : count / total,
  }))
  return {
    kind,
    total,
    missing,
    unique: tally.size,
    omitted: Math.max(0, tally.size - values.length),
    values,
  }
}

/** Row projection and filtering options for {@link selectRows}. */
export interface RowSelection {
  /** Column names to include, in output order; defaults to all headers. */
  columns?: string[]
  /** Exact-match filter on one column; `null` cells never match. */
  where?: { column: string; equals: string }
}

/** The `sample_rows` per-call result, before read-level fields. */
export interface SelectRowsResult {
  rows: Record<string, string | null>[]
  /** Matched rows counted over the whole table, ignoring offset/limit. */
  totalMatches: number
}

/**
 * Project and filter rows of a parsed table: optional column subset (in the
 * requested order), optional exact-match `where` filter (applied first, with
 * `offset`/`limit` slicing the matches), and a total-match count so the model
 * can page through matches. Unknown column names fail with the header list.
 * @param table - the parsed table.
 * @param selection - columns/where options.
 * @param offset - index into the matched rows.
 * @param limit - max rows to return.
 * @returns the projected rows and the total match count.
 */
export function selectRows(table: Table, selection: RowSelection, offset: number, limit: number): SelectRowsResult {
  const include = selection.columns ?? table.headers
  for (const h of include) {
    if (!table.headers.includes(h)) {
      throw new Error(`sample_rows: column "${h}" not found. Available columns: ${table.headers.join(', ')}`)
    }
  }
  const whereColumn = selection.where?.column
  if (whereColumn !== undefined && !table.headers.includes(whereColumn)) {
    throw new Error(`sample_rows: where.column "${whereColumn}" not found. Available columns: ${table.headers.join(', ')}`)
  }
  const includeIdx = include.map(h => table.headers.indexOf(h))
  const whereIdx = whereColumn === undefined ? -1 : table.headers.indexOf(whereColumn)
  const rows: Record<string, string | null>[] = []
  let totalMatches = 0
  for (const source of table.rows) {
    if (whereIdx !== -1) {
      const cell = source[whereIdx] ?? null
      // `null` never matches, even when `equals` is an empty string.
      if (cell === null || cell !== selection.where!.equals) continue
    }
    if (totalMatches >= offset && rows.length < limit) {
      const row: Record<string, string | null> = {}
      include.forEach((h, i) => {
        // includeIdx[i] is a valid header index (validated above); the guard
        // only satisfies noUncheckedIndexedAccess.
        /* v8 ignore next -- i is within includeIdx's bounds */
        row[h] = source[includeIdx[i]!] ?? null
      })
      rows.push(row)
    }
    totalMatches++
  }
  return { rows, totalMatches }
}

/** Options for {@link readCsvFile}. */
export interface ReadCsvOptions {
  /**
   * Maximum number of bytes to read (defaults to {@link DEFAULT_MAX_BYTES}).
   * A larger file reports `truncated: true`; the caller decides whether that
   * is acceptable (profile_dataset marks it, sample_rows rejects it).
   */
  maxBytes?: number
}

/**
 * Read the head of a CSV file with a byte cap, honoring `signal` for
 * cancellation.
 * @param path - the file to read.
 * @param signal - aborts the read.
 * @param opts - the byte cap.
 * @returns the decoded text, the bytes read, and whether the file was larger
 *   than the cap (so the text is only the file's head).
 */
export async function readCsvFile(path: string, signal: AbortSignal, opts: ReadCsvOptions = {}): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const toRead = Math.min(size, maxBytes)
    const buffer = Buffer.alloc(toRead)
    let read = 0
    while (read < toRead) {
      signal.throwIfAborted()
      const result = await handle.read(buffer, read, toRead - read, read)
      if (result.bytesRead === 0) break
      read += result.bytesRead
    }
    return {
      text: buffer.subarray(0, read).toString('utf8'),
      bytes: read,
      truncated: read < size,
    }
  } finally {
    await handle.close()
  }
}
