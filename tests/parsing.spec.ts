import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import * as profile from '../src/profile.ts'

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function makeCsv(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-data-parsing-'))
  tempDirs.push(dir)
  const path = join(dir, 'data.csv')
  await writeFile(path, content)
  return path
}

describe('csv parsing robustness', () => {
  it('strips a UTF-8 BOM from the header', () => {
    const table = profile.parseCsv('\uFEFFa,b\n1,2\n')
    expect(table.headers).toEqual(['a', 'b'])
    expect(table.rows).toEqual([['1', '2']])
  })

  it('auto-detects tab-separated values', () => {
    const table = profile.parseCsv('a\tb\n1\t2\n3\t4\n')
    expect(table.headers).toEqual(['a', 'b'])
    expect(table.rows).toEqual([['1', '2'], ['3', '4']])
  })

  it('auto-detects semicolon-separated values', () => {
    const table = profile.parseCsv('a;b\n1;2\n3;4\n')
    expect(table.headers).toEqual(['a', 'b'])
    expect(table.rows).toEqual([['1', '2'], ['3', '4']])
  })

  it('auto-detects pipe-separated values', () => {
    const table = profile.parseCsv('a|b\n1|2\n3|4\n')
    expect(table.headers).toEqual(['a', 'b'])
    expect(table.rows).toEqual([['1', '2'], ['3', '4']])
  })

  it('falls back to comma for a single-column file', () => {
    const table = profile.parseCsv('a\n1\n2\n')
    expect(table.headers).toEqual(['a'])
    expect(table.rows).toEqual([['1'], ['2']])
  })

  it('keeps comma detection working with quoted fields containing commas', () => {
    const table = profile.parseCsv('name,note\nalice,"hello, world"\nbob,plain\n')
    expect(table.headers).toEqual(['name', 'note'])
    expect(table.rows).toEqual([
      ['alice', 'hello, world'],
      ['bob', 'plain'],
    ])
  })

  it('explicit delimiter wins over auto-detection', () => {
    const table = profile.parseCsv('a,b;c\n1,2;3\n', { delimiter: ';' })
    expect(table.headers).toEqual(['a,b', 'c'])
    expect(table.rows).toEqual([['1,2', '3']])
  })
})

describe('csv row sampling', () => {
  it('keeps every row when under maxRows', () => {
    const table = profile.parseCsv('v\n1\n2\n3\n', { maxRows: 100 })
    expect(table.totalDataLines).toBe(3)
    expect(table.sampled).toBe(false)
    expect(table.rows.length).toBe(3)
  })

  it('samples head plus every k-th row when maxRows is exceeded', () => {
    // 10 data rows, maxRows 4: head = 2 (rows 0,1), stride = ceil(8/2) = 4 → rows 2,6
    const lines = ['v', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].join('\n')
    const table = profile.parseCsv(lines + '\n', { maxRows: 4 })
    expect(table.totalDataLines).toBe(10)
    expect(table.sampled).toBe(true)
    expect(table.rows.length).toBe(4)
    expect(table.rows.map(r => r[0])).toEqual(['0', '1', '2', '6'])
  })

  it('sampling keeps the profile row count truthful', () => {
    const table = profile.parseCsv('a,b\n1,2\n3,4\n5,6\n7,8\n', { maxRows: 2 })
    const p = profile.buildProfile(table, '/x.csv', 20, 5)
    expect(p.rowCount).toBe(4)
    expect(p.rowsProfiled).toBe(2)
    expect(p.sampled).toBe(true)
  })
})

describe('readCsvFile byte cap', () => {
  it('caps the read at maxBytes and reports truncation', async () => {
    const path = await makeCsv('v\n' + Array.from({ length: 100 }, (_, i) => String(i)).join('\n') + '\n')
    const { text, bytes, truncated } = await profile.readCsvFile(path, new AbortController().signal, { maxBytes: 32 })
    expect(bytes).toBeLessThanOrEqual(32)
    expect(text.length).toBeLessThanOrEqual(32)
    expect(truncated).toBe(true)
  })

  it('does not truncate files smaller than maxBytes', async () => {
    const path = await makeCsv('a,b\n1,2\n')
    const { text, bytes, truncated } = await profile.readCsvFile(path, new AbortController().signal, { maxBytes: 1024 })
    expect(truncated).toBe(false)
    expect(bytes).toBe(8)
    expect(text).toBe('a,b\n1,2\n')
  })
})
