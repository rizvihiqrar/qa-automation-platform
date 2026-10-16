import type { APIRequestContext, APIResponse } from '@playwright/test';

const AI_BASE_URL = process.env.AI_BASE_URL || 'http://localhost:3031';

export interface ChatRequest {
  messages: { role: 'user' | 'assistant'; content: string }[];
  max_tokens?: number;
}

export interface ChatResponse {
  id: string;
  type: string;
  role: string;
  content: { type: string; text: string }[];
  model: string;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

export async function chat(request: ChatRequest, apiContext: APIRequestContext): Promise<APIResponse> {
  return apiContext.post(`${AI_BASE_URL}/v1/messages`, {
    data: {
      model: process.env.AI_MODEL || 'mock-model-1.0',
      max_tokens: 256,
      ...request,
    },
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.AI_API_KEY ? { 'x-api-key': process.env.AI_API_KEY } : {}),
    },
  });
}

// Checks the shape at runtime, since the body comes from the network. On success,
// TypeScript treats `body` as a ChatResponse from then on.
export function assertResponseSchema(body: unknown): asserts body is ChatResponse {
  if (typeof body !== 'object' || body === null) throw new Error('AI response is not a JSON object');
  const required = ['id', 'type', 'role', 'content', 'model', 'stop_reason', 'usage'];
  const missing  = required.filter(k => !(k in body));
  if (missing.length) throw new Error(`AI response missing fields: ${missing.join(', ')}`);

  const { content, usage } = body as Partial<ChatResponse>;
  if (!Array.isArray(content) || content.length === 0)
    throw new Error('content must be a non-empty array');

  if (content[0]?.type !== 'text' || typeof content[0]?.text !== 'string')
    throw new Error('content[0] must be { type: "text", text: string }');

  if (typeof usage?.input_tokens !== 'number' || typeof usage?.output_tokens !== 'number')
    throw new Error('usage must have numeric input_tokens and output_tokens');
}
