export type ColumnKind = 'number' | 'boolean' | 'string' | 'datetime';
/** One parsed CSV cell: `null` for an empty field. */
type Cell = string | null;
/** One parsed CSV row: the header values and cell values by column index. */
interface Table {
    headers: string[];
    rows: Cell[][];
    /** Real data rows seen (excluding the header and blank lines), even when row sampling kept fewer. */
    totalDataLines: number;
    /** True when row sampling kept fewer rows than `totalDataLines`. */
    sampled: boolean;
}
/**
 * Distribution statistics for a numeric column, computed on the non-missing
 * values of the rows actually read (which may be a sample; `sampled`/
 * `truncated` on the dataset profile say how approximate the numbers are).
 */
export interface NumericStats {
    /** Number of non-missing values the statistics were computed on. */
    n: number;
    min: number;
    max: number;
    mean: number;
    /** Sample standard deviation (ddof=1); `null` when `n < 2`. */
    std: number | null;
    /** Linear-interpolation quartiles, matching numpy/pandas defaults. */
    p25: number;
    p50: number;
    p75: number;
}
/** A column profile, in model-facing canonical value shape. */
export interface ColumnProfile {
    name: string;
    kind: ColumnKind;
    missing: number;
    missingRate: number;
    unique: number;
    sample: string[];
    /** Present only for `number` columns. */
    stats?: NumericStats;
}
/** The `profile_dataset` canonical result. */
export interface DatasetProfile {
    path: string;
    rowCount: number;
    columnCount: number;
    bytes: number;
    /** Rows actually profiled; may be less than `rowCount` when `sampled`. */
    rowsProfiled: number;
    /** True when the profile was computed on a row sample, not every row. */
    sampled: boolean;
    columns: ColumnProfile[];
}
/** The `sample_rows` canonical result. */
export interface SampleRows {
    path: string;
    offset: number;
    rows: Record<string, string | null>[];
    totalRows: number;
}
/** One top-frequency value with its count and share of non-missing values. */
export interface ValueCount {
    value: string;
    count: number;
    /** `count / total`, where total is the non-missing value count. */
    rate: number;
}
/** The `value_counts` per-column distribution, before read-level flags. */
export interface ValueCounts {
    kind: ColumnKind;
    /** Non-missing values in the rows read. */
    total: number;
    missing: number;
    /** Distinct non-missing values in the rows read. */
    unique: number;
    /** Distinct values not shown (unique − values.length). */
    omitted: number;
    values: ValueCount[];
}
/** Default cap on bytes read from a CSV file (64 MiB). */
export declare const DEFAULT_MAX_BYTES: number;
/**
 * Split one CSV line into fields, honoring double-quoted fields containing
 * the delimiter. Unbalanced quotes return the raw line as a single field; the
 * caller reports malformed rows through its own error path.
 * @param line - one physical CSV line without its line terminator.
 * @param delimiter - the field delimiter (defaults to comma).
 * @returns the split fields.
 */
export declare function splitLine(line: string, delimiter?: string): string[];
/**
 * Guess the field delimiter from sample lines: the candidate with the most
 * lines agreeing on the same field count (> 1). Ties prefer the earlier
 * candidate in {@link DELIMITERS}; when nothing agrees, comma wins.
 * @param lines - non-empty CSV lines to inspect.
 * @returns the detected delimiter.
 */
export declare function detectDelimiter(lines: string[]): string;
/** Options for {@link parseCsv}. */
export interface ParseCsvOptions {
    /** Explicit field delimiter; when absent, one is auto-detected. */
    delimiter?: string;
    /**
     * Cap on rows kept for profiling. When the file has more data rows, the
     * first half of the budget is kept as head rows and the rest are sampled
     * every `k`-th row across the whole file (deterministic). Never affects
     * {@link Table.totalDataLines}.
     */
    maxRows?: number;
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
export declare function parseCsv(text: string, opts?: ParseCsvOptions): Table;
/**
 * Whether a cell value looks like a calendar date or timestamp. The regex
 * pins the shape (so bare years like `2024` stay numbers); `Date.parse`
 * rejects impossible dates like `2024-13-01`.
 * @param value - the cell value.
 * @returns true for ISO or slash dates with an optional time component.
 */
export declare function isDatetimeValue(value: string): boolean;
/** Infer the column kind from its non-empty values. */
export declare function inferKind(values: Cell[]): ColumnKind;
/**
 * Distribution statistics over the numeric subset of a column's cells.
 * Non-numeric and missing cells are skipped. `undefined` when nothing
 * numeric remains.
 * @param values - the column cells.
 * @returns the statistics, or undefined for an all-missing/all-text column.
 */
export declare function numericStats(values: Cell[]): NumericStats | undefined;
/**
 * Profile one column: kind, missing counts, unique-value count, and up to
 * `maxSample` distinct sample values in first-seen order.
 * @param name - the header name.
 * @param values - the column cells.
 * @param maxSample - how many distinct sample values to keep.
 * @returns the column profile.
 */
export declare function profileColumn(name: string, values: Cell[], maxSample: number): ColumnProfile;
/**
 * Profile a parsed table into the canonical {@link DatasetProfile}. The
 * `path` and `bytes` fields come from the caller (file read metadata).
 * @param table - the parsed table.
 * @param path - the file path as the model named it.
 * @param bytes - the number of bytes read.
 * @param maxSample - sample values kept per column.
 * @returns the dataset profile.
 */
export declare function buildProfile(table: Table, path: string, bytes: number, maxSample: number): DatasetProfile;
/**
 * Tally one column's value distribution: top frequencies with rates. Counts
 * reflect the rows present in `table` (which may be a sample). Missing cells
 * are counted separately and never appear in `values`.
 * @param table - the parsed table.
 * @param columnIndex - the column to tally.
 * @param topK - how many top values to return.
 * @returns the distribution.
 */
export declare function valueCounts(table: Table, columnIndex: number, topK: number): ValueCounts;
/** Row projection and filtering options for {@link selectRows}. */
export interface RowSelection {
    /** Column names to include, in output order; defaults to all headers. */
    columns?: string[];
    /** Exact-match filter on one column; `null` cells never match. */
    where?: {
        column: string;
        equals: string;
    };
}
/** The `sample_rows` per-call result, before read-level fields. */
export interface SelectRowsResult {
    rows: Record<string, string | null>[];
    /** Matched rows counted over the whole table, ignoring offset/limit. */
    totalMatches: number;
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
export declare function selectRows(table: Table, selection: RowSelection, offset: number, limit: number): SelectRowsResult;
/** Options for {@link readCsvFile}. */
export interface ReadCsvOptions {
    /**
     * Maximum number of bytes to read (defaults to {@link DEFAULT_MAX_BYTES}).
     * A larger file reports `truncated: true`; the caller decides whether that
     * is acceptable (profile_dataset marks it, sample_rows rejects it).
     */
    maxBytes?: number;
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
export declare function readCsvFile(path: string, signal: AbortSignal, opts?: ReadCsvOptions): Promise<{
    text: string;
    bytes: number;
    truncated: boolean;
}>;
export {};
//# sourceMappingURL=profile.d.ts.map