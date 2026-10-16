// Calls Claude to turn a feature description into a Playwright spec.
// The client is injected so the unit tests can run without network access.
import { buildPrompt } from './prompts/testPrompt.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';

// Models sometimes wrap code in markdown fences despite the prompt. Strip one
// outer fence pair (```js ... ```) so the result is a runnable .js file.
export function cleanOutput(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```$/);
  return (fenced ? fenced[1] : trimmed) + '\n';
}

export async function generateTests(client, featureText, { model = process.env.AI_MODEL || DEFAULT_MODEL } = {}) {
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
