import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { CallId } from '@deepseek-ai/dsh-llm'

import * as profile from '../src/profile.ts'
import * as plugin from '../src/index.ts'

const testToolSignal = new AbortController().signal

/** Track temp dirs so tests clean up after themselves. */
const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function makeCsv(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-data-profile-'))
  tempDirs.push(dir)
  const path = join(dir, 'data.csv')
  await writeFile(path, content)
  return path
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(plugin)
  return ctx
}

let callCounter = 0
function callTool(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('csv parsing', () => {
  it('parses headers, rows, and quoted fields containing commas', () => {
    const table = profile.parseCsv('name,note\nalice,"hello, world"\nbob,plain\n')
    expect(table.headers).toEqual(['name', 'note'])
    expect(table.rows).toEqual([
      ['alice', 'hello, world'],
      ['bob', 'plain'],
    ])
  })

  it('maps empty fields to null and pads short rows', () => {
    const table = profile.parseCsv('a,b,c\n1,,3\n4,5\n')
    expect(table.rows).toEqual([
      ['1', null, '3'],
      ['4', '5', null],
    ])
  })

  it('handles CRLF line endings and skips blank lines', () => {
    const table = profile.parseCsv('a,b\r\n1,2\r\n\r\n3,4\r\n')
    expect(table.rows).toEqual([['1', '2'], ['3', '4']])
  })

  it('handles escaped double quotes inside quoted fields', () => {
    const table = profile.parseCsv('a\n"say ""hi"""\n')
    expect(table.rows).toEqual([['say "hi"']])
  })
})

describe('column kind inference', () => {
  it('infers number when every non-empty value parses as a finite number', () => {
    expect(profile.inferKind(['1', '2.5', '-3', null])).toBe('number')
  })

  it('infers boolean for true/false', () => {
    expect(profile.inferKind(['true', 'false', null])).toBe('boolean')
  })

  it('infers string when values mix kinds or are textual', () => {
    expect(profile.inferKind(['1', 'true'])).toBe('string')
    expect(profile.inferKind(['abc', 'def'])).toBe('string')
    expect(profile.inferKind([])).toBe('string')
  })

  it('counts unique values, skipping nulls', () => {
    const p = profile.profileColumn('col', ['a', 'a', 'b', null, null], 10)
    expect(p).toEqual({
      name: 'col',
      kind: 'string',
      missing: 2,
      missingRate: 0.4,
      unique: 2,
      sample: ['a', 'b'],
    })
  })

  it('returns a zero missing rate for an empty column', () => {
    const p = profile.profileColumn('empty', [], 5)
    expect(p.missing).toBe(0)
    expect(p.missingRate).toBe(0)
    expect(p.unique).toBe(0)
    expect(p.sample).toEqual([])
  })
})

describe('profile_dataset tool', () => {
  it('registers the tool with the expected schema', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(s => s.name === 'profile_dataset')
    expect(schema).toBeDefined()
    const props = (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props)).toEqual(['path', 'maxSample', 'maxRows', 'maxBytes'])
  })

  it('returns schema, missing rates, sample values, and stats for a real CSV file', async () => {
    const ctx = await setup()
    const path = await makeCsv('name,age,score\nalice,30,0.9\nbob,,0.7\ncarol,25,\n')
    const result = await callTool(ctx, 'profile_dataset', { path })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as {
      path: string
      rowCount: number
      columnCount: number
      bytes: number
      rowsProfiled: number
      sampled: boolean
      truncated: boolean
      columns: Array<{
        name: string
        kind: string
        missing: number
        missingRate: number
        unique: number
        sample: string[]
        stats?: { n: number; min: number; max: number; mean: number; std: number | null; p25: number; p50: number; p75: number }
      }>
    }
    expect(value.rowCount).toBe(3)
    expect(value.columnCount).toBe(3)
    expect(value.bytes).toBe(Buffer.byteLength('name,age,score\nalice,30,0.9\nbob,,0.7\ncarol,25,\n'))
    expect(value.rowsProfiled).toBe(3)
    expect(value.sampled).toBe(false)
    expect(value.truncated).toBe(false)

    const [name, age, score] = value.columns
    expect(name).toEqual({ name: 'name', kind: 'string', missing: 0, missingRate: 0, unique: 3, sample: ['alice', 'bob', 'carol'] })

    expect(age).toMatchObject({ name: 'age', kind: 'number', missing: 1, unique: 2, sample: ['30', '25'] })
    expect(age.missingRate).toBeCloseTo(1 / 3, 10)
    expect(age.stats).toBeDefined()
    expect(age.stats!.n).toBe(2)
    expect(age.stats!.min).toBe(25)
    expect(age.stats!.max).toBe(30)
    expect(age.stats!.mean).toBe(27.5)
    expect(age.stats!.std).toBeCloseTo(3.5355339059327378, 10)
    expect(age.stats!.p25).toBe(26.25)
    expect(age.stats!.p50).toBe(27.5)
    expect(age.stats!.p75).toBe(28.75)

    expect(score).toMatchObject({ name: 'score', kind: 'number', missing: 1, unique: 2, sample: ['0.9', '0.7'] })
    expect(score.missingRate).toBeCloseTo(1 / 3, 10)
    expect(score.stats!.min).toBe(0.7)
    expect(score.stats!.max).toBe(0.9)
    expect(score.stats!.mean).toBeCloseTo(0.8, 10)
    expect(score.stats!.std).toBeCloseTo(0.1414213562373095, 10)
    expect(score.stats!.p25).toBeCloseTo(0.75, 10)
    expect(score.stats!.p50).toBeCloseTo(0.8, 10)
    expect(score.stats!.p75).toBeCloseTo(0.85, 10)
  })

  it('infers datetime columns and omits stats for them', async () => {
    const ctx = await setup()
    const path = await makeCsv('joined,score\n2024-01-01,0.9\n2023-05-05,0.7\n')
    const result = await callTool(ctx, 'profile_dataset', { path })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const columns = (result.value as { columns: Array<{ name: string; kind: string; stats?: unknown }> }).columns
    expect(columns[0]).toMatchObject({ name: 'joined', kind: 'datetime' })
    expect('stats' in columns[0]!).toBe(false)
    expect(columns[1]).toMatchObject({ name: 'score', kind: 'number' })
    expect(columns[1]!.stats).toBeDefined()
  })

  it('caps sample values per column via maxSample', async () => {
    const ctx = await setup()
    const path = await makeCsv('v\n1\n2\n3\n4\n5\n6\n')
    const result = await callTool(ctx, 'profile_dataset', { path, maxSample: 2 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const columns = (result.value as { columns: { sample: string[] }[] }).columns
    expect(columns[0]?.sample).toEqual(['1', '2'])
  })

  it('renders a compact human summary', async () => {
    const ctx = await setup()
    const path = await makeCsv('a,b\n1,x\n')
    const result = await callTool(ctx, 'profile_dataset', { path })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('1 rows × 2 columns')
  })

  it('fails loud on a missing file', async () => {
    const ctx = await setup()
    const result = await callTool(ctx, 'profile_dataset', { path: '/no/such/file.csv' })
    expect(result.isError).toBe(true)
  })

  it('rejects an empty path', async () => {
    const ctx = await setup()
    const result = await callTool(ctx, 'profile_dataset', { path: '' })
    expect(result.isError).toBe(true)
  })

  it('reports sampling when maxRows is exceeded', async () => {
    const ctx = await setup()
    const path = await makeCsv('v\n1\n2\n3\n4\n5\n')
    const result = await callTool(ctx, 'profile_dataset', { path, maxRows: 3 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as {
      rowCount: number
      rowsProfiled: number
      sampled: boolean
      truncated: boolean
    }
    expect(value.rowCount).toBe(5)
    expect(value.rowsProfiled).toBe(3)
    expect(value.sampled).toBe(true)
    expect(value.truncated).toBe(false)
  })

  it('marks the profile as truncated when the byte cap is hit', async () => {
    const ctx = await setup()
    const path = await makeCsv('a,b\n1,2\n3,4\n')
    const result = await callTool(ctx, 'profile_dataset', { path, maxBytes: 8 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as { truncated: boolean; rowCount: number }
    expect(value.truncated).toBe(true)
    expect(value.rowCount).toBe(1) // only the head line fit inside the cap
  })
})

describe('sample_rows tool', () => {
  it('returns rows as objects keyed by column name with null for empty fields', async () => {
    const ctx = await setup()
    const path = await makeCsv('name,age\nalice,30\nbob,\ncarol,25\n')
    const result = await callTool(ctx, 'sample_rows', { path })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toEqual({
      path,
      offset: 0,
      columns: ['name', 'age'],
      totalMatches: 3,
      rows: [
        { name: 'alice', age: '30' },
        { name: 'bob', age: null },
        { name: 'carol', age: '25' },
      ],
    })
  })

  it('honors offset and limit', async () => {
    const ctx = await setup()
    const path = await makeCsv('v\n1\n2\n3\n4\n5\n')
    const result = await callTool(ctx, 'sample_rows', { path, offset: 1, limit: 2 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toEqual({
      path,
      offset: 1,
      columns: ['v'],
      totalMatches: 5,
      rows: [{ v: '2' }, { v: '3' }],
    })
  })

  it('projects only the requested columns in order', async () => {
    const ctx = await setup()
    const path = await makeCsv('a,b,c\n1,2,3\n4,5,6\n')
    const result = await callTool(ctx, 'sample_rows', { path, columns: ['c', 'a'] })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toEqual({
      path,
      offset: 0,
      columns: ['c', 'a'],
      totalMatches: 2,
      rows: [{ c: '3', a: '1' }, { c: '6', a: '4' }],
    })
  })

  it('rejects unknown columns', async () => {
    const ctx = await setup()
    const path = await makeCsv('a,b\n1,2\n')
    const result = await callTool(ctx, 'sample_rows', { path, columns: ['nope'] })
    expect(result.isError).toBe(true)
  })

  it('filters by where with offset/limit applied to matches', async () => {
    const ctx = await setup()
    const path = await makeCsv('plan,amount\nbasic,1\npremium,2\nbasic,3\npremium,4\nbasic,5\n')
    const result = await callTool(ctx, 'sample_rows', { path, where: { column: 'plan', equals: 'basic' } })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as { totalMatches: number; rows: Array<{ plan: string; amount: string }> }
    expect(value.totalMatches).toBe(3)
    expect(value.rows).toEqual([{ plan: 'basic', amount: '1' }, { plan: 'basic', amount: '3' }, { plan: 'basic', amount: '5' }])

    const paged = await callTool(ctx, 'sample_rows', { path, where: { column: 'plan', equals: 'basic' }, offset: 1, limit: 1 })
    expect((paged.value as { totalMatches: number; rows: unknown[] }).totalMatches).toBe(3)
    expect((paged.value as { rows: Array<{ plan: string; amount: string }> }).rows).toEqual([{ plan: 'basic', amount: '3' }])
  })

  it('never matches a where value against a null cell', async () => {
    const ctx = await setup()
    const path = await makeCsv('age,note\n,empty\n30,ok\n')
    const result = await callTool(ctx, 'sample_rows', { path, where: { column: 'age', equals: '' } })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect((result.value as { totalMatches: number; rows: unknown[] }).totalMatches).toBe(0)
    expect((result.value as { rows: unknown[] }).rows).toEqual([])
  })

  it('rejects an empty path', async () => {
    const ctx = await setup()
    const result = await callTool(ctx, 'sample_rows', { path: '' })
    expect(result.isError).toBe(true)
  })

  it('fails loud when the file exceeds maxBytes', async () => {
    const ctx = await setup()
    const path = await makeCsv('v\n' + Array.from({ length: 100 }, (_, i) => String(i)).join('\n') + '\n')
    const result = await callTool(ctx, 'sample_rows', { path, maxBytes: 16 })
    expect(result.isError).toBe(true)
  })
})

describe('value_counts tool', () => {
  it('registers the tool with the expected schema', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(s => s.name === 'value_counts')
    expect(schema).toBeDefined()
    const props = (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props)).toEqual(['path', 'column', 'topK', 'maxRows', 'maxBytes'])
  })

  it('returns counts and rates for a categorical column', async () => {
    const ctx = await setup()
    const path = await makeCsv('plan,churned\npremium,no\nbasic,yes\npremium,no\nbasic,yes\nbasic,yes\n')
    const result = await callTool(ctx, 'value_counts', { path, column: 'plan' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toMatchObject({
      column: 'plan',
      kind: 'string',
      total: 5,
      missing: 0,
      unique: 2,
      omitted: 0,
      sampled: false,
      truncated: false,
      values: [
        { value: 'basic', count: 3, rate: 0.6 },
        { value: 'premium', count: 2, rate: 0.4 },
      ],
    })
  })

  it('fails loud on an unknown column', async () => {
    const ctx = await setup()
    const path = await makeCsv('plan,churned\npremium,no\n')
    const result = await callTool(ctx, 'value_counts', { path, column: 'nope' })
    expect(result.isError).toBe(true)
  })

  it('marks counts as sampled when maxRows is exceeded', async () => {
    const ctx = await setup()
    const path = await makeCsv('v\na\na\na\nb\nb\n')
    const result = await callTool(ctx, 'value_counts', { path, column: 'v', maxRows: 2 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect((result.value as { sampled: boolean }).sampled).toBe(true)
  })
})

describe('discover_datasets tool', () => {
  it('registers the tool with the expected schema', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(s => s.name === 'discover_datasets')
    expect(schema).toBeDefined()
    const props = (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props)).toEqual(['dir', 'maxDepth', 'maxFiles'])
  })

  it('lists data files in a directory with sizes and delimiters', async () => {
    const ctx = await setup()
    const dir = await mkdtemp(join(tmpdir(), 'dsh-tool-discover-'))
    tempDirs.push(dir)
    await writeFile(join(dir, 'a.csv'), 'x,y\n1,2\n')
    await writeFile(join(dir, 'b.tsv'), 'x\ty\n1\t2\n')
    const result = await callTool(ctx, 'discover_datasets', { dir })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as {
      root: string
      fileCount: number
      truncated: boolean
      files: Array<{ path: string; kind: string; delimiter?: string; rowEstimate?: number; estimated?: boolean }>
    }
    expect(value.root).toBe(dir)
    expect(value.fileCount).toBe(2)
    expect(value.truncated).toBe(false)
    expect(value.files.map(f => f.path)).toEqual([join(dir, 'a.csv'), join(dir, 'b.tsv')])
    expect(value.files[0]!.delimiter).toBe(',')
    expect(value.files[1]!.delimiter).toBe('\t')
    expect(value.files[0]!.rowEstimate).toBe(1)
  })
})

describe('split_dataset tool', () => {
  it('registers the tool with the expected schema', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(s => s.name === 'split_dataset')
    expect(schema).toBeDefined()
    const props = (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props)).toEqual([
      'path', 'name', 'strategy', 'ratio', 'seed', 'stratifyColumn', 'timeColumn',
      'gapDays', 'groupColumn', 'idColumn', 'outDir', 'maxBytes',
    ])
  })

  it('writes train/test/split.json and reports honest counts', async () => {
    const ctx = await setup()
    const path = await makeCsv('id,v\na,1\nb,2\nc,3\nd,4\ne,5\nf,6\ng,7\nh,8\ni,9\nj,10\n')
    const outDir = join(tmpdir(), `dsh-split-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    tempDirs.push(outDir)
    const result = await callTool(ctx, 'split_dataset', { path, name: 's1', strategy: 'random', ratio: 0.8, seed: 1, idColumn: 'id', outDir })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as {
      totalRows: number; trainRows: number; testRows: number; droppedRows: number
      trainFile: string; testFile: string; splitFile: string; seed: number; strategy: string
    }
    expect(value.totalRows).toBe(10)
    expect(value.trainRows).toBe(8)
    expect(value.testRows).toBe(2)
    expect(value.droppedRows).toBe(0)
    expect(value.strategy).toBe('random')
    expect(value.seed).toBe(1)

    const { readFile } = await import('node:fs/promises')
    const trainText = await readFile(value.trainFile, 'utf8')
    const testText = await readFile(value.testFile, 'utf8')
    const splitJson = JSON.parse(await readFile(value.splitFile, 'utf8'))
    // 10 header+data rows each; no overlap between the two files
    const trainLines = trainText.trim().split('\n')
    const testLines = testText.trim().split('\n')
    expect(trainLines.length).toBe(9) // header + 8
    expect(testLines.length).toBe(3) // header + 2
    const trainIds = new Set(trainLines.slice(1).map(l => l.split(',')[0]))
    const testIds = new Set(testLines.slice(1).map(l => l.split(',')[0]))
    for (const id of trainIds) expect(testIds.has(id)).toBe(false)
    expect(splitJson.version).toBe(1)
    expect(splitJson.trainRows).toBe(8)
    expect(splitJson.testRows).toBe(2)
  })

  it('reproduces the same split for the same seed', async () => {
    const ctx = await setup()
    const path = await makeCsv('v\n1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n')
    const run = async (tag: string) => {
      const outDir = join(tmpdir(), `dsh-split-re-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      tempDirs.push(outDir)
      const result = await callTool(ctx, 'split_dataset', { path, name: tag, strategy: 'random', ratio: 0.5, seed: 5, outDir })
      if (result.isError) throw new Error('expected success')
      const { readFile } = await import('node:fs/promises')
      const train = (await readFile((result.value as { trainFile: string }).trainFile, 'utf8')).trim()
      return train
    }
    expect(await run('a')).toBe(await run('b'))
  })

  it('fails loud when a strategy-required column is missing', async () => {
    const ctx = await setup()
    const path = await makeCsv('v\n1\n2\n3\n')
    const result = await callTool(ctx, 'split_dataset', { path, name: 'bad', strategy: 'chronological', timeColumn: 'nope' })
    expect(result.isError).toBe(true)
  })
})

async function doSplit(ctx: Context, path: string, name: string, strategy: string, extra: Record<string, unknown> = {}): Promise<string> {
  const outDir = join(tmpdir(), `dsh-leak-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  tempDirs.push(outDir)
  const result = await callTool(ctx, 'split_dataset', { path, name, strategy, outDir, ...extra })
  if (result.isError) throw new Error(`split failed: ${JSON.stringify(result)}`)
  return (result.value as { splitFile: string }).splitFile
}

describe('check_leakage tool', () => {
  it('registers the tool with the expected schema', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(s => s.name === 'check_leakage')
    expect(schema).toBeDefined()
    const props = (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props)).toEqual(['splitFile', 'maxBytes'])
  })

  it('passes a clean random split', async () => {
    const ctx = await setup()
    const path = await makeCsv('id,v\na,1\nb,2\nc,3\nd,4\ne,5\nf,6\ng,7\nh,8\ni,9\nj,10\n')
    const splitFile = await doSplit(ctx, path, 'clean', 'random', { ratio: 0.8, seed: 1, idColumn: 'id' })
    const result = await callTool(ctx, 'check_leakage', { splitFile })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as { ok: boolean; checks: Array<{ name: string; passed: boolean }>; duplicateCount: number }
    expect(value.ok).toBe(true)
    expect(value.duplicateCount).toBe(0)
    const names = value.checks.map(c => c.name)
    expect(names).toContain('row-counts')
    expect(names).toContain('duplicates')
    expect(names).toContain('id-column')
    expect(names).toContain('totals')
  })

  it('fails when a train row is duplicated into test', async () => {
    const ctx = await setup()
    const path = await makeCsv('v\n1\n2\n3\n4\n5\n6\n')
    const splitFile = await doSplit(ctx, path, 'dup', 'random', { ratio: 0.5, seed: 1 })
    const { readFile, writeFile } = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    const testFile = join(dirname(splitFile), 'test.csv')
    const trainFile = join(dirname(splitFile), 'train.csv')
    const trainText = await readFile(trainFile, 'utf8')
    const trainLine = trainText.trim().split('\n')[1]! // first train data row
    await writeFile(testFile, (await readFile(testFile, 'utf8')).trimEnd() + '\n' + trainLine + '\n')
    const result = await callTool(ctx, 'check_leakage', { splitFile })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as { ok: boolean; duplicateCount: number; checks: Array<{ name: string; passed: boolean }> }
    expect(value.ok).toBe(false)
    expect(value.duplicateCount).toBe(1)
    expect(value.checks.find(c => c.name === 'duplicates')!.passed).toBe(false)
  })

  it('fails a group split when an id crosses sides', async () => {
    const ctx = await setup()
    const path = await makeCsv('id,group,v\n1,g1,a\n2,g1,b\n3,g2,c\n4,g2,d\n5,g3,e\n6,g3,f\n')
    const splitFile = await doSplit(ctx, path, 'group', 'group', { ratio: 0.5, seed: 3, groupColumn: 'group', idColumn: 'id' })
    const { readFile, writeFile } = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    const trainFile = join(dirname(splitFile), 'train.csv')
    const testFile = join(dirname(splitFile), 'test.csv')
    const trainText = await readFile(trainFile, 'utf8')
    const trainRow = trainText.trim().split('\n')[1]!
    await writeFile(testFile, (await readFile(testFile, 'utf8')).trimEnd() + '\n' + trainRow + '\n')
    const result = await callTool(ctx, 'check_leakage', { splitFile })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as { ok: boolean; idOverlapCount: number; checks: Array<{ name: string; passed: boolean }> }
    expect(value.ok).toBe(false)
    expect(value.idOverlapCount).toBeGreaterThan(0)
    expect(value.checks.find(c => c.name === 'id-column')!.passed).toBe(false)
  })

  it('fails a chronological split whose test rows precede train rows', async () => {
    const ctx = await setup()
    const path = await makeCsv('date,v\n2024-01-01,a\n2024-01-02,b\n2024-01-03,c\n2024-01-04,d\n2024-01-05,e\n2024-01-06,f\n')
    const splitFile = await doSplit(ctx, path, 'time', 'chronological', { ratio: 0.5, timeColumn: 'date' })
    const { readFile, writeFile } = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    const testFile = join(dirname(splitFile), 'test.csv')
    const trainFile = join(dirname(splitFile), 'train.csv')
    const trainText = await readFile(trainFile, 'utf8')
    // overwrite test with the two earliest rows (which belong to train)
    const earliest = trainText.trim().split('\n').slice(0, 3).join('\n')
    await writeFile(testFile, earliest + '\n')
    const result = await callTool(ctx, 'check_leakage', { splitFile })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as { ok: boolean; checks: Array<{ name: string; passed: boolean }> }
    expect(value.ok).toBe(false)
    expect(value.checks.find(c => c.name === 'time-order')!.passed).toBe(false)
  })

  it('fails loud on a missing split file', async () => {
    const ctx = await setup()
    const result = await callTool(ctx, 'check_leakage', { splitFile: '/no/such/split.json' })
    expect(result.isError).toBe(true)
  })
})

describe('manifest tool', () => {
  it('registers the tool with the expected schema', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(s => s.name === 'manifest')
    expect(schema).toBeDefined()
    const props = (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props)).toEqual([
      'action', 'manifestFile', 'statement', 'target', 'metric', 'constraints',
      'phase', 'path', 'notes', 'text', 'splitFile',
    ])
  })

  async function ledger(ctx: Context, file: string) {
    return (await callTool(ctx, 'manifest', { action: 'read', manifestFile: file })).value as {
      goal: { statement: string; target: string; metric: string; constraints: string[] } | null
      phase: string | null
      datasets: Array<{ path: string; notes: string; recordedAt: string }>
      split: { splitFile: string; strategy: string; trainFile: string; testFile: string } | null
      decisions: Array<{ text: string; phase: string; recordedAt: string }>
    }
  }

  it('records a goal and reads it back', async () => {
    const ctx = await setup()
    const file = join(tmpdir(), `dsh-manifest-tool-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    tempDirs.push(file)
    const result = await callTool(ctx, 'manifest', {
      action: 'set_goal', manifestFile: file,
      statement: 'predict churn', target: 'churn', metric: 'AUC',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const m = await ledger(ctx, file)
    expect(m.goal).toEqual({ statement: 'predict churn', target: 'churn', metric: 'AUC', constraints: [] })
    expect(m.phase).toBe('business')
  })

  it('appends datasets and decisions across calls', async () => {
    const ctx = await setup()
    const file = join(tmpdir(), `dsh-manifest-tool2-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    tempDirs.push(file)
    await callTool(ctx, 'manifest', { action: 'set_phase', manifestFile: file, phase: 'data-understanding' })
    await callTool(ctx, 'manifest', { action: 'add_dataset', manifestFile: file, path: '/a.csv', notes: 'missing calls' })
    await callTool(ctx, 'manifest', { action: 'add_dataset', manifestFile: file, path: '/b.csv' })
    await callTool(ctx, 'manifest', { action: 'record_decision', manifestFile: file, text: 'drop city' })
    const m = await ledger(ctx, file)
    expect(m.datasets).toHaveLength(2)
    expect(m.datasets[0]).toMatchObject({ path: '/a.csv', notes: 'missing calls' })
    expect(m.datasets[1]).toMatchObject({ path: '/b.csv', notes: '' })
    expect(m.decisions).toEqual([{ text: 'drop city', phase: 'data-understanding', recordedAt: expect.any(String) }])
  })

  it('records a split reference from split.json', async () => {
    const ctx = await setup()
    const path = await makeCsv('id,v\na,1\nb,2\nc,3\nd,4\ne,5\nf,6\ng,7\nh,8\ni,9\nj,10\n')
    const outDir = join(tmpdir(), `dsh-manifest-split-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    tempDirs.push(outDir)
    const split = await callTool(ctx, 'split_dataset', { path, name: 's', strategy: 'random', ratio: 0.8, seed: 1, outDir })
    const splitFile = (split.value as { splitFile: string }).splitFile
    const file = join(tmpdir(), `dsh-manifest-tool3-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    tempDirs.push(file)
    await callTool(ctx, 'manifest', { action: 'set_split', manifestFile: file, splitFile })
    const m = await ledger(ctx, file)
    expect(m.split).toMatchObject({ strategy: 'random' })
    expect(m.split!.trainFile.endsWith('train.csv')).toBe(true)
    expect(m.split!.testFile.endsWith('test.csv')).toBe(true)
  })

  it('fails loud when required arguments are missing', async () => {
    const ctx = await setup()
    const file = join(tmpdir(), `dsh-manifest-tool4-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    tempDirs.push(file)
    const result = await callTool(ctx, 'manifest', { action: 'set_goal', manifestFile: file, statement: 'only' })
    expect(result.isError).toBe(true)
  })
})

describe('bundled skills', () => {
  it('registers the three data-mining skills on ctx.skills', async () => {
    const ctx = await setup()
    const snapshot = await ctx.skills.snapshot()
    const names = snapshot.skills.map(s => s.name)
    expect(names).toContain('data-mining-workflow')
    expect(names).toContain('data-leakage-prevention')
    expect(names).toContain('data-quality-assessment')
  })

  it('loads a bundled skill body', async () => {
    const ctx = await setup()
    const skill = await ctx.skills.get('data-mining-workflow')
    expect(skill).toBeDefined()
    expect(skill?.content).toContain('CRISP-DM')
  })

  it('loads the data-quality-assessment skill body', async () => {
    const ctx = await setup()
    const skill = await ctx.skills.get('data-quality-assessment')
    expect(skill).toBeDefined()
    expect(skill?.content).toContain('missingness')
    expect(skill?.content).toContain('outliers')
  })
})

describe('dm gate tool', () => {
  it('registers the tool with the expected schema', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(s => s.name === 'dm')
    expect(schema).toBeDefined()
    const props = (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props)).toEqual(['action', 'manifestFile', 'phase', 'reason'])
  })

  async function manifestFile(ctx: Context): Promise<string> {
    const file = join(tmpdir(), `dsh-dm-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    tempDirs.push(file)
    return file
  }

  async function dm(ctx: Context, file: string, args: Record<string, unknown>) {
    const r = await callTool(ctx, 'dm', { manifestFile: file, ...args })
    return r
  }

  it('enable installs the gate layout with business unlocked', async () => {
    const ctx = await setup()
    const file = await manifestFile(ctx)
    const r = await dm(ctx, file, { action: 'enable' })
    expect(r.isError).toBe(false)
    if (r.isError) throw new Error('expected success')
    const m = r.value as { gates: Array<{ phase: string; status: string }> }
    expect(m.gates.find(g => g.phase === 'business')!.status).toBe('unlocked')
    expect(m.gates.find(g => g.phase === 'modeling')!.status).toBe('locked')
  })

  it('phase reports all gate states', async () => {
    const ctx = await setup()
    const file = await manifestFile(ctx)
    await dm(ctx, file, { action: 'enable' })
    const r = await dm(ctx, file, { action: 'phase' })
    expect(r.isError).toBe(false)
    const gates = (r.value as { gates: Array<{ phase: string; status: string }> }).gates
    expect(gates.map(g => g.phase)).toContain('business')
    expect(gates.map(g => g.phase)).toContain('done')
  })

  it('complete rejects business without a goal', async () => {
    const ctx = await setup()
    const file = await manifestFile(ctx)
    await dm(ctx, file, { action: 'enable' })
    const r = await dm(ctx, file, { action: 'complete', phase: 'business' })
    expect(r.isError).toBe(true)
  })

  it('complete -> pending, confirm -> done and unlocks data-understanding', async () => {
    const ctx = await setup()
    const file = await manifestFile(ctx)
    await dm(ctx, file, { action: 'enable' })
    await callTool(ctx, 'manifest', { action: 'set_goal', manifestFile: file, statement: 'predict churn', target: 'churn', metric: 'AUC' })
    const pending = await dm(ctx, file, { action: 'complete', phase: 'business' })
    const pg = (pending.value as { gates: Array<{ phase: string; status: string }> }).gates
    expect(pg.find(g => g.phase === 'business')!.status).toBe('pending')
    const done = await dm(ctx, file, { action: 'confirm', phase: 'business' })
    const gates = (done.value as { gates: Array<{ phase: string; status: string }> }).gates
    expect(gates.find(g => g.phase === 'business')!.status).toBe('done')
    expect(gates.find(g => g.phase === 'data-understanding')!.status).toBe('unlocked')
  })

  it('redo relocks the phases after it', async () => {
    const ctx = await setup()
    const file = await manifestFile(ctx)
    await dm(ctx, file, { action: 'enable' })
    await callTool(ctx, 'manifest', { action: 'set_goal', manifestFile: file, statement: 'g', target: 't', metric: 'm' })
    await dm(ctx, file, { action: 'complete', phase: 'business' })
    await dm(ctx, file, { action: 'confirm', phase: 'business' })
    const r = await dm(ctx, file, { action: 'redo', phase: 'business' })
    const gates = (r.value as { gates: Array<{ phase: string; status: string }> }).gates
    expect(gates.find(g => g.phase === 'business')!.status).toBe('unlocked')
    expect(gates.find(g => g.phase === 'data-understanding')!.status).toBe('locked')
  })

  it('force completes without verification and records the reason', async () => {
    const ctx = await setup()
    const file = await manifestFile(ctx)
    await dm(ctx, file, { action: 'enable' })
    const r = await dm(ctx, file, { action: 'force', phase: 'business', reason: 'user insists' })
    const gates = (r.value as { gates: Array<{ phase: string; status: string; overrideReason?: string }> }).gates
    const b = gates.find(g => g.phase === 'business')!
    expect(b.status).toBe('done')
    expect(b.overrideReason).toBe('user insists')
    expect(gates.find(g => g.phase === 'data-understanding')!.status).toBe('unlocked')
  })
})

describe('tool gates (execution enforcement)', () => {
  let cwdSpy: ReturnType<typeof vi.spyOn> | undefined
  let gateCwd: string | undefined

  async function setGateCwd(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-gate-cwd-'))
    tempDirs.push(dir)
    gateCwd = dir
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(dir)
    return dir
  }

  afterEach(() => {
    if (cwdSpy) { cwdSpy.mockRestore(); cwdSpy = undefined }
    gateCwd = undefined
  })

  async function writeManifest(state: (m: { phaseGates: Record<string, { status: string }> }) => void): Promise<void> {
    const m: { phaseGates: Record<string, { status: string }> } = {
      phaseGates: { business: { status: 'unlocked' } },
    }
    state(m)
    const { writeFile, mkdir } = await import('node:fs/promises')
    const dir = gateCwd!
    await mkdir(join(dir, 'dsh_manifest'), { recursive: true })
    await writeFile(join(dir, 'dsh_manifest', 'manifest.json'), JSON.stringify({ version: 1, phaseGates: m.phaseGates }))
  }

  it('data tools pass when gates are not enabled (backward compatible)', async () => {
    const ctx = await setup()
    const dir = await setGateCwd()
    const path = join(dir, 'data.csv')
    await writeFile(path, 'v\n1\n2\n')
    const r = await callTool(ctx, 'profile_dataset', { path })
    expect(r.isError).toBe(false)
  })

  it('data tools are rejected before business is confirmed', async () => {
    const ctx = await setup()
    const dir = await setGateCwd()
    await writeManifest(() => {}) // business unlocked, data-understanding locked
    const path = join(dir, 'data.csv')
    await writeFile(path, 'v\n1\n2\n')
    const r = await callTool(ctx, 'profile_dataset', { path })
    expect(r.isError).toBe(true)
    const text = JSON.stringify(r)
    expect(text).toContain('data-understanding')
    expect(text).toContain('locked')
  })

  it('data tools pass once business is confirmed', async () => {
    const ctx = await setup()
    const dir = await setGateCwd()
    await writeManifest(m => {
      m.phaseGates = {
        business: { status: 'done' },
        'data-understanding': { status: 'unlocked' },
      }
    })
    const path = join(dir, 'data.csv')
    await writeFile(path, 'v\n1\n2\n')
    const r = await callTool(ctx, 'profile_dataset', { path })
    expect(r.isError).toBe(false)
  })

  it('split_dataset is rejected before data-understanding completes', async () => {
    const ctx = await setup()
    const dir = await setGateCwd()
    await writeManifest(m => {
      m.phaseGates = { business: { status: 'done' }, 'data-understanding': { status: 'unlocked' } }
    })
    const path = join(dir, 'data.csv')
    await writeFile(path, 'v\n1\n2\n3\n4\n5\n6\n')
    const r = await callTool(ctx, 'split_dataset', { path, name: 's', strategy: 'random', outDir: join(dir, 'out') })
    expect(r.isError).toBe(true)
  })

  it('manifest and dm tools are never gated', async () => {
    const ctx = await setup()
    const dir = await setGateCwd()
    await writeManifest(() => {}) // business unlocked, everything else locked
    const r1 = await callTool(ctx, 'manifest', { action: 'set_goal', statement: 'g', target: 't', metric: 'm' })
    expect(r1.isError).toBe(false)
    const r2 = await callTool(ctx, 'dm', { action: 'phase' })
    expect(r2.isError).toBe(false)
  })
})
