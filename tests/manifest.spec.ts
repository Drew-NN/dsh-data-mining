import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import {
  addDataset, emptyManifest, loadManifest, recordDecision, saveManifest,
  setGoal, setPhase, setSplitRef,
  confirmComplete, forceComplete, initPhaseGates, isGateExecutable,
  redoPhase, requestComplete,
} from '../src/manifest.ts'

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempFile(name = 'manifest.json'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-manifest-'))
  tempDirs.push(dir)
  return join(dir, name)
}

describe('manifest pure functions', () => {
  it('starts empty', () => {
    const m = emptyManifest()
    expect(m.version).toBe(1)
    expect(m.goal).toBeNull()
    expect(m.phase).toBeNull()
    expect(m.datasets).toEqual([])
    expect(m.split).toBeNull()
    expect(m.decisions).toEqual([])
  })

  it('sets a goal with optional constraints', () => {
    const m = setGoal(emptyManifest(), { statement: 'predict churn', target: 'churn', metric: 'AUC' })
    expect(m.goal).toEqual({ statement: 'predict churn', target: 'churn', metric: 'AUC', constraints: [] })

    const withConstraints = setGoal(emptyManifest(), {
      statement: 'explain churn', target: 'churn', metric: 'recall', constraints: ['needs interpretability'],
    })
    expect(withConstraints.goal!.constraints).toEqual(['needs interpretability'])
  })

  it('appends datasets without overwriting', () => {
    let m = emptyManifest()
    m = addDataset(m, { path: '/a.csv', notes: 'has missing calls' })
    m = addDataset(m, { path: '/b.csv' })
    expect(m.datasets.length).toBe(2)
    expect(m.datasets[0]).toMatchObject({ path: '/a.csv', notes: 'has missing calls' })
    expect(m.datasets[1]).toMatchObject({ path: '/b.csv', notes: '' })
    expect(m.datasets[0]!.recordedAt).toBeTruthy()
  })

  it('records decisions stamped with the current phase', () => {
    let m = setPhase(emptyManifest(), 'data-cleaning')
    m = recordDecision(m, '999 means missing, impute median')
    m = recordDecision(m, 'drop city column')
    expect(m.decisions.length).toBe(2)
    expect(m.decisions[0]).toMatchObject({ text: '999 means missing, impute median', phase: 'data-cleaning' })
    expect(m.decisions[1]!.phase).toBe('data-cleaning')
  })

  it('records a decision with phase unknown when no phase is set', () => {
    const m = recordDecision(emptyManifest(), 'note')
    expect(m.decisions[0]!.phase).toBe('unknown')
  })

  it('sets a split reference', () => {
    const m = setSplitRef(emptyManifest(), {
      splitFile: '/s/split.json', strategy: 'random', trainFile: '/s/train.csv', testFile: '/s/test.csv',
    })
    expect(m.split).toEqual({ splitFile: '/s/split.json', strategy: 'random', trainFile: '/s/train.csv', testFile: '/s/test.csv' })
  })

  it('round-trips through save and load', async () => {
    const file = await tempFile()
    let m = emptyManifest()
    m = setGoal(m, { statement: 'g', target: 't', metric: 'm' })
    m = setPhase(m, 'modeling')
    m = addDataset(m, { path: '/d.csv' })
    m = recordDecision(m, 'use pipeline')
    await saveManifest(file, m)
    const loaded = await loadManifest(file)
    expect(loaded).toEqual(m)
  })

  it('loads a missing file as an empty manifest', async () => {
    const m = await loadManifest('/no/such/manifest.json')
    expect(m).toEqual(emptyManifest())
  })

  it('rejects an unsupported version', async () => {
    const file = await tempFile()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, JSON.stringify({ version: 99 }))
    await expect(loadManifest(file)).rejects.toThrow(/version/)
  })
})

describe('phaseGates state machine', () => {
  it('initializes with business unlocked and everything else locked', () => {
    const g = initPhaseGates()
    expect(g['business']!.status).toBe('unlocked')
    for (const p of ['data-understanding', 'data-cleaning', 'split', 'modeling', 'evaluation', 'deployment', 'done']) {
      expect(g[p as keyof typeof g]!.status).toBe('locked')
    }
  })

  it('requestComplete moves unlocked to pending and rejects locked phases', () => {
    let g = initPhaseGates()
    g = requestComplete(g, 'business')
    expect(g['business']!.status).toBe('pending')
    expect(() => requestComplete(g, 'data-understanding')).toThrow()
  })

  it('confirmComplete marks done and unlocks the next phase', () => {
    let g = initPhaseGates()
    g = requestComplete(g, 'business')
    g = confirmComplete(g, 'business')
    expect(g['business']!.status).toBe('done')
    expect(g['data-understanding']!.status).toBe('unlocked')
    expect(g['data-cleaning']!.status).toBe('locked')
  })

  it('only the direct successor unlocks', () => {
    let g = initPhaseGates()
    g = requestComplete(g, 'business')
    g = confirmComplete(g, 'business')
    // data-understanding done -> data-collection unlocks (its direct successor);
    // data-cleaning stays locked until data-collection completes
    g = requestComplete(g, 'data-understanding')
    g = confirmComplete(g, 'data-understanding')
    expect(g['data-collection']!.status).toBe('unlocked')
    expect(g['data-cleaning']!.status).toBe('locked')
  })

  it('redo unlocks the phase and relocks everything after it', () => {
    let g = initPhaseGates()
    g = requestComplete(g, 'business')
    g = confirmComplete(g, 'business')
    g = requestComplete(g, 'data-understanding')
    g = confirmComplete(g, 'data-understanding')
    g = redoPhase(g, 'business')
    expect(g['business']!.status).toBe('unlocked')
    expect(g['data-understanding']!.status).toBe('locked')
    expect(g['data-cleaning']!.status).toBe('locked')
  })

  it('forceComplete bypasses verification and records the reason', () => {
    const g = forceComplete(initPhaseGates(), 'business', 'user said skip')
    expect(g['business']!.status).toBe('done')
    expect(g['business']!.overrideReason).toBe('user said skip')
    expect(g['data-understanding']!.status).toBe('unlocked')
  })

  it('isGateExecutable allows unlocked and done but not locked or pending', () => {
    const g = initPhaseGates()
    expect(isGateExecutable(g, 'business')).toBe(true) // unlocked
    const g2 = requestComplete(g, 'business')
    expect(isGateExecutable(g2, 'business')).toBe(false) // pending
    const g3 = confirmComplete(g2, 'business')
    expect(isGateExecutable(g3, 'business')).toBe(true) // done
    expect(isGateExecutable(g3, 'data-understanding')).toBe(true) // unlocked by the confirmation
    expect(isGateExecutable(g3, 'split')).toBe(false) // still locked
  })
})
