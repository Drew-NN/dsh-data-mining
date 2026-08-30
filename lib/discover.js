import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { detectDelimiter } from "./profile.js";
const EXT_KIND = {
    csv: 'csv',
    tsv: 'csv',
    json: 'json',
    jsonl: 'json',
    parquet: 'parquet',
    xlsx: 'excel',
    xls: 'excel',
};
const SKIP_DIRS = new Set(['node_modules', '.git']);
const ESTIMATE_CHUNK = 64 * 1024;
function extOf(name) {
    const dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}
/**
 * Sniff the delimiter and estimate the row count of a CSV/TSV file by reading
 * its head (up to 64 KiB). Files smaller than the chunk are counted exactly;
 * larger ones extrapolate the head's line density over the full size.
 * @param path - the file.
 * @param signal - aborts the read.
 * @returns the delimiter, the row estimate, and whether it is approximate.
 */
async function estimateCsv(path, signal) {
    const handle = await open(path, 'r');
    try {
        const { size } = await handle.stat();
        const chunkSize = Math.min(size, ESTIMATE_CHUNK);
        const buffer = Buffer.alloc(chunkSize);
        let read = 0;
        while (read < chunkSize) {
            signal.throwIfAborted();
            const result = await handle.read(buffer, read, chunkSize - read, read);
            if (result.bytesRead === 0)
                break;
            read += result.bytesRead;
        }
        const text = buffer.subarray(0, read).toString('utf8');
        // Strip a UTF-8 BOM so the delimiter sniff matches parseCsv's view.
        const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
        const lines = clean.split(/\r\n|\n|\r/).filter(line => line.length > 0);
        const delimiter = detectDelimiter(lines);
        const estimated = read < size;
        const rowEstimate = read === 0 ? 0
            : estimated
                ? Math.max(0, Math.round(lines.length * (size / read)))
                : Math.max(0, lines.length - 1); // the whole file fit: drop the header line
        return { delimiter, rowEstimate, estimated };
    }
    finally {
        await handle.close();
    }
}
async function walk(root, opts, files, depth) {
    if (depth >= opts.maxDepth || files.length >= opts.maxFiles) {
        return files.length >= opts.maxFiles;
    }
    let entries;
    try {
        entries = await readdir(root, { withFileTypes: true });
    }
    catch {
        return false;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    let hitCap = false;
    for (const entry of entries) {
        opts.signal.throwIfAborted();
        if (files.length >= opts.maxFiles) {
            hitCap = true;
            break;
        }
        const path = join(root, entry.name);
        if (entry.isDirectory()) {
            if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name))
                continue;
            hitCap = (await walk(path, opts, files, depth + 1)) || hitCap;
            continue;
        }
        if (!entry.isFile())
            continue;
        const kind = EXT_KIND[extOf(entry.name)];
        if (kind === undefined)
            continue;
        const st = await stat(path);
        if (kind === 'csv') {
            const { delimiter, rowEstimate, estimated } = await estimateCsv(path, opts.signal);
            files.push({ path, ext: extOf(entry.name), kind, bytes: st.size, delimiter, rowEstimate, estimated });
        }
        else {
            files.push({ path, ext: extOf(entry.name), kind, bytes: st.size });
        }
    }
    return hitCap;
}
/**
 * Recursively discover data files under `root`: csv/tsv/json/jsonl/parquet/
 * xlsx/xls, skipping hidden directories and dependency folders. Results are
 * sorted by path.
 * @param root - the directory to scan.
 * @param opts - depth/file caps and cancellation.
 * @returns the discovery result.
 */
export async function discoverDataFiles(root, opts = {}) {
    const maxDepth = opts.maxDepth ?? 3;
    const maxFiles = opts.maxFiles ?? 200;
    const signal = opts.signal ?? new AbortController().signal;
    // Fail loud on a missing root or a non-directory: an empty listing would
    // read as "no data here" and mislead the model about a typo'd path.
    const st = await stat(root);
    if (!st.isDirectory())
        throw new Error(`discoverDataFiles: "${root}" is not a directory`);
    const files = [];
    const hitCap = await walk(root, { maxDepth, maxFiles, signal }, files, 0);
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { root, fileCount: files.length, truncated: hitCap, files };
}
