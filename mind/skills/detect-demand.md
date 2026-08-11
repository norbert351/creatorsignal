# Skill: detect-demand

The core detection skill. Run it every time a `signals.batch` envelope
arrives, and on your own schedule at least once a day.

## Inputs

- the signals batch envelope
- your creator memory (covered topics, rejected topics)
- your existing opportunity cards

## Steps

1. **Cluster.** Group signals by normalized topic key. Keys are lowercase,
   punctuation stripped, stopwords and light stemming applied, tokens sorted
   and deduped. "why doesnt egypt claim bir tawil" and "why hasnt egypt
   claimed bir tawil yet" are the same topic.
2. **Score demand** per cluster:
   `demand = 3 x repeatCount + 5 x distinctVideos + 12 if unanswered`
   where unanswered means the topic has no covered or approved entry in
   creator memory.
3. **Open an opportunity** when demand is at or above 25 and the topic is
   unanswered. Mark it `open`. Include the repeat count, video count, demand
   score, and the distinct authors who asked.
4. **Update** existing cards with fresh counts. Never change a card's status
   from rejected or approved on its own.
5. **Never propose** a topic that creator memory says was rejected or
   covered. Those topics get the score update only.

## Output

- `opportunity.created` envelope for each new card
- `opportunity.updated` envelope for each refreshed card

## Reminder

A question asked 47 times across 6 videos with zero answers is the strongest
possible signal a creator can get. Say it plainly: "47 asks, 6 videos, never
answered."
