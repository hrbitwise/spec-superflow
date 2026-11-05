// scripts/lib/vault-drift.mjs
// 外部 Obsidian vault 漂移检查引擎（供 `ssf doctor vault` 调用），两类事实核对：
// 1. skill 镜像漂移：vault/<mirrorDir>/** 必须与插件源 <pluginRoot>/skills/** 逐文件一致，
//    检出镜像缺失（mirror-missing）、内容过期（mirror-outdated）、源已删除的多余文件
//    （mirror-extra，默认 warning，--strict 下升级为 error）。
// 2. MOC 引用完整性：MOC 索引页（vault 根下 MOC*.md）中以路径形式引用的 vault 内文件/
//    目录必须真实存在（moc-broken-link），含 `..` 越界段判为 moc-unsafe-link。
// 边界：纯只读文件系统逻辑；不解析 Obsidian 裸笔记名双链（[[笔记名]]，无路径无 .md），
// 不感知 MCPVault 挂载——裸磁盘与 MCP 同步后的磁盘均可检查。
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** 默认镜像目录（相对 vault 根）：vault 内 SSF skill 镜像所在位置。 */
export const DEFAULT_MIRROR_DIR = 'skills/spec-superflow';

/** 递归列出目录下全部文件，返回绝对路径数组；目录不存在时返回空数组。 */
function listFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory)) {
    const filePath = join(directory, entry);
    if (statSync(filePath).isDirectory()) {
      files.push(...listFiles(filePath));
    } else {
      files.push(filePath);
    }
  }
  return files;
}

/** 将路径转换为 POSIX 风格（正斜杠），保证跨平台输出与键一致。 */
function toPosix(value) {
  return value.split(sep).join('/');
}

/** 计算字节内容的 sha256 摘要（带 sha256: 前缀），用于镜像内容比对。 */
function digest(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

/**
 * 比对插件源 skills/ 与 vault 镜像目录的全部文件。
 * @param {string} pluginRoot 插件仓根（其下含 skills/）
 * @param {string} vaultRoot Obsidian vault 根
 * @param {string} mirrorDir 镜像目录（相对 vault 根，POSIX 形式）
 * @returns {{issues: Array<{kind:string,severity:'error'|'warning',file:string,detail:string}>, sourceCount:number, mirroredCount:number, syncedCount:number}}
 */
export function checkSkillMirror(pluginRoot, vaultRoot, mirrorDir = DEFAULT_MIRROR_DIR) {
  const issues = [];
  const sourceRoot = join(pluginRoot, 'skills');
  const mirrorRoot = join(vaultRoot, ...mirrorDir.split('/'));

  const sourceFiles = listFiles(sourceRoot).map(file => toPosix(relative(sourceRoot, file)));
  const mirrorFiles = new Set(listFiles(mirrorRoot).map(file => toPosix(relative(mirrorRoot, file))));
  let syncedCount = 0;

  for (const rel of sourceFiles.sort()) {
    const mirrorRel = `${mirrorDir}/${rel}`;
    const mirrorFile = join(mirrorRoot, ...rel.split('/'));
    if (!existsSync(mirrorFile)) {
      issues.push({
        kind: 'mirror-missing',
        severity: 'error',
        file: mirrorRel,
        detail: `source skills/${rel} has no counterpart in vault mirror`,
      });
      continue;
    }
    const sourceHash = digest(readFileSync(join(sourceRoot, ...rel.split('/'))));
    const mirrorHash = digest(readFileSync(mirrorFile));
    if (sourceHash !== mirrorHash) {
      issues.push({
        kind: 'mirror-outdated',
        severity: 'error',
        file: mirrorRel,
        detail: `content differs from source skills/${rel} (mirror ${mirrorHash.slice(0, 15)}… vs source ${sourceHash.slice(0, 15)}…)`,
      });
    } else {
      syncedCount += 1;
    }
  }

  for (const rel of [...mirrorFiles].sort()) {
    if (!sourceFiles.includes(rel)) {
      issues.push({
        kind: 'mirror-extra',
        severity: 'warning',
        file: `${mirrorDir}/${rel}`,
        detail: 'exists in vault mirror but no such file under source skills/',
      });
    }
  }

  return { issues, sourceCount: sourceFiles.length, mirroredCount: mirrorFiles.size, syncedCount };
}

/**
 * 从 MOC Markdown 中提取 vault 内路径式引用。
 * 来源：反引号代码 span（文件与目录）、裸文本中的 xxx/yyy.md 路径；
 * 跳过 URL、~/home 路径、<占位符>、glob 通配、绝对路径、fenced code block 内容。
 * @param {string} markdown MOC 文件全文
 * @returns {Array<{path:string,line:number}>} 去重后的引用（保留首次出现行号）
 */
export function extractMocReferences(markdown) {
  const references = new Map();
  const lines = markdown.split(/\r?\n/);
  let fenced = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s{0,3}(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    // 行内去掉 URL，避免把 https://host/path/x.md 误判为 vault 路径。
    let residual = line.replace(/[A-Za-z][\w+.-]*:\/\/\S+/g, '');

    // 反引号代码 span：路径式文件或目录引用的主要载体。
    for (const match of residual.matchAll(/`([^`]+)`/g)) {
      classifyReference(match[1], index + 1, references);
    }
    residual = residual.replace(/`[^`]+`/g, ' ');

    // Obsidian 双链 [[path]]（仅处理路径式；裸笔记名需全库 basename 解析，不在本工具范围）。
    for (const match of residual.matchAll(/\[\[([^\]]+)\]\]/g)) {
      classifyReference(match[1].split('|')[0], index + 1, references);
    }
    residual = residual.replace(/\[\[[^\]]+\]\]/g, ' ');

    // 裸文本路径：至少含一个目录分隔符且以 .md 结尾（允许中文目录/文件名）。
    for (const match of residual.matchAll(/(?:[\w.\u4e00-\u9fa5-]+\/)+[\w.\u4e00-\u9fa5-]+\.md\b/g)) {
      classifyReference(match[0], index + 1, references);
    }
  }

  return [...references.values()];
}

/**
 * 判定单个候选 token 是否为 vault 内相对路径，合法则收入引用表。
 * @param {string} raw 候选文本（可能含锚点、尾随标点、占位符）
 * @param {number} line 行号（1 起）
 * @param {Map<string,{path:string,line:number}>} accum 去重累加表
 */
function classifyReference(raw, line, accum) {
  let candidate = raw.trim().split('#')[0].trim();
  if (candidate === '' || accum.has(candidate)) return;

  // 非 vault 路径：URL、home 目录、占位符模板、glob、绝对路径（/ 或盘符）。
  if (/:\/\//.test(candidate)) return;
  if (candidate.startsWith('~')) return;
  if (/[<>*?[\]]/.test(candidate)) return;
  if (candidate.startsWith('/') || /^[A-Za-z]:[\\/]/.test(candidate)) return;

  // 规范化：去掉结尾斜杠用于存在性判断，但保留原始形式上报。
  const normalized = candidate.replace(/\/+$/, '');
  if (normalized === '') return;

  // 只接受路径式引用（含目录分隔符）；无分隔符的裸词不判定。
  if (!normalized.includes('/')) return;

  accum.set(candidate, { path: normalized, line });
}

/**
 * 发现需要检查的 MOC 文件。
 * @param {string} vaultRoot vault 根
 * @param {string|null} explicitMoc 用户显式指定的 MOC 相对路径
 * @returns {{files:string[], missing:boolean}} MOC 绝对路径列表；显式指定但不存在或默认未发现时 missing=true
 */
export function findMocFiles(vaultRoot, explicitMoc = null) {
  if (explicitMoc) {
    const file = join(vaultRoot, ...explicitMoc.split('/'));
    return existsSync(file) ? { files: [file], missing: false } : { files: [], missing: true };
  }
  if (!existsSync(vaultRoot)) return { files: [], missing: true };
  const files = readdirSync(vaultRoot)
    .filter(entry => /^MOC.*\.md$/i.test(entry) && statSync(join(vaultRoot, entry)).isFile())
    .sort()
    .map(entry => join(vaultRoot, entry));
  return { files, missing: files.length === 0 };
}

/**
 * 校验各 MOC 文件中的路径引用是否都落在 vault 内且真实存在。
 * @param {string} vaultRoot vault 根
 * @param {string[]} mocFiles MOC 文件绝对路径列表
 * @returns {Array<{kind:string,severity:'error'|'warning',file:string,line:number,detail:string}>}
 */
export function checkMocLinks(vaultRoot, mocFiles) {
  const issues = [];
  const root = resolve(vaultRoot);

  for (const mocFile of mocFiles) {
    const mocName = toPosix(relative(root, mocFile));
    const markdown = readFileSync(mocFile, 'utf8');
    for (const reference of extractMocReferences(markdown)) {
      const target = join(root, ...reference.path.split('/'));
      if (reference.path.split('/').includes('..') || !resolve(target).startsWith(root + sep)) {
        issues.push({
          kind: 'moc-unsafe-link',
          severity: 'error',
          file: mocName,
          line: reference.line,
          detail: `'${reference.path}' escapes the vault root`,
        });
        continue;
      }
      if (!existsSync(target)) {
        issues.push({
          kind: 'moc-broken-link',
          severity: 'error',
          file: mocName,
          line: reference.line,
          detail: `referenced path '${reference.path}' does not exist in vault`,
        });
      }
    }
  }
  return issues;
}

/**
 * vault 漂移检查主入口。
 * @param {string} pluginRoot 插件仓根
 * @param {string} vaultRoot Obsidian vault 根
 * @param {{moc?:string|null, mirrorDir?:string, strict?:boolean}} options
 *        moc: 显式 MOC 相对路径；mirrorDir: 镜像目录相对路径；strict: warning 是否计为失败
 * @returns {{ok:boolean, pass:boolean, fatal:string|null, issues:Array, summary:object, mocFiles:string[]}}
 *          ok=false 表示检查未能执行（vault/MOC 缺失等致命问题）；pass 表示无阻断性漂移。
 */
export function checkVaultDrift(pluginRoot, vaultRoot, options = {}) {
  const mirrorDir = options.mirrorDir || DEFAULT_MIRROR_DIR;
  const strict = options.strict === true;

  if (!vaultRoot || !existsSync(vaultRoot) || !statSync(vaultRoot).isDirectory()) {
    return {
      ok: false,
      pass: false,
      fatal: `vault root not found or not a directory: ${vaultRoot || '(unset)'}`,
      issues: [],
      summary: {},
      mocFiles: [],
    };
  }

  const { files: mocFiles, missing: mocMissing } = findMocFiles(vaultRoot, options.moc ?? null);
  if (mocMissing) {
    return {
      ok: false,
      pass: false,
      fatal: options.moc
        ? `MOC file not found: ${options.moc}`
        : 'no MOC*.md index found at vault root (pass --moc <rel-path> to specify one)',
      issues: [],
      summary: {},
      mocFiles: [],
    };
  }

  const mirror = checkSkillMirror(pluginRoot, vaultRoot, mirrorDir);
  const linkIssues = checkMocLinks(vaultRoot, mocFiles);
  const issues = [...mirror.issues, ...linkIssues];

  const errors = issues.filter(issue => issue.severity === 'error').length;
  const warnings = issues.filter(issue => issue.severity === 'warning').length;
  const pass = strict ? issues.length === 0 : errors === 0;

  return {
    ok: true,
    pass,
    fatal: null,
    issues,
    summary: {
      errors,
      warnings,
      sourceFiles: mirror.sourceCount,
      mirroredFiles: mirror.mirroredCount,
      syncedFiles: mirror.syncedCount,
      mocCount: mocFiles.length,
      strict,
    },
    mocFiles,
  };
}
