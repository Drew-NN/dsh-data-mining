/** Data file formats discover_datasets recognizes. */
export type DataKind = 'csv' | 'json' | 'parquet' | 'excel';
/** One discovered data file. */
export interface DataFileInfo {
    path: string;
    ext: string;
    kind: DataKind;
    bytes: number;
    /** Sniffed field delimiter, present for csv/tsv files. */
    delimiter?: string;
    /** Estimated data-line count; exact when the whole file fit the estimator. */
    rowEstimate?: number;
    /** True when `rowEstimate` was extrapolated from a head chunk. */
    estimated?: boolean;
}
/** The `discover_datasets` canonical result. */
export interface DiscoveryResult {
    root: string;
    fileCount: number;
    /** True when the file cap was hit and the listing is incomplete. */
    truncated: boolean;
    files: DataFileInfo[];
}
/** Options for {@link discoverDataFiles}. */
export interface DiscoverOptions {
    /** Maximum directory depth to descend into (default 3). */
    maxDepth?: number;
    /** Maximum files to report (default 200). */
    maxFiles?: number;
    signal?: AbortSignal;
}
/**
 * Recursively discover data files under `root`: csv/tsv/json/jsonl/parquet/
 * xlsx/xls, skipping hidden directories and dependency folders. Results are
 * sorted by path.
 * @param root - the directory to scan.
 * @param opts - depth/file caps and cancellation.
 * @returns the discovery result.
 */
export declare function discoverDataFiles(root: string, opts?: DiscoverOptions): Promise<DiscoveryResult>;
//# sourceMappingURL=discover.d.ts.map