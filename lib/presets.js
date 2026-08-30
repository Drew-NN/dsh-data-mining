import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';
/** Preset ids shipped by this package and installed into the user root. */
export const SHIPPED_PRESETS = ['data-mining'];
/** The package's own preset sources (shipped inside `presets/`). */
const PRESETS_SRC = fileURLToPath(new URL('../presets/', import.meta.url));
/** The user preset root; overridable for tests. */
export function userPresetRoot(dshHome = process.env.DSH_HOME) {
    return join(dshHome ?? join(homedir(), '.dsh'), '.agent-presets');
}
/** The old preset row that referenced the global entry; detected for replacement. */
const LEGACY_ENTRY_MARKER = "name: '@deepseek-ai/dsh-data-mining'";
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
export async function ensurePresetsInstalled(dshHome) {
    const root = userPresetRoot(dshHome);
    const written = [];
    for (const id of SHIPPED_PRESETS) {
        const targetDir = join(root, id);
        const target = join(targetDir, 'agent.cordis.yml');
        const fresh = await readFile(join(PRESETS_SRC, id, 'agent.cordis.yml'), 'utf8');
        if (existsSync(target)) {
            const existing = await readFile(target, 'utf8');
            if (existing === fresh || !existing.includes(LEGACY_ENTRY_MARKER))
                continue;
            // legacy row: replace
        }
        await mkdir(targetDir, { recursive: true });
        await copyFile(join(PRESETS_SRC, id, 'agent.cordis.yml'), target);
        await copyFile(join(PRESETS_SRC, id, 'preset.yml'), join(targetDir, 'preset.yml'));
        written.push(id);
    }
    return written;
}
