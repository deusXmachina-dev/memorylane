# Phase 3 - Agent C: MCP Guidance and Prompt Updates

## Objective

Update MCP-facing guidance so LLM consumers interpret data correctly:

- Use `summary` for activity conclusions
- Use `OCR` only for exact recall
- Avoid inferring user actions from OCR alone

## Primary Files

- `src/main/mcp/server.ts` (server-level instructions)
- `src/main/mcp/prompts.ts` (prompt templates)
- `src/main/mcp/tools.ts` (tool descriptions and response wording)
- `README.md` or MCP docs section (if user-facing docs exist)

## Implementation Scope

1. **Server Instructions Update**
   - Revise top-level instructions to explicitly distinguish:
     - activity inference source: `summary`
     - precise lookup source: `OCR`
   - Add explicit warning about OCR ambiguity:
     - unknown authorship
     - passive reading vs active writing
     - unrelated on-screen text (ads/notifications)

2. **Prompt Template Alignment**
   - Update `recent_activity` and `time_report` prompts to:
     - prefer summary-driven conclusions
     - request OCR only for quote-level or exact-string needs

3. **Tool Documentation Clarity**
   - Keep existing tool signatures unchanged.
   - Improve descriptions so clients know:
     - `search_context`/`browse_timeline` are summary-oriented
     - `get_event_details` is for deep OCR inspection and exact recall

4. **Output Framing**
   - Ensure examples and docs encourage:
     - "what user did" from summaries
     - "what text appeared" from OCR

## Deliverables

- Updated MCP instruction text and prompt wording.
- No API/tool contract changes.
- Clear consumer-facing guidance embedded in server metadata.

## Acceptance Criteria

- MCP instructions explicitly forbid activity inference from OCR alone.
- Prompts consistently direct summary-first reasoning.
- Existing MCP clients continue to work without code changes.

## Risks and Mitigations

- **Risk:** Guidance too verbose reduces model adherence  
  **Mitigation:** Keep rules short, explicit, and repeated in key prompt surfaces.
- **Risk:** Conflicting wording across files  
  **Mitigation:** Reuse a shared phrasing pattern across server and prompts.

## Handoff to Agent D

- Provide before/after prompt snapshots for validation.
- Provide sample expected answers for activity vs recall questions.
