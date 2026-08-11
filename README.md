# CreatorSignal

A persistent Minds agent that listens to your audience, remembers what people
care about, and tells you what to create next.

Built for the Creative Minds Jam #1 (Audience Growth & Engagement track).

## What it does

Creators drown in comments. The questions people keep asking get buried, the
fans who show up everywhere go unnoticed, and nobody knows what to make next.

CreatorSignal is a persistent Mind that lives next to your content:

- **Audience memory** — every comment becomes a signal, clustered by topic
- **Relationship memory** — it tracks who keeps engaging and what they care about
- **Creator memory** — it remembers what you approved, rejected, and covered
- **Demand detection** — repeated unanswered questions surface as opportunities
- **Autonomy** — it pushes a digest on its own schedule, no prompting needed

The example the demo is built around: 47 people ask why Egypt doesn't claim
Bir Tawil across 6 videos, and no video ever answers it. The Mind spots it,
ranks it as the top audience opportunity, and names the 9 superfans who care.

## Monorepo layout

```
apps/backend       Fastify API, ingestion, distiller, workers, seed data
packages/shared    Zod contracts for every record and the Mind protocol
packages/mind-client  MindGateway abstraction: SimulatedMind + Telegram transport
mind/              The real Mind's DNA and skill specs (for onboarding)
docs/              Architecture and demo documentation
```

## Quick start

```bash
pnpm install
pnpm build
pnpm seed              # load the demo dataset and run the pipeline
pnpm dev:backend       # boot the API on :3500 (see .env.example)
```

With the default `.env` (no external keys) the backend runs fully offline:
`MIND_MODE=simulated` runs the detection logic locally and
`SEED_ON_BOOT=true` loads the Bir Tawil fixture on first boot.

## Key endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/opportunities` | Ranked audience opportunities |
| POST | `/api/opportunities/:id/decision` | Approve or reject, feeds creator memory |
| GET | `/api/fans` | Superfan profiles with topics and scores |
| GET | `/api/memory` | The creator memory trail |
| GET | `/api/digests` | Daily digests the Mind produced |
| POST | `/api/pipeline/run` | Manually trigger ingest, distill, or relay |
| POST | `/api/seed/reset` | Reset to the demo dataset |

## Connecting a real Mind

A Mind is required for the submission. The product is built so the Mind is the
brain, not a bolt-on:

1. Sign up at hellominds.ai and awaken a Mind using the DNA in `mind/dna.md`
2. Create a Telegram bot, link it to the Mind, and add both the Mind bot and
   this backend's bot to a group (a Minds Circle)
3. Set `CREATORSIGNAL_MIND_MODE=telegram` plus the bot token and group id
4. The backend feeds distilled signals into the chat as JSON envelopes, the
   Mind's skills (specs in `mind/skills/`) read them, update its Soul memory,
   and reply with opportunity cards and digests

In `simulated` mode the exact same detection logic runs locally so the demo
works end to end before the Mind is connected.
