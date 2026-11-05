import { ValidationReport } from './types.js';
import type { VerificationReport, ConflictReport } from './types.js';
import type { ScenarioIdIssue } from '../parsing/requirement-blocks.js';
/** Scenario 覆盖矩阵报告：缺口（missing）为 CRITICAL 级，缺失即阻止 closing */
export interface ScenarioCoverageReport {
    /** 是否启用（spec 中存在至少一个合法带 ID 场景） */
    applicable: boolean;
    /** 合法带 ID 场景总数 */
    totalScenarios: number;
    /** 已被任务 covers 声明覆盖的 ID */
    covered: string[];
    /** 未被任何任务声明覆盖的缺口 ID */
    missing: string[];
    /** covers 声明了 spec 中不存在的 ID */
    declaredButUnknown: string[];
    /** 解析层 ID 问题（malformed-id / duplicate-id） */
    idIssues: ScenarioIdIssue[];
    /** 矩阵闭合且无 ID 问题 */
    valid: boolean;
}
export declare class Validator {
    private strictMode;
    constructor(strictMode?: boolean);
    validateSpecContent(specName: string, content: string): ValidationReport;
    validateChangeContent(changeName: string, content: string): ValidationReport;
    validateDeltaSpec(content: string): ValidationReport;
    validateImplementation(diffSummary: string, specContent: string, designContent: string, config?: {
        verification?: {
            language?: string;
        };
    }): VerificationReport;
    private extractRequirementNames;
    private extractDecisionNames;
    /**
     * Scenario 覆盖矩阵维度（S-TRACE-005~007）。
     * 仅当 spec 中存在带 ID 的场景时启用（applicable）；全部带 ID 场景必须被
     * 至少一个任务的 covers 声明覆盖，缺口（missing）使 valid 为 false；
     * 声明了 spec 中不存在的 ID（declaredButUnknown）同样使 valid 为 false；
     * ID 格式/唯一性问题（idIssues）在解析层报 ERROR 并阻断矩阵可信度。
     */
    validateScenarioCoverage(specContent: string, tasksContent: string): ScenarioCoverageReport;
    detectSyncConflicts(deltaSpecs: Array<{
        changeName: string;
        content: string;
    }>): ConflictReport;
    isValid(report: ValidationReport): boolean;
}
