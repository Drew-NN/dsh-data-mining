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
    expect(Object.keys(props)).toEqual(['path', 'maxSample'])
  })

  it('returns schema, missing rates, and sample values for a real CSV file', async () => {
    const ctx = await setup()
    const path = await makeCsv('name,age,score\nalice,30,0.9\nbob,,0.7\ncarol,25,\n')
    const result = await callTool(ctx, 'profile_dataset', { path })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toEqual({
      path,
      rowCount: 3,
      columnCount: 3,
      bytes: Buffer.byteLength('name,age,score\nalice,30,0.9\nbob,,0.7\ncarol,25,\n'),
      columns: [
        { name: 'name', kind: 'string', missing: 0, missingRate: 0, unique: 3, sample: ['alice', 'bob', 'carol'] },
        { name: 'age', kind: 'number', missing: 1, missingRate: 1 / 3, unique: 2, sample: ['30', '25'] },
        { name: 'score', kind: 'number', missing: 1, missingRate: 1 / 3, unique: 2, sample: ['0.9', '0.7'] },
      ],
    })
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
})

describe('bundled skills', () => {
  it('registers the two data-mining skills on ctx.skills', async () => {
    const ctx = await setup()
    const snapshot = await ctx.skills.snapshot()
    const names = snapshot.skills.map(s => s.name)
    expect(names).toContain('data-mining-workflow')
    expect(names).toContain('data-leakage-prevention')
  })

  it('loads a bundled skill body', async () => {
    const ctx = await setup()
    const skill = await ctx.skills.get('data-mining-workflow')
    expect(skill).toBeDefined()
    expect(skill?.content).toContain('CRISP-DM')
  })
})
