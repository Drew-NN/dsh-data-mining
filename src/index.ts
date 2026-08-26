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
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

import { buildProfile, DEFAULT_MAX_BYTES, parseCsv, readCsvFile, selectRows, valueCounts, type RowSelection } from './profile.ts'
import { discoverDataFiles } from './discover.ts'
import { splitDatasetFile, type SplitStrategy } from './split.ts'

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
    description: 'Return up to `limit` rows of a CSV file starting at `offset` (0-based, excluding the header). `columns` projects a subset of columns in order; `where` filters rows by exact match on one column (offset/limit then apply to the matches, and `totalMatches` reports the full match count so the model can page through them). Each row is an object keyed by column name with string or null values. Use this to inspect actual data values after profiling. Files larger than `maxBytes` (default 64 MiB) are rejected rather than silently truncated, because offset and total-match semantics need the whole file; profile a sample or use Python for big files.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path to the CSV file.' },
      offset: { type: 'integer', description: 'Index into the (filtered) rows to start from. Defaults to 0.' },
      limit: { type: 'integer', description: 'Maximum number of rows to return. Defaults to 10, capped at 100.' },
      columns: { type: 'array', items: { type: 'string' }, description: 'Column names to include, in output order. Defaults to all columns.' },
      where: {
        type: 'object',
        additionalProperties: false,
        properties: {
          column: { type: 'string', required: true, description: 'Column to filter on.' },
          equals: { type: 'string', required: true, description: 'Exact value to match; null cells never match.' },
        },
      },
      maxBytes: { type: 'integer', description: 'Maximum bytes to read. Defaults to 67108864 (64 MiB); larger files fail.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          offset: { type: 'integer', required: true },
          columns: { type: 'array', required: true, items: { type: 'string' } },
          rows: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: true },
          },
          totalMatches: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.rows.length} rows from offset ${value.offset} of ${value.totalMatches} matches: `
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
        throw new Error(`sample_rows: file exceeds the ${maxBytes}-byte read cap; offset/total-match semantics need the whole file. Use profile_dataset on a sample, or read the file with Python via bash.`)
      }
      const table = parseCsv(text)
      const selection: RowSelection = {}
      if (args.columns !== undefined) selection.columns = args.columns
      if (args.where !== undefined && args.where !== null) selection.where = args.where
      const { rows, totalMatches } = selectRows(table, selection, offset, limit)
      return {
        path: args.path,
        offset,
        columns: selection.columns ?? table.headers,
        rows,
        totalMatches,
      }
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

  ctx.tools.register(defineTool({
    name: 'split_dataset',
    description: 'Split a CSV into train/test with a deterministic, documented strategy and write the split metadata (strategy, seed, ratio, counts, file paths) to disk. Call this BEFORE any preprocessing that learns from data (imputation, scaling, encoding) — every statistic must be fit on the train side only. Strategies: random (optional `stratifyColumn`), chronological by a time column (with optional `gapDays`), or group by an entity column (entities never cross the split). Outputs `train.csv`, `test.csv`, and `split.json` under `<outDir>` (default `<cwd>/dsh_manifest/splits/<name>`); `check_leakage` later verifies the split. Whole-file read: files over `maxBytes` fail rather than split a partial file.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path to the CSV file to split.' },
      name: { type: 'string', required: true, description: 'Split name; used for the output directory and metadata.' },
      strategy: { type: 'string', required: true, enum: ['random', 'chronological', 'group'], description: 'How to split. chronological requires timeColumn; group requires groupColumn.' },
      ratio: { type: 'number', description: 'Train share, 0.05–0.95. Defaults to 0.8.' },
      seed: { type: 'integer', description: 'Seed for deterministic random/group parts. Defaults to 42.' },
      stratifyColumn: { type: 'string', description: 'For random: keep the train share balanced within this column\'s values.' },
      timeColumn: { type: 'string', description: 'For chronological: column with ISO/slash dates to order by.' },
      gapDays: { type: 'number', description: 'For chronological: rows within this many days of the cutoff are dropped. Defaults to 0.' },
      groupColumn: { type: 'string', description: 'For group: column whose values must never appear on both sides.' },
      idColumn: { type: 'string', description: 'Optional entity key recorded in metadata for check_leakage overlap checks.' },
      outDir: { type: 'string', description: 'Output directory for train.csv/test.csv/split.json. Defaults to <cwd>/dsh_manifest/splits/<name>.' },
      maxBytes: { type: 'integer', description: 'Maximum bytes to read. Defaults to 67108864 (64 MiB); larger files fail.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          datasetPath: { type: 'string', required: true },
          name: { type: 'string', required: true },
          strategy: { type: 'string', required: true, enum: ['random', 'chronological', 'group'] },
          ratio: { type: 'number', required: true },
          seed: { type: 'integer', required: true },
          totalRows: { type: 'integer', required: true },
          trainRows: { type: 'integer', required: true },
          testRows: { type: 'integer', required: true },
          droppedRows: { type: 'integer', required: true },
          trainFile: { type: 'string', required: true },
          testFile: { type: 'string', required: true },
          splitFile: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.name} (${value.strategy}, ratio ${value.ratio}, seed ${value.seed}): ${value.trainRows}/${value.totalRows} train, ${value.testRows} test${value.droppedRows > 0 ? `, ${value.droppedRows} dropped` : ''}. `,
      }],
    },
    async execute(args, exec) {
      if (!args.path) throw new Error('split_dataset: `path` must be a non-empty string')
      if (!args.name) throw new Error('split_dataset: `name` must be a non-empty string')
      const strategy = args.strategy as SplitStrategy
      const ratio = args.ratio === undefined ? 0.8 : Math.min(0.95, Math.max(0.05, args.ratio))
      const seed = args.seed === undefined ? 42 : Math.max(0, Math.floor(args.seed))
      const maxBytes = args.maxBytes === undefined ? DEFAULT_MAX_BYTES : Math.max(1, args.maxBytes)
      const outDir = args.outDir ?? join(process.cwd(), 'dsh_manifest', 'splits', args.name)
      const { metadata, trainFile, testFile, splitFile } = await splitDatasetFile(args.path, exec.signal, {
        strategy,
        ratio,
        seed,
        name: args.name,
        outDir,
        maxBytes,
        ...(args.stratifyColumn !== undefined ? { stratifyColumn: args.stratifyColumn } : {}),
        ...(args.timeColumn !== undefined ? { timeColumn: args.timeColumn } : {}),
        ...(args.gapDays !== undefined ? { gapDays: args.gapDays } : {}),
        ...(args.groupColumn !== undefined ? { groupColumn: args.groupColumn } : {}),
        ...(args.idColumn !== undefined ? { idColumn: args.idColumn } : {}),
      })
      return {
        datasetPath: metadata.datasetPath,
        name: metadata.name,
        strategy: metadata.strategy,
        ratio: metadata.ratio,
        seed: metadata.seed,
        totalRows: metadata.totalRows,
        trainRows: metadata.trainRows,
        testRows: metadata.testRows,
        droppedRows: metadata.droppedRows,
        trainFile,
        testFile,
        splitFile,
      }
    },
  }))

  ctx.skills.registerProvider(() => skillProvider)
}
