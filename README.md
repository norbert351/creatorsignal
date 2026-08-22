# CreatorSignal

A persistent Minds agent that listens to your audience, remembers what people
care about, and tells you what to create next. It runs on your real channel
data: no demo fixtures, no canned answers. Set your auth and ingest keys in
`.env` and the backend ingests, distills, and pushes on its own schedule.

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
pnpm dev:backend       # boot the API on :3500 (see .env.example)
```

Set `CREATORSIGNAL_YOUTUBE_API_KEY` (+ channel/video ids) and, optionally, a
`CREATORSIGNAL_LLM_API_KEY` for distilling with an LLM. The backend runs
continuously: workers ingest real comments on a schedule, distill them, and
push opportunities, digests, and a weekly brief. `MIND_MODE=simulated` runs the
detection logic locally; connect a real Minds bot via Telegram for the full
Mind loop.

## Key endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/opportunities` | Ranked audience opportunities |
| POST | `/api/opportunities/:id/decision` | Approve or reject, feeds creator memory |
| GET | `/api/fans` | Superfan profiles with topics and scores |
| GET | `/api/memory` | The creator memory trail |
| GET | `/api/digests` | Daily digests the Mind produced |
| POST | `/api/pipeline/run` | Manually trigger ingest, distill, or relay |
| POST | `/api/brief/generate` | Generate the weekly content brief now |

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
