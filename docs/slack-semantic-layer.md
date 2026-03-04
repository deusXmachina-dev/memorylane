# Slack Semantic Layer

Goal: only draft a Slack reply when recent MemoryLane activity is clearly useful.

## Flow

1. Slack message is detected by the poller.
2. If no OpenRouter key is configured, keep the current placeholder reply flow.
3. Otherwise load a small activity slice from `storage.activities` using the Slack message timestamp:
   - 30 minutes back
   - 2 minutes forward
   - last 6 activity summaries
4. Run a cheap relevance call on:
   - Slack message text
   - channel ID
   - sender user ID
   - message timestamp
   - recent activity summaries
5. If relevance says `not_relevant`, stop.
6. If relevance says `relevant`, run a second call to draft the reply.
7. Hand the draft to the existing approval / auto-approve flow.

## Files

- [service.ts](/Users/filip/Documents/dxm/memorylane/src/main/integrations/slack/service.ts)
- [index.ts](/Users/filip/Documents/dxm/memorylane/src/main/integrations/slack/semantic/index.ts)
- [context-builder.ts](/Users/filip/Documents/dxm/memorylane/src/main/integrations/slack/semantic/context-builder.ts)
- [relevance-service.ts](/Users/filip/Documents/dxm/memorylane/src/main/integrations/slack/semantic/relevance-service.ts)
- [draft-service.ts](/Users/filip/Documents/dxm/memorylane/src/main/integrations/slack/semantic/draft-service.ts)

## Rules

- Use activity `summary` text first.
- Do not use OCR in this first draft.
- Use Slack `message.ts`, not `Date.now()`, for retrieval.
- Keep Slack posting and approval behavior unchanged.
- If the semantic call fails, throw and retry on the next poll cycle.
