import Anthropic from '@anthropic-ai/sdk';
import type {
  AssistantMessage,
  ContentBlock,
  Message,
  Provider,
  StopReason,
  StreamEvent,
  StreamOptions,
  Tool,
} from '../types.ts';

type ParamBlock = Anthropic.Beta.BetaContentBlockParam;

// High enough that a big file written through a tool call isn't cut off mid-JSON.
const MAX_TOKENS = Number(process.env.MYPI_MAX_TOKENS ?? 64000);
// low | medium | high | xhigh | max, or "none" to leave it to the model default.
const EFFORT = process.env.MYPI_EFFORT ?? 'high';
// The SDK can fail to parse a streamed tool input; re-issue the turn this many times.
const PARSE_RETRIES = 2;

// Unified history -> Anthropic MessageParam[].
function toAnthropic(messages: Message[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      if (m.provider === 'anthropic' && Array.isArray(m.raw)) {
        // Replay Anthropic's own blocks verbatim (keeps thinking blocks valid).
        out.push({ role: 'assistant', content: m.raw as ParamBlock[] });
        continue;
      }
      const content: ParamBlock[] = [];
      for (const b of m.content) {
        if (b.type === 'text' && b.text) content.push({ type: 'text', text: b.text });
        if (b.type === 'tool_call') content.push({ type: 'tool_use', id: b.id, name: b.name, input: b.arguments });
      }
      if (content.length) out.push({ role: 'assistant', content });
    } else {
      // Tool results travel as user content blocks. All results for one
      // assistant turn must sit in a single user message.
      const block: ParamBlock = {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content || '(no output)',
        is_error: m.isError,
      };
      const prev = out[out.length - 1];
      if (prev?.role === 'user' && Array.isArray(prev.content) && prev.content.every((c) => c.type === 'tool_result')) {
        prev.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
    }
  }
  return out;
}

function toAnthropicTools(tools: Tool[]): Anthropic.Beta.BetaTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema,
    // Stream big inputs (file contents) as they're generated. The server no
    // longer validates them, so the agent loop validates before executing.
    eager_input_streaming: true,
  }));
}

function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'length';
    case 'refusal':
      return 'refusal';
    default:
      return 'stop';
  }
}

export function createAnthropicProvider(apiKey = process.env.ANTHROPIC_API_KEY): Provider {
  // With no key the SDK falls back to ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile.
  const client = new Anthropic(apiKey ? { apiKey } : {});

  async function* stream(opts: StreamOptions): AsyncGenerator<StreamEvent> {
    for (let attempt = 0; ; attempt++) {
      const s = client.beta.messages.stream(
        {
          model: opts.model,
          max_tokens: MAX_TOKENS,
          system: opts.system,
          messages: toAnthropic(opts.messages),
          tools: opts.tools?.length ? toAnthropicTools(opts.tools) : undefined,
          ...(EFFORT !== 'none' && { output_config: { effort: EFFORT as Anthropic.Beta.BetaOutputConfig['effort'] } }),
          // Cache the growing history; each agent turn resends all of it.
          cache_control: { type: 'ephemeral' },
          // If the model declines for policy reasons, let the API retry on its default fallback model.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { signal: opts.signal },
      );

      for await (const event of s) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text_delta', delta: event.delta.text };
        }
      }

      let final: Anthropic.Beta.BetaMessage;
      try {
        final = await s.finalMessage();
      } catch (err) {
        // API errors are real failures; anything else is an unparseable tool input.
        if (err instanceof Anthropic.APIError || attempt >= PARSE_RETRIES) throw err;
        yield { type: 'text_delta', delta: '\n[tool input was not valid JSON, retrying turn]\n' };
        continue;
      }

      const content: ContentBlock[] = [];
      for (const b of final.content) {
        if (b.type === 'text') content.push({ type: 'text', text: b.text });
        else if (b.type === 'tool_use') {
          content.push({ type: 'tool_call', id: b.id, name: b.name, arguments: (b.input ?? {}) as Record<string, unknown> });
        }
      }

      const message: AssistantMessage = {
        role: 'assistant',
        content,
        usage: {
          // input_tokens excludes cached tokens; count everything the model read.
          input:
            final.usage.input_tokens +
            (final.usage.cache_read_input_tokens ?? 0) +
            (final.usage.cache_creation_input_tokens ?? 0),
          output: final.usage.output_tokens,
        },
        stopReason: mapStopReason(final.stop_reason),
        provider: 'anthropic',
        raw: final.content,
      };
      yield { type: 'done', message };
      return;
    }
  }

  return { name: 'anthropic', defaultModel: 'claude-opus-5-5', stream };
}
