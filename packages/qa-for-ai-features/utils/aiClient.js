const AI_BASE_URL = process.env.AI_BASE_URL || 'http://localhost:3031';

export async function chat(request, apiContext) {
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

export function assertResponseSchema(body) {
  const required = ['id', 'type', 'role', 'content', 'model', 'stop_reason', 'usage'];
  const missing  = required.filter(k => !(k in body));
  if (missing.length) throw new Error(`AI response missing fields: ${missing.join(', ')}`);

  if (!Array.isArray(body.content) || body.content.length === 0)
    throw new Error('content must be a non-empty array');

  if (body.content[0].type !== 'text' || typeof body.content[0].text !== 'string')
    throw new Error('content[0] must be { type: "text", text: string }');

  if (typeof body.usage?.input_tokens !== 'number' || typeof body.usage?.output_tokens !== 'number')
    throw new Error('usage must have numeric input_tokens and output_tokens');
}
