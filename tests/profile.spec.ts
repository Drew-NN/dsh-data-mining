import { describe, expect, it } from 'vitest'
import * as profile from '../src/profile.ts'

describe('numeric statistics', () => {
  it('computes min/max/mean/std/quartiles on a known odd-sized set', () => {
    const s = profile.numericStats(['1', '2', '3', '4', '5'])
    expect(s).toBeDefined()
    expect(s!.n).toBe(5)
    expect(s!.min).toBe(1)
    expect(s!.max).toBe(5)
    expect(s!.mean).toBe(3)
    expect(s!.std).toBeCloseTo(1.5811388300841898, 10)
    expect(s!.p25).toBe(2)
    expect(s!.p50).toBe(3)
    expect(s!.p75).toBe(4)
  })

  it('interpolates quartiles and median for an even-sized set', () => {
    const s = profile.numericStats(['1', '2', '3', '4'])
    expect(s!.p25).toBeCloseTo(1.75, 10)
    expect(s!.p50).toBeCloseTo(2.5, 10)
    expect(s!.p75).toBeCloseTo(3.25, 10)
  })

  it('reports null std for a single value', () => {
    const s = profile.numericStats(['7'])
    expect(s!.n).toBe(1)
    expect(s!.std).toBeNull()
    expect(s!.min).toBe(7)
    expect(s!.max).toBe(7)
    expect(s!.mean).toBe(7)
  })

  it('skips missing and non-numeric values', () => {
    const s = profile.numericStats([null, '1', '3', null, 'abc'])
    expect(s!.n).toBe(2)
    expect(s!.min).toBe(1)
    expect(s!.max).toBe(3)
    expect(s!.mean).toBe(2)
  })

  it('returns undefined for an all-empty column', () => {
    expect(profile.numericStats([null, null])).toBeUndefined()
  })
})

describe('datetime kind inference', () => {
  it('recognizes ISO dates, times, and slash formats', () => {
    expect(profile.isDatetimeValue('2024-01-01')).toBe(true)
    expect(profile.isDatetimeValue('2024-01-01T10:30:00Z')).toBe(true)
    expect(profile.isDatetimeValue('2024-01-01 10:30:00')).toBe(true)
    expect(profile.isDatetimeValue('2024-01-01T10:30:00+08:00')).toBe(true)
    expect(profile.isDatetimeValue('2024/01/01')).toBe(true)
  })

  it('rejects invalid dates, bare years, and time-only values', () => {
    expect(profile.isDatetimeValue('2024-13-01')).toBe(false)
    expect(profile.isDatetimeValue('2024')).toBe(false)
    expect(profile.isDatetimeValue('abc')).toBe(false)
    expect(profile.isDatetimeValue('10:30:00')).toBe(false)
  })

  it('infers datetime only when every non-empty value is a date', () => {
    expect(profile.inferKind(['2024-01-01', '2023-05-05', null])).toBe('datetime')
  })

  it('keeps bare years as numbers', () => {
    expect(profile.inferKind(['2024', '2023'])).toBe('number')
  })

  it('treats mixed date/number and date/boolean columns as strings', () => {
    expect(profile.inferKind(['2024-01-01', '2024'])).toBe('string')
    expect(profile.inferKind(['2024-01-01', 'true'])).toBe('string')
  })
})

describe('column profile stats', () => {
  it('adds stats to number columns and omits them for other kinds', () => {
    const num = profile.profileColumn('age', ['30', '25', null], 5)
    expect(num.kind).toBe('number')
    expect(num.stats).toBeDefined()
    expect(num.stats!.mean).toBe(27.5)

    const str = profile.profileColumn('name', ['a', 'b'], 5)
    expect(str.kind).toBe('string')
    expect('stats' in str).toBe(false)

    const date = profile.profileColumn('joined', ['2024-01-01', '2023-05-05'], 5)
    expect(date.kind).toBe('datetime')
    expect('stats' in date).toBe(false)
  })
})
