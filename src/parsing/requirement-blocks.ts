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

export function normalizeRequirementName(name: string): string {
  return name.trim();
}

// Keep the canonical `Requirement:` form while accepting existing Chinese
// artifacts that use a stable requirement ID as the heading.
export const REQUIREMENT_HEADER_REGEX = /^###\s*(?:(?:Requirement|需求)\s*[:：]\s*(.+)|(REQ-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\s*:\s*.+))\s*$/i;

function requirementName(match: RegExpMatchArray): string {
  return normalizeRequirementName(match[1] ?? match[2]);
}

function requirementNameFromHeader(header: string): string | undefined {
  const match = header.match(REQUIREMENT_HEADER_REGEX);
  return match ? requirementName(match) : undefined;
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

interface MarkdownLine {
  text: string;
  lineNumber: number;
  fenced: boolean;
}

interface Fence {
  marker: '`' | '~';
  length: number;
}

function openingFence(line: string): Fence | undefined {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  if (!match) return undefined;
  return {
    marker: match[1][0] as Fence['marker'],
    length: match[1].length,
  };
}

function closesFence(line: string, fence: Fence): boolean {
  const match = line.match(/^ {0,3}(`+|~+)\s*$/);
  return Boolean(
    match && match[1][0] === fence.marker && match[1].length >= fence.length
  );
}

// Keep the original markdown available to callers while giving structural
// parsers a shared view that excludes example content inside fenced blocks.
// Line numbers are retained for future diagnostics without changing public
// requirement or delta-plan shapes.
export function scanMarkdownLines(content: string): MarkdownLine[] {
  const lines = normalizeLineEndings(content).split('\n');
  let activeFence: Fence | undefined;

  return lines.map((text, index) => {
    if (activeFence) {
      if (closesFence(text, activeFence)) {
        activeFence = undefined;
        return { text, lineNumber: index + 1, fenced: false };
      }
      return { text, lineNumber: index + 1, fenced: true };
    }

    const fence = openingFence(text);
    if (fence) activeFence = fence;
    return { text, lineNumber: index + 1, fenced: false };
  });
}

export function extractRequirementsSection(content: string): RequirementsSectionParts {
  const normalized = normalizeLineEndings(content);
  const lines = normalized.split('\n');
  const structure = scanMarkdownLines(normalized);
  const reqHeaderIndex = structure.findIndex(
    ({ text, fenced }) => !fenced && /^##\s+Requirements\s*$/i.test(text)
  );

  if (reqHeaderIndex === -1) {
    const before = content.trimEnd();
    const headerLine = '## Requirements';
    return {
      before: before ? before + '\n\n' : '',
      headerLine,
      preamble: '',
      bodyBlocks: [],
      after: '\n',
    };
  }

  let endIndex = lines.length;
  for (let i = reqHeaderIndex + 1; i < lines.length; i++) {
    if (!structure[i].fenced && /^##\s+/.test(lines[i])) {
      endIndex = i;
      break;
    }
  }

  const before = lines.slice(0, reqHeaderIndex).join('\n');
  const headerLine = lines[reqHeaderIndex];
  const sectionBodyLines = lines.slice(reqHeaderIndex + 1, endIndex);

  const blocks: RequirementBlock[] = [];
  let cursor = 0;
  let preambleLines: string[] = [];

  while (
    cursor < sectionBodyLines.length &&
    (structure[reqHeaderIndex + 1 + cursor].fenced ||
      !REQUIREMENT_HEADER_REGEX.test(sectionBodyLines[cursor]))
  ) {
    preambleLines.push(sectionBodyLines[cursor]);
    cursor++;
  }

  while (cursor < sectionBodyLines.length) {
    const headerLineCandidate = sectionBodyLines[cursor];
    const headerMatch = structure[reqHeaderIndex + 1 + cursor].fenced
      ? undefined
      : headerLineCandidate.match(REQUIREMENT_HEADER_REGEX);
    if (!headerMatch) {
      cursor++;
      continue;
    }
    const name = requirementName(headerMatch);
    cursor++;
    const bodyLines: string[] = [headerLineCandidate];
    while (
      cursor < sectionBodyLines.length &&
      (structure[reqHeaderIndex + 1 + cursor].fenced ||
        (!REQUIREMENT_HEADER_REGEX.test(sectionBodyLines[cursor]) &&
          !/^##\s+/.test(sectionBodyLines[cursor])))
    ) {
      bodyLines.push(sectionBodyLines[cursor]);
      cursor++;
    }
    const raw = bodyLines.join('\n').trimEnd();
    blocks.push({ headerLine: headerLineCandidate, name, raw });
  }

  const after = lines.slice(endIndex).join('\n');
  const preamble = preambleLines.join('\n').trimEnd();

  return {
    before: before.trimEnd() ? before + '\n' : before,
    headerLine,
    preamble,
    bodyBlocks: blocks,
    after: after.startsWith('\n') ? after : '\n' + after,
  };
}

export interface DeltaPlan {
  added: RequirementBlock[];
  modified: RequirementBlock[];
  removed: string[];
  renamed: Array<{ from: string; to: string }>;
  sectionPresence: {
    added: boolean;
    modified: boolean;
    removed: boolean;
    renamed: boolean;
  };
}

function splitTopLevelSections(content: string): Record<string, string> {
  const structure = scanMarkdownLines(content);
  const lines = structure.map(({ text }) => text);
  const result: Record<string, string> = {};
  const indices: Array<{ title: string; index: number; level: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = structure[i].fenced ? undefined : lines[i].match(/^(##)\s+(.+)$/);
    if (m) {
      const level = m[1].length;
      indices.push({ title: m[2].trim(), index: i, level });
    }
  }
  for (let i = 0; i < indices.length; i++) {
    const current = indices[i];
    const next = indices[i + 1];
    const body = lines
      .slice(current.index + 1, next ? next.index : lines.length)
      .join('\n');
    result[current.title] = body;
  }
  return result;
}

function getSectionCaseInsensitive(
  sections: Record<string, string>,
  desired: string
): { body: string; found: boolean } {
  const target = desired.toLowerCase();
  for (const [title, body] of Object.entries(sections)) {
    if (title.toLowerCase() === target) return { body, found: true };
  }
  return { body: '', found: false };
}

function parseRequirementBlocksFromSection(sectionBody: string): RequirementBlock[] {
  if (!sectionBody) return [];
  const structure = scanMarkdownLines(sectionBody);
  const lines = structure.map(({ text }) => text);
  const blocks: RequirementBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    while (
      i < lines.length &&
      (structure[i].fenced || !REQUIREMENT_HEADER_REGEX.test(lines[i]))
    ) i++;
    if (i >= lines.length) break;
    const headerLine = lines[i];
    const m = headerLine.match(REQUIREMENT_HEADER_REGEX);
    if (!m) {
      i++;
      continue;
    }
    const name = requirementName(m);
    const buf: string[] = [headerLine];
    i++;
    while (
      i < lines.length &&
      (structure[i].fenced ||
        (!REQUIREMENT_HEADER_REGEX.test(lines[i]) && !/^##\s+/.test(lines[i])))
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ headerLine, name, raw: buf.join('\n').trimEnd() });
  }
  return blocks;
}

function parseRemovedNames(sectionBody: string): string[] {
  if (!sectionBody) return [];
  const names: string[] = [];
  for (const { text: line, fenced } of scanMarkdownLines(sectionBody)) {
    if (fenced) continue;
    const m = line.match(REQUIREMENT_HEADER_REGEX);
    if (m) {
      names.push(requirementName(m));
      continue;
    }
    const bullet = line.match(/^\s*-\s*`?(###\s*.+?)`?\s*$/);
    if (bullet) {
      const name = requirementNameFromHeader(bullet[1]);
      if (name) names.push(name);
    }
  }
  return names;
}

function parseRenamedPairs(
  sectionBody: string
): Array<{ from: string; to: string }> {
  if (!sectionBody) return [];
  const pairs: Array<{ from: string; to: string }> = [];
  let current: { from?: string; to?: string } = {};
  for (const { text: line, fenced } of scanMarkdownLines(sectionBody)) {
    if (fenced) continue;
    const fromMatch = line.match(/^\s*-?\s*FROM:\s*`?(###\s*.+?)`?\s*$/);
    const toMatch = line.match(/^\s*-?\s*TO:\s*`?(###\s*.+?)`?\s*$/);
    if (fromMatch) {
      current.from = requirementNameFromHeader(fromMatch[1]);
    } else if (toMatch) {
      current.to = requirementNameFromHeader(toMatch[1]);
      if (current.from && current.to) {
        pairs.push({ from: current.from, to: current.to });
        current = {};
      }
    }
  }
  return pairs;
}

export function parseDeltaSpec(content: string): DeltaPlan {
  const normalized = normalizeLineEndings(content);
  const sections = splitTopLevelSections(normalized);
  const addedLookup = getSectionCaseInsensitive(sections, 'ADDED Requirements');
  const modifiedLookup = getSectionCaseInsensitive(sections, 'MODIFIED Requirements');
  const removedLookup = getSectionCaseInsensitive(sections, 'REMOVED Requirements');
  const renamedLookup = getSectionCaseInsensitive(sections, 'RENAMED Requirements');
  const added = parseRequirementBlocksFromSection(addedLookup.body);
  const modified = parseRequirementBlocksFromSection(modifiedLookup.body);
  const removedNames = parseRemovedNames(removedLookup.body);
  const renamedPairs = parseRenamedPairs(renamedLookup.body);
  return {
    added,
    modified,
    removed: removedNames,
    renamed: renamedPairs,
    sectionPresence: {
      added: addedLookup.found,
      modified: modifiedLookup.found,
      removed: removedLookup.found,
      renamed: renamedLookup.found,
    },
  };
}

// --- Scenario ID traceability (S-TRACE-001~003) ---

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
  locations: Array<{ lineNumber: number; headerLine: string }>;
}

const SCENARIO_HEADER_REGEX = /^####\s+Scenario:\s*(.+?)\s*$/i;
// 疑似 ID 前缀（宽松）：S-/s- 开头、后接冒号——中文标题含冒号不受影响
const SUSPECTED_SCENARIO_ID_REGEX = /^([Ss]-[^\s:]+)\s*:\s*(.+)$/;
// 严格 ID 格式：S-<CAP>-<NNN>（大写字母/数字/连字符能力段 + 三位序号）
const STRICT_SCENARIO_ID_REGEX = /^S-[A-Z][A-Z0-9-]*-\d{3}$/;

/**
 * 提取 markdown 中全部场景块（S-TRACE-001/002）。
 * 围栏代码块内的示例场景头不参与提取；无 ID 场景保持合法（id 为 undefined）。
 */
export function extractScenarios(content: string): ScenarioBlock[] {
  const blocks: ScenarioBlock[] = [];
  for (const { text, lineNumber, fenced } of scanMarkdownLines(content)) {
    if (fenced) continue;
    const m = text.match(SCENARIO_HEADER_REGEX);
    if (!m) continue;
    const rest = m[1];
    const suspected = rest.match(SUSPECTED_SCENARIO_ID_REGEX);
    if (suspected) {
      // 疑似 ID：原样保留（含非法格式），由 validateScenarioIds 分级报错
      blocks.push({
        headerLine: text,
        id: suspected[1],
        title: suspected[2].trim(),
        lineNumber,
      });
    } else {
      blocks.push({ headerLine: text, title: rest, lineNumber });
    }
  }
  return blocks;
}

/**
 * 校验场景 ID（S-TRACE-003）：严格格式 + change 内唯一。
 * 非法格式报 malformed-id；重复 ID 报 duplicate-id 并给出全部出现位置。
 */
export function validateScenarioIds(blocks: ScenarioBlock[]): ScenarioIdIssue[] {
  const issues: ScenarioIdIssue[] = [];
  const byId = new Map<string, Array<{ lineNumber: number; headerLine: string }>>();
  for (const block of blocks) {
    if (block.id === undefined) continue;
    if (!STRICT_SCENARIO_ID_REGEX.test(block.id)) {
      issues.push({
        kind: 'malformed-id',
        id: block.id,
        locations: [{ lineNumber: block.lineNumber, headerLine: block.headerLine }],
      });
      continue;
    }
    const list = byId.get(block.id);
    if (list) list.push({ lineNumber: block.lineNumber, headerLine: block.headerLine });
    else byId.set(block.id, [{ lineNumber: block.lineNumber, headerLine: block.headerLine }]);
  }
  for (const [id, locations] of byId) {
    if (locations.length > 1) {
      issues.push({ kind: 'duplicate-id', id, locations });
    }
  }
  return issues;
}

// --- Task covers declarations (S-TRACE-004) ---

/** 任务行的 covers 声明：任务 ID + 其声明覆盖的场景 ID 列表 */
export interface TaskCoversEntry {
  taskId: string;
  covers: string[];
  lineNumber: number;
}

const TASK_HEADER_REGEX = /^-\s*\[[ xX]\]\s*\*{0,2}(\d+(?:\.\d+)*)/;
// 捕获 covers: 之后到中文句号/行尾的整段，再按逗号切分（逗号紧邻无空格也正确）
const COVERS_DECLARATION_REGEX = /covers:\s*([^。]+)/;

/**
 * 解析 tasks.md 中的 covers 声明（S-TRACE-004）。
 * covers 归属其上方最近的任务行；无声明的任务不产生条目。
 */
export function extractTaskCovers(content: string): TaskCoversEntry[] {
  const entries: TaskCoversEntry[] = [];
  let currentTaskId: string | undefined;
  let currentLineNumber = 0;
  for (const { text, lineNumber, fenced } of scanMarkdownLines(content)) {
    if (fenced) continue;
    const taskMatch = text.match(TASK_HEADER_REGEX);
    if (taskMatch) {
      currentTaskId = taskMatch[1];
      currentLineNumber = lineNumber;
    }
    const coversMatch = text.match(COVERS_DECLARATION_REGEX);
    if (coversMatch && currentTaskId) {
      const covers = coversMatch[1]
        .split(',')
        .map(id => id.trim())
        .filter(id => id.length > 0);
      if (covers.length > 0) {
        entries.push({ taskId: currentTaskId, covers, lineNumber: currentLineNumber });
      }
    }
  }
  return entries;
}
