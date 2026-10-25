// Calls Claude to turn a feature description into a Playwright spec.
// The client is injected so the unit tests can run without network access.
import { buildPrompt } from './prompts/testPrompt.ts';

export const DEFAULT_MODEL = 'claude-opus-5-5';

// The slice of the Messages API this module uses. Typed here rather than taken
// from the SDK so the unit tests' fake client satisfies it too.
export interface MessageRequest {
  model: string;
  max_tokens: number;
  output_config: { effort: 'low' | 'medium' | 'high' };
  betas: string[];
  fallbacks: 'default';
  messages: { role: 'user'; content: string }[];
}

export type ContentBlock = { type: 'text'; text: string } | { type: 'thinking'; thinking: string };

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export interface MessageResponse {
  model: string;
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  content: ContentBlock[];
  usage: Usage;
}

export interface MessagesClient {
  beta: { messages: { create(params: MessageRequest): Promise<MessageResponse> } };
}

export interface GenerateResult {
  code: string;
  usage: Usage;
  model: string;
}

// Models sometimes wrap code in markdown fences despite the prompt. Strip one
// outer fence pair (```js ... ```) so the result is a runnable .js file.
export function cleanOutput(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```$/);
  return (fenced?.[1] ?? trimmed) + '\n';
}

export async function generateTests(
  client: MessagesClient,
  featureText: string,
  { model = process.env.AI_MODEL || DEFAULT_MODEL }: { model?: string } = {},
): Promise<GenerateResult> {
  const response = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    output_config: { effort: 'high' },
    // If the model declines, the API reruns the request on a fallback model it picks by category.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: buildPrompt(featureText) }],
  });

  if (response.stop_reason === 'refusal') {
    const category = response.stop_details?.category ?? 'unspecified';
    throw new Error(`Model declined to generate tests (category: ${category})`);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Output hit max_tokens before the test file was complete');
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  if (!text.trim()) throw new Error('Model returned no text');

  return { code: cleanOutput(text), usage: response.usage, model: response.model };
}
