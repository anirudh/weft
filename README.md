# Weft

Your inbox knows everything about your life and tells you none of it.

Somewhere in there is your daughter's field trip form, the receipt you need for
taxes, and the customer email you meant to answer. Gmail can only sort by sender
and keyword, so all of it drowns together.

Weft makes your inbox programmable. You describe what matters in plain English:

- *anything from my daughter's school that needs me to act*
- *all my receipts*
- *customer feedback about my product*

Weft watches your email continuously and turns each filter into a living view:
matching messages labeled and gathered, a current summary at the top, and every
open task and deadline pulled out.

Not inbox zero. Inbox useful.

## Bring your own model

Weft is free and open source. There's no subscription and no company sitting
between you and your email. You bring your own AI — an OpenAI, Claude, or Gemini
key, or a local model that never sends a single message off your machine.

Your email, your model, your rules.

## How it works

Weft runs locally as a single process. It syncs your Gmail into a local SQLite
database, evaluates each message against your filters, and writes the results
back to Gmail as labels. The web UI is served from the same process.

Filters aren't just prompts. When you write one, Weft compiles it into a cheap
deterministic gate (senders, domains, keywords, date windows) plus a semantic
predicate only a model can judge. Most mail is decided by the gate for free, so
model calls scale with your mailbox rather than mailbox size times filter count.
The compiled gate is visible and editable, which is also how you find out why
something didn't match.

## Status

Early. Nothing works yet — this repo is at the scaffolding stage. It's currently
built as a single-user app.

## License

TBD.
