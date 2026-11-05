import { scanMarkdownLines } from './requirement-blocks.js';
// 围栏开闭标记行（```/~~~）在结构中标记为非围栏，收集正文时需一并排除。
const FENCE_MARKER_REGEX = /^ {0,3}(?:`{3,}|~{3,})/;
// 围栏感知章节提取：仅非围栏行可作为标题，正文排除围栏行与围栏标记，
// 章节结束于下一个非围栏二级标题。
function extractSection(content, heading) {
    const structure = scanMarkdownLines(content);
    // 标题正则沿用旧规则，兼容 "## Why" 与 "## 背景（Why）" 双语形式。
    const headingRegex = new RegExp(`^##\\s+.*\\b${heading.replace(/\s+/g, '\\s+')}\\b.*$`, 'i');
    const idx = structure.findIndex(({ text, fenced }) => !fenced && headingRegex.test(text));
    if (idx === -1)
        return '';
    let endIdx = structure.length;
    for (let i = idx + 1; i < structure.length; i++) {
        if (!structure[i].fenced && /^##\s+/.test(structure[i].text)) {
            endIdx = i;
            break;
        }
    }
    const body = structure
        .slice(idx + 1, endIdx)
        .filter(({ text, fenced }) => !fenced && !FENCE_MARKER_REGEX.test(text))
        .map(({ text }) => text);
    return body.join('\n').trim();
}
export function parseChangeMarkdown(content, changeName) {
    const why = extractSection(content, 'Why');
    const whatChanges = extractSection(content, 'What Changes');
    const deltas = [];
    const deltaSectionRegex = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/i;
    // 围栏感知 delta 扫描：仅非围栏行匹配节头，围栏内标题不产生幻影 delta。
    const structure = scanMarkdownLines(content);
    for (let i = 0; i < structure.length; i++) {
        if (structure[i].fenced)
            continue;
        const match = structure[i].text.match(deltaSectionRegex);
        if (!match)
            continue;
        const operation = match[1].toUpperCase();
        const descLines = [];
        // 向下收集非围栏行：遇下一个非围栏二级标题或三级标题即止，
        // 空行跳过、其余 trim 后保留——与修复前 break/trim 规则一致。
        for (let j = i + 1; j < structure.length; j++) {
            const { text, fenced } = structure[j];
            if (!fenced && /^##\s+/.test(text))
                break;
            if (fenced || FENCE_MARKER_REGEX.test(text))
                continue;
            if (/^###\s+/.test(text))
                break;
            const trimmed = text.trim();
            if (trimmed)
                descLines.push(trimmed);
        }
        deltas.push({
            spec: '',
            operation,
            description: descLines.join('\n'),
        });
    }
    return {
        name: changeName,
        why,
        whatChanges,
        deltas,
    };
}
