// Unified, provider-agnostic types. Every provider converts to and from these.

export interface Usage {
  input: number;
  output: number;
}

export type StopReason = 'stop' | 'length' | 'tool_use' | 'refusal';

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolCallBlock {
  type: 'tool_call';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ContentBlock = TextBlock | ToolCallBlock;

export interface UserMessage {
  role: 'user';
  content: string;
}

export interface AssistantMessage {
  role: 'assistant';
  content: ContentBlock[];
  usage: Usage;
  stopReason: StopReason;
  // Name of the provider that produced this message, and its native content.
  // Providers replay `raw` verbatim when the history goes back to them, so
  // things the unified blocks don't model (e.g. Anthropic thinking blocks,
  // which must be sent back unchanged) survive the round trip.
  provider?: string;
  raw?: unknown;
}

export interface ToolResultMessage {
  role: 'tool_result';
  toolCallId: string;
  toolName: string;
  content: string;
  isError: boolean;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export interface Tool {
  name: string;
  description: string;
  // JSON Schema describing the arguments object.
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'done'; message: AssistantMessage };

export interface StreamOptions {
  messages: Message[];
  model: string;
  system?: string;
  tools?: Tool[];
  signal?: AbortSignal;
}

export interface Provider {
  name: string;
  defaultModel: string;
  stream: (opts: StreamOptions) => AsyncGenerator<StreamEvent>;
}

// Events the agent loop reports to the UI.
export type AgentEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_start'; call: ToolCallBlock }
  | { type: 'tool_end'; call: ToolCallBlock; result: string; isError: boolean }
  | { type: 'turn_end'; turn: number; message: AssistantMessage };
