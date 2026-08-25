import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from '../env.js';

/**
 * Reads voice.md and hands sections of it to the prompts.
 *
 * The point of loading a file rather than pasting the rules into each prompt is
 * that pasting is what produced the problem: the composer grew a five-rule voice
 * block, the extractor kept a single line, and the two drifted apart with nothing
 * to notice. One file, imported twice, cannot disagree with itself.
 *
 * Sections are handed out individually because the extractor is called once per
 * thread. Its system prompt is already about 2,400 tokens and a backfill runs
 * ~900 of them, so a full copy of voice.md in that prompt would add roughly 1.3
 * million input tokens per backfill to govern two short strings. It gets the one
 * section about naming things. The composer runs once per edition and gets
 * everything.
 *
 * Fails at import if the file or a named section is missing, in the same spirit
 * as env.ts: a prompt silently missing its voice rules is worse than a server
 * that will not start.
 */

// REPO_ROOT rather than cwd, so the prompts build the same whether the server
// is started from the repo root, a workspace, or a test runner.
const PATH = resolve(REPO_ROOT, 'voice.md');

function readSections(): Map<string, string> {
  let raw: string;
  try {
    raw = readFileSync(PATH, 'utf8');
  } catch {
    throw new Error(`voice.md not found at ${PATH}. It is the source of the product's voice, not documentation, and the prompts do not build without it.`);
  }

  const sections = new Map<string, string>();
  // Split on level-two headings. The preamble above the first one is for humans
  // and deliberately never reaches a prompt.
  const parts = raw.split(/^## /m).slice(1);
  for (const part of parts) {
    const brk = part.indexOf('\n');
    sections.set(part.slice(0, brk).trim(), part.slice(brk + 1).trim());
  }
  return sections;
}

const SECTIONS = readSections();

/** One section of voice.md by heading. Throws if it has been renamed away. */
export function voice(heading: string): string {
  const body = SECTIONS.get(heading);
  if (!body) {
    throw new Error(
      `voice.md has no "## ${heading}" section. Found: ${[...SECTIONS.keys()].join(', ')}. ` +
        'Rename it back or update the caller.',
    );
  }
  return body;
}

/** Everything a prompt writing prose needs. Used by the composer. */
export const VOICE_PROSE = [voice('Voice'), voice('Never write these'), voice('Judgment')].join('\n\n');

/**
 * The rules for titles and details.
 *
 * Deliberately NOT in the extraction prompt. Extraction runs once per thread, so
 * anything in that prompt is paid ~900 times a backfill and can still only be
 * hoped for; the same rule checked by lintVoice() in the eval costs nothing and
 * fails loudly.
 *
 * An attempt to measure the difference is written up in eval/README.md. It did
 * not resolve: the corpus varies by about two fixtures between runs at three
 * repetitions, which is the size of the effect being looked for.
 */
export const VOICE_LABELS = voice('Naming things');
