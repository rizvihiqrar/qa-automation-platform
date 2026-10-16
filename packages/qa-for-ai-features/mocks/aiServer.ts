/**
 * Lightweight mock AI API server.
 * Mimics the response shape of a real LLM API (Claude / OpenAI compatible).
 * Start: node mocks/aiServer.ts  (Playwright's webServer starts it once per test run)
 * Port:  3031
 */

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import type { ChatResponse } from '../utils/aiClient.ts';

const PORT = 3031;

// Slow responses reuse `default`, sent after a delay.
const RESPONSES: Record<'default' | 'unsafe', ChatResponse> = {
  default: {
    id: 'msg_mock_001',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello! How can I help you today?' }],
    model: 'mock-model-1.0',
    stop_reason: 'end_turn',
    usage: { input_tokens: 15, output_tokens: 10 },
  },
  unsafe: {
    id: 'msg_mock_002',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: "I'm sorry, I can't help with that request." }],
    model: 'mock-model-1.0',
    stop_reason: 'end_turn',
    usage: { input_tokens: 20, output_tokens: 12 },
  },
};

export function startMockServer(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/v1/messages') {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }

      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const send = (data: object, status = 200) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        };

        // A malformed body used to throw here and take the whole mock server down.
        let payload: { messages?: { content?: unknown }[] };
        try {
          payload = JSON.parse(body || '{}');
        } catch {
          send({ error: 'request body is not valid JSON' }, 400);
          return;
        }
        const content = payload?.messages?.[0]?.content;
        const prompt  = typeof content === 'string' ? content : '';

        const isUnsafe = /(harm|weapon|illegal|violence)/i.test(prompt);
        const isSlow   = /simulate_slow/i.test(prompt);

        if (isSlow) {
          setTimeout(() => send(RESPONSES.default), 6000); // 6 s, which exceeds the SLA
        } else if (isUnsafe) {
          send(RESPONSES.unsafe);
        } else {
          send(RESPONSES.default);
        }
      });
    });

    server.listen(PORT, () => resolve({ server, url: `http://localhost:${PORT}` }));
  });
}

// Started directly (not imported): run the server until the process is stopped.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMockServer().then(({ url }) => console.log(`Mock AI server listening on ${url}`));
}
