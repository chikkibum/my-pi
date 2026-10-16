import { isAbsolute, relative, resolve } from 'node:path';

// Resolve a model-supplied path against the working directory and refuse
// anything that escapes it (`..`, absolute paths elsewhere on disk).
export function resolveInCwd(path: unknown): string {
  if (typeof path !== 'string' || !path) throw new Error('path must be a non-empty string');
  const root = process.cwd();
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`path "${path}" is outside the working directory ${root}`);
  }
  return target;
}
