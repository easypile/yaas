# YAAS MCP Server Instructions

Use this MCP server when you need concise, stylistically controlled affirmative (**yes-like**) or negative (**no-like**) phrasing.

## When to use it

Use YAAS when you are producing:

- short UI copy,
- conversational confirmations/refusals,
- tone-varied responses for assistants, bots, and demo flows,
- deterministic phrase generation constrained to known categories.

## Available tools

### `get-yes`

Returns one phrase from the **yes** library.

- Optional argument: `kind`
- Supported `kind` values:
  - `agree`
  - `confirm`
  - `contradict`
  - `encourage`

### `get-no`

Returns one phrase from the **no** library.

- Optional argument: `kind`
- Supported `kind` values:
  - `refuse`
  - `surprise`
  - `reinforce`

## Usage guidance

1. Prefer providing `kind` when tone control matters.
2. Omit `kind` to sample across all phrases for that polarity.
3. Expect an error if `kind` is unsupported.
4. Expect an error if a requested `kind` has no loaded phrases.

## Response shape

Tool responses return JSON text payloads in this form:

```json
{ "kind": "agree", "text": "Absolutely, I agree." }
```

Use `kind` for downstream routing/analytics and `text` for user-visible output.
