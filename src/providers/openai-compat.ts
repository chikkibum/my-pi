import OpenAI from 'openai';
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

export interface OpenAICompatConfig {
  name: string;
  baseURL: string;
  // Name of the environment variable holding the key (set it in the harness .env).
  apiKeyEnv: string;
  defaultModel: string;
}

// Marker the agent loop recognises when a model emitted unparseable arguments.
export const INVALID_JSON_KEY = '__invalid_json';

function toOpenAI(messages: Message[], system?: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const text = m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      const toolCalls = m.content.flatMap((b) =>
        b.type === 'tool_call'
          ? [{
              id: b.id,
              type: 'function' as const,
              function: {
                name: b.name,
                // Send unparseable arguments back exactly as the model wrote them.
                arguments: INVALID_JSON_KEY in b.arguments ? String(b.arguments[INVALID_JSON_KEY]) : JSON.stringify(b.arguments),
              },
            }]
          : [],
      );
      out.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length && { tool_calls: toolCalls }),
      });
    } else {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content || '(no output)' });
    }
  }
  return out;
}

function toOpenAITools(tools: Tool[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { [INVALID_JSON_KEY]: raw };
  } catch {
    return { [INVALID_JSON_KEY]: raw };
  }
}

export function createOpenAICompatProvider(config: OpenAICompatConfig): Provider {
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) throw new Error(`${config.apiKeyEnv} is not set (needed for the ${config.name} provider)`);
  const client = new OpenAI({ baseURL: config.baseURL, apiKey });

  async function* stream(opts: StreamOptions): AsyncGenerator<StreamEvent> {
    const response = await client.chat.completions.create(
      {
        model: opts.model,
        messages: toOpenAI(opts.messages, opts.system),
        tools: opts.tools?.length ? toOpenAITools(opts.tools) : undefined,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal: opts.signal },
    );

    let text = '';
    // Tool calls arrive in fragments keyed by index: id and name first, then argument chunks.
    const calls = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: string | null = null;
    let usage = { input: 0, output: 0 };

    for await (const chunk of response) {
      if (chunk.usage) usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens };
      const choice = chunk.choices[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;

      const delta = choice.delta;
      if (delta?.content) {
        text += delta.content;
        yield { type: 'text_delta', delta: delta.content };
      }
      for (const tc of delta?.tool_calls ?? []) {
        const call = calls.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) call.id = tc.id;
        if (tc.function?.name) call.name += tc.function.name;
        if (tc.function?.arguments) call.args += tc.function.arguments;
        calls.set(tc.index, call);
      }
    }

    const content: ContentBlock[] = [];
    if (text) content.push({ type: 'text', text });
    for (const [index, c] of [...calls.entries()].sort(([a], [b]) => a - b)) {
      content.push({ type: 'tool_call', id: c.id || `call_${index}`, name: c.name, arguments: parseArgs(c.args) });
    }

    // Some providers report "stop" even when they emitted tool calls.
    let stopReason: StopReason = 'stop';
    if (calls.size > 0) stopReason = 'tool_use';
    else if (finishReason === 'length') stopReason = 'length';
    else if (finishReason === 'content_filter') stopReason = 'refusal';

    const message: AssistantMessage = { role: 'assistant', content, usage, stopReason, provider: config.name };
    yield { type: 'done', message };
  }

  return { name: config.name, defaultModel: config.defaultModel, stream };
}
