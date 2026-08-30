import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCsv, readCsvFile } from "./profile.js";
/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** Small stable string hash, for per-group RNG seeds. */
function hashString(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++)
        h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return h >>> 0;
}
/** Fisher–Yates shuffle of 0..n-1 with the given RNG. */
function shuffledIndices(n, rng) {
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = idx[i] ?? i;
        idx[i] = idx[j] ?? j;
        idx[j] = tmp;
    }
    return idx;
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
export function planSplit(rows, headers, options) {
    const n = rows.length;
    const train = new Array(n).fill(false);
    const test = new Array(n).fill(false);
    const dropped = new Array(n).fill(false);
    if (n === 0)
        return { train, test, dropped };
    const ratio = options.ratio;
    const seed = options.seed ?? 42;
    if (options.strategy === 'random') {
        const rng = mulberry32(seed);
        const col = options.stratifyColumn === undefined ? undefined : headers.indexOf(options.stratifyColumn);
        if (options.stratifyColumn !== undefined && col === -1) {
            throw new Error(`planSplit: stratifyColumn "${options.stratifyColumn}" not found`);
        }
        if (col === undefined) {
            const order = shuffledIndices(n, rng);
            const k = Math.max(1, Math.min(n - 1, Math.round(n * ratio)));
            for (let i = 0; i < k; i++)
                train[order[i]] = true;
            for (let i = k; i < n; i++)
                test[order[i]] = true;
        }
        else {
            const groups = new Map();
            rows.forEach((row, i) => {
                const key = row[col] ?? '\u0000null';
                const list = groups.get(key) ?? [];
                list.push(i);
                groups.set(key, list);
            });
            for (const [key, indices] of groups) {
                const grng = mulberry32((seed + hashString(key)) >>> 0);
                const order = shuffledIndices(indices.length, grng);
                const k = Math.max(0, Math.min(indices.length - 1, Math.round(indices.length * ratio)));
                for (let i = 0; i < k; i++)
                    train[indices[order[i]]] = true;
                for (let i = k; i < indices.length; i++)
                    test[indices[order[i]]] = true;
            }
        }
        return { train, test, dropped };
    }
    if (options.strategy === 'chronological') {
        const timeColumn = options.timeColumn;
        if (timeColumn === undefined)
            throw new Error('planSplit: chronological split requires timeColumn');
        const ci = headers.indexOf(timeColumn);
        if (ci === -1)
            throw new Error(`planSplit: timeColumn "${timeColumn}" not found`);
        const times = rows.map((row, i) => {
            const v = row[ci] ?? null;
            if (v === null || v.trim().length === 0) {
                throw new Error(`planSplit: unparseable time at row ${i + 1} of column "${timeColumn}"`);
            }
            const t = Date.parse(v.trim());
            if (Number.isNaN(t))
                throw new Error(`planSplit: unparseable time "${v}" at row ${i + 1} of column "${timeColumn}"`);
            return t;
        });
        const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => times[a] - times[b] || a - b);
        const k = Math.max(1, Math.min(n - 1, Math.floor(n * ratio)));
        const cutoff = times[order[k - 1]];
        const gapMs = (options.gapDays ?? 0) * 86_400_000;
        for (const i of order) {
            const t = times[i];
            if (t <= cutoff)
                train[i] = true;
            else if (gapMs > 0 && t <= cutoff + gapMs)
                dropped[i] = true;
            else
                test[i] = true;
        }
        return { train, test, dropped };
    }
    // group
    const groupColumn = options.groupColumn;
    if (groupColumn === undefined)
        throw new Error('planSplit: group split requires groupColumn');
    const gi = headers.indexOf(groupColumn);
    if (gi === -1)
        throw new Error(`planSplit: groupColumn "${groupColumn}" not found`);
    const groups = new Map();
    rows.forEach((row, i) => {
        const v = row[gi] ?? null;
        if (v === null || v.length === 0)
            throw new Error(`planSplit: null group value at row ${i + 1} of column "${groupColumn}"`);
        const list = groups.get(v) ?? [];
        list.push(i);
        groups.set(v, list);
    });
    const rng = mulberry32(seed);
    const keys = [...groups.keys()];
    for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = keys[i];
        keys[i] = keys[j];
        keys[j] = tmp;
    }
    let trainCount = 0;
    for (const key of keys) {
        const indices = groups.get(key);
        if (trainCount / n < ratio) {
            indices.forEach(i => { train[i] = true; });
            trainCount += indices.length;
        }
        else {
            indices.forEach(i => { test[i] = true; });
        }
    }
    return { train, test, dropped };
}
/**
 * Serialize one CSV line, quoting cells that contain the delimiter, quotes,
 * or line breaks (double-quoted, with `""` escapes).
 * @param cells - the cell values; `null` renders as an empty field.
 * @param delimiter - the field delimiter.
 * @returns the line.
 */
export function toCsvLine(cells, delimiter = ',') {
    return cells.map(cell => {
        if (cell === null)
            return '';
        if (cell.includes(delimiter) || cell.includes('"') || cell.includes('\n') || cell.includes('\r')) {
            return `"${cell.replaceAll('"', '""')}"`;
        }
        return cell;
    }).join(delimiter);
}
/** Render the kept rows (original order) as CSV text with the header. */
function renderCsv(headers, rows, keep) {
    const lines = [toCsvLine(headers)];
    rows.forEach((row, i) => { if (keep[i])
        lines.push(toCsvLine(row)); });
    return lines.join('\n') + '\n';
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
export async function splitDatasetFile(path, signal, options) {
    const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
    const { text, truncated } = await readCsvFile(path, signal, { maxBytes });
    if (truncated) {
        throw new Error(`split_dataset: file exceeds the ${maxBytes}-byte read cap; splitting needs the whole file. Raise maxBytes or use Python via bash.`);
    }
    const table = parseCsv(text);
    const plan = planSplit(table.rows, table.headers, options);
    const seed = options.seed ?? 42;
    await mkdir(options.outDir, { recursive: true });
    const trainFile = join(options.outDir, 'train.csv');
    const testFile = join(options.outDir, 'test.csv');
    const splitFile = join(options.outDir, 'split.json');
    await writeFile(trainFile, renderCsv(table.headers, table.rows, plan.train));
    await writeFile(testFile, renderCsv(table.headers, table.rows, plan.test));
    const metadata = {
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
    };
    await writeFile(splitFile, JSON.stringify(metadata, null, 2));
    return { metadata, trainFile, testFile, splitFile };
}
/** Parse a table's time column; fails loud on any unparseable or empty value. */
function parseTimeColumn(headers, rows, column) {
    const ci = headers.indexOf(column);
    if (ci === -1)
        throw new Error(`check_leakage: timeColumn "${column}" missing from headers`);
    return rows.map((row, i) => {
        const v = row[ci] ?? null;
        if (v === null || v.trim().length === 0) {
            throw new Error(`check_leakage: empty time at row ${i + 1} of column "${column}"`);
        }
        const t = Date.parse(v.trim());
        if (Number.isNaN(t))
            throw new Error(`check_leakage: unparseable time "${v}" at row ${i + 1} of column "${column}"`);
        return t;
    });
}
function maxOf(values) {
    let m = -Infinity;
    for (const v of values)
        if (v > m)
            m = v;
    return m;
}
function minOf(values) {
    let m = Infinity;
    for (const v of values)
        if (v < m)
            m = v;
    return m;
}
/**
 * Read and validate a recorded split's metadata (`split.json`). Unknown
 * versions fail loud.
 * @param splitFile - path to the split.json.
 * @returns the parsed metadata.
 */
export async function readSplitMetadata(splitFile) {
    let metadata;
    try {
        metadata = JSON.parse(await readFile(splitFile, 'utf8'));
    }
    catch (error) {
        throw new Error(`cannot read split metadata "${splitFile}": ${error.message}`);
    }
    if (metadata.version !== 1) {
        throw new Error(`unsupported split metadata version ${String(metadata.version)}`);
    }
    return metadata;
}
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
export async function checkLeakageFile(splitFile, signal, opts = {}) {
    const maxBytes = opts.maxBytes ?? 64 * 1024 * 1024;
    const metadata = await readSplitMetadata(splitFile);
    const trainRead = await readCsvFile(metadata.trainFile, signal, { maxBytes });
    const testRead = await readCsvFile(metadata.testFile, signal, { maxBytes });
    if (trainRead.truncated || testRead.truncated) {
        throw new Error(`check_leakage: train/test exceeds the ${maxBytes}-byte read cap; cannot verify leakage on a partial read. Raise maxBytes.`);
    }
    const train = parseCsv(trainRead.text);
    const test = parseCsv(testRead.text);
    const checks = [];
    const totalsOk = metadata.trainRows + metadata.testRows + metadata.droppedRows === metadata.totalRows;
    checks.push({
        name: 'totals',
        passed: totalsOk,
        detail: `${metadata.trainRows}+${metadata.testRows}+${metadata.droppedRows}=${metadata.totalRows}${totalsOk ? '' : ' — does not equal the recorded totalRows'}`,
    });
    const countOk = train.totalDataLines === metadata.trainRows && test.totalDataLines === metadata.testRows;
    checks.push({
        name: 'row-counts',
        passed: countOk,
        detail: `train ${train.totalDataLines}/${metadata.trainRows}, test ${test.totalDataLines}/${metadata.testRows}${countOk ? '' : ' — files no longer match the recorded split'}`,
    });
    const trainHashes = new Set();
    for (const row of train.rows)
        trainHashes.add(JSON.stringify(row));
    const duplicateSamples = [];
    let duplicateCount = 0;
    for (const row of test.rows) {
        if (trainHashes.has(JSON.stringify(row))) {
            duplicateCount++;
            if (duplicateSamples.length < 3)
                duplicateSamples.push(row.map(cell => cell ?? ''));
        }
    }
    checks.push({
        name: 'duplicates',
        passed: duplicateCount === 0,
        detail: duplicateCount === 0
            ? 'no exact duplicate rows across train/test'
            : `${duplicateCount} rows appear in both train and test`,
    });
    let idOverlapCount = 0;
    if (metadata.idColumn !== null) {
        const ti = train.headers.indexOf(metadata.idColumn);
        const si = test.headers.indexOf(metadata.idColumn);
        if (ti === -1 || si === -1) {
            checks.push({ name: 'id-column', passed: false, detail: `idColumn "${metadata.idColumn}" missing from train/test headers` });
        }
        else {
            const trainIds = new Set();
            for (const row of train.rows) {
                const v = row[ti];
                if (v !== null && v !== undefined)
                    trainIds.add(v);
            }
            for (const row of test.rows) {
                const v = row[si];
                if (v !== null && v !== undefined && trainIds.has(v))
                    idOverlapCount++;
            }
            const hardFail = metadata.strategy === 'group' && idOverlapCount > 0;
            checks.push({
                name: 'id-column',
                passed: !hardFail,
                detail: idOverlapCount === 0
                    ? `no ${metadata.idColumn} overlap`
                    : `${idOverlapCount} ${metadata.idColumn} values appear on both sides${hardFail ? ' (group split: FAIL)' : ' (non-group split: warning)'}`,
            });
        }
    }
    if (metadata.timeColumn !== null) {
        let trainTimes;
        let testTimes;
        try {
            trainTimes = parseTimeColumn(train.headers, train.rows, metadata.timeColumn);
            testTimes = parseTimeColumn(test.headers, test.rows, metadata.timeColumn);
        }
        catch (error) {
            checks.push({ name: 'time-order', passed: false, detail: error.message });
            return finish(checks, metadata, duplicateCount, duplicateSamples, idOverlapCount, train.totalDataLines, test.totalDataLines);
        }
        const maxTrain = maxOf(trainTimes);
        const minTest = minOf(testTimes);
        const gapMs = (metadata.gapDays ?? 0) * 86_400_000;
        const ok = maxTrain + gapMs <= minTest;
        checks.push({
            name: 'time-order',
            passed: ok,
            detail: ok
                ? `max(train ${new Date(maxTrain).toISOString()}) + ${metadata.gapDays ?? 0}d <= min(test ${new Date(minTest).toISOString()})`
                : `train contains rows at or after the test boundary (max train ${new Date(maxTrain).toISOString()} vs min test ${new Date(minTest).toISOString()})`,
        });
    }
    return finish(checks, metadata, duplicateCount, duplicateSamples, idOverlapCount, train.totalDataLines, test.totalDataLines);
}
function finish(checks, metadata, duplicateCount, duplicateSamples, idOverlapCount, trainRows, testRows) {
    return {
        ok: checks.every(c => c.passed),
        datasetPath: metadata.datasetPath,
        strategy: metadata.strategy,
        checks,
        duplicateCount,
        duplicateSamples,
        idOverlapCount,
        trainRows,
        testRows,
    };
}
