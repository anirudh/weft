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
