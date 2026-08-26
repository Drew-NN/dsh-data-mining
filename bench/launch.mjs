// Launch the dsh CLI with a session cwd of our choosing. Lives in the bench
// workspace (writable); imports the harness CLI by absolute path so module
// resolution stays rooted at the harness repo, while process.cwd() becomes
// DSH_WORKSPACE (which the headless profile uses as the session cwd and the
// sandbox workspace root).
const ws = process.env.DSH_WORKSPACE
if (ws) process.chdir(ws)
await import('file:///home/njd/openagent/deepseek-harness/apps/cli/src/bin.ts')
