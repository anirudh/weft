# Eval corpus

28 email threads, frozen, scrubbed, and labelled. Running the extraction prompt
against them turns a prompt edit from a judgement call into a number.

```
npm run eval                 one pass  · ~7s   · ~100k tokens
npm run eval -- --reps 3     three     · ~14s  · ~300k tokens
npm run eval -- --only promo just the promo cases
```

Exits non-zero on regression, so it can gate a commit.

## Why it exists

Tuning the prompt by re-extracting the whole mailbox costs 4.2M tokens and a
quarter of an hour, which is slow enough that you stop running it and start
guessing. Worse, a live mailbox is not a fixed corpus: mail arrives daily, so
you cannot tell whether the prompt improved or the inputs moved.

Everything here is pinned. Each fixture carries its own `today`, so a date that
is two days out today is still two days out next year.

## What is in it, and what is not

Selected, not sampled. Every fixture is a case that cost real time to get right
or that a plausible prompt change would break: marketing carrying genuine hard
dates, a statement whose fine print says auto-pay is already enrolled, a trial
ending in an email written as an upsell, calendar invitations against advertised
webinars, and the two date formats that defeated the anchor validator.

Roughly half must produce **nothing**. A corpus of things that should extract
only teaches a model to extract everything.

Nothing medical, immigration-related or identity-financial is here, even
scrubbed. What makes a thread hard is its shape, not its subject, and that shape
is available in a subscription receipt.

## How the scrubbing works

Two passes, because only one of them can be trusted.

`capture.ts` asks a model to rewrite each body: keep the structure, the register
and above all the dates — `07-30-2026` stays `07-30-2026`, since that format is
the whole point of one fixture — while replacing names, addresses and reference
numbers.

`anonymise.ts` then does the part that actually matters, in code. Asked to keep
"large consumer brands", the model kept the reader's gym, doctor, bank and
registrar — which as a set describe a person more precisely than their name
would. So every sender identity in the source mailbox is mapped to an invented
one deterministically. Which brand a message is from never affects how it should
be classified, so nothing is lost.

Sender mapping does not see third parties. A gym newsletter mentioned another
club, a retail brand, a phone number and three towns — none of them senders,
all of them together enough to locate a person. Geography is an identifier and
the first two sweeps missed it entirely. Anything captured from a rich HTML
newsletter is better hand-written; several fixtures here are, and each says so
in its own note.

Two bugs that pass silently if you are not looking for them, both now fixed and
worth knowing about if you extend this:

- Substitution without word boundaries rewrites the middle of ordinary words.
  `scheduled` became `scKingsleyightpathled`.
- Substituting on raw JSON text does not work. An escaped newline is the two
  characters `\` and `n`, so every word starting a line looks preceded by the
  letter `n` and boundary checks silently fail. Scrub parsed values.

## What the suite actually scores

45 fixtures, and it runs 41-44 of them depending on the roll. A handful sit on
the model's decision boundary and flicker between runs: a prepaid credit that
expires, a statement whose fine print says auto-pay is on, a security notice
that says no action is needed, a support auto-reply read as waiting_on. Those
are genuinely ambiguous emails, not wording bugs, and chasing them with prompt
edits has twice cost more than it returned.

Thinking level was measured rather than assumed:

| level | boundary cases | thought tokens |
|---|---|---|
| minimal | 18/24 | 0 |
| low | 23/24 | ~1,000 per suite run |
| medium | no better than low | ~100,000 per suite run |

`low` is the setting. Use `--thinking` to re-measure if the model changes.

## One restructure, measured and rejected

The prompt is a long list of specific shapes rather than a few general
principles, and that looks like something to clean up. It was tried, with this
corpus as the safety net, and it is measurably worse:

| prompt | passes /225 |
|---|---|
| as it stands | 219, 222 (two runs) |
| rewritten around one test + four canonical exclusions | 202 |

Suite-level variance between identical runs is about ±3 passes, so 202 is well
outside it. The general version broke cases the specific list had solid — an
auto-pay statement and a membership discount both went from passing to 0/5. The
long list is doing real work; generality lost discriminations that took a day of
real mail to find.

**Do not "fix" the camp-evaluation example.** Example seven extracts a camp
evaluation, which the prose explicitly says to drop. It is a genuine logical
contradiction and it is load-bearing. Three separate attempts to resolve it —
making it return nothing, swapping it for an undated medication form, and the
full restructure — each dropped the suite to 202-212, and each broke
`auto-pay-enabled-statement` from 5/5 to 0/5. The untouched version passes it
10/10 across two runs. No mechanism explains this; the measurement is
unambiguous. If you change it, run `--reps 5` before and after and be ready to
revert.

The wider lesson: a few-shot example teaches more than its stated case. That one
is also one of only two showing an *undated* obligation being extracted, and
removing that demonstration appears to make the model broadly more conservative.

## Labels are the weak link

Three times while building this, a fixture failed and the prompt turned out to
be right:

- A **statement with a balance and a due date** that also said auto-pay was
  enrolled. Correctly dropped.
- An **expiring credit**, labelled as promotional. But a discount code expiring
  costs you nothing you had, whereas a credit you already paid for is property.
  Correctly extracted — the label changed.
- A **domain renewal** asserted as a `deadline`, which the model called a
  `window` a third of the time. Both readings are defensible; the fixture exists
  to test the date format, so it now asserts the anchor rather than the class.

When a fixture fails, read the `note` field and the email before touching the
prompt. Assert only on what the fixture is actually for.

## Adding a case

Fixtures are committed JSON — you do not need mailbox access to add one by hand.
Give it an `id`, a `note` saying why it is hard, a pinned `today`, the messages,
and an `expect`. Assert the least that captures the point: `court` and
`temporalClass` where they are the point, `anchorDate` where the date is.

`knownGap: true` marks a case the prompt gets wrong today. It is reported
separately and does not fail the run, so a known weakness stays visible instead
of being deleted or silently tolerated.

Regenerating from source needs a mailbox with message bodies still persisted,
which production deliberately no longer keeps. That is why the output is
committed rather than rebuilt.

## The brief corpus

`npm run eval:brief` does for the composer what the corpus above does for the
extractor. It is separate because it exercises a different prompt on a different
model, and a voice change should not have to pay for 46 extraction calls.

The assertions are a different shape, because there is no correct brief. Two good
briefs about the same day share no sentences. So the cases in `brief-cases.ts`
assert only what is true of every good brief and no bad one:

- it obeys the mechanical rules in `voice.md`, via `lintVoice()`
- the headline is at most 14 words and does not greet
- there are two to four notes
- **every money figure in the brief appears in the input**, or is the exact sum
  of figures that do

The last one is the reason this exists. A reader can catch a clumsy sentence.
They cannot catch a number that was never in their mail, and the brief is prose
about money.

That check is strict on purpose, and it will fire on arithmetic that happens to
be correct. Removing the "never invent" rule from `voice.md` produced "about $125
a month" from a set of renewals whose figures sum to $104.74. The $125 was right
in the sense that it normalised a weekly price to a monthly one. It was still a
number the reader had never seen. The rule the product wants is that the brief
quotes figures rather than deriving them, and the check enforces exactly that.
If a real total is worth showing, compute it in code and pass it in.

`--print` shows the briefs. Nothing else judges the half no assertion reaches, so
read them after a voice change.

## voice.md

The prompts do not carry their own voice rules. `voice.md` at the repo root is
the source, and `pipeline/voice.ts` interpolates sections of it into both. This
exists because the rules had already drifted: the composer carried five and the
extractor carried one, and they disagreed.

The composer gets Voice, Never write these, and Judgment. The extractor gets none
of it: it keeps a one-line rule pointing here, and `judge()` runs `lintVoice()`
over every title and detail before the structural checks.

That choice is on principle, not measurement, and the attempt to measure it is
worth recording because it failed instructively.

Wiring the wording rules into the extraction prompt appeared to cost two
fixtures. Five three-repetition runs, in order: 46/46 and 46/46 on the baseline,
44/46 with the section added, 46/46 after trimming it, 44/46 after changing one
word of an example, and 45/46 back at baseline plus three lines of comment. The
fixtures that wobbled were not even consistent between runs.

So the honest reading is that this corpus has a run-to-run spread of about two
fixtures at three repetitions, and a difference of that size cannot be attributed
to anything. The first 44/46 looked like a regression and the following 46/46
looked like a fix. Neither was established. Resolving a two-fixture difference
would take roughly ten repetitions per arm, which is about 2.3M tokens each.

**Do not read a two-fixture difference at `--reps 3` as a result.** Either spend
the repetitions or decide on other grounds. Here the other grounds were enough:
enforcing wording by lint costs nothing per thread and fails loudly, while
enforcing it by prompt costs ~900 calls' worth of tokens and can only be hoped
for.
