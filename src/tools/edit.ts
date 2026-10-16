import { readFileSync, writeFileSync } from 'node:fs';
import type { Tool } from '../types.ts';
import { resolveInCwd } from './paths.ts';

export const editTool: Tool = {
  name: 'edit',
  description:
    'Replaces exactly one occurrence of old_string with new_string in a file. ' +
    'old_string must match the file exactly (including whitespace) and be unique; include surrounding lines to make it unique. ' +
    'Read the file first.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file relative to the current working directory' },
      old_string: { type: 'string', description: 'Exact text to replace' },
      new_string: { type: 'string', description: 'Replacement text' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  async execute(args) {
    const target = resolveInCwd(args.path);
    const oldString = String(args.old_string);
    const newString = String(args.new_string);
    if (!oldString) throw new Error('old_string must not be empty; use the write tool to create files');

    const text = readFileSync(target, 'utf-8');
    const count = text.split(oldString).length - 1;
    if (count === 0) throw new Error(`old_string not found in ${args.path}`);
    if (count > 1) throw new Error(`old_string occurs ${count} times in ${args.path}; add context to make it unique`);

    // Function replacer so `$&` and friends in new_string are taken literally.
    writeFileSync(target, text.replace(oldString, () => newString), 'utf-8');
    return `Edited ${args.path}`;
  },
};
