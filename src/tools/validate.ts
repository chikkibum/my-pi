import { INVALID_JSON_KEY } from '../providers/openai-compat.ts';
import type { Tool } from '../types.ts';

const checks: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number',
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
  array: Array.isArray,
};

// Check model-supplied arguments against the tool's JSON Schema (top-level
// `required` and primitive `type`s). Returns an error message, or null if OK.
// Models can emit truncated or malformed arguments; better to tell them than run the tool.
export function validateArgs(tool: Tool, args: Record<string, unknown>): string | null {
  if (INVALID_JSON_KEY in args) return `arguments were not valid JSON: ${String(args[INVALID_JSON_KEY]).slice(0, 500)}`;

  const schema = tool.parameters as { properties?: Record<string, { type?: string }>; required?: string[] };
  for (const key of schema.required ?? []) {
    if (args[key] === undefined) return `missing required argument "${key}"`;
  }
  for (const [key, value] of Object.entries(args)) {
    const type = schema.properties?.[key]?.type;
    if (value !== undefined && type && checks[type] && !checks[type](value)) {
      return `argument "${key}" must be of type ${type}`;
    }
  }
  return null;
}
