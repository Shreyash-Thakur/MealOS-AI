# MealOS AI — Prompt Library

## 1. Prompt Architecture Philosophy

MealOS uses a 4-agent pipeline. Each agent has a single responsibility and a fixed model assignment:

| Agent | Model | SLA | Role |
|---|---|---|---|
| Conversation Agent | claude-haiku-4-5 | < 800ms | Raw input → SituationContext JSON |
| Planning Agent | claude-sonnet-4-6 | < 5s | Full context → Recommendation JSON |
| Tool Agent | claude-haiku-4-5 | < 3s | Execute external API calls, normalize responses |
| Memory Agent | claude-haiku-4-5 | Async | Completed interaction → Persistent facts |

**Scores are never computed by Claude.** Cook / Order / Dineout path scores (0–100) are computed by deterministic TypeScript code before any LLM call. Claude receives pre-calculated scores and writes the explanation for why the winner won. This is non-negotiable: if score computation moves into Claude, scores become non-deterministic and non-auditable.

**System prompt is a prefix, not a document.** The contents of `system.md` are injected as the opening block of the system message for every agent call. Agent-specific prompt content follows it in the same system message. They are concatenated, not merged.

**Memory before questions.** Before the clarification engine generates any question, the Memory Service is queried. A question whose answer is already in memory is never generated. Violating this rule creates a broken UX and wastes tokens.

---

## 2. How Prompts Compose

Every agent call is assembled in this order:

```
system message = [system.md content] + [agent-specific system prompt]
user message   = [agent user message template] with {{variables}} interpolated
```

The system prefix (`system.md`) is identical across all four agents. It establishes identity, tone, and universal rules. The agent-specific system prompt adds the reasoning instructions, output schema, and examples for that specific agent.

User message templates carry the dynamic payload. Structured inputs (SituationContext, Swiggy results, user memory) are injected as JSON into the user message, not the system message.

The Planning Agent is the only agent that receives output from another agent (Tool Agent results). All other agents receive only their designated inputs. Agents do not call each other directly — they communicate through the orchestrator.

---

## 3. Variable Injection Convention

All injected variables use `{{snake_case}}` format with double curly braces.

**Types of variables:**

| Type | Format | Example |
|---|---|---|
| Scalar string | `{{variable_name}}` | `{{situation_type}}` |
| Scalar number | `{{variable_name}}` | `{{budget_inr}}` |
| ISO date | `{{current_date}}` | `2026-07-05` |
| 24h time | `{{current_time}}` | `21:34` |
| Day of week | `{{day_of_week}}` | `Sunday` |
| JSON object | `{{variable_name_json}}` | `{{situation_context_json}}` |
| JSON array | `{{variable_name_json}}` | `{{pantry_items_json}}` |
| Null/missing | literal string `"null"` | — |

**Prompt injection safety rules:**
- Raw user input (`{{raw_input}}`) is injected only into user message templates, never into the system prompt.
- JSON payloads are always `JSON.stringify`-encoded before injection. Never interpolate raw object literals.
- Null and undefined fields are always injected as the literal string `"null"`. Never omit a variable from the template or leave it as an empty string — the agent needs to know the difference between "not provided" and "not applicable."

**TypeScript injection pattern:**

```typescript
const userMessage = CONVERSATION_USER_TEMPLATE
  .replace('{{raw_input}}', userInput)
  .replace('{{user_memory_summary}}', JSON.stringify(memorySummary) ?? 'null')
  .replace('{{previous_situation_type}}', previousType ?? 'null');
```

Use the same pattern for all agents. Never use template literals with embedded expressions — interpolation must go through the replace chain so variables are auditable.

---

## 4. Versioning Strategy

Every prompt file begins with a version declaration:

```
VERSION: 1.0.0
```

Semantic versioning rules for prompt files:

| Change type | Version bump | Example |
|---|---|---|
| Output schema change (added/removed field) | **Major** | 1.0.0 → 2.0.0 |
| New required input variable | **Major** | 1.0.0 → 2.0.0 |
| New examples, clarified instructions | **Minor** | 1.0.0 → 1.1.0 |
| Reworded instructions (same semantics) | **Minor** | 1.0.0 → 1.1.0 |
| Typo fixes, formatting | **Patch** | 1.0.0 → 1.0.1 |

The version string is logged with every agent run in the `situation_agent_runs.model_used` field (append `:v{VERSION}` to the model name string, e.g., `claude-haiku-4-5:v1.2.0`). This makes it possible to correlate output quality degradation with specific prompt versions in post-hoc analysis.

Rolling back a prompt: change the VERSION string and content in the file, redeploy. No database migration is needed. The new version takes effect on the next request.

Each file maintains a CHANGELOG section at the bottom. Add an entry on every non-patch change.

---

## 5. How to Update a Prompt in Production

1. Edit the prompt file.
2. Bump the version following the rules above.
3. Add a CHANGELOG entry: date, old version → new version, what changed, why.
4. Run evaluation: execute the file's example inputs through the updated prompt. Every example must produce output that matches the expected schema and passes the semantic checks for that example. Minimum 5 representative inputs for minor changes; minimum 10 for major changes.
5. Deploy via standard `git push` → Vercel deploy pipeline. No separate step.
6. Monitor: query `situation_agent_runs` for `error_message IS NOT NULL` grouped by `agent_name` for the 30 minutes following deploy. Error rate increase > 2% vs. the prior 30-minute baseline is a rollback trigger.

Do not edit prompts live in the Vercel environment. All changes go through git.

---

## 6. Cost Implications

The system prefix (`system.md`) is injected on every call across all four agents. Keep it under 400 tokens. Every token added to the system prefix is multiplied by total daily agent calls.

**Per-call cost estimates at current model pricing:**

| Agent | Input tokens | Output tokens | Cost/call | Cost at 1k calls/day |
|---|---|---|---|---|
| Conversation (Haiku) | ~800 | ~200 | ~$0.00003 | ~$0.03 |
| Planning (Sonnet) | ~3,000 | ~800 | ~$0.0032 | ~$3.20 |
| Tool (Haiku) | ~600 | ~400 | ~$0.00002 | ~$0.02 |
| Memory (Haiku) | ~500 | ~300 | ~$0.00002 | ~$0.02 |
| **Total** | | | | **~$3.27/day** |

The Planning Agent represents ~98% of daily LLM cost. Optimize its prompt first. Every 100 tokens removed from the Planning Agent system prompt saves ~$0.096/day at 1000 situations/day.

**Prompt caching:** The system prefix and agent-specific system prompts are eligible for Claude prompt caching when using the Anthropic API directly (cache_control requires the block to exceed 1024 tokens). If the combined system message exceeds 1024 tokens, add `"cache_control": {"type": "ephemeral"}` to the system message block. This reduces cost by ~90% on the cached portion for repeated calls within the cache TTL (5 minutes).

---

## 7. File Index

| File | Agent | Model | Description |
|---|---|---|---|
| `system.md` | All | — | Global system prefix injected into every agent call |
| `conversation.md` | Conversation Agent | claude-haiku-4-5 | Raw user input → SituationContext JSON |
| `planning.md` | Planning Agent | claude-sonnet-4-6 | Full context + pre-calculated scores → Recommendation JSON |
| `tool.md` | Tool Agent | claude-haiku-4-5 | Tool definitions, call instructions, normalization rules |
| `memory.md` | Memory Agent | claude-haiku-4-5 | Completed interaction → Persistent fact array |
| `clarification.md` | Clarification Engine | claude-sonnet-4-6 | Missing fields → Question objects with quick-tap options |
| `fallback.md` | All (degraded mode) | — | Static responses for Swiggy down, LLM timeout, non-food input, low confidence |

---

## CHANGELOG

| Date | Version | Change | Reason |
|---|---|---|---|
| 2026-07-05 | 1.0.0 | Initial prompt library | Pre-production baseline |
