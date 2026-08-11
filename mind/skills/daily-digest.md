# Skill: daily-digest

The daily push. The creator never asks for this, the Mind delivers it.

## Trigger

Every day at the creator's chosen time, or when a `digest.request` envelope
arrives.

## Steps

1. Read all open and proposed opportunities from audience memory.
2. Rank by demand score, take the top 5.
3. Read relationship memory for authors above the superfan threshold.
4. Rank by superfan score, take the top 5.
5. Compose the digest as a list of items:
   - `opportunity` items: topic label, repeat count, video count, unanswered
     flag, demand score
   - `fan` items: name, superfan score, engagement count, question count
   - `alert` items for opportunities created since the last digest
6. Send the digest to the creator in Telegram, and emit a `digest` envelope
   to the backend so the viewer can render it.

## Tone

Short, numbered, evidence-first. One line per item, no padding. The creator
reads this in 30 seconds and knows exactly what to do next.
