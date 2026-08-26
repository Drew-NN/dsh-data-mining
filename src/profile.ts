import { open } from 'node:fs/promises'

export type ColumnKind = 'number' | 'boolean' | 'string'

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

/** A column profile, in model-facing canonical value shape. */
export interface ColumnProfile {
  name: string
  kind: ColumnKind
  missing: number
  missingRate: number
  unique: number
  sample: string[]
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

/** Infer the column kind from its non-empty values. */
export function inferKind(values: Cell[]): ColumnKind {
  let hasNumber = false
  let hasBoolean = false
  let hasString = false
  for (const v of values) {
    if (v === null) continue
    if (v === 'true' || v === 'false') {
      hasBoolean = true
      continue
    }
    if (v.length > 0 && Number.isFinite(Number(v))) {
      hasNumber = true
      continue
    }
    hasString = true
  }
  if (hasString) return 'string'
  if (hasNumber && hasBoolean) return 'string'
  if (hasNumber) return 'number'
  if (hasBoolean) return 'boolean'
  return 'string'
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
  return {
    name,
    kind,
    missing,
    missingRate: values.length === 0 ? 0 : missing / values.length,
    unique: seen.size,
    sample,
  }
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
