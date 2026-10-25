// The real Anthropic client, adapted to the slice generator.ts uses. No casts: the
// request type must be accepted by the SDK's own create() and the response is built
// from the SDK's own BetaMessage fields, so a breaking SDK change (a renamed field,
// a removed parameter) fails `npm run typecheck` instead of the next paid eval run.
// Before this, `new Anthropic() as unknown as MessagesClient` hid the SDK's types, and
// the 0.x to 1.x bump (Dependabot #86) could only be checked by hand.
import type Anthropic from '@anthropic-ai/sdk';
import type { MessageRequest, MessageResponse, MessagesClient } from './generator.ts';

export function sdkClient(client: Anthropic): MessagesClient {
  return {
    beta: {
      messages: {
        async create(params: MessageRequest): Promise<MessageResponse> {
          const message = await client.beta.messages.create({ ...params, stream: false });
          return {
            model: message.model,
            stop_reason: message.stop_reason,
            stop_details: message.stop_details,
            // Only text is read; thinking, fallback and other blocks are left out.
            content: message.content.flatMap((block) => (block.type === 'text' ? [{ type: 'text' as const, text: block.text }] : [])),
            usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens },
          };
        },
      },
    },
  };
}
