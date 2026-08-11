# CreatorSignal Architecture

## The problem

Creators get hundreds of comments a day. Recurring questions never get
answered, superfans go unrecognized, and content decisions are made from
vibes instead of signals. Analytics dashboards show what happened, not what
to do next.

## The product

CreatorSignal is a persistent Mind that turns audience noise into a small
number of high-signal decisions:

- what to make next (the audience opportunity)
- who to engage with (the relationship memory)
- what already failed or was rejected (the creator memory)

The Mind is integral: all memory lives in the Mind's Soul, all detection
runs as Mind skills, and the backend is connective tissue plus a thin viewer.

## System diagram

```
 YouTube comments
      |
      v
[ingest]  pulls new comment threads (YouTube Data API or demo fixtures)
      |
      v
[distill] classifies each comment into a signal
          kind (question, request, praise, critique, topic)
          topic key (normalized cluster)
          sentiment
      |
      v
[relay]  signals.batch envelope  ----------->  THE MIND
          (Telegram chat / simulated)          - Soul memory (audience,
      ^                                          relationship, creator)
      |                                         - detect-demand skill
      |                                         - daily-digest skill
      |                                         - reply-draft skill
      +------------  opportunity.created / digest / reply.draft envelopes
      |
      v
[sqlite store]  signals, opportunities, fans, decisions, memory, digests
      |
      v
[fastify API]  viewer endpoints + decision intake
```

## The three memories

| Memory | Lives in | Holds |
| --- | --- | --- |
| Audience | Mind Soul + signals table | recurring questions, requests, sentiment, topics |
| Relationship | Mind Soul + fans table | who engages, their topics, superfan score |
| Creator | Mind Soul + creator_memory table | approvals, rejections, covered topics, notes |

The sqlite store is a mirror for the viewer. In production the Mind's Soul is
authoritative and the store only caches what the viewer renders.

## The Mind protocol

Every message between backend and Mind is a typed envelope, validated on both
sides with the same Zod schemas in `packages/shared`.

To the Mind: `signals.batch`, `decision`, `creator.note`, `digest.request`
From the Mind: `opportunity.created`, `opportunity.updated`, `digest`,
`reply.draft`, `log`

Transport is pluggable through the `MindGateway` interface:

- `SimulatedMindGateway` runs the same detection logic locally so tests and
  the demo run end to end with zero credentials
- `TelegramMindGateway` posts envelopes into a Telegram group where the real
  Mind bot lives, and polls for the Mind's replies

## Detection logic (detect-demand skill)

1. Normalize every comment to a topic key (stopwords, stemming, dedupe)
2. Cluster by key, count repeats and distinct videos
3. Score demand: `3 x repeats + 5 x videos + 12 if unanswered`
4. Opportunity when score >= threshold (25) and the topic is not covered
5. Relationship memory: `6 x engagements + 12 x questions`, capped at 100
6. Superfans are the authors above the superfan threshold (30)

## The autonomy loop

Workers run on a schedule with an overlap guard:

- every `INGEST_INTERVAL_MIN` minutes: ingest, distill, relay
- daily at `DIGEST_TIME`: ask the Mind for a digest and store it
- after boot: one immediate pipeline run so a fresh deploy shows results

The creator never has to ask. The Mind pushes.

## Judging criteria mapping

| Criterion | How CreatorSignal hits it |
| --- | --- |
| Minds integration depth | Memory and detection live in the Mind; the backend only feeds it and renders its outputs |
| Problem fit | Repeated unanswered questions and nameless superfans are universal creator pain |
| Innovation | Audience listening plus relationship memory, not another post generator |
| Execution | Working backend, seeded demo, replayable pipeline, 29 unit tests |
| Viability | One integration (YouTube comments) is a clear wedge into a huge market |
