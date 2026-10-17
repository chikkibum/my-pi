import { validateArgs } from '../tools/validate.ts';
import type { AgentEvent, AssistantMessage, Message, Provider, Tool, ToolCallBlock } from '../types.ts';

export interface AgentOptions {
  provider: Provider;
  model: string;
  system?: string;
  tools: Tool[];
  // Conversation history. runAgent appends to it in place, so a REPL can keep using it.
  messages: Message[];
  maxTurns?: number;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentResult {
  message: AssistantMessage;
  turns: number;
  hitMaxTurns: boolean;
}

async function executeCall(call: ToolCallBlock, tools: Tool[]): Promise<{ result: string; isError: boolean }> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return { result: `Unknown tool "${call.name}". Available: ${tools.map((t) => t.name).join(', ')}`, isError: true };

  const invalid = validateArgs(tool, call.arguments);
  if (invalid) return { result: `Invalid arguments for ${call.name}: ${invalid}`, isError: true };

  try {
    return { result: await tool.execute(call.arguments), isError: false };
  } catch (err) {
    // Hand the error back to the model so it can correct itself next turn.
    return { result: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}

// The agent loop: call the model, run any tools it asks for, feed the results
// back, repeat until it answers without calling a tool.
export async function runAgent(opts: AgentOptions): Promise<AgentResult> {
  const { provider, model, system, tools, messages, signal, onEvent = () => {} } = opts;
  const maxTurns = opts.maxTurns ?? 200;
  let last: AssistantMessage | undefined;

  for (let turn = 0; turn < maxTurns; turn++) {
    // 1. Call the model, streaming text to the UI as it arrives.
    let assistant: AssistantMessage | undefined;
    for await (const event of provider.stream({ messages, model, system, tools, signal })) {
      if (event.type === 'text_delta') onEvent(event);
      else assistant = event.message;
    }
    if (!assistant) throw new Error(`${provider.name} stream ended without a final message`);

    // 2. Save it to the history.
    messages.push(assistant);
    last = assistant;
    onEvent({ type: 'turn_end', turn, message: assistant });

    // 3. No tool calls means the model is done.
    const calls = assistant.content.filter((b): b is ToolCallBlock => b.type === 'tool_call');
    if (calls.length === 0) return { message: assistant, turns: turn + 1, hitMaxTurns: false };

    // 4. Run each tool call and append its result. Every call gets a result,
    // even ones we refuse to run, because providers reject unanswered calls.
    for (const call of calls) {
      onEvent({ type: 'tool_start', call });
      let outcome: { result: string; isError: boolean };
      if (assistant.stopReason === 'length') {
        outcome = {
          result: 'Not executed: your output hit the max token limit, so these arguments may be truncated. ' +
            'Retry with smaller pieces (e.g. write a large file in several steps).',
          isError: true,
        };
      } else if (assistant.stopReason === 'refusal') {
        outcome = { result: 'Not executed: the response was stopped by a refusal.', isError: true };
      } else {
        outcome = await executeCall(call, tools);
      }
      onEvent({ type: 'tool_end', call, ...outcome });
      messages.push({ role: 'tool_result', toolCallId: call.id, toolName: call.name, content: outcome.result, isError: outcome.isError });
    }
    if (assistant.stopReason === 'refusal') return { message: assistant, turns: turn + 1, hitMaxTurns: false };

    // 5. Loop: the next request carries the tool results back to the model.
  }

  return { message: last!, turns: maxTurns, hitMaxTurns: true };
}
