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
/** The worker roster: label → role instructions (sent as the first prompt). */
const WORKERS: Array<{ label: string; role: string }> = [
  {
    label: '数据理解工人',
    role: '你是数据理解工人（数据挖掘流水线的一员）。请先读取工作区的 dsh_manifest/manifest.json（若不存在视为全新开始），然后探查数据，用 manifest 工具把数据地图、质量发现、可疑字段记入（add_dataset，set_phase data-understanding），完成后向用户汇报。',
  },
  {
    label: '建模工人',
    role: '你是建模工人（数据挖掘流水线的一员）。开工前必须先读 dsh_manifest/manifest.json 检查前置阶段进度：数据理解（datasets 有记录）和切分（split 有引用）都完成，才能开始切分、特征工程、建模、评估。前置未完成时不要绕过——向用户反馈"前置阶段 X 还没完成"，然后停下等待指示。',
  },
]

export function DockBar({ sessionId, getAgentPreset, refreshStatus, spawnWorker, openSession, ..._rest }: DockBarProps) {
  // Only render inside a 数据挖掘模式 (data-mining) session; everywhere else
  // the dock stays out of the way so it cannot disturb other presets.
  const agentPreset = getAgentPreset()
  const [status, setStatus] = useState<string>('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [spawning, setSpawning] = useState<string | undefined>(undefined)

  const spawn = async (worker: { label: string; role: string }) => {
    setSpawning(worker.label)
    try {
      await spawnWorker(worker.role)
    } catch (e) {
      setError(e instanceof Error ? e.message : `无法启动${worker.label}`)
    } finally {
      setSpawning(undefined)
    }
  }

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
  useEffect(() => { if (agentPreset === 'data-mining') void refresh() }, [])

  if (agentPreset !== 'data-mining') return null

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
      {WORKERS.map(w => (
        <button
          key={w.label}
          type="button"
          title={`打开${w.label}会话`}
          disabled={spawning !== undefined}
          onClick={() => { void spawn(w) }}
          style={{
            border: '1px solid var(--dsw-alias-border, #ddd)', background: 'transparent',
            borderRadius: 10, padding: '1px 8px', cursor: 'pointer', fontSize: 12,
          }}
        >
          {spawning === w.label ? '启动中…' : `👷 ${w.label}`}
        </button>
      ))}
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
