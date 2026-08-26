import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
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
      totalRows: 3,
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
      totalRows: 5,
      rows: [{ v: '2' }, { v: '3' }],
    })
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
