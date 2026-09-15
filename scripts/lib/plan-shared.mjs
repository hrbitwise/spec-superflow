// scripts/lib/plan-shared.mjs
// execution-plan 各子模块共享的常量与纯工具函数。无模块间依赖，位于依赖图最底层。
import { randomUUID } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';

export const EXECUTION_MODES = ['inline', 'batch-inline', 'sdd'];

export const REVIEW_STATUSES = new Set(['pass', 'fail']);
export const MAX_REPAIR_FAILURES = 3;

/** 校验值是否为合法时间戳字符串（非空且可被 Date.parse 解析）。 */
export function isValidTimestamp(value) {
  return isNonEmptyText(value) && !Number.isNaN(Date.parse(value));
}

/** 确定性 JSON 序列化（键排序 + 循环引用检测），用于 plan 内容 hash。 */
export function stableJson(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (seen.has(value)) throw new Error('circular plan data');
  seen.add(value);
  if (Array.isArray(value)) {
    const result = `[${value.map(item => stableJson(item, seen)).join(',')}]`;
    seen.delete(value);
    return result;
  }
  const result = `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key], seen)}`).join(',')}}`;
  seen.delete(value);
  return result;
}

/** 就地更新或追加 state 文件中的单个字段行。 */
export function setStateField(content, field, value) {
  const line = `${field}: ${value}`;
  const expression = new RegExp(`^${field}:\\s*.*$`, 'm');
  return expression.test(content)
    ? content.replace(expression, line)
    : `${content.replace(/\n*$/, '\n')}\n${line}\n`;
}

/** 原子写入：先写临时文件再 rename，避免半截文件。 */
export function atomicWrite(targetPath, content) {
  const tempPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tempPath, content, 'utf8');
  renameSync(tempPath, targetPath);
}

/** 校验值是否为非数组的纯对象。 */
export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 校验值是否为去空白后非空的字符串。 */
export function isNonEmptyText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 校验值是否为 null 或 sha256: 前缀的 hash 字符串。 */
export function isNullableHash(value) {
  return value === null || (typeof value === 'string' && value.startsWith('sha256:'));
}

/** 断言字段为非空字符串，否则抛出带字段名的错误。 */
export function requireText(value, field) {
  if (!isNonEmptyText(value)) throw new Error(`${field} is required`);
}

/** 将任意 id 转为文件系统安全的文件名（base64url 编码）。 */
export function safeFileName(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}
