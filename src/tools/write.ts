import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Tool } from '../types.ts';
import { resolveInCwd } from './paths.ts';

export const writeTool: Tool = {
  name: 'write',
  description: 'Creates or overwrites a file with the given content. Parent directories are created as needed.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file relative to the current working directory' },
      content: { type: 'string', description: 'The full content to write' },
    },
    required: ['path', 'content'],
  },
  async execute(args) {
    const target = resolveInCwd(args.path);
    const content = String(args.content);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf-8');
    return `Wrote ${content.split('\n').length} lines to ${args.path}`;
  },
};
