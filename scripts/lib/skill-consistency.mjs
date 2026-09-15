// scripts/lib/skill-consistency.mjs
// `ssf doctor skills` 的事实核对引擎：CLI 源码是唯一事实源，本模块静态提取
// 子命令/flag/asset 白名单，再扫描 skills/**/*.md 中所有 `ssf ...` 调用，
// 检出文档引用了已删除/改名的命令、参数、资源，以及关键阈值（人工裁决次数、
// DP-5 尝试次数、状态名、执行模式）在文档与引擎间的漂移。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { EXECUTION_MODES, MAX_REPAIR_FAILURES } from './plan-shared.mjs';
import { MINIMUM_FAILED_ATTEMPTS } from './debug-attempts.mjs';

// 顶层 --help/--version 由 CLI 分发器处理，不属于任何子命令模块的 parseArgs。
const GLOBAL_FLAGS = new Set(['help', 'version']);
const NUMBER_WORDS = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five' };
const ORDINAL_WORDS = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth' };

/** 递归列出目录下全部指定后缀的文件。 */
function listFiles(directory, suffix, accumulator = []) {
  if (!existsSync(directory)) return accumulator;
  for (const entry of readdirSync(directory)) {
    const filePath = join(directory, entry);
    const metadata = statSync(filePath);
    if (metadata.isDirectory()) listFiles(filePath, suffix, accumulator);
    else if (entry.endsWith(suffix)) accumulator.push(filePath);
  }
  return accumulator;
}

/**
 * 从 CLI 源码提取事实目录：
 * - commands: 顶层命令 → 模块文件、二级子命令集合、parseArgs 声明的 flag 集合
 * - assetAllowlist: `ssf runtime asset read` 允许读取的资源路径
 * 解析失败不吞错——事实源本身损坏时调用方应当看到异常。
 */
export function extractCliCatalog(root) {
  const registryPath = join(root, 'scripts', 'spec-superflow.mjs');
  if (!existsSync(registryPath)) {
    throw new Error(`CLI registry not found: ${registryPath}`);
  }
  const registrySrc = readFileSync(registryPath, 'utf8');
  const commandEntryPattern = /^\s{2}'?([a-z][a-z0-9-]*)'?\s*:\s*\(\)\s*=>\s*import\('\.\/lib\/(cmd-[a-z0-9-]+)\.mjs'\)/gm;
  const commands = new Map();

  for (const match of registrySrc.matchAll(commandEntryPattern)) {
    const [, name, moduleName] = match;
    const modulePath = join(root, 'scripts', 'lib', `${moduleName}.mjs`);
    commands.set(name, {
      module: `${moduleName}.mjs`,
      subcommands: existsSync(modulePath) ? extractSubcommands(readFileSync(modulePath, 'utf8')) : new Set(),
      flags: collectModuleFlags(root, modulePath),
    });
  }

  const runtimeSource = existsSync(join(root, 'scripts', 'lib', 'cmd-runtime.mjs'))
    ? readFileSync(join(root, 'scripts', 'lib', 'cmd-runtime.mjs'), 'utf8')
    : '';
  const assetMatch = runtimeSource.match(/const\s+ASSETS\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
  const assetAllowlist = new Set(
    assetMatch ? [...assetMatch[1].matchAll(/'([^']+)'/g)].map(item => item[1]) : [],
  );

  return { commands, assetAllowlist };
}

/** 从模块源码提取二级子命令：SUBCOMMANDS/SUBS 数组字面量、=== 'x'、case 'x:'。 */
function extractSubcommands(source) {
  const names = new Set();
  // 形如 const SUBCOMMANDS = ['a', 'b'] / const KNOWN_SUBS = [...]
  for (const arrayMatch of source.matchAll(/(?:const|let)\s+\w*(?:SUB\w*|SUBS)\w*\s*=\s*\[([^\]]*)\]/g)) {
    for (const literal of arrayMatch[1].matchAll(/['"]([a-z][a-z0-9-]*)['"]/g)) names.add(literal[1]);
  }
  // subcommand === 'x' / sub === 'x' / positionals[0] === 'x' / case 'x':
  for (const compare of source.matchAll(/(?:subcommand|\bsub|positionals\[0\])\s*===\s*'([a-z][a-z0-9-]*)'/g)) {
    names.add(compare[1]);
  }
  for (const caseMatch of source.matchAll(/case\s+'([a-z][a-z0-9-]+)'\s*:/g)) names.add(caseMatch[1]);
  return names;
}

/**
 * 收集某个 cmd 模块实际接受的全部长 flag。四条来源：
 * 1. parseArgs 内联 options（允许一行多个键）；
 * 2. parseArgs 通过 `options: SOME_CONST` 引用的命名选项常量；
 * 3. 手工解析/usage 字符串中的 `--flag` 字面量（args.includes/indexOf/帮助文本）；
 * 4. 沿静态/动态 import 与 runScript 转发目标递归收集（如 runtime config
 *    转发 cmd-config、runtime guard 转发 scripts/guard/guard.mjs）。
 * 方向上宁可宽收集（多为合法 flag），避免把手工解析的合法 flag 误报为漂移。
 */
function collectModuleFlags(root, entryFile) {
  const flags = new Set();
  const visited = new Set();
  const queue = [entryFile];
  const scriptsRoot = join(root, 'scripts');

  while (queue.length > 0) {
    const filePath = queue.shift();
    if (!filePath || visited.has(filePath) || !existsSync(filePath)) continue;
    visited.add(filePath);
    const source = readFileSync(filePath, 'utf8');
    for (const flag of extractDeclaredFlags(source)) flags.add(flag);
    for (const literal of source.matchAll(/--([a-z][a-z0-9-]*)/g)) flags.add(literal[1]);
    for (const reference of referencedFiles(source)) {
      const candidate = reference.startsWith('scripts/')
        ? join(root, reference)
        : resolve(dirname(filePath), reference);
      // 只在仓库自己的 scripts/ 树内递归，防止越界与外部依赖扫描。
      if (candidate.startsWith(scriptsRoot + sep)) queue.push(candidate);
    }
  }
  return flags;
}

/** 提取源码引用的同仓脚本文件：静态 import、动态 import()、runScript('scripts/...')。 */
function referencedFiles(source) {
  const references = [];
  for (const match of source.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.[^'"]+\.mjs)['"]/g)) {
    references.push(match[1]);
  }
  for (const match of source.matchAll(/runScript\(\s*['"](scripts\/[^'"]+\.mjs)['"]/g)) {
    references.push(match[1]);
  }
  return references;
}

/** 提取单个文件内 parseArgs 声明的长选项（内联 options + 命名常量引用）。 */
function extractDeclaredFlags(source) {
  const flags = new Set();
  const optionKeyPattern = /'?([a-z][a-z0-9-]*)'?\s*:\s*\{\s*type:\s*'(?:string|boolean)'/g;
  for (const block of parseArgsBlocks(source)) {
    for (const option of block.matchAll(optionKeyPattern)) flags.add(option[1]);
    // options: SOME_NAMED_CONSTANT —— 回源码解析该常量的对象字面量。
    for (const named of block.matchAll(/options:\s*([A-Za-z_$][\w$]*)/g)) {
      const declaration = source.match(new RegExp(`(?:const|let)\\s+${named[1]}\\s*=\\s*\\{`));
      if (!declaration) continue;
      const objectBlock = sliceBalanced(source, source.indexOf('{', declaration.index), '{', '}');
      if (objectBlock) {
        for (const option of objectBlock.matchAll(optionKeyPattern)) flags.add(option[1]);
      }
    }
  }
  return flags;
}

/** 提取源码中每个 parseArgs(...) 调用的完整实参块（括号配平）。 */
function parseArgsBlocks(source) {
  const blocks = [];
  const anchor = /parseArgs\s*\(/g;
  let match;
  while ((match = anchor.exec(source))) {
    const openIndex = source.indexOf('(', match.index);
    const block = sliceBalanced(source, openIndex, '(', ')');
    if (block !== null) blocks.push(block);
  }
  return blocks;
}

/** 从 openIndex 处的开定界符配平截取到对应闭定界符（含两端）；配平失败返回 null。 */
function sliceBalanced(source, openIndex, open, close) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index++) {
    const char = source[index];
    if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return source.slice(openIndex, index + 1);
    }
  }
  return null;
}

/**
 * 解析一段 Markdown 中所有 `ssf ...` / `spec-superflow.mjs ...` 调用。
 * 支持反斜杠折行、单双引号值、<占位符>/[占位符]。返回带行号的调用描述，
 * 供上层逐个核对命令、子命令、flag 与 asset 路径。
 */
export function parseSkillInvocations(markdown) {
  // 先合并以反斜杠结尾的折行，保留逻辑行的起始行号。
  const rawLines = markdown.split(/\r?\n/);
  const logicalLines = [];
  for (let i = 0; i < rawLines.length; i++) {
    let text = rawLines[i];
    const line = i + 1;
    while (/\\\s*$/.test(text) && i + 1 < rawLines.length) {
      i++;
      text = `${text.replace(/\\\s*$/, ' ')}${rawLines[i].replace(/^\s+/, ' ')}`;
    }
    logicalLines.push({ text, line });
  }

  const invocations = [];
  for (const { text, line } of logicalLines) {
    for (const segment of extractInvocationSegments(text)) {
      const tokens = tokenize(segment.rest);
      const plain = tokens.filter(token => token.kind === 'plain').map(token => token.value);
      const flags = tokens.filter(token => token.kind === 'flag').map(token => token.value);
      // 形如 runtime asset read <path>：取 read 之后的第一个路径 token。
      let assetPath = null;
      if (plain[0] === 'runtime' && plain[1] === 'asset') {
        const readIndex = tokens.findIndex(token => token.kind === 'plain' && token.value === 'read');
        const afterRead = tokens[readIndex + 1];
        if (afterRead && afterRead.kind === 'positional') assetPath = afterRead.value;
      }
      invocations.push({
        line,
        command: plain[0] ?? null,
        subcommand: plain[1] ?? null,
        flags,
        assetPath,
        raw: segment.raw.trim(),
      });
    }
  }
  return invocations;
}

/**
 * 从一行 Markdown 中切出 `ssf ...` / `spec-superflow.mjs ...` 调用段。
 * 引号（单/双）内部的 ; | & 是参数内容，不作为命令分隔；反引号与换行始终终止。
 */
export function extractInvocationSegments(text) {
  const segments = [];
  const prefixPattern = /(?:\bssf\b|spec-superflow\.mjs['"]?)\s+/g;
  let match;
  while ((match = prefixPattern.exec(text))) {
    let quote = null;
    let index = prefixPattern.lastIndex;
    for (; index < text.length; index++) {
      const char = text[index];
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '`' || char === '\n') break;
      if (char === ';' || char === '|' || char === '&') break;
    }
    const rest = text.slice(prefixPattern.lastIndex, index);
    segments.push({ raw: text.slice(match.index, index), rest });
    prefixPattern.lastIndex = index;
  }
  return segments;
}

/** 词法切分：引号值、方括号/尖括号占位符、--flag、普通词与位置参数。 */
function tokenize(text) {
  const tokens = [];
  const pattern = /'[^']*'|"[^"]*"|\[[^\]]*\]|<[^>]*>|[^\s]+/g;
  for (const match of text.matchAll(pattern)) {
    let token = match[0];
    if (/^['"]/.test(token)) {
      tokens.push({ kind: 'positional', value: token.slice(1, -1) });
    } else if (token.startsWith('[') || token.startsWith('<')) {
      tokens.push({ kind: 'placeholder', value: token });
    } else if (token.startsWith('--')) {
      tokens.push({ kind: 'flag', value: token.slice(2).split('=')[0] });
    } else if (/^[a-z][a-z0-9-]*$/.test(token)) {
      tokens.push({ kind: 'plain', value: token });
    } else {
      tokens.push({ kind: 'positional', value: token });
    }
  }
  return tokens;
}

/**
 * 阈值契约：引擎常量变更后，对应 skill 文档必须同步。每条规则直接 import
 * 引擎中的真实常量，避免在检查器里维护第二份数字。
 * 返回每条规则的满足情况，供 checkSkillConsistency 汇总与单元测试断言。
 */
export function buildThresholdRules(root) {
  const read = relativePath => {
    const filePath = join(root, relativePath);
    return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  };
  // 数字/基数词/序数词 + 邻近语境词，防止 "3" 出现在无关句子里也算通过。
  const numberAlternatives = n => [String(n), NUMBER_WORDS[n], ORDINAL_WORDS[n]].filter(Boolean).join('|');
  const nearFailureContext = n =>
    new RegExp(`(?:${numberAlternatives(n)})\\w*[^.\\n]{0,70}(?:receipt|failure|attempt)`, 'i');
  const nearAttemptsContext = n =>
    new RegExp(`(?:${numberAlternatives(n)})\\w*[^.\\n]{0,70}attempts?`, 'i');

  const stateSource = existsSync(join(root, 'scripts', 'lib', 'cmd-state.mjs'))
    ? readFileSync(join(root, 'scripts', 'lib', 'cmd-state.mjs'), 'utf8')
    : '';
  const stateArray = stateSource.match(/VALID_STATES\s*=\s*\[([\s\S]*?)\]/);
  const states = stateArray
    ? [...stateArray[1].matchAll(/'([a-z][a-z0-9-]+)'/g)].map(item => item[1])
    : [];

  const workflowStart = read('skills/workflow-start/SKILL.md');
  const buildExecutor = read('skills/build-executor/SKILL.md');
  const bugInvestigator = read('skills/bug-investigator/SKILL.md');

  return [
    {
      concept: 'repair/adjudication failure threshold',
      value: MAX_REPAIR_FAILURES,
      file: 'skills/build-executor/SKILL.md',
      satisfied: nearFailureContext(MAX_REPAIR_FAILURES).test(buildExecutor),
    },
    {
      concept: 'DP-5 minimum failed attempts',
      value: MINIMUM_FAILED_ATTEMPTS,
      file: 'skills/bug-investigator/SKILL.md',
      satisfied: nearAttemptsContext(MINIMUM_FAILED_ATTEMPTS).test(bugInvestigator),
    },
    {
      concept: 'all eight workflow states named in routing skill',
      value: states.join(','),
      file: 'skills/workflow-start/SKILL.md',
      satisfied: states.length > 0 && states.every(state => new RegExp(`\\b${state.replace(/-/g, '\\-')}\\b`).test(workflowStart)),
    },
    {
      concept: 'all execution modes documented in build-executor',
      value: EXECUTION_MODES.join(','),
      file: 'skills/build-executor/SKILL.md',
      satisfied: EXECUTION_MODES.every(mode => new RegExp(`\\b${mode.replace(/-/g, '\\-')}\\b`).test(buildExecutor)),
    },
  ];
}

/**
 * 主检查入口：扫描 root 下全部 skill 文档，返回 { pass, message, issues }。
 * issues 每项：{ kind, file, line, detail }，kind 取值：
 * unknown-command / unknown-subcommand / unknown-flag /
 * asset-not-allowlisted / asset-missing / script-missing / threshold-drift
 */
export function checkSkillConsistency(root) {
  const issues = [];
  const catalog = extractCliCatalog(root);
  const skillFiles = listFiles(join(root, 'skills'), '.md');

  let referenceCount = 0;
  for (const filePath of skillFiles) {
    const relativeFile = filePath.replace(`${root}\\`, '').replace(`${root}/`, '').replace(/\\/g, '/');
    const content = readFileSync(filePath, 'utf8');
    const invocations = parseSkillInvocations(content);
    referenceCount += invocations.length;

    for (const invocation of invocations) {
      const prefix = `${relativeFile}:${invocation.line}`;
      const moduleEntry = invocation.command ? catalog.commands.get(invocation.command) : null;
      if (!invocation.command || !moduleEntry) {
        issues.push({ kind: 'unknown-command', file: relativeFile, line: invocation.line, detail: `unknown command '${invocation.command}' in: ${invocation.raw}` });
        continue;
      }
      // 模块声明了二级子命令时，第一个普通词必须命中（值/路径不会是纯小写短词）。
      if (invocation.subcommand && moduleEntry.subcommands.size > 0
        && !moduleEntry.subcommands.has(invocation.subcommand)) {
        issues.push({ kind: 'unknown-subcommand', file: relativeFile, line: invocation.line, detail: `'${invocation.command} ${invocation.subcommand}' is not a valid subcommand in: ${invocation.raw}` });
      }
      for (const flag of invocation.flags) {
        if (!GLOBAL_FLAGS.has(flag) && !moduleEntry.flags.has(flag)) {
          issues.push({ kind: 'unknown-flag', file: relativeFile, line: invocation.line, detail: `'--${flag}' is not declared by cmd module '${moduleEntry.module}' in: ${invocation.raw}` });
        }
      }
      if (invocation.command === 'runtime' && invocation.assetPath) {
        if (!catalog.assetAllowlist.has(invocation.assetPath)) {
          issues.push({ kind: 'asset-not-allowlisted', file: relativeFile, line: invocation.line, detail: `runtime asset '${invocation.assetPath}' is not in the ASSETS allowlist` });
        } else if (!existsSync(join(root, invocation.assetPath))) {
          issues.push({ kind: 'asset-missing', file: relativeFile, line: invocation.line, detail: `allowlisted asset '${invocation.assetPath}' does not exist on disk` });
        }
      }
    }

    // 反引号包裹的 scripts/<name> 引用必须指向真实脚本（含 task-brief 这类无扩展名入口）。
    for (const scriptRef of content.matchAll(/`(scripts\/[a-z0-9][-a-z0-9./]*[a-z0-9])/g)) {
      const scriptPath = scriptRef[1].split(/\s+/)[0];
      if (!existsSync(join(root, scriptPath))) {
        issues.push({ kind: 'script-missing', file: relativeFile, line: 0, detail: `references '${scriptPath}' which does not exist` });
      }
    }
  }

  for (const rule of buildThresholdRules(root)) {
    if (!rule.satisfied) {
      issues.push({ kind: 'threshold-drift', file: rule.file, line: 0, detail: `${rule.concept} (engine value: ${rule.value}) is not reflected in this document` });
    }
  }

  const pass = issues.length === 0;
  const message = pass
    ? `${skillFiles.length} skill files scanned, ${referenceCount} command references consistent with the CLI`
    : `${skillFiles.length} skill files scanned, ${referenceCount} references, ${issues.length} inconsistency(ies): ${issues.slice(0, 3).map(issue => issue.detail).join('; ')}${issues.length > 3 ? `; (+${issues.length - 3} more)` : ''}`;
  return { pass, message, issues };
}
