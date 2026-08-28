import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import {
  addDataset, emptyManifest, loadManifest, recordDecision, saveManifest,
  setGoal, setPhase, setSplitRef,
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

