import { clientBundle } from './build/client.tsdown.ts'

// The node half (lib/) is built by tsc; this config only needs the browser
// client bundle, emitted as the closure-factory artifact the web loader serves
// from /plugins/<id>/client.js.
export default clientBundle('@deepseek-ai/dsh-data-mining', [], { hostPhase: true })
