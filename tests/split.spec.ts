import { describe, expect, it } from 'vitest'
import { parseCsv } from '../src/profile.ts'
import { mulberry32, planSplit, toCsvLine } from '../src/split.ts'

function table(csv: string) {
  const t = parseCsv(csv)
  return { headers: t.headers, rows: t.rows }
}

describe('toCsvLine', () => {
  it('joins plain cells with the delimiter', () => {
    expect(toCsvLine(['a', 'b'])).toBe('a,b')
  })

  it('quotes cells containing the delimiter, quotes, or newlines', () => {
    expect(toCsvLine(['a,b', 'c'])).toBe('"a,b",c')
    expect(toCsvLine(['say "hi"'])).toBe('"say ""hi"""')
    expect(toCsvLine(['x\ny'])).toBe('"x\ny"')
  })

  it('renders null and empty cells as empty fields', () => {
    expect(toCsvLine([null, ''])).toBe(',')
    expect(toCsvLine([])).toBe('')
  })
})

describe('mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const seqA = Array.from({ length: 5 }, () => a())
    const seqB = Array.from({ length: 5 }, () => b())
    expect(seqA).toEqual(seqB)
    expect(seqA.every(x => x >= 0 && x < 1)).toBe(true)
  })
})

describe('planSplit random', () => {
  it('splits by ratio with disjoint, covering index sets', () => {
    const { headers, rows } = table('v\n1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n')
    const plan = planSplit(rows, headers, { strategy: 'random', ratio: 0.7, seed: 7 })
    const inTrain = plan.train.filter(Boolean).length
    const inTest = plan.test.filter(Boolean).length
    expect(inTrain).toBe(7)
    expect(inTest).toBe(3)
    for (let i = 0; i < rows.length; i++) {
      // every row lands in exactly one side
      expect(plan.train[i] === plan.test[i]).toBe(false)
      expect(plan.train[i] || plan.test[i]).toBe(true)
      expect(plan.dropped[i]).toBe(false)
    }
  })

  it('is deterministic for the same seed and different for a different seed', () => {
    const { headers, rows } = table('v\n1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n')
    const a = planSplit(rows, headers, { strategy: 'random', ratio: 0.5, seed: 3 })
    const b = planSplit(rows, headers, { strategy: 'random', ratio: 0.5, seed: 3 })
    const c = planSplit(rows, headers, { strategy: 'random', ratio: 0.5, seed: 4 })
    expect(a.train).toEqual(b.train)
    expect(a.test).toEqual(b.test)
    expect(a.train).not.toEqual(c.train)
  })
})

describe('planSplit stratify', () => {
  it('keeps the train share balanced within each stratum', () => {
    const { headers, rows } = table('cls,val\na,1\na,2\nb,3\nb,4\nb,5\nb,6\n')
    const plan = planSplit(rows, headers, { strategy: 'random', ratio: 0.5, seed: 9, stratifyColumn: 'cls' })
    const trainByClass: Record<string, number> = {}
    const totalByClass: Record<string, number> = {}
    rows.forEach((row, i) => {
      const cls = row[0]!
      totalByClass[cls] = (totalByClass[cls] ?? 0) + 1
      if (plan.train[i]) trainByClass[cls] = (trainByClass[cls] ?? 0) + 1
    })
    // a: 1 of 2, b: 2 of 4
    expect(trainByClass['a']).toBe(1)
    expect(trainByClass['b']).toBe(2)
    expect(totalByClass['a']).toBe(2)
    expect(totalByClass['b']).toBe(4)
  })
})

describe('planSplit chronological', () => {
  const CSV = 'date,value\n2024-01-01,a\n2024-01-02,b\n2024-01-03,c\n2024-01-04,d\n2024-01-05,e\n'

  it('puts the earliest rows in train and the latest in test', () => {
    const { headers, rows } = table(CSV)
    const plan = planSplit(rows, headers, { strategy: 'chronological', ratio: 0.6, timeColumn: 'date' })
    expect(plan.train.filter(Boolean).length).toBe(3)
    expect(plan.test.filter(Boolean).length).toBe(2)
    expect(plan.dropped.filter(Boolean).length).toBe(0)
    // train: a,b,c (rows 0-2); test: d,e (rows 3-4)
    expect(plan.train.slice(0, 3)).toEqual([true, true, true])
    expect(plan.test.slice(3)).toEqual([true, true])
  })

  it('drops rows inside the gap window and records them', () => {
    const { headers, rows } = table(CSV)
    const plan = planSplit(rows, headers, { strategy: 'chronological', ratio: 0.6, timeColumn: 'date', gapDays: 1 })
    expect(plan.train.slice(0, 3)).toEqual([true, true, true])
    expect(plan.dropped[3]).toBe(true) // 2024-01-04 inside the 1-day gap
    expect(plan.test[4]).toBe(true) // 2024-01-05 stays test
    expect(plan.train.filter(Boolean).length).toBe(3)
    expect(plan.test.filter(Boolean).length).toBe(1)
    expect(plan.dropped.filter(Boolean).length).toBe(1)
  })

  it('fails loud on an unparseable time value', () => {
    const { headers, rows } = table('date,value\n2024-01-01,a\nnot-a-date,b\n')
    expect(() => planSplit(rows, headers, { strategy: 'chronological', ratio: 0.5, timeColumn: 'date' })).toThrow(/not-a-date/)
  })
})

describe('planSplit group', () => {
  it('never lets a group value appear on both sides', () => {
    const { headers, rows } = table('group,value\ng1,a\ng1,b\ng2,c\ng3,d\ng3,e\ng3,f\n')
    const plan = planSplit(rows, headers, { strategy: 'group', ratio: 0.5, seed: 11, groupColumn: 'group' })
    const sideByGroup: Record<string, string> = {}
    rows.forEach((row, i) => {
      const g = row[0]!
      const side = plan.train[i] ? 'train' : plan.test[i] ? 'test' : 'dropped'
      if (sideByGroup[g] !== undefined && sideByGroup[g] !== side) {
        throw new Error(`group ${g} crossed sides`)
      }
      sideByGroup[g] = side
    })
    // all 6 rows land somewhere, none dropped
    expect(plan.dropped.every(Boolean) === false).toBe(true)
    const train = plan.train.filter(Boolean).length
    const test = plan.test.filter(Boolean).length
    expect(train + test).toBe(6)
    expect(train).toBeGreaterThan(0)
    expect(test).toBeGreaterThan(0)
  })

  it('fails loud on a null group value', () => {
    const { headers, rows } = table('group,value\n,\n1,2\n')
    expect(() => planSplit(rows, headers, { strategy: 'group', ratio: 0.5, groupColumn: 'group' })).toThrow()
  })
})
