/**
 * dsh-data-mining — browser half.
 *
 * Renders a worker dock in the `conversation.input.dock` strip (the same
 * slot the goal bar uses): one chip per data-mining stage with a
 * mechanically derived progress light, refreshed from the `/dm status` host
 * command. Clicking a stage chip opens the corresponding worker session when
 * one exists, else focuses the input.
 *
 * Data flows host → command → browser: the component never reads files; it
 * calls `ctx.remote.commands.execute(sessionId, '/dm status')` and parses
 * the structured text block. No projection, no store, no event listener.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.dock entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { DockBarActions } from './slots.ts'
import { DockBar } from './DockBar.tsx'

export { DockBar } from './DockBar.tsx'
export type { DockBarActions } from './slots.ts'

/** Required services for the dock entry. `remote.commands` is its own
 * injection seat (as in ui-plan) — `remote` alone does not provide it. */
export const inject = ['slots', 'sessions', 'remote', 'remote.commands']

/** Browser plugin body: the worker dock entry. */
export function apply(ctx: ClientContext): void {
  const sessions = ctx.sessions

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'data-mining-dock',
    order: 20,
    inject: (sessionId: SessionId): DockBarActions => ({
      sessionId,
      refreshStatus: () => ctx.remote.commands.execute(sessionId, '/dm status'),
      openSession: (id: SessionId) => sessions.open(id),
    }),
  }, DockBar))
}
