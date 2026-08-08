# First-touch outreach copy

Drafted 2026-08-07. **Not shipped.** The templates in `scripts/lib/outreach-mail.mjs` are
still the old ones; this file records the agreed direction and the copy to move to, so the
work can be picked up without re-running the discussion.

## Why the current templates are being replaced

There is one message per person per campaign — the dedupe key in
`scripts/lib/outreach-outbox.mjs` enforces it, and the compliance footer promises it. So the
first message has to carry the whole story. The shipped templates do not: they never say what
beGlib is, what hosting involves, how long it takes, or what the host gets, and they offer to
"send a short overview" later, which spends the one message on asking permission to explain.

Personalisation is also fake. `{{topics}}` joins Wikidata subcategories lowercased, producing
strings like "developmental psychology parenting education". An expert reads that as bulk mail.

## Decisions

**No images, video, or attachments in the message.** Remote images and pixels are already
banned by design (`toHtml` in `outreach-mail.mjs`). A cold message from a new sending domain
carrying media is a deliverability problem, embedded video does not render in mail clients
anyway, and a glossy commercial mail undercuts the "one-time professional note" position that
is also the lawful basis. The video lives on the landing page, behind the one link.

**Three claims, not seven.** The story is *control stays with the host*: the audience, the
recording, the length and the price. Everything else is landing-page material.

**"Elite" is out** of the English copy. It reads as flattery, and it is what scam mail says.

**The personal claim link is out of first contact.** A tokenised "your invitation, claim it
here" link from an unknown sender has the exact shape of phishing. `tmpl-host-invite` moves to
the second step, after someone shows interest.

**The encryption story moves to the sensitive-category templates.** Sessions are encrypted
while running; if a recording is going to be made everyone is told first and can turn their
camera off. That is a consent story, and it is the first question a psychology, therapy, or
medicine candidate asks. In the general template it would be a fourth claim nobody reads.

**AI-written personalisation: not yet.** There is no LLM integration in this repository (only
an unused `OPENAI_API_KEY` slot in `.env.example`). At 25 sends/day the operator writing one
concrete sentence is ~30 seconds and strictly better than a model working from a name, a
title, and Wikidata subcategories — thin input is what produces confident fabrication, and a
wrong factual claim in a commercial message is a substantiation problem, not just an
embarrassment. If volume ever justifies it, the design is: the model sees only stored evidence
(no open-world knowledge, no browsing), returns one sentence of at most 25 words or refuses,
the sentence is stored in the overlay with model id and prompt version, and the operator
approves the rendered body — which the existing `bodyHash` approval already forces. Cost is
negligible at this scale; `claude-haiku-4-5-20251001` is enough for a constrained rewrite.

## Facts the copy may assert

Confirmed by the operator 2026-08-07:

- Paid sessions settle into the host's **own Stripe account**. The platform holds ticket money
  only until the session has taken place (~24h), to protect ticket buyers.
- Sessions are **encrypted** while running when no recording is being made. If a recording
  starts, every participant is told beforehand and can turn their camera off. Recording is
  announced before and during the session.
- The **recording belongs to the host**, to publish anywhere or not to make at all.
- The host chooses a **private invited group or an open room**, and sets the length.
- `beglib.com` is live: hosts page, event page, video highlights, private/public communities.

Still to verify before send:

- Does the terms of service match "the recording is yours, with no rights taken by us"?
- Real-money Stripe flow, to be proven on the founder's own host account in private sessions.
- The example-host video for the `/hosts` page.

## Templates

`{{whyYou}}` is a new placeholder: one concrete operator-written sentence about this specific
person. It replaces `{{topics}}` in the body and must be required — an empty value should fail
the render, so a generic message cannot go out by accident. `{{overviewUrl}}` comes from
config (`OUTREACH_HOST_OVERVIEW_URL`) and should be a blocking config issue when unset. The
link points at a page with the video at the top, not at a bare video URL and never at a
shortener.

Signature is a named human — Mehmet Yiter, Founder — not "beGlib team". The compliance footer
is appended automatically and still carries the legal name, postal address, and opt-out.

### Default / expert

Subject: `Hosting live sessions on beGlib`
(alternative: `Your own live sessions — your audience, your recording`)

```
Hi {{name}},

I'm Mehmet Yiter, the founder of beGlib. We built a place where people host live sessions
for the audience that actually wants depth — a private group you invite yourself, or anyone
who signs up.

{{whyYou}}

Three things hosts ask about first:

- You set the format and the length. A 30-minute conversation and a three-hour workshop are
  both normal here.
- The recording is yours. Publish it on your own channels — or don't record at all.
- If you charge for a session, the money goes to your own Stripe account. We hold ticket
  payments only until the session has taken place.

A short overview and an example session: {{overviewUrl}}

Happy to answer anything by email first — nothing is scheduled or published without you.

If this isn't for you, reply "no thanks" and I won't write again.

Best,
Mehmet Yiter
Founder, beGlib
```

### Academia

Subject: `A way to teach outside the lecture hall`

```
Hi {{name}},

I'm Mehmet Yiter, the founder of beGlib — a platform for live sessions where someone with
real expertise talks to people who came specifically for it, not to a passive webinar
audience.

{{whyYou}}

What that looks like in practice: you choose whether the room is a small invited group or
open to anyone, you set the length, and the recording stays yours to publish or to never
make at all. Sessions can be free; if you'd rather charge, payments settle into your own
Stripe account.

Overview and an example session: {{overviewUrl}}

If it's useful, I'm glad to answer questions by email before anything is scheduled.

If this isn't relevant, reply "no thanks" and I won't write again.

Best,
Mehmet Yiter
Founder, beGlib
```

### Creator (YouTube, video-native)

Subject: `Live sessions for the part of your audience that wants more`

```
Hi {{name}},

I'm Mehmet Yiter, the founder of beGlib. It's built for live sessions where a creator can go
deeper with the slice of their audience that wants it — a private community you control, or
an open room.

{{whyYou}}

The parts creators usually care about: the recording is yours, with no rights taken by us, so
it can go straight to your own channels. You set the length and the price, and paid tickets
settle into your own Stripe account.

Overview and an example session: {{overviewUrl}}

Happy to answer questions by email first — nothing goes live without you.

If this isn't for you, reply "no thanks" and I won't write again.

Best,
Mehmet Yiter
Founder, beGlib
```

### Sensitive categories (psychology, therapy, medicine; religion takes this shape)

Privacy first, control second, money last and optional.

Subject: `A carefully scoped format for public education sessions`

```
Hi {{name}},

I'm Mehmet Yiter, the founder of beGlib. We host live sessions where someone with real
expertise speaks to a room that came for exactly that — either a private group you choose, or
an open one.

{{whyYou}}

Because of the subject matter, two things are worth stating up front. Sessions are encrypted
while they run, and if a recording is going to be made, everyone in the room is told before it
starts and can turn their camera off. And the recording, if there is one, is yours — nothing
is published by us.

This would be an educational conversation, not clinical advice, and we'd want the scope agreed
in writing before anything is scheduled.

Overview and an example session: {{overviewUrl}}

If this isn't appropriate, reply "no thanks" and I won't write again.

Best,
Mehmet Yiter
Founder, beGlib
```

## What implementing this changes in code

- `{{whyYou}}` placeholder, sourced from the operator overlay review note, required at render.
- `{{overviewUrl}}` from `OUTREACH_HOST_OVERVIEW_URL`, with a blocking config issue when unset.
- The `{{topics}}` requirement in `renderOutreachMessage` is replaced by the `{{whyYou}}` one.
- `tmpl-host-invite` stops being a first-touch template.
- Template tests in `scripts/lib/outreach-service.test.mjs` follow the new bodies.

Bullet blocks render correctly as-is: `toHtml` splits on blank lines and converts single
newlines to `<br />`, so the list stays a plain paragraph with no external styling.
