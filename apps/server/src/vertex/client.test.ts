import { describe, expect, it } from 'vitest';
import { generateJson } from './client.js';
import { env } from '../env.js';

/**
 * Hits the real Vertex API on purpose. Every assertion here pins a quirk that
 * cost real time to discover by probing, and that no type or local test would
 * catch if Google changed it: the API would simply start behaving differently
 * and the pipeline would get quietly worse.
 *
 * Needs ADC (`gcloud auth application-default login`). Costs a few hundred
 * tokens per run. Set WEFT_SKIP_VERTEX=1 to skip it offline.
 */

const online = !process.env.WEFT_SKIP_VERTEX;
const SCHEMA = {
  type: 'OBJECT',
  properties: { colour: { type: 'STRING' }, count: { type: 'NUMBER' } },
  required: ['colour', 'count'],
};
const ASK = 'Return colour "blue" and count 3.';

describe.runIf(online)('the Vertex contract', () => {
  it('accepts thinkingLevel nested inside thinkingConfig', { timeout: 60_000 }, async () => {
    // The nesting is load-bearing: thinkingLevel at the top of generationConfig
    // is rejected outright, and the client silently retries without any
    // thinking config at all if the error mentions thinking — so a regression
    // here would show up as a quietly more expensive pipeline, not a failure.
    const { data, usage } = await generateJson<{ colour: string; count: number }>({
      model: env.GEMINI_EXTRACT_MODEL, user: ASK, schema: SCHEMA, thinkingLevel: 'minimal',
    });
    expect(data.colour.toLowerCase()).toContain('blue');
    expect(usage.promptTokens).toBeGreaterThan(0);
  });

  it('spends no thought tokens at minimal on flash-lite', { timeout: 60_000 }, async () => {
    // The measurement the .env comment rests on: raising this to "low" was
    // 1,058 thought tokens on one call. At minimal it must be exactly zero.
    const { usage } = await generateJson({
      model: env.GEMINI_EXTRACT_MODEL, user: ASK, schema: SCHEMA, thinkingLevel: 'minimal',
    });
    expect(usage.thoughtTokens).toBe(0);
  });

  it('honours responseSchema and returns parseable JSON of the right shape', { timeout: 60_000 }, async () => {
    const { data, raw } = await generateJson<{ colour: string; count: number }>({
      model: env.GEMINI_EXTRACT_MODEL, user: ASK, schema: SCHEMA, thinkingLevel: 'minimal',
    });
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(typeof data.colour).toBe('string');
    expect(typeof data.count).toBe('number');
    expect(data).not.toHaveProperty('```'); // never fenced when responseMimeType is set
  });

  it('serves the compose model too, at a thinking level flash-lite never uses', { timeout: 120_000 }, async () => {
    const { data, usage } = await generateJson<{ colour: string; count: number }>({
      model: env.GEMINI_COMPOSE_MODEL, user: ASK, schema: SCHEMA, thinkingLevel: 'medium',
    });
    expect(data.colour.toLowerCase()).toContain('blue');
    expect(usage.totalTokens).toBeGreaterThan(0);
  });
});
