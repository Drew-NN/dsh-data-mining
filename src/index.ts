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

import type { Context } from '@deepseek-ai/cordis'
import { dmStatusCommand, type DmCommandResult } from './command.ts'
import { ensurePresetsInstalled } from './presets.ts'

/** Cordis plugin name. */
export const name = 'data-mining'

/** Register the /dm status host command (no tool registrations here). */
export function apply(ctx: Context): void {
  // Make the data-mining presets available on first boot (idempotent;
  // never overwrites a user-authored composition).
  void ensurePresetsInstalled().catch(() => {})
  const commands = ctx.get('commands') as
    | { register(cmd: { name: string; description: string; input: { hint: string }; handler: (i: { rawInput: string; agent?: { session?: { header?: { cwd?: string } } } }) => DmCommandResult | Promise<DmCommandResult> }): void }
    | undefined
  if (commands !== undefined) {
    commands.register({
      name: 'dm',
      description: 'show the data-mining workspace progress (ledger summary)',
      input: { hint: 'status' },
      handler: (invocation) => {
        if (invocation.rawInput.trim().startsWith('status')) {
          return dmStatusCommand(invocation)
        }
        return { kind: 'success', text: 'Usage: /dm status' }
      },
    })
  }
}
