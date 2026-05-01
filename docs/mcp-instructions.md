# YAAS MCP Server Instructions

Use this MCP server when you need a concise affirmative response that fits a tone or intent.

## When to use it

- You need a short **yes-like** reply for UX copy, bots, or playful prompts.
- You want a specific tone category (agree, confirm, contradict, encourage).
- You need deterministic validation for accepted tone categories.

## How to use it

1. Call the `get-yes` tool.
2. Optionally provide `kind` with one of:
   - `agree`
   - `confirm`
   - `contradict`
   - `encourage`
3. Omit `kind` to let the server choose from all available categories.
4. If `kind` is invalid, expect an error response.

## Tool quick reference

- Tool: `get-yes`
- Optional input: `{ "kind": "agree" }`
- Output: `{ "kind": "agree", "text": "..." }`
