/** Preset ids shipped by this package and installed into the user root. */
export declare const SHIPPED_PRESETS: readonly ["data-mining", "data-mining-understanding", "data-mining-modeling"];
/** The user preset root; overridable for tests. */
export declare function userPresetRoot(dshHome?: string | undefined): string;
/**
 * Install the shipped agent presets into the user root (`$DSH_HOME/
 * .agent-presets`), the root dsh documents as "where a person — or an agent —
 * authors their own". Idempotent: an existing composition is left untouched
 * UNLESS it is a legacy row still referencing the global entry
 * (`@deepseek-ai/dsh-data-mining`), which is replaced with the current
 * preset-only entry (`.../tools`) so upgrades self-heal.
 * @param dshHome - DSH_HOME override for tests.
 * @returns the preset ids written (empty when everything was already current).
 */
export declare function ensurePresetsInstalled(dshHome?: string): Promise<string[]>;
//# sourceMappingURL=presets.d.ts.map