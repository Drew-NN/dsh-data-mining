import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
/** The manifest file name inside the dsh_manifest directory. */
export const MANIFEST_FILENAME = 'manifest.json';
/** An empty manifest; a missing file loads as this. */
export function emptyManifest() {
    return { version: 1, goal: null, phase: null, datasets: [], split: null, decisions: [] };
}
/** Record the agreed goal. */
export function setGoal(m, goal) {
    return {
        ...m,
        goal: { statement: goal.statement, target: goal.target, metric: goal.metric, constraints: goal.constraints ?? [] },
    };
}
/** Move to a new phase. */
export function setPhase(m, phase) {
    return { ...m, phase };
}
/** Append one dataset entry (never overwrites). */
export function addDataset(m, dataset) {
    return {
        ...m,
        datasets: [...m.datasets, { path: dataset.path, notes: dataset.notes ?? '', recordedAt: new Date().toISOString() }],
    };
}
/** Record the split reference (single value, overwrites). */
export function setSplitRef(m, split) {
    return { ...m, split };
}
/** Append one decision, stamped with the current phase. */
export function recordDecision(m, text) {
    return {
        ...m,
        decisions: [...m.decisions, { text, phase: m.phase ?? 'unknown', recordedAt: new Date().toISOString() }],
    };
}
/**
 * Load a manifest from disk; a missing file is an empty manifest. Unknown
 * versions fail loud (a corrupt ledger must not be silently reset).
 * @param filePath - the manifest file path.
 * @returns the parsed manifest.
 */
export async function loadManifest(filePath) {
    let raw;
    try {
        raw = await readFile(filePath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return emptyManifest();
        throw error;
    }
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1)
        throw new Error(`manifest: unsupported version ${String(parsed.version)}`);
    // Older gate-era manifests carried a `phaseGates` key; it no longer exists
    // and must not leak into returned values or the tool's output schema.
    const legacy = parsed;
    const { phaseGates: _legacy, ...rest } = legacy;
    return {
        ...emptyManifest(),
        ...rest,
        datasets: rest.datasets ?? [],
        decisions: rest.decisions ?? [],
    };
}
/** Persist a manifest, creating the directory if needed. */
export async function saveManifest(filePath, manifest) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(manifest, null, 2));
}
