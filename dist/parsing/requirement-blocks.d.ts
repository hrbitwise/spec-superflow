export interface RequirementBlock {
    headerLine: string;
    name: string;
    raw: string;
}
export interface RequirementsSectionParts {
    before: string;
    headerLine: string;
    preamble: string;
    bodyBlocks: RequirementBlock[];
    after: string;
}
export declare function normalizeRequirementName(name: string): string;
export declare const REQUIREMENT_HEADER_REGEX: RegExp;
interface MarkdownLine {
    text: string;
    lineNumber: number;
    fenced: boolean;
}
export declare function scanMarkdownLines(content: string): MarkdownLine[];
export declare function extractRequirementsSection(content: string): RequirementsSectionParts;
export interface DeltaPlan {
    added: RequirementBlock[];
    modified: RequirementBlock[];
    removed: string[];
    renamed: Array<{
        from: string;
        to: string;
    }>;
    sectionPresence: {
        added: boolean;
        modified: boolean;
        removed: boolean;
        renamed: boolean;
    };
}
export declare function parseDeltaSpec(content: string): DeltaPlan;
/** 场景块：headerLine 原文、可选 ID、去 ID 前缀后的标题与行号 */
export interface ScenarioBlock {
    headerLine: string;
    id?: string;
    title: string;
    lineNumber: number;
}
/** 场景 ID 问题：格式非法（malformed-id）或 change 内重复（duplicate-id） */
export interface ScenarioIdIssue {
    kind: 'duplicate-id' | 'malformed-id';
    id: string;
    locations: Array<{
        lineNumber: number;
        headerLine: string;
    }>;
}
/**
 * 提取 markdown 中全部场景块（S-TRACE-001/002）。
 * 围栏代码块内的示例场景头不参与提取；无 ID 场景保持合法（id 为 undefined）。
 */
export declare function extractScenarios(content: string): ScenarioBlock[];
/**
 * 校验场景 ID（S-TRACE-003）：严格格式 + change 内唯一。
 * 非法格式报 malformed-id；重复 ID 报 duplicate-id 并给出全部出现位置。
 */
export declare function validateScenarioIds(blocks: ScenarioBlock[]): ScenarioIdIssue[];
export {};
