import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import { discoverDataFiles } from '../src/discover.ts'

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-data-discover-'))
  tempDirs.push(dir)
  return dir
}

describe('discoverDataFiles', () => {
  it('finds data files by extension with sizes, sorted by path', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'a.csv'), 'x,y\n1,2\n')
    await writeFile(join(root, 'b.jsonl'), '{"a":1}\n')
    await writeFile(join(root, 'c.txt'), 'not data\n')
    const result = await discoverDataFiles(root)
    expect(result.fileCount).toBe(2)
    expect(result.files.map(f => f.path)).toEqual([join(root, 'a.csv'), join(root, 'b.jsonl')])
    expect(result.files[0]).toMatchObject({ ext: 'csv', kind: 'csv', bytes: 8 })
    expect(result.files[1]).toMatchObject({ ext: 'jsonl', kind: 'json' })
  })

  it('sniffs csv vs tab delimiters', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'comma.csv'), 'a,b\n1,2\n3,4\n')
    await writeFile(join(root, 'tab.tsv'), 'a\tb\n1\t2\n3\t4\n')
    const result = await discoverDataFiles(root)
    const comma = result.files.find(f => f.path.endsWith('comma.csv'))
    const tab = result.files.find(f => f.path.endsWith('tab.tsv'))
    expect(comma?.delimiter).toBe(',')
    expect(tab?.delimiter).toBe('\t')
  })

  it('estimates rows exactly for small files and approximates big ones', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'small.csv'), 'v\n1\n2\n3\n')
    const bigLines = ['v']
    for (let i = 0; i < 10000; i++) bigLines.push(`row_${String(i).padStart(8, '0')},extra,data`)
    const bigContent = bigLines.join('\n') + '\n'
    await writeFile(join(root, 'big.csv'), bigContent)

    const result = await discoverDataFiles(root)
    const small = result.files.find(f => f.path.endsWith('small.csv'))
    const big = result.files.find(f => f.path.endsWith('big.csv'))

    expect(small?.rowEstimate).toBe(3)
    expect(small?.estimated).toBe(false)
    expect(big?.estimated).toBe(true)
    expect(big?.rowEstimate).toBeGreaterThan(0)
    // Extrapolation from a 64 KiB head of a ~200 KiB file should be close.
    expect(Math.abs((big!.rowEstimate! - 10000) / 10000)).toBeLessThan(0.1)
  })

  it('skips hidden directories and node_modules', async () => {
    const root = await makeRoot()
    await mkdir(join(root, '.hidden'), { recursive: true })
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await mkdir(join(root, 'sub'), { recursive: true })
    await writeFile(join(root, '.hidden', 'h.csv'), 'a\n1\n')
    await writeFile(join(root, 'node_modules', 'n.csv'), 'a\n1\n')
    await writeFile(join(root, 'sub', 'ok.csv'), 'a\n1\n')
    const result = await discoverDataFiles(root)
    expect(result.files.map(f => f.path)).toEqual([join(root, 'sub', 'ok.csv')])
  })

  it('respects maxDepth and maxFiles', async () => {
    const root = await makeRoot()
    await mkdir(join(root, 'd1', 'd2'), { recursive: true })
    await writeFile(join(root, 'top.csv'), 'a\n1\n')
    await writeFile(join(root, 'd1', 'mid.csv'), 'a\n1\n')
    await writeFile(join(root, 'd1', 'd2', 'deep.csv'), 'a\n1\n')

    const shallow = await discoverDataFiles(root, { maxDepth: 1 })
    expect(shallow.files.map(f => f.path)).toEqual([join(root, 'top.csv')])

    const capped = await discoverDataFiles(root, { maxFiles: 1 })
    expect(capped.files.length).toBe(1)
    expect(capped.truncated).toBe(true)
  })

  it('fails loud on a missing root', async () => {
    await expect(discoverDataFiles('/no/such/dir')).rejects.toThrow()
  })
})
