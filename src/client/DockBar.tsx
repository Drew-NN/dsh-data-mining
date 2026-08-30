import { useEffect, useState } from 'react'
import type { DockBarActions } from './slots.ts'

/** Full props of the dock entry: the input-dock runtime share plus the injected actions. */
export type DockBarProps = import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.input.dock'> & DockBarActions

/** Parse the status text block into per-stage lines for chip rendering. */
export function parseStatusLines(text: string): Array<{ icon: string; label: string }> {
  return text.split('\n')
    .map(line => line.trim())
    .filter(line => /^[✅🔄⬜]/.test(line))
    .map(line => ({ icon: line[0] ?? '⬜', label: line.slice(2) }))
}

/**
 * The worker dock: a row of stage chips with progress lights, refreshed
 * from `/dm status`. Clicking a chip focuses the worker's session when one
 * exists (we cannot know worker sessions yet, so the chip just refreshes and
 * reports the current summary).
 */
export function DockBar({ sessionId, refreshStatus, openSession, ..._rest }: DockBarProps) {
  const [status, setStatus] = useState<string>('')
  const [error, setError] = useState<string | undefined>(undefined)

  const refresh = async () => {
    try {
      const result = await refreshStatus()
      if (result.error !== undefined) {
        setError(result.error.message ?? 'status unavailable')
        setStatus('')
      } else {
        setStatus(result.text ?? '')
        setError(undefined)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'status unavailable')
      setStatus('')
    }
  }

  // Refresh exactly once on mount. `refresh` is recreated every render, so it
  // must NOT be an effect dependency — listing it would loop (refresh →
  // setState → rerender → new refresh → refresh …). Manual refresh is the
  // button's job.
  useEffect(() => { void refresh() }, [])

  const stages = parseStatusLines(status)

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
        fontSize: 12, borderTop: '1px solid var(--dsw-alias-border, #ddd)',
      }}
      data-plugin="data-mining-dock"
    >
      <span style={{ fontWeight: 600, marginRight: 4 }}>数据挖掘</span>
      {error !== undefined ? (
        <span style={{ color: '#b3261e' }}>{error}</span>
      ) : stages.length === 0 ? (
        <span style={{ color: '#888' }}>未开始（点此初始化 /dm status）</span>
      ) : (
        stages.map((s, i) => (
          <button
            key={i}
            type="button"
            title={`${s.icon} ${s.label} — 点击刷新`}
            onClick={() => { void refresh() }}
            style={{
              border: '1px solid var(--dsw-alias-border, #ddd)', background: 'transparent',
              borderRadius: 10, padding: '1px 8px', cursor: 'pointer', fontSize: 12,
            }}
          >
            {s.icon} {s.label}
          </button>
        ))
      )}
      <button
        type="button"
        onClick={() => { void refresh() }}
        style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12 }}
        aria-label="刷新进度"
      >
        ⟳
      </button>
      <span style={{ color: '#888', fontSize: 11 }}>{sessionId.slice(-6)}</span>
    </div>
  )
}
