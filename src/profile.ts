import { readFile } from 'node:fs/promises'

export type ColumnKind = 'number' | 'boolean' | 'string'

/** One parsed CSV cell: `null` for an empty field. */
type Cell = string | null

/** One parsed CSV row: the header values and cell values by column index. */
interface Table {
  headers: string[]
  rows: Cell[][]
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
  columns: ColumnProfile[]
}

/** The `sample_rows` canonical result. */
export interface SampleRows {
  path: string
  offset: number
  rows: Record<string, string | null>[]
  totalRows: number
}

/**
 * Split one CSV line into fields, honoring double-quoted fields containing
 * commas. Unbalanced quotes return the raw line as a single field; the caller
 * reports malformed rows through its own error path.
 * @param line - one physical CSV line without its line terminator.
 * @returns the split fields.
 */
export function splitLine(line: string): string[] {
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
    } else if (ch === ',') {
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
 * Parse CSV text into headers and rows. The first line is the header row.
 * Rows with fewer fields than headers are padded with nulls; rows with more
 * fields are truncated (the parser keeps the first `headers.length` fields).
 * @param text - the full CSV file text.
 * @returns the parsed table.
 */
export function parseCsv(text: string): Table {
  const lines = text.split(/\r\n|\n|\r/)
  // split always returns at least one element; the fallback only satisfies
  // noUncheckedIndexedAccess.
  /* v8 ignore next -- split of any string yields a non-empty array */
  const headers = splitLine(lines[0] ?? '')
  const rows: Cell[][] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined || line.length === 0) continue
    const fields = splitLine(line)
    const row: Cell[] = []
    for (let j = 0; j < headers.length; j++) {
      const field = fields[j]
      row.push(field === undefined || field.length === 0 ? null : field)
    }
    rows.push(row)
  }
  return { headers, rows }
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
 * @param bytes - the file size in bytes.
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
    rowCount: table.rows.length,
    columnCount: table.headers.length,
    bytes,
    columns,
  }
}

/** Apply `exec.signal` cancellation to a file read. */
export async function readCsvFile(path: string, signal: AbortSignal): Promise<{ text: string; bytes: number }> {
  const buffer = await readFile(path, { signal })
  return { text: buffer.toString('utf8'), bytes: buffer.byteLength }
}
