/** The split strategies split_dataset supports. */
export type SplitStrategy = 'random' | 'chronological' | 'group';
/** Options for {@link planSplit}. */
export interface SplitOptions {
    strategy: SplitStrategy;
    /** Train share of the data, 0..1. */
    ratio: number;
    /** Seed for the deterministic random parts. */
    seed?: number;
    /** Stratify a random split by this column's values. */
    stratifyColumn?: string;
    /** Chronological split orders by this column (ISO/slash dates). */
    timeColumn?: string;
    /** Chronological split drops rows within this many days of the boundary. */
    gapDays?: number;
    /** Group split keeps this column's values on one side only. */
    groupColumn?: string;
    /** Entity key recorded for cross-split overlap checks. */
    idColumn?: string;
}
/** Per-row split membership; exactly one of train/test is true (dropped rows: neither). */
export interface SplitPlan {
    train: boolean[];
    test: boolean[];
    dropped: boolean[];
}
/** The persisted split metadata (`split.json`), version 1. */
export interface SplitMetadata {
    version: 1;
    datasetPath: string;
    name: string;
    strategy: SplitStrategy;
    ratio: number;
    seed: number;
    stratifyColumn: string | null;
    timeColumn: string | null;
    gapDays: number | null;
    groupColumn: string | null;
    idColumn: string | null;
    totalRows: number;
    trainRows: number;
    testRows: number;
    droppedRows: number;
    trainFile: string;
    testFile: string;
    createdAt: string;
}
/** Deterministic PRNG (mulberry32). */
export declare function mulberry32(seed: number): () => number;
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
export declare function planSplit(rows: readonly (string | null)[][], headers: readonly string[], options: SplitOptions): SplitPlan;
/**
 * Serialize one CSV line, quoting cells that contain the delimiter, quotes,
 * or line breaks (double-quoted, with `""` escapes).
 * @param cells - the cell values; `null` renders as an empty field.
 * @param delimiter - the field delimiter.
 * @returns the line.
 */
export declare function toCsvLine(cells: readonly (string | null)[], delimiter?: string): string;
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
export declare function splitDatasetFile(path: string, signal: AbortSignal, options: SplitOptions & {
    name: string;
    outDir: string;
    maxBytes?: number;
}): Promise<{
    metadata: SplitMetadata;
    trainFile: string;
    testFile: string;
    splitFile: string;
}>;
/** One named leakage check outcome. */
export interface LeakageCheck {
    name: string;
    passed: boolean;
    detail: string;
}
/** The `check_leakage` canonical result. */
export interface LeakageCheckResult {
    ok: boolean;
    datasetPath: string;
    strategy: SplitStrategy;
    checks: LeakageCheck[];
    duplicateCount: number;
    /** Up to three duplicated rows (as cell arrays), for the report. */
    duplicateSamples: string[][];
    idOverlapCount: number;
    trainRows: number;
    testRows: number;
}
/**
 * Read and validate a recorded split's metadata (`split.json`). Unknown
 * versions fail loud.
 * @param splitFile - path to the split.json.
 * @returns the parsed metadata.
 */
export declare function readSplitMetadata(splitFile: string): Promise<SplitMetadata>;
/**
 * Verify a recorded split against its files: metadata presence, row counts,
 * exact duplicate rows across train/test, entity-key overlap, and — for
 * chronological splits — that no train row is later than a test row plus the
 * gap. Every check is mechanical: a failing check means `ok: false`, never a
 * softly adjusted verdict.
 *
 * Whole-file reads only: if either side exceeds `maxBytes`, the check fails
 * loud instead of verifying a partial read.
 * @param splitFile - path to the split's `split.json`.
 * @param signal - cancellation.
 * @param opts - the byte cap.
 * @returns the check results.
 */
export declare function checkLeakageFile(splitFile: string, signal: AbortSignal, opts?: {
    maxBytes?: number;
}): Promise<LeakageCheckResult>;
//# sourceMappingURL=split.d.ts.map