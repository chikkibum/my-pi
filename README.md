# my-pi

A minimal AI coding agent (a tiny Claude Code / Pi) built from scratch in TypeScript: a provider-agnostic streaming layer, a handful of tools, and an agentic loop.

## Setup

1. Put a key in `.env` (in this folder; it's loaded from here no matter where you run `mypi`):
   - `ANTHROPIC_API_KEY` for the default `anthropic` provider (or skip it if you've run `ant auth login`)
   - `GROQ_API_KEY` for the free-tier `groq` provider
   - `OPENROUTER_API_KEY` for `openrouter`
2. Already done in this checkout: `npm install` and `npm link` (puts `mypi` on your PATH).

## Usage

```sh
mypi -p "add a --verbose flag to src/cli.ts"     # one task, then exit
mypi                                            # interactive; /clear resets, /exit quits, Ctrl+C cancels a task
mypi --provider groq -p "explain this repo"     # free tier
mypi -m claude-sonnet-5-5 -p "..."              # pick a model
```

Defaults: `anthropic` → `claude-opus-5-5`, `groq` → `qwen/qwen3-32b`, `openrouter` → `qwen/qwen3-coder`. Other settings are in `.env.example`.

## Layout

```
bin/mypi.js                 global entry; runs src/ through tsx (no build step)
src/main.ts                 CLI args, terminal output, interactive mode
src/env.ts                  loads .env from the harness folder
src/types.ts                unified Message / ContentBlock / Tool / Provider types
src/providers/anthropic.ts  native Anthropic SDK streaming
src/providers/openai-compat.ts  any OpenAI-compatible API (Groq, OpenRouter, ...)
src/providers/index.ts      provider registry: getProvider(name)
src/tools/                  read, write, edit, bash (+ argument validation, path guard)
src/agent/loop.ts           runAgent: call model → run tools → feed results back → repeat
```

## Extending

- **New tool:** add a file in `src/tools/` exporting a `Tool` (name, description, JSON Schema `parameters`, `execute`) and list it in `src/tools/index.ts`. You can ask mypi to do this itself.
- **New OpenAI-compatible provider:** add an entry to `src/providers/index.ts` with its base URL, key variable and default model.

## Notes

- File tools only touch paths inside the current directory. `bash` is unrestricted (it's a shell), so run mypi in directories you're happy for it to change.
- On Windows, `bash` uses Git Bash (`MYPI_BASH` overrides the path).
- Anthropic requests enable prompt caching and server-side refusal fallback (`fallbacks: "default"`), and replay thinking blocks unchanged as the API requires.
