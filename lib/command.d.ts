import { type Manifest } from './manifest.ts';
/** Minimal command-invocation shape (subset of dsh-commands) used by /dm. */
export interface DmCommandInvocation {
    rawInput: string;
    agent?: {
        session?: {
            header?: {
                cwd?: string;
            };
        };
    };
}
/** Minimal command-result shape used by /dm. */
export type DmCommandResult = {
    kind: 'success' | 'error';
    text: string;
};
/** The worker stages the dock shows, in order, with their manifest data source. */
export declare const WORKER_STAGES: readonly [{
    readonly phase: "business";
    readonly label: "目标";
    readonly key: "goal";
}, {
    readonly phase: "data-understanding";
    readonly label: "数据理解";
    readonly key: "datasets";
}, {
    readonly phase: "data-cleaning";
    readonly label: "清洗";
    readonly key: "datasets";
}, {
    readonly phase: "split";
    readonly label: "切分";
    readonly key: "split";
}, {
    readonly phase: "modeling";
    readonly label: "建模";
    readonly key: "phase";
}, {
    readonly phase: "evaluation";
    readonly label: "评估";
    readonly key: "phase";
}, {
    readonly phase: "deployment";
    readonly label: "交付";
    readonly key: "phase";
}];
/**
 * Mechanically derive one stage's status from the ledger.
 * - record-keyed stages (goal/datasets/split): done when the record exists
 * - phase-keyed stages (modeling/evaluation/deployment): done when the
 *   ledger's current phase has passed them, in-progress when it is on them
 */
export declare function stageStatus(m: Manifest, phase: string, key: 'goal' | 'datasets' | 'split' | 'phase'): 'done' | 'in-progress' | 'not-started';
/** Render a compact, human-readable ledger status block for the /dm status command. */
export declare function renderLedgerStatus(m: Manifest): string;
/** Handler for `/dm status`: read the session workspace ledger and summarize it. */
export declare function dmStatusCommand(invocation: DmCommandInvocation): Promise<DmCommandResult>;
//# sourceMappingURL=command.d.ts.map