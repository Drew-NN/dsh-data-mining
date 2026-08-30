/**
 * dsh-data-mining — global plugin entry.
 *
 * Installed into the web profile, this entry registers ONLY the /dm status
 * host command (harmless everywhere). The data-mining TOOLS and skills are
 * registered by the preset-only entry (`./tools.ts`, mounted by the
 * 数据挖掘模式 preset), and the browser dock is preset-gated — so sessions
 * under other presets are untouched. The persona lives in the preset
 * composition, not here.
 *
 * @module @deepseek-ai/dsh-data-mining
 */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis plugin name. */
export declare const name = "data-mining";
/** Register the /dm status host command (no tool registrations here). */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map