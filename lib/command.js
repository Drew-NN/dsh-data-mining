import { join } from 'node:path';
import { MANIFEST_FILENAME, loadManifest } from "./manifest.js";
/** The worker stages the dock shows, in order, with their manifest data source. */
export const WORKER_STAGES = [
    { phase: 'business', label: '目标', key: 'goal' },
    { phase: 'data-understanding', label: '数据理解', key: 'datasets' },
    { phase: 'data-cleaning', label: '清洗', key: 'datasets' },
    { phase: 'split', label: '切分', key: 'split' },
    { phase: 'modeling', label: '建模', key: 'phase' },
    { phase: 'evaluation', label: '评估', key: 'phase' },
    { phase: 'deployment', label: '交付', key: 'phase' },
];
/** Ledger order used to derive progress for phase-keyed stages. */
const PHASE_ORDER = [
    'business', 'data-understanding', 'data-collection', 'data-cleaning', 'split',
    'preprocessing', 'modeling', 'evaluation', 'deployment', 'done',
];
/**
 * Mechanically derive one stage's status from the ledger.
 * - record-keyed stages (goal/datasets/split): done when the record exists
 * - phase-keyed stages (modeling/evaluation/deployment): done when the
 *   ledger's current phase has passed them, in-progress when it is on them
 */
export function stageStatus(m, phase, key) {
    if (key === 'phase') {
        const cur = PHASE_ORDER.indexOf((m.phase ?? ''));
        const target = PHASE_ORDER.indexOf(phase);
        if (cur > target)
            return 'done';
        if (cur === target)
            return 'in-progress';
        return 'not-started';
    }
    const recordDone = key === 'goal'
        ? m.goal !== null
        : key === 'datasets'
            ? m.datasets.length > 0
            : m.split !== null;
    return recordDone ? 'done' : 'not-started';
}
/** Render a compact, human-readable ledger status block for the /dm status command. */
export function renderLedgerStatus(m) {
    const lines = WORKER_STAGES.map(({ phase, label, key }) => {
        const status = stageStatus(m, phase, key);
        const dot = status === 'done' ? '✅' : status === 'in-progress' ? '🔄' : '⬜';
        return `${dot} ${label} (${phase})`;
    });
    const goal = m.goal === null ? '（未设置）' : `“${m.goal.statement}” 目标=${m.goal.target} 指标=${m.goal.metric}`;
    return [
        `目标: ${goal}`,
        `当前阶段: ${m.phase ?? '（未开始）'}`,
        `数据集: ${m.datasets.length} 个已记录 | 切分: ${m.split === null ? '未切分' : `${m.split.strategy} (${m.split.splitFile})`} | 决策: ${m.decisions.length} 条`,
        ...lines,
    ].join('\n');
}
/** Handler for `/dm status`: read the session workspace ledger and summarize it. */
export function dmStatusCommand(invocation) {
    const cwd = invocation.agent?.session?.header?.cwd;
    if (cwd === undefined) {
        return Promise.resolve({ kind: 'error', text: '/dm status: no session workspace available' });
    }
    const file = join(cwd, 'dsh_manifest', MANIFEST_FILENAME);
    return loadManifest(file)
        .then(m => ({ kind: 'success', text: renderLedgerStatus(m) }))
        .catch(() => ({ kind: 'error', text: '/dm status: could not read the workspace ledger' }));
}
