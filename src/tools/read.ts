import { readFileSync } from 'node:fs';
import type { Tool } from '../types.ts';
import { resolveInCwd } from './paths.ts';

const MAX_LINES = 2000;

export const readTool: Tool = {
  name: 'read',
  description:
    'Reads a text file and returns its contents with line numbers. ' +
    `Returns at most ${MAX_LINES} lines; use offset/limit to page through larger files.`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file relative to the current working directory' },
      offset: { type: 'integer', description: '1-based line to start from (default 1)' },
      limit: { type: 'integer', description: `Maximum number of lines to return (default ${MAX_LINES})` },
    },
    required: ['path'],
  },
  async execute(args) {
    const lines = readFileSync(resolveInCwd(args.path), 'utf-8').split(/\r?\n/);
    const start = Math.max(1, Number(args.offset ?? 1));
    const limit = Math.min(MAX_LINES, Math.max(1, Number(args.limit ?? MAX_LINES)));
    const slice = lines.slice(start - 1, start - 1 + limit);
    const body = slice.map((line, i) => `${String(start + i).padStart(5)}  ${line}`).join('\n');
    const end = start - 1 + slice.length;
    return end < lines.length ? `${body}\n... (${lines.length - end} more lines; continue with offset=${end + 1})` : body;
  },
};
