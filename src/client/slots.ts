/** Business face of the data-mining dock entry. */
export interface DockBarActions {
  /** The session the dock is attached to. */
  sessionId: string
  /** Run `/dm status` and return the rendered ledger summary text. */
  refreshStatus: () => Promise<{ text?: string; error?: { message?: string } }>
  /** Open (switch to) a session by id. */
  openSession: (id: string) => void
}
