# Slack Semantic Layer

## Purpose

The Slack semantic layer decides whether MemoryLane has enough useful context to help answer a Slack message.

It sits between:

1. Slack message detection
2. reply drafting
3. the existing approval / auto-post flow

The goal is simple: do not draft a reply unless recent or searchable MemoryLane activity is actually relevant.

## Current Flow

1. A new Slack message is detected.
2. If no OpenRouter key is available, the system logs that Slack semantic replies currently require an OpenRouter key and skips reply generation.
3. A research step can search MemoryLane activity using:
   - semantic search
   - timeline browsing
   - activity detail lookup
4. The research step decides:
   - `relevant`
   - `not_relevant`
5. If the result is `not_relevant`, the flow stops.
6. If the result is `relevant`, a second model call drafts a short Slack reply using the research output.
7. The draft goes through the normal approval / auto-approve flow.

## Main Inputs

- Slack message text
- Slack message timestamp
- searchable activity history

## Main Principles

- Activity summaries are the primary source.
- OCR is only supporting evidence.
- Retrieval should use the Slack message timestamp, not the current time.
- The research step should gather the useful context; the draft step should consume that result instead of rebuilding context.
- Slack posting behavior should stay unchanged.
- If semantic processing fails, skip the reply rather than posting something low-confidence.

## Main Files

- [service.ts](../src/main/integrations/slack/service.ts)
- [index.ts](../src/main/integrations/slack/semantic/index.ts)
- [research-service.ts](../src/main/integrations/slack/semantic/research-service.ts)
- [research-tools.ts](../src/main/integrations/slack/semantic/research-tools.ts)
- [draft-service.ts](../src/main/integrations/slack/semantic/draft-service.ts)
