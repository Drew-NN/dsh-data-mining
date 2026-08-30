/**
 * dsh-data-mining — one installable data-mining agent for DeepSeek Harness.
 *
 * Registers the data-profiling tools (`profile_dataset`, `sample_rows`) on
 * `ctx.tools` and the bundled data-mining skills on `ctx.skills`. The persona
 * lives in `cordis.patch.yml` (the bundle's patch layer), so installing this
 * bundle adds the whole data-mining agent to a profile.
 *
 * @module @deepseek-ai/dsh-data-mining
 */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis plugin name. */
export declare const name = "data-mining";
/** Services required by the tools and the bundled skill provider. */
export declare const inject: string[];
/**
 * Register the data-mining tools and bundled skill provider.
 * @param ctx - registrant context carrying the tool and skill registries.
 */
export declare function apply(ctx: Context): void;
/** Verify a phase's machine-checkable exit conditions; returns what is missing. */
/** Render the gate layout as an ordered array for the dm tool's output. */
//# sourceMappingURL=index.d.ts.map