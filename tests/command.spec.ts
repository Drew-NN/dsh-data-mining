import { describe, expect, it } from 'vitest'
import { WORKER_STAGES, renderLedgerStatus, stageStatus } from '../src/command.ts'
import { addDataset, emptyManifest, setGoal, setPhase, setSplitRef } from '../src/manifest.ts'

describe('stageStatus', () => {
  it('marks record-keyed stages done when their record exists', () => {
    let m = emptyManifest()
    expect(stageStatus(m, 'business', 'goal')).toBe('not-started')
    m = setGoal(m, { statement: 'predict churn', target: 'churn', metric: 'AUC' })
    expect(stageStatus(m, 'business', 'goal')).toBe('done')

    expect(stageStatus(m, 'data-understanding', 'datasets')).toBe('not-started')
    m = addDataset(m, { path: '/a.csv' })
    expect(stageStatus(m, 'data-understanding', 'datasets')).toBe('done')

    expect(stageStatus(m, 'split', 'split')).toBe('not-started')
    m = setSplitRef(m, { splitFile: '/s.json', strategy: 'random', trainFile: '/t.csv', testFile: '/e.csv' })
    expect(stageStatus(m, 'split', 'split')).toBe('done')
  })

  it('derives phase-keyed stages from the ledger phase marker', () => {
    let m = emptyManifest()
    expect(stageStatus(m, 'modeling', 'phase')).toBe('not-started')
    m = setPhase(m, 'modeling')
    expect(stageStatus(m, 'modeling', 'phase')).toBe('in-progress')
    m = setPhase(m, 'evaluation')
    expect(stageStatus(m, 'modeling', 'phase')).toBe('done')
    expect(stageStatus(m, 'evaluation', 'phase')).toBe('in-progress')
    expect(stageStatus(m, 'deployment', 'phase')).toBe('not-started')
    m = setPhase(m, 'done')
    expect(stageStatus(m, 'deployment', 'phase')).toBe('done')
  })
})

describe('renderLedgerStatus', () => {
  it('covers every worker stage', () => {
    const text = renderLedgerStatus(emptyManifest())
    for (const { label } of WORKER_STAGES) {
      expect(text).toContain(label)
    }
  })

  it('shows goal, phase, and counts', () => {
    const m = setGoal(addDataset(emptyManifest(), { path: '/a.csv' }), {
      statement: 'predict churn', target: 'churn', metric: 'AUC',
    })
    const text = renderLedgerStatus(m)
    expect(text).toContain('“predict churn”')
    expect(text).toContain('1 个已记录')
    expect(text).toContain('未切分')
    expect(text).toContain('✅ 目标')
    expect(text).toContain('✅ 数据理解')
  })
})
