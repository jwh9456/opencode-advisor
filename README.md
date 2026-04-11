# opencode-advisor

Advisor-pattern model routing plugin for [OpenCode](https://opencode.ai).

Routes sub-agent tasks to the right model tier — so complex work gets a powerful model and simple lookups get a fast one.

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

## Setup agents

The plugin routes to three custom agents you define. Copy the examples into your project:

```bash
mkdir -p .opencode/agents
cp node_modules/opencode-advisor/examples/powerful.md  .opencode/agents/
cp node_modules/opencode-advisor/examples/balanced.md  .opencode/agents/
cp node_modules/opencode-advisor/examples/fast.md      .opencode/agents/
```

Edit the `model:` field in each file to match your provider (e.g. `anthropic/claude-sonnet-4-20250514`).

## Modes

### Advisor mode (default)

All `general` sub-agent tasks go to the **balanced** executor. The model can escalate to **powerful** when it needs strategic guidance. Keyword guardrails force escalation/simplification at the edges.

### Routing mode

Keyword-based weighted scoring assigns tasks to **powerful**, **balanced**, or **fast** based on prompt content and token volume.

Switch modes:

```bash
ADVISOR_MODE=routing opencode
```

## Configuration (optional)

Place `advisor-config.json` in `.opencode/plugins/`:

```bash
cp node_modules/opencode-advisor/examples/advisor-config.json .opencode/plugins/
```

See the file for all options (keywords, tiers, escalation/simplification rules).

## Environment variables

| Variable | Values | Description |
|---|---|---|
| `ADVISOR_MODE` | `advisor` \| `routing` | Switch routing strategy |
| `ADVISOR_AGENT_HIGH` | agent name | Override high-tier agent |
| `ADVISOR_AGENT_MEDIUM` | agent name | Override medium-tier agent |
| `ADVISOR_AGENT_LOW` | agent name | Override low-tier agent |
| `ADVISOR_FORCE_INHERIT` | `true` | Disable routing — sub-agents inherit parent model |
| `ADVISOR_DEBUG` | `true` | Log routing decisions to console |

## License

MIT
