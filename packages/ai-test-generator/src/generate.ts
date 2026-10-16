#!/usr/bin/env node
/**
 * Usage:
 *   node src/generate.ts --input examples/input/feature-login.txt --output tests/generated/login.spec.js
 *   node src/generate.ts --input examples/input/feature-cart.txt
 *
 * Credentials come from the environment: ANTHROPIC_API_KEY, or an `ant auth login` profile.
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateTests, type MessagesClient } from './generator.ts';
import { reviewSpec, formatReview } from './review.ts';

export function parseArgs(argv: string[]): { input: string; output: string } {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] ?? null : null;
  };
  const input = get('--input');
  if (!input) throw new Error('Usage: node src/generate.ts --input <feature-file.txt> [--output <test.spec.js>]');
  return {
    input,
    output: get('--output') ?? path.join('tests', 'generated', path.basename(input, '.txt') + '.spec.js'),
  };
}

async function main(): Promise<void> {
  const { input, output } = parseArgs(process.argv.slice(2));
  const featureText = fs.readFileSync(input, 'utf8').trim();

  console.log(`Generating tests for: ${input}`);
  // The SDK's own types lag the beta request fields used here, so the client is
  // narrowed to the interface generator.ts declares.
  const client = new Anthropic() as unknown as MessagesClient;
  const { code, usage, model } = await generateTests(client, featureText);

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, code, 'utf8');
  console.log(`Test file written to: ${output} (model: ${model})`);
  console.log(`Input tokens: ${usage.input_tokens}, output tokens: ${usage.output_tokens}\n`);

  // Generated tests are a draft. Review them before anyone commits them.
  const review = reviewSpec(code);
  console.log('Review:\n' + formatReview(review));
  if (!review.passed) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    if (err instanceof Anthropic.AuthenticationError) console.error('Authentication failed: set ANTHROPIC_API_KEY or run `ant auth login`.');
    else if (err instanceof Anthropic.RateLimitError) console.error('Rate limited; try again shortly.');
    else if (err instanceof Anthropic.APIError) console.error(`API error ${err.status}: ${err.message}`);
    else console.error('Generation failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
