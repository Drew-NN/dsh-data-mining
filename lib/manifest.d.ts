/** The workflow stages the manifest tracks (DESIGN.md six steps, split apart). */
export type ManifestPhase = 'business' | 'data-understanding' | 'data-collection' | 'data-cleaning' | 'split' | 'preprocessing' | 'modeling' | 'evaluation' | 'deployment' | 'done';
/** The agreed goal, decided in step 1 and confirmed by the user. */
export interface ManifestGoal {
    statement: string;
    target: string;
    metric: string;
    constraints: string[];
}
/** One profiled dataset with the agent's findings. */
export interface ManifestDataset {
    path: string;
    notes: string;
    recordedAt: string;
}
/** Reference to a recorded split (from split_dataset's split.json). */
export interface ManifestSplitRef {
    splitFile: string;
    strategy: 'random' | 'chronological' | 'group';
    trainFile: string;
    testFile: string;
}
/** One recorded decision, stamped with the phase it was made in. */
export interface ManifestDecision {
    text: string;
    phase: string;
    recordedAt: string;
}
/**
 * The workspace ledger: the agent's durable, cross-step memory. Lives at
 * `<cwd>/dsh_manifest/manifest.json` (the same directory family as
 * `splits/`). DESIGN.md's "storage" mechanism: every decision lands here so
 * later steps can reference it and the final result is reproducible.
 */
export interface Manifest {
    version: 1;
    goal: ManifestGoal | null;
    phase: ManifestPhase | null;
    datasets: ManifestDataset[];
    split: ManifestSplitRef | null;
    decisions: ManifestDecision[];
}
/** The manifest file name inside the dsh_manifest directory. */
export declare const MANIFEST_FILENAME = "manifest.json";
/** An empty manifest; a missing file loads as this. */
export declare function emptyManifest(): Manifest;
/** Record the agreed goal. */
export declare function setGoal(m: Manifest, goal: {
    statement: string;
    target: string;
    metric: string;
    constraints?: string[];
}): Manifest;
/** Move to a new phase. */
export declare function setPhase(m: Manifest, phase: ManifestPhase): Manifest;
/** Append one dataset entry (never overwrites). */
export declare function addDataset(m: Manifest, dataset: {
    path: string;
    notes?: string;
}): Manifest;
/** Record the split reference (single value, overwrites). */
export declare function setSplitRef(m: Manifest, split: ManifestSplitRef): Manifest;
/** Append one decision, stamped with the current phase. */
export declare function recordDecision(m: Manifest, text: string): Manifest;
/**
 * Load a manifest from disk; a missing file is an empty manifest. Unknown
 * versions fail loud (a corrupt ledger must not be silently reset).
 * @param filePath - the manifest file path.
 * @returns the parsed manifest.
 */
export declare function loadManifest(filePath: string): Promise<Manifest>;
/** Persist a manifest, creating the directory if needed. */
export declare function saveManifest(filePath: string, manifest: Manifest): Promise<void>;
//# sourceMappingURL=manifest.d.ts.map