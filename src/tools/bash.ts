import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Tool } from '../types.ts';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 30_000;

// Locate a bash executable. On Windows that means Git Bash; System32\bash.exe
// is WSL, which runs in a different filesystem, so it is deliberately skipped.
function findBash(): string | null {
  if (process.env.MYPI_BASH) return process.env.MYPI_BASH;
  if (process.platform !== 'win32') return existsSync('/bin/bash') ? '/bin/bash' : null;

  const candidates = [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe'),
  ];
  // Derive from wherever git.exe lives (…\Git\cmd\git.exe -> …\Git\bin\bash.exe).
  const where = spawnSync('where', ['git'], { encoding: 'utf-8' });
  for (const gitPath of where.stdout?.split(/\r?\n/).filter(Boolean) ?? []) {
    candidates.push(join(dirname(dirname(gitPath)), 'bin', 'bash.exe'));
  }
  return candidates.find((p) => existsSync(p)) ?? null;
}

const bashPath = findBash();

function killTree(pid: number | undefined) {
  if (!pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F']);
  else process.kill(-pid, 'SIGKILL');
}

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  const half = MAX_OUTPUT_CHARS / 2;
  return `${text.slice(0, half)}\n... (${text.length - MAX_OUTPUT_CHARS} chars truncated) ...\n${text.slice(-half)}`;
}

export const bashTool: Tool = {
  name: 'bash',
  description:
    `Executes a shell command in the current working directory (${bashPath ? 'bash' : 'the system default shell'}) ` +
    'and returns combined stdout/stderr plus the exit code. Use it to list, search, run builds and tests, use git, etc. ' +
    'Commands are non-interactive; do not start servers or watchers that never exit.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to run' },
      timeout_ms: { type: 'integer', description: `Kill the command after this many ms (default ${DEFAULT_TIMEOUT_MS})` },
    },
    required: ['command'],
  },
  execute(args) {
    const command = String(args.command);
    const timeoutMs = Number(args.timeout_ms ?? DEFAULT_TIMEOUT_MS);

    return new Promise((resolve) => {
      const child = bashPath
        ? spawn(bashPath, ['-c', command], { cwd: process.cwd(), detached: process.platform !== 'win32' })
        : spawn(command, { cwd: process.cwd(), shell: true, detached: process.platform !== 'win32' });

      let output = '';
      let timedOut = false;
      child.stdout.on('data', (d) => (output += d));
      child.stderr.on('data', (d) => (output += d));
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child.pid);
      }, timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve(`Failed to start shell: ${err.message}`);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const status = timedOut ? `timed out after ${timeoutMs}ms` : `exit code ${code}`;
        resolve(`${truncate(output.trimEnd()) || '(no output)'}\n[${status}]`);
      });
    });
  },
};
