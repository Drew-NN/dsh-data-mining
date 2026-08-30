/**
 * dsh-data-mining — preset tools entry.
 *
 * Registered ONLY by the 数据挖掘模式 (data-mining) agent preset
 * (`agent.cordis.yml` row `name: '@deepseek-ai/dsh-data-mining/tools'`), so
 * the profiling/split/ledger tools and the bundled skills are visible to
 * data-mining sessions alone. The global plugin entry (`./index.ts`) keeps
 * only the /dm status command; the browser dock is preset-gated in the
 * client half. This keeps every other preset's tool catalog untouched.
 *
 * @module @deepseek-ai/dsh-data-mining/tools
 */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis plugin name (preset entry; distinct from the global entry). */
export declare const name = "data-mining-tools";
/** Services required by the tools and the bundled skill provider. */
export declare const inject: string[];
/**
 * Register the data-mining tools and bundled skill provider.
 * @param ctx - registrant context carrying the tool and skill registries.
 */
/**
 * Register the data-mining tools and bundled skill provider.
 * @param ctx - registrant context carrying the tool and skill registries.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=tools.d.ts.map