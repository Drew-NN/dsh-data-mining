/**
 * dsh-data-mining — one installable data-mining agent for DeepSeek Harness.
 *
 * Registers the data-profiling tools (`profile_dataset`, `sample_rows`) on
 * `ctx.tools` and the bundled data-mining skills on `ctx.skills`. The persona
 * lives in `cordis.patch.yml` (the bundle's patch layer), so installing this
 * bundle adds the whole data-mining agent to a profile.
 *
 * @module @deepseek-ai/dsh-data-mining
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

import { buildProfile, DEFAULT_MAX_BYTES, parseCsv, readCsvFile, valueCounts } from './profile.ts'
import { discoverDataFiles } from './discover.ts'

/** Cordis plugin name. */
export const name = 'data-mining'
/** Services required by the tools and the bundled skill provider. */
export const inject = ['tools', 'skills']

// ── Bundled skills ─────────────────────────────────────────────────────────

const PROVIDER_NAME = 'data-mining'
const SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url))
const RESOURCE_BASE = {
  kind: 'directory',
  path: SKILLS_DIR,
} as const
const INVOCATION = { modelInvocable: true, userInvocable: true } as const

interface BundledSkill {
  name: string
  description: string
  file: string
}

const SKILLS: BundledSkill[] = [
  {
    name: 'data-mining-workflow',
    description: 'Use at the start of any data-mining task, and when you are unsure what to do next, to run the six-phase CRISP-DM workflow — business understanding, data understanding, data preparation, modeling, evaluation, deployment — in order, producing the right artifact at each phase instead of jumping straight to model training.',
    file: 'data-mining-workflow/SKILL.md',
  },
  {
    name: 'data-leakage-prevention',
    description: 'Use before training or evaluating any model on tabular data, and whenever you are about to impute, scale, encode, or split a dataset, to apply the data-leakage rules that keep test-set information out of training. The most dangerous failure in data mining is a model that scores high but leaks — its metric is fake.',
    file: 'data-leakage-prevention/SKILL.md',
  },
  {
    name: 'data-quality-assessment',
    description: 'Use during data understanding and before any preprocessing, when a dataset has missing values, outliers, duplicates, or inconsistent types, to assess data quality systematically — missingness patterns, outlier detection, duplicate rows, and value-consistency checks — and record every quality problem before fixing anything.',
    file: 'data-quality-assessment/SKILL.md',
  },
]

const candidates: SkillCandidate[] = SKILLS.map(skill => ({
  name: skill.name,
  description: skill.description,
  invocation: INVOCATION,
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: new URL(`../skills/${skill.file}`, import.meta.url),
}))

const skillProvider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve(candidates),
  async get(candidate): Promise<SkillDefinition | undefined> {
    const skill = SKILLS.find(s => s.name === candidate.name)
    if (skill === undefined) return undefined
    return {
      name: skill.name,
      description: skill.description,
      invocation: INVOCATION,
      provider: PROVIDER_NAME,
      source: 'bundled',
      resourceBase: RESOURCE_BASE,
      content: await readFile(new URL(`../skills/${skill.file}`, import.meta.url), 'utf8'),
    }
  },
}

// ── Tools ──────────────────────────────────────────────────────────────────

/**
 * Register the data-mining tools and bundled skill provider.
 * @param ctx - registrant context carrying the tool and skill registries.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'profile_dataset',
    description: 'Profile a CSV file: returns the row count, column count, file size in bytes, and one entry per column with its inferred kind (number/boolean/string/datetime), missing count and rate, distinct-value count, sample values, and — for number columns — real distribution stats (n, min, max, mean, std, quartiles p25/p50/p75). Use this to understand a dataset before writing any analysis code. Large files are sampled: `maxRows` caps the rows profiled (head plus every k-th row) and `maxBytes` caps the bytes read; the result reports `rowsProfiled`/`sampled`/`truncated` so the model knows the stats may be approximate.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path to the CSV file.' },
      maxSample: { type: 'integer', description: 'How many distinct sample values to return per column. Defaults to 5.' },
      maxRows: { type: 'integer', description: 'Maximum rows to profile; larger files are sampled head + every k-th row. Defaults to 100000.' },
      maxBytes: { type: 'integer', description: 'Maximum bytes to read; larger files are truncated (the profile covers only the head). Defaults to 67108864 (64 MiB).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          rowCount: { type: 'integer', required: true },
          columnCount: { type: 'integer', required: true },
          bytes: { type: 'integer', required: true },
          rowsProfiled: { type: 'integer', required: true },
          sampled: { type: 'boolean', required: true },
          truncated: { type: 'boolean', required: true },
          columns: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                kind: { type: 'string', required: true, enum: ['number', 'boolean', 'string', 'datetime'] },
                missing: { type: 'integer', required: true },
                missingRate: { type: 'number', required: true },
                unique: { type: 'integer', required: true },
                sample: { type: 'array', required: true, items: { type: 'string' } },
                stats: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    n: { type: 'integer', required: true },
                    min: { type: 'number', required: true },
                    max: { type: 'number', required: true },
                    mean: { type: 'number', required: true },
                    std: { oneOf: [{ type: 'number' }, { type: 'null' }], required: true },
                    p25: { type: 'number', required: true },
                    p50: { type: 'number', required: true },
                    p75: { type: 'number', required: true },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.path}: ${value.rowCount} rows × ${value.columnCount} columns (${value.bytes} bytes)`
          + (value.sampled ? `, profiled ${value.rowsProfiled} sampled rows` : '')
          + (value.truncated ? ', truncated at byte cap' : '')
          + '. '
          + value.columns.map(c => {
            const stats = c.stats
              ? ` stats=min ${c.stats.min} max ${c.stats.max} mean ${c.stats.mean} std ${c.stats.std === null ? 'n/a' : c.stats.std.toFixed(3)} q25/50/75=${c.stats.p25},${c.stats.p50},${c.stats.p75}`
              : ''
            return `${c.name}[${c.kind}] missing=${c.missing}(${(c.missingRate * 100).toFixed(1)}%) unique=${c.unique} sample=${c.sample.join('|')}${stats}`
          }).join('; '),
      }],
    },
    async execute(args, exec) {
      if (!args.path) throw new Error('profile_dataset: `path` must be a non-empty string')
      const maxSample = args.maxSample === undefined ? 5 : Math.max(1, Math.min(20, args.maxSample))
      const maxRows = args.maxRows === undefined ? 100_000 : Math.max(1, Math.min(1_000_000, args.maxRows))
      const maxBytes = args.maxBytes === undefined ? DEFAULT_MAX_BYTES : Math.max(1, args.maxBytes)
      const { text, bytes, truncated } = await readCsvFile(args.path, exec.signal, { maxBytes })
      const profile = buildProfile(parseCsv(text, { maxRows }), args.path, bytes, maxSample)
      return { ...profile, truncated }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'sample_rows',
    description: 'Return up to `limit` rows of a CSV file starting at `offset` (0-based, excluding the header). Each row is an object keyed by column name with string or null values. Use this to inspect actual data values after profiling. Files larger than `maxBytes` (default 64 MiB) are rejected rather than silently truncated, because offset semantics need the whole file; profile a sample or use Python for big files.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path to the CSV file.' },
      offset: { type: 'integer', description: 'Row index to start from (0-based, header excluded). Defaults to 0.' },
      limit: { type: 'integer', description: 'Maximum number of rows to return. Defaults to 10, capped at 100.' },
      maxBytes: { type: 'integer', description: 'Maximum bytes to read. Defaults to 67108864 (64 MiB); larger files fail.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          offset: { type: 'integer', required: true },
          rows: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: true },
          },
          totalRows: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.rows.length} rows from offset ${value.offset} of ${value.totalRows}: `
          + JSON.stringify(value.rows),
      }],
    },
    async execute(args, exec) {
      if (!args.path) throw new Error('sample_rows: `path` must be a non-empty string')
      const offset = args.offset === undefined ? 0 : Math.max(0, args.offset)
      const limit = args.limit === undefined ? 10 : Math.max(1, Math.min(100, args.limit))
      const maxBytes = args.maxBytes === undefined ? DEFAULT_MAX_BYTES : Math.max(1, args.maxBytes)
      const { text, truncated } = await readCsvFile(args.path, exec.signal, { maxBytes })
      if (truncated) {
        throw new Error(`sample_rows: file exceeds the ${maxBytes}-byte read cap; offset semantics need the whole file. Use profile_dataset on a sample, or read the file with Python via bash.`)
      }
      const table = parseCsv(text)
      const rows: Record<string, string | null>[] = []
      for (let i = offset; i < table.rows.length && rows.length < limit; i++) {
        const row: Record<string, string | null> = {}
        const source = table.rows[i]
        // The loop bound guarantees a defined row; the check only satisfies
        // noUncheckedIndexedAccess.
        /* v8 ignore next -- i < rows.length guarantees a defined row */
        if (source === undefined) continue
        table.headers.forEach((h, c) => { row[h] = source[c] ?? null })
        rows.push(row)
      }
      return { path: args.path, offset, rows, totalRows: table.totalDataLines }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'value_counts',
    description: 'Return the top-K value frequencies for one column of a CSV file: each value with its count and share of non-missing values, plus the column kind, total/missing/unique counts, and how many distinct values are not shown. Use this to judge distributions — target imbalance, whether a high-cardinality column is really an ID, or which categories dominate — before modeling.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path to the CSV file.' },
      column: { type: 'string', required: true, description: 'Column name to tally. Fails if the name is not a header.' },
      topK: { type: 'integer', description: 'How many top values to return. Defaults to 10, capped at 50.' },
      maxRows: { type: 'integer', description: 'Maximum rows to read for the tally; larger files are sampled head + every k-th row. Defaults to 100000.' },
      maxBytes: { type: 'integer', description: 'Maximum bytes to read; larger files are truncated (counts cover only the head). Defaults to 67108864 (64 MiB).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          column: { type: 'string', required: true },
          kind: { type: 'string', required: true, enum: ['number', 'boolean', 'string', 'datetime'] },
          total: { type: 'integer', required: true },
          missing: { type: 'integer', required: true },
          unique: { type: 'integer', required: true },
          omitted: { type: 'integer', required: true },
          sampled: { type: 'boolean', required: true },
          truncated: { type: 'boolean', required: true },
          values: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                value: { type: 'string', required: true },
                count: { type: 'integer', required: true },
                rate: { type: 'number', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.path} column ${value.column}[${value.kind}]: ${value.total} values (${value.missing} missing), ${value.unique} distinct`
          + (value.sampled ? ` (sampled)` : '')
          + (value.truncated ? ' (truncated at byte cap)' : '')
          + `. top: ${value.values.map(v => `${v.value}=${v.count}(${(v.rate * 100).toFixed(1)}%)`).join(', ')}`
          + (value.omitted > 0 ? `; ${value.omitted} more not shown` : ''),
      }],
    },
    async execute(args, exec) {
      if (!args.path) throw new Error('value_counts: `path` must be a non-empty string')
      if (!args.column) throw new Error('value_counts: `column` must be a non-empty string')
      const topK = args.topK === undefined ? 10 : Math.max(1, Math.min(50, args.topK))
      const maxRows = args.maxRows === undefined ? 100_000 : Math.max(1, Math.min(1_000_000, args.maxRows))
      const maxBytes = args.maxBytes === undefined ? DEFAULT_MAX_BYTES : Math.max(1, args.maxBytes)
      const { text, truncated } = await readCsvFile(args.path, exec.signal, { maxBytes })
      const table = parseCsv(text, { maxRows })
      const index = table.headers.indexOf(args.column)
      if (index === -1) {
        throw new Error(`value_counts: column "${args.column}" not found. Available columns: ${table.headers.join(', ')}`)
      }
      const counts = valueCounts(table, index, topK)
      return { path: args.path, column: args.column, ...counts, sampled: table.sampled, truncated }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'discover_datasets',
    description: 'Scan a directory tree for data files (csv, tsv, json, jsonl, parquet, xlsx, xls): each file with its size, detected format, sniffed delimiter for CSV/TSV, and an estimated row count (exact for small files, extrapolated from a 64 KiB head — flagged `estimated`). Use this first to map a workspace instead of guessing with ls/cat.',
    parameters: {
      dir: { type: 'string', description: 'Directory to scan. Defaults to the current working directory.' },
      maxDepth: { type: 'integer', description: 'Maximum directory depth to descend into. Defaults to 3.' },
      maxFiles: { type: 'integer', description: 'Maximum number of files to report. Defaults to 200, capped at 2000.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true },
          fileCount: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
          files: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                ext: { type: 'string', required: true },
                kind: { type: 'string', required: true, enum: ['csv', 'json', 'parquet', 'excel'] },
                bytes: { type: 'integer', required: true },
                delimiter: { type: 'string' },
                rowEstimate: { type: 'integer' },
                estimated: { type: 'boolean' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.root}: ${value.fileCount} data files${value.truncated ? ' (truncated at file cap)' : ''}. `
          + value.files.map(f => {
            const delim = f.delimiter === undefined ? '' : `, ${f.delimiter === '\t' ? 'tab' : f.delimiter}-delimited`
            const rows = f.rowEstimate === undefined ? '' : `, ~${f.rowEstimate} rows${f.estimated ? ' (estimated)' : ''}`
            return `${f.path} (${f.kind}${delim}${rows}, ${f.bytes} bytes)`
          }).join('; '),
      }],
    },
    async execute(args, exec) {
      const dir = args.dir === undefined ? process.cwd() : args.dir
      const maxDepth = args.maxDepth === undefined ? 3 : Math.max(1, Math.min(10, args.maxDepth))
      const maxFiles = args.maxFiles === undefined ? 200 : Math.max(1, Math.min(2000, args.maxFiles))
      return discoverDataFiles(dir, { maxDepth, maxFiles, signal: exec.signal })
    },
  }))

  ctx.skills.registerProvider(() => skillProvider)
}
