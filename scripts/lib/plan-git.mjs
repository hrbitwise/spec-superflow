// scripts/lib/plan-git.mjs
// review receipt 的 Git 证明边界：range 校验（含进程内缓存单例）、head 分支保护、
// 隔离 worktree 越界 WARN、worktree 列表解析与路径规范化。仅依赖 Node 内置模块。
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';

// Protected branches that review receipts must never certify directly. A head
// commit contained only by these branches means the work was committed straight
// onto the trunk instead of through an isolate-created branch.
const PROTECTED_BRANCHES = new Set(['main', 'master']);
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i;
const defaultGitRangeValidator = createGitRangeValidator();

/** 用进程内默认单例校验 review range（base/head 为完整 commit ID 且 base 是 head 祖先）。 */
export function validateReviewRange(changeDir, base, head) {
  return defaultGitRangeValidator.validate(changeDir, base, head);
}

/**
 * Builds the internal Git proof boundary used by execution-plan validation.
 * The cache is intentionally process-local and only trusts complete immutable
 * commit IDs. Mutable revision inputs must be resolved on every call.
 */
export function createGitRangeValidator(runGit = defaultRunGit) {
  const rootsByChangeDir = new Map();
  const commitsByRepository = new Map();
  const verifiedRanges = new Map();

  function getGitRoot(changeDir, cacheable) {
    const changeKey = resolve(changeDir);
    if (cacheable && rootsByChangeDir.has(changeKey)) return rootsByChangeDir.get(changeKey);
    let gitRoot;
    try {
      gitRoot = runGit(['-C', changeDir, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      throw new Error('Review receipts require the change directory to be inside a Git work tree');
    }
    if (cacheable) rootsByChangeDir.set(changeKey, gitRoot);
    return gitRoot;
  }

  function resolveCommit(gitRoot, revision, field, cacheable) {
    const cacheKey = `${gitRoot}\u0000${revision}`;
    if (cacheable && commitsByRepository.has(cacheKey)) return commitsByRepository.get(cacheKey);
    let resolved;
    try {
      resolved = runGit(['-C', gitRoot, 'rev-parse', '--verify', `${revision}^{commit}`], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      throw new Error(`Review receipt ${field} must name an existing Git commit`);
    }
    if (cacheable) commitsByRepository.set(cacheKey, resolved);
    return resolved;
  }

  return {
    validate(changeDir, base, head) {
      const cacheable = FULL_COMMIT_SHA.test(base) && FULL_COMMIT_SHA.test(head);
      const gitRoot = getGitRoot(changeDir, cacheable);
      const resolvedBase = resolveCommit(gitRoot, base, 'base', cacheable);
      const resolvedHead = resolveCommit(gitRoot, head, 'head', cacheable);
      const rangeKey = `${gitRoot}\u0000${resolvedBase}\u0000${resolvedHead}`;
      if (cacheable && verifiedRanges.has(rangeKey)) {
        const cached = verifiedRanges.get(rangeKey);
        if (cached === null) throw new Error('Review receipt base must be an ancestor of head');
        return cached;
      }
      try {
        runGit(['-C', gitRoot, 'merge-base', '--is-ancestor', resolvedBase, resolvedHead], { stdio: 'ignore' });
      } catch {
        if (cacheable) verifiedRanges.set(rangeKey, null);
        throw new Error('Review receipt base must be an ancestor of head');
      }
      const result = { base: resolvedBase, head: resolvedHead };
      if (cacheable) verifiedRanges.set(rangeKey, result);
      return result;
    },
  };
}

/** 默认 git 执行器：同步执行 git CLI。 */
function defaultRunGit(args, options) {
  return execFileSync('git', args, options);
}

/**
 * R4: head 只被 protected 分支（main/master）包含时，拒绝 review receipt。
 * 验证使用 `git branch --contains`：结果含任一非 protected 分支（含隔离分支
 * 已 merge 回主干、head 同时被 main 与隔离分支包含的场景）即放行。此步骤在
 * 写 receipt 之前执行，拒绝时不写入任何 receipt 文件。git root 解析失败时
 * 抛出明确错误（review-findings-fix R4）：静默 return 等于绕过安全校验。
 */
export function assertReviewHeadBranch(changeDir, head, runGit = defaultRunGit) {
  let gitRoot;
  try {
    gitRoot = runGit(['-C', changeDir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (error) {
    throw new Error(`Review head branch verification cannot resolve the git root for '${changeDir}': ${error.message}`);
  }
  let output;
  try {
    output = runGit(['-C', gitRoot, 'branch', '--contains', head, '--format=%(refname:short)'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (error) {
    throw new Error(`Review head branch verification failed for commit ${head}: ${error.message}`);
  }
  const branches = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (branches.length === 0) return;
  if (branches.every(branch => PROTECTED_BRANCHES.has(branch))) {
    throw new Error(`Review head commit ${head} is only contained by protected branch(es): ${branches.join(', ')}; review requires a commit on a non-protected isolated branch`);
  }
}

/**
 * R5: change 存在隔离 worktree 且进程 cwd 不在该 worktree 内时，输出一行含
 * worktree 绝对路径的 WARN（不阻断命令）。change 无隔离 worktree 时不输出。
 * 隔离 worktree 按 change 目录名命名（isolate 创建的分支名 = change-name）。
 * git root / worktree 列表解析失败时（review-findings-fix R5）输出解析失败
 * 原因的 WARN，而非静默返回。
 */
export function warnIfCwdOutsideIsolation(changeDir) {
  const name = basename(resolve(changeDir));
  let gitRoot;
  try {
    gitRoot = execFileSync('git', ['-C', changeDir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (error) {
    process.stderr.write(`WARN: 无法确认进程 cwd 是否在隔离 worktree 内——git root 解析失败：${error.message}\n`);
    return;
  }
  let entries;
  try {
    entries = parseWorktreeEntries(execFileSync('git', ['-C', gitRoot, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim());
  } catch (error) {
    process.stderr.write(`WARN: 无法确认进程 cwd 是否在隔离 worktree 内——git worktree list 失败：${error.message}\n`);
    return;
  }
  const entry = entries.find(item => item.branch === `refs/heads/${name}`);
  if (!entry) return;
  if (isSubpath(entry.path, process.cwd())) return;
  process.stdout.write(
    `WARN: 进程 cwd（${process.cwd()}）不在隔离 worktree 内。worktree 绝对路径：${entry.path}；` +
    '实现编辑必须使用 worktree 内路径，或每条命令以前缀 `cd <worktree> &&` 开头。\n'
  );
}

// 解析 `git worktree list --porcelain`：返回 [{ path, branch }]。
function parseWorktreeEntries(output) {
  const entries = [];
  for (const block of output.split(/\n[ \t]*\n/)) {
    const lines = block.split('\n').map(line => line.trim());
    if (!lines[0]) continue;
    const entry = { path: null, branch: null };
    for (const line of lines) {
      if (line.startsWith('worktree ')) entry.path = resolve(line.slice('worktree '.length));
      else if (line.startsWith('branch ')) entry.branch = line.slice('branch '.length);
    }
    if (entry.path) entries.push(entry);
  }
  return entries;
}

// 规范化路径：realpath 解析 8.3 短名/junction，失败时退化为 resolve。
// 必须用 native 版本：JS 版 realpathSync 无法解析 8.3 短名组件，CI
// Windows runner 的 TEMP 是 C:\Users\RUNNER~1\... 短名形式，与 git
// worktree list 输出的长路径比较会误报 R5 越界 WARN。
function normalizedPath(p) {
  try {
    return realpathSync.native(p);
  } catch {
    return resolve(p);
  }
}

// child 是否位于 parent 内（大小写不敏感，兼容 Windows 盘符）。
// 导出供测试验证 8.3 短路径兼容性（path-normalization.test.mjs）。
export function isSubpath(parent, child) {
  const p = normalizedPath(parent).toLowerCase();
  const c = normalizedPath(child).toLowerCase();
  return c === p || c.startsWith(`${p}${sep}`);
}
