import { HARNESS_ROOT } from './env.ts';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { runAgent } from './agent/loop.ts';
import { getProvider, providerNames } from './providers/index.ts';
import { tools } from './tools/index.ts';
import type { AgentEvent, Message, Provider } from './types.ts';

const HELP = `mypi - a minimal AI coding agent

Usage:
  mypi -p "<task>"          run one task and exit
  mypi                      interactive mode (type /exit to quit, /clear to reset)

Options:
  -p, --prompt <text>       the task
      --provider <name>     ${providerNames.join(' | ')} (default: $MYPI_PROVIDER or anthropic)
  -m, --model <id>          override the provider's default model
      --max-turns <n>       stop after n model calls per task (default 200)
  -h, --help                show this help
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    prompt: { type: 'string', short: 'p' },
    provider: { type: 'string', default: process.env.MYPI_PROVIDER ?? 'anthropic' },
    model: { type: 'string', short: 'm' },
    'max-turns': { type: 'string', default: '200' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

const ENV_HINT = `API keys are read from ${join(HARNESS_ROOT, '.env')}`;

let provider: Provider;
try {
  provider = getProvider(values.provider!);
} catch (err) {
  console.error(`\x1b[31mError: ${err instanceof Error ? err.message : String(err)}\x1b[0m\n${ENV_HINT}`);
  process.exit(1);
}
const model = values.model ?? provider.defaultModel;
const maxTurns = Number(values['max-turns']);

const system = `You are mypi, an AI coding agent running in the user's terminal.
You can read, write and edit files and run shell commands with your tools. Work in the current directory.
Investigate before changing things: read the relevant files first. Prefer small, targeted edits over rewriting whole files.
After making changes, verify them (run the build, tests or the program) when that's possible.
Keep replies short; the user sees your tool calls as they happen.

Environment:
- Working directory: ${process.cwd()}
- Platform: ${process.platform}
- Date: ${new Date().toISOString().slice(0, 10)}`;

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

// Track whether the cursor sits at the start of a line, so log lines never
// get glued onto the end of streamed text.
let atLineStart = true;
function write(s: string) {
  if (!s) return;
  process.stdout.write(s);
  atLineStart = s.endsWith('\n');
}
function line(s: string) {
  write(`${atLineStart ? '' : '\n'}${s}\n`);
}

function preview(args: Record<string, unknown>): string {
  const text = Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ');
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function onEvent(event: AgentEvent) {
  switch (event.type) {
    case 'text_delta':
      write(event.delta);
      break;
    case 'tool_start':
      line(c.cyan(`● ${event.call.name}(${preview(event.call.arguments)})`));
      break;
    case 'tool_end': {
      const lines = event.result.split('\n').length;
      if (event.isError) line(c.red(`  ⎿ error: ${event.result.split('\n')[0].slice(0, 200)}`));
      else line(c.green(`  ⎿ ok · ${lines} line${lines === 1 ? '' : 's'}`));
      break;
    }
    case 'turn_end': {
      const { usage, stopReason } = event.message;
      line(c.dim(`[${provider.name}/${model} · in ${usage.input} · out ${usage.output} · ${stopReason}]`));
      break;
    }
  }
}

async function runTask(messages: Message[], prompt: string, signal?: AbortSignal) {
  messages.push({ role: 'user', content: prompt });
  const result = await runAgent({ provider, model, system, tools, messages, maxTurns, signal, onEvent });
  if (result.hitMaxTurns) line(c.red(`Stopped after ${maxTurns} turns (raise with --max-turns).`));
  if (result.message.stopReason === 'refusal') line(c.red('The model declined to continue.'));
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const prompt = values.prompt ?? (positionals.length ? positionals.join(' ') : undefined);

if (prompt) {
  try {
    await runTask([], prompt);
  } catch (err) {
    line(c.red(`Error: ${describeError(err)}`));
    line(c.dim(ENV_HINT));
    process.exitCode = 1;
  }
} else {
  // Interactive mode: one conversation across many prompts.
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let messages: Message[] = [];
  let running: AbortController | null = null;

  // Ctrl+C cancels the task in progress; at the prompt it exits.
  rl.on('SIGINT', () => {
    if (running) running.abort();
    else rl.close();
  });
  rl.on('close', () => process.exit(0));

  line(c.dim(`mypi · ${provider.name}/${model} · ${process.cwd()}`));
  line(c.dim('Type a task. /clear resets the conversation, /exit quits, Ctrl+C cancels a running task.'));

  while (true) {
    const input = (await rl.question('\n> ')).trim();
    if (!input) continue;
    if (input === '/exit' || input === '/quit') break;
    if (input === '/clear') {
      messages = [];
      line(c.dim('Conversation cleared.'));
      continue;
    }

    running = new AbortController();
    try {
      await runTask(messages, input, running.signal);
    } catch (err) {
      line(c.red(running.signal.aborted ? 'Cancelled.' : `Error: ${describeError(err)}`));
    } finally {
      running = null;
    }
  }
  rl.close();
}
