/**
 * The mechanical half of voice.md, as a function.
 *
 * Tone is usually a matter of taste and therefore never enforced, which is how
 * two prompts ended up with two different sets of voice rules. Most of what
 * makes text read like a machine is not taste at all: it is a finite list of
 * constructions. Those can be a test.
 *
 * Every rule here has a line in voice.md under "Never write these". The two are
 * meant to be read together, and a rule added to one belongs in the other.
 *
 * Deliberately conservative. This runs over real product copy, so a rule that
 * fires on a legitimate sentence costs more than one that misses: the point is
 * to make the check trustworthy enough that a failure means "fix the text"
 * rather than "add another exception".
 */

export type VoiceRule = {
  /** Stable id, so a test failure names something searchable. */
  id: string;
  test: RegExp;
  /** What to do instead. Shown on failure, so it has to be actionable. */
  fix: string;
};

export type VoiceViolation = { id: string; fix: string; match: string; at: number };

export const VOICE_RULES: VoiceRule[] = [
  // Weft's own rule, and the one that matters most. Read-only access means it
  // cannot know whether the reader acted, so it must never say they did not.
  {
    id: 'accusation',
    test: /\b(overdue|past due|you'?re late|is late|are late|you missed|missed the|fell behind|you'?re behind|failed to|last chance|act now|don'?t forget|asap)\b/i,
    fix: 'Weft cannot see whether you acted. Ask whether it is still open instead.',
  },
  {
    id: 'alarm',
    test: /\b(urgent|urgently|immediately|critical|attention required|action required)\b/i,
    fix: 'Put it first in the order instead, and name the actual consequence.',
  },
  { id: 'exclamation', test: /!/, fix: 'Use a full stop.' },

  {
    id: 'chatbot',
    test: /\b(i hope this helps|let me know if|feel free to|great question|happy to help|as an ai|i'?d be happy to|thanks for asking)\b/i,
    fix: 'Delete it. The reader did not ask you a question.',
  },
  {
    id: 'padding',
    test: /\b(it is important to note|it'?s important to note|it is worth noting|it'?s worth noting|in order to|due to the fact that|at this point in time|needless to say)\b/i,
    fix: 'Cut it, or write "to" / "because" / "now".',
  },
  {
    id: 'ai-lexicon',
    test: /\b(delve|crucial|pivotal|underscores?|underscoring|interplay|tapestry|realm|vibrant|testament|seamless|robust|myriad|plethora|elevate|empower|streamline|curated|bespoke)\b/i,
    fix: 'Use the plain word for what you mean.',
  },
  {
    id: 'fancy-is',
    test: /\b(serves as|boasts|stands as|represents a)\b/i,
    fix: 'Write "is".',
  },
  {
    id: 'metaphor-noun',
    test: /\b(north star|bedrock|paradigm|substrate|nexus|ecosystem|synergy|leverage|leveraging)\b/i,
    fix: 'Name the concrete thing. "Leverage" is almost always "use".',
  },
  {
    id: 'not-just',
    test: /\bnot (just|only)\b[^.!?]{1,60}?\bbut\b/i,
    fix: 'Say the thing you mean, once.',
  },
  {
    id: 'stacked-hedge',
    test: /\b(may|might|could)\s+(potentially|possibly|perhaps|conceivably)\b/i,
    fix: 'One modal, or none.',
  },
  // Not a typographic preference. Long dashes are the join that lets two ideas
  // travel as one sentence, which is the shape most machine prose defaults to.
  { id: 'long-dash', test: /[—–]/, fix: 'Use a full stop or a comma. It is usually two sentences.' },
  {
    id: 'smart-punctuation',
    test: /[‘’“”]/,
    fix: "Straight quotes and apostrophes only, so copy survives being pasted.",
  },
  {
    id: 'emoji',
    test: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u,
    fix: 'Remove it. Nothing here has a tone an emoji would add to.',
  },
  {
    id: 'greeting',
    test: /\b(good morning|good afternoon|good evening|welcome back|hello there)\b/i,
    fix: 'Start with the first fact.',
  },
  {
    id: 'encouragement',
    test: /\b(you'?ve got this|you can do it|stay on top of|keep it up|nice work|well done|busy (day|week) ahead)\b/i,
    fix: 'The reader did not ask to be encouraged.',
  },
];

/** Every rule this text breaks, in the order they appear in the rule list. */
export function lintVoice(text: string): VoiceViolation[] {
  const out: VoiceViolation[] = [];
  for (const rule of VOICE_RULES) {
    const m = rule.test.exec(text);
    if (m) out.push({ id: rule.id, fix: rule.fix, match: m[0], at: m.index });
  }
  return out;
}

/** One line per violation, for a test failure or a server log. */
export function formatViolations(text: string, violations: VoiceViolation[]): string {
  const where = text.length > 90 ? `${text.slice(0, 87)}...` : text;
  return [
    `voice: ${violations.length} violation(s) in "${where}"`,
    ...violations.map((v) => `  [${v.id}] "${v.match}": ${v.fix}`),
  ].join('\n');
}
