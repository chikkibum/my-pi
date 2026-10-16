import type { Provider } from '../types.ts';
import { createAnthropicProvider } from './anthropic.ts';
import { createOpenAICompatProvider } from './openai-compat.ts';

// Factories, so a provider (and its SDK client) is only built when selected.
// Any OpenAI-compatible API is one more entry here: a base URL, a key, a default model.
const providers: Record<string, () => Provider> = {
  anthropic: () => createAnthropicProvider(),
  groq: () =>
    createOpenAICompatProvider({
      name: 'groq',
      baseURL: 'https://api.groq.com/openai/v1',
      apiKeyEnv: 'GROQ_API_KEY',
      defaultModel: process.env.GROQ_MODEL ?? 'qwen/qwen3-32b',
    }),
  openrouter: () =>
    createOpenAICompatProvider({
      name: 'openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      defaultModel: process.env.OPENROUTER_MODEL ?? 'qwen/qwen3-coder',
    }),
};

export const providerNames = Object.keys(providers);

export function getProvider(name: string): Provider {
  const factory = providers[name];
  if (!factory) throw new Error(`Unknown provider "${name}". Available: ${providerNames.join(', ')}`);
  return factory();
}
