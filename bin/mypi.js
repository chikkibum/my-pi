#!/usr/bin/env node
// Global entry point (`npm link` puts `mypi` on PATH). Runs the TypeScript
// sources directly through tsx, so edits to src/ apply without a build step.
import { register } from 'tsx/esm/api';

register();
await import('../src/main.ts');
