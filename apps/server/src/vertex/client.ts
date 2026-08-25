import { GoogleAuth } from 'google-auth-library';
import { env } from '../env.js';

/**
 * Vertex generateContent, not the Gemini Developer API and not the Interactions
 * API — the latter returns "Unsupported model interaction" for these models on
 * Vertex. Contract verified against the live project; see client.test.ts, which
 * asserts the quirks so we hear about it if Vertex changes underneath us.
 */

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

const host = (location: string) =>
  location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export type VertexUsage = { promptTokens: number; outputTokens: number; thoughtTokens: number; totalTokens: number };

export class VertexError extends Error {
  constructor(public readonly status: number, message: string) {
    super(`vertex ${status}: ${message}`);
  }
}

export type GenerateArgs = {
  model: string;
  system?: string;
  user: string;
  /** OpenAPI-subset schema. Vertex calls this responseSchema. */
  schema: Record<string, unknown>;
  thinkingLevel?: ThinkingLevel;
};

export async function generateJson<T>(args: GenerateArgs): Promise<{ data: T; usage: VertexUsage; raw: string }> {
  const token = await auth.getAccessToken();
  if (!token) throw new Error('no ADC token — run: gcloud auth application-default login');

  const url =
    `https://${host(env.GOOGLE_CLOUD_LOCATION)}/v1/projects/${env.GOOGLE_CLOUD_PROJECT}` +
    `/locations/${env.GOOGLE_CLOUD_LOCATION}/publishers/google/models/${args.model}:generateContent`;

  const build = (withThinking: boolean) => ({
    contents: [{ role: 'user', parts: [{ text: args.user }] }],
    ...(args.system ? { systemInstruction: { parts: [{ text: args.system }] } } : {}),
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: args.schema,
      // Nesting matters: thinkingLevel at the top of generationConfig is rejected.
      // Deliberately no temperature/top_p/top_k — the 3.x guidance warns that
      // changing them causes looping or degraded output.
      ...(withThinking && args.thinkingLevel ? { thinkingConfig: { thinkingLevel: args.thinkingLevel } } : {}),
    },
  });

  const post = async (withThinking: boolean, attempt = 0): Promise<Response> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(build(withThinking)),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2 ** attempt * 700 + Math.random() * 400));
      return post(withThinking, attempt + 1);
    }
    return res;
  };

  let res = await post(true);
  if (!res.ok) {
    const body = (await res.json()) as { error?: { message?: string } };
    const msg = body.error?.message ?? 'unknown';
    // e.g. "Thinking level is unsupported: THINKING_LEVEL_MINIMAL" on 3.7-flash.
    // Losing the thinking setting is far better than losing the extraction.
    if (/thinking/i.test(msg)) res = await post(false);
    else throw new VertexError(res.status, msg);
    if (!res.ok) {
      const b2 = (await res.json()) as { error?: { message?: string } };
      throw new VertexError(res.status, b2.error?.message ?? 'unknown');
    }
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };
  };

  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!raw) throw new Error('vertex returned no text part');

  const u = json.usageMetadata ?? {};
  return {
    data: JSON.parse(raw) as T,
    raw,
    usage: {
      promptTokens: u.promptTokenCount ?? 0,
      outputTokens: u.candidatesTokenCount ?? 0,
      thoughtTokens: u.thoughtsTokenCount ?? 0,
      totalTokens: u.totalTokenCount ?? 0,
    },
  };
}
