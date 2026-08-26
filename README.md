# dsh-data-mining

A data-mining agent for DeepSeek Harness — one installable profile layer that adds a data-scientist persona, data-profiling tools, and domain skills to any `dsh` profile.

## What you get

Installing this bundle adds three things to your profile:

| Contribution | What it does |
|---|---|
| **Data-scientist persona** | Replaces the profile persona: discover the workspace first, profile before coding, validate without leakage, report findings |
| **Data tools** (`profile_dataset`, `sample_rows`) | Give the model a proxy view of datasets that cannot fit in its context window (schema, missing rates, sample values) |
| **Domain skills** (`data-mining-workflow`, `data-leakage-prevention`, `data-quality-assessment`) | CRISP-DM workflow discipline, the leakage rules that keep test information out of training, and a systematic data-quality assessment checklist — loaded on demand |

Everything is one package: the tools and skills are registered by the same plugin, and the persona lives in the bundle's patch layer.

## Install

```sh
# from GitHub
dsh plugin --profile headless add github:<your-username>/dsh-data-mining
# or after publishing to npm
dsh plugin --profile headless add @deepseek-ai/dsh-data-mining
```

The bundle joins the profile's layer stack; the persona, tools, and skills are live on the next `dsh` run.

## Use

Run `dsh` from the directory you want the agent to work in — the agent's working directory IS that directory (the headless profile sets cwd and the sandbox root to `process.cwd()`):

```sh
cd /path/to/your/data-mining-workspace
dsh --profile headless "explore this workspace, find the datasets, and analyze them"
```

The agent lists the workspace, finds data and code, profiles the datasets, and keeps its artifacts (scripts, models, reports) in your workspace.

> **Sandbox note**: the default sandbox mode is `workspace-write` — the agent can freely read and write inside the directory it runs from, and writes outside it require approval. This is the safety boundary, not a limitation.

## Verify the install

```sh
dsh --profile headless --dump-config | grep -A2 "data-mining"
# expect a data-mining row inserted by this bundle
```

## How it works

- `cordis.patch.yml` — the bundle's patch layer: replaces the base `system-prompt` persona and inserts the `data-mining` plugin row.
- `src/index.ts` — a Cordis plugin that registers `profile_dataset` / `sample_rows` on `ctx.tools` and the bundled skills on `ctx.skills` as a bundled provider (locating the `SKILL.md` files relative to the installed bundle directory).
- `src/profile.ts` — the CSV parsing and profiling logic (pure functions, unit-tested).
- `skills/` — the three skill bodies.

## Development

```sh
pnpm install
pnpm run build     # tsc → lib/
pnpm test          # vitest (21 tests)
```

To test the bundle end to end in an isolated profile:

```sh
export DSH_HOME=/tmp/dsh-e2e
dsh plugin --profile headless add file:./          # or the git URL
dsh --profile headless --dump-config               # verify the data-mining row
cd /some/workspace && dsh --profile headless "analyze the data here"
```

## Publish

1. Replace `<your-username>` in `package.json`'s `repository` field.
2. Push to GitHub; users install via `dsh plugin ... add github:<your-username>/dsh-data-mining`.
3. Optionally `npm publish --access public` for a plain npm install.

## License

MIT
