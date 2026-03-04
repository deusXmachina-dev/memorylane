# Slack Semantic Layer

Goal: only draft a Slack reply when recent MemoryLane activity is clearly useful.

## Flow

1. Slack message is detected by the poller.
2. If no OpenRouter key is configured, log that Slack semantic replies currently require an OpenRouter key and skip reply generation.
3. Otherwise load a small activity slice from `storage.activities` using the Slack message timestamp:
   - 30 minutes back
   - 2 minutes forward
   - last 6 activity summaries
4. Run a research step that can use local tools:
   - `search_context`
   - `browse_timeline`
   - `get_activity_details`
5. The research step returns `relevant` or `not_relevant`.
6. If `not_relevant`, stop.
7. If `relevant`, run a second call to draft the reply.
8. Hand the draft to the existing approval / auto-approve flow.

## Files

- [service.ts](../src/main/integrations/slack/service.ts)
- [index.ts](../src/main/integrations/slack/semantic/index.ts)
- [context-builder.ts](../src/main/integrations/slack/semantic/context-builder.ts)
- [relevance-service.ts](../src/main/integrations/slack/semantic/relevance-service.ts)
- [draft-service.ts](../src/main/integrations/slack/semantic/draft-service.ts)

## Rules

- Use activity `summary` text first.
- Do not use OCR in this first draft.
- Use Slack `message.ts`, not `Date.now()`, for retrieval.
- Let the model search for likely entities and synonyms from the Slack message.
- Keep Slack posting and approval behavior unchanged.
- If the semantic call fails, throw and retry on the next poll cycle.

## Manual Test

Run:

`npm run slack:semantic:test -- "your Slack message" --ts "2026-03-04T10:00:00Z"`

It uses the production DB path by default. Use `--db-path` to override and `--json` for machine-readable output.
