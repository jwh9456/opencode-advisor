# opencode-advisor

Advisor tool plugin for [OpenCode](https://opencode.ai).

Adds an explicit `advisor` tool that consults a stronger model in a temporary forked session and returns concise strategic guidance.

This is an **advisor-pattern approximation**, not Claude's native server-side advisor API.

## Install

```bash
npm install opencode-advisor
```

Add to `~/.config/opencode/opencode.jsonc` (or your project's `.opencode/opencode.jsonc`):

```jsonc
{
  "plugin": ["opencode-advisor@latest"]
}
```

## Quick start

1. Install the plugin.
2. Create either `~/.config/opencode/plugins/advisor-config.json` for a global default or `.opencode/plugins/advisor-config.json` inside a project for a local override.
3. Set `advisorModel` to the stronger model you want to consult.
4. Start opencode normally — the plugin will inject guidance telling the model to call `advisor` only when genuinely blocked.

### Typical usage

The model will usually call the tool with inputs like:

```json
{
  "question": "What boundary should own validation in this refactor?",
  "blocker": "Parser and repository still depend on each other, so I cannot split the module safely.",
  "attempted": "I first extracted helper functions and then tried interface-based decoupling, but both versions still leave a circular dependency.",
  "context": "Current module mixes parsing, validation, and persistence. I already found circular dependencies between parser.ts and repository.ts."
}
```

## How it works

The plugin registers a custom `advisor` tool.

When the model calls `advisor`, the plugin:

1. forks the current session at the current message,
2. sends a focused prompt to a stronger model,
3. returns the advisor's text back as a tool result,
4. deletes the temporary advisor session.

This gives you a practical advisor workflow inside opencode without patching core internals.

```text
parent session
  └─ advisor tool call
      ├─ fork current session
      ├─ prompt stronger model
      ├─ collect text response
      └─ delete temporary advisor session
```

## Configuration

You can place `advisor-config.json` in either of these locations:

- Global: `~/.config/opencode/plugins/advisor-config.json`
- Project-local: `.opencode/plugins/advisor-config.json`

Precedence is:

1. Environment variables
2. Project-local config
3. Global config
4. Built-in defaults

Example:

```json
{
  "advisorModel": "anthropic/claude-opus-4-5",
  "advisorSystem": null,
  "maxAdvisorCalls": 1,
  "debug": false
}
```

### Fields

| Field | Type | Description |
|---|---|---|
| `advisorModel` | `string \| null` | Model to use in `provider/model` format. If `null`, the forked session uses its default model. |
| `advisorSystem` | `string \| null` | Optional custom system prompt for the advisor session. |
| `maxAdvisorCalls` | `number` | Per-session call budget. Defaults to `1`. `0` means unlimited. |
| `debug` | `boolean` | Print initialization and advisor call logs. |

### Example model setups

```json
{ "advisorModel": "anthropic/claude-opus-4-5" }
```

```json
{ "advisorModel": "github-copilot/claude-opus-4.6" }
```

```json
{ "advisorModel": "openai/o3" }
```

## Environment variables

| Variable | Values | Description |
|---|---|---|
| `ADVISOR_MODEL` | `provider/model` | Override `advisorModel` |
| `ADVISOR_SYSTEM` | string | Override `advisorSystem` |
| `ADVISOR_MAX_CALLS` | integer | Override per-session advisor call budget |
| `ADVISOR_DEBUG` | `true` | Enable debug logging |

## Usage notes

- The plugin injects a system prompt telling the model when to call `advisor`.
- `advisor` is intended for genuine blockers after the model has already tried at least one concrete approach.
- Calls should include the decision to make, the blocker, and what has already been attempted.
- No custom agent files are required for this plugin.
- The per-session advisor call budget is cleared automatically when the session is deleted.
- This plugin does **not** provide Claude-native `advisor_tool_result`, single-request sub-inference, or native advisor billing semantics.

## Limitations

- Each advisor call is an extra session round-trip.
- The advisor runs in a forked opencode session, not inside the provider's native server-side tool loop.
- Native Claude advisor API behavior is out of scope without opencode core/provider support.

## Development

Run tests with:

```bash
bun test
```

## Packaging note

This package is intended for the opencode/Bun plugin loader.
The published entrypoint intentionally points to `index.ts` rather than a separate transpiled CommonJS build.

## License

MIT
