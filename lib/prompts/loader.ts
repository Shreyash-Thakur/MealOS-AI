/**
 * MealOS AI — Prompt Loader
 *
 * Reads docs/prompts/*.md at boot time, parses version headers, exposes typed
 * per-agent accessors, and holds an in-memory cache so repeated calls never
 * re-read disk.
 *
 * Architecture notes (docs/PROMPT_ENGINEERING_GUIDE.md §6 + prompts/README.md):
 *  - system.md is the byte-stable shared prefix prepended to EVERY agent call.
 *  - Agent-specific prompts follow in the same system message block.
 *  - Date/time/timezone variables are injected via user-message templates so
 *    the system block stays byte-stable for prompt caching.
 *  - Variable injection uses {{snake_case}} replace-chains (never template
 *    literals with embedded expressions).
 *  - Version is parsed from the first line of each file: "VERSION: x.y.z"
 *
 * Prompt file ownership: this module READS docs/prompts/*.md.
 * It NEVER writes or modifies them. docs/ is read-only.
 *
 * @module lib/prompts/loader
 */

import * as fs from 'fs'
import * as path from 'path'

// ── Types ─────────────────────────────────────────────────────────────────────

/** Prompt file keys — one per docs/prompts/*.md file (README.md §7 file index). */
export type PromptKey =
  | 'system'
  | 'conversation'
  | 'planning'
  | 'tool'
  | 'memory'
  | 'clarification'
  | 'fallback'

/** Parsed prompt: raw text content + parsed semver version. */
export interface LoadedPrompt {
  /** The raw file content (includes VERSION header and all sections). */
  content: string
  /** Semver parsed from "VERSION: x.y.z" on the first line. */
  version: PromptVersion
  /** The prompt key (file name without extension). */
  key: PromptKey
}

/** Semver triple from prompt VERSION header. */
export interface PromptVersion {
  major: number
  minor: number
  patch: number
  /** Raw version string e.g. "1.2.0" */
  raw: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** All prompt files that must be present at boot (README.md §7). */
const PROMPT_FILES: readonly PromptKey[] = [
  'system',
  'conversation',
  'planning',
  'tool',
  'memory',
  'clarification',
  'fallback',
] as const

/**
 * Absolute path to docs/prompts/ directory.
 * Resolved relative to the project root (process.cwd()) at load time.
 */
const PROMPTS_DIR = path.resolve(process.cwd(), 'docs', 'prompts')

// ── In-memory cache ───────────────────────────────────────────────────────────

/** Module-level cache — populated on first access, never cleared at runtime. */
const _cache = new Map<PromptKey, LoadedPrompt>()

// ── Version parsing ───────────────────────────────────────────────────────────

/**
 * Parses the VERSION header from prompt file content.
 * Expected format: "VERSION: x.y.z" on the very first line.
 *
 * @param content - Raw file content.
 * @param key - Prompt key (used in error messages only).
 * @returns Parsed PromptVersion.
 * @throws If the VERSION line is absent or malformed.
 */
export function parseVersion(content: string, key: PromptKey): PromptVersion {
  const firstLine = content.split('\n')[0]?.trim() ?? ''
  const match = firstLine.match(/^VERSION:\s*(\d+)\.(\d+)\.(\d+)$/)
  if (!match) {
    throw new Error(
      `[PromptLoader] ${key}.md is missing a valid VERSION header. ` +
      `Expected "VERSION: x.y.z" on the first line, got: "${firstLine}"`
    )
  }
  const [, majorStr, minorStr, patchStr] = match
  // noUncheckedIndexedAccess: these are guaranteed by the regex above
  const major = parseInt(majorStr!, 10)
  const minor = parseInt(minorStr!, 10)
  const patch = parseInt(patchStr!, 10)
  return { major, minor, patch, raw: `${major}.${minor}.${patch}` }
}

// ── Disk loader ───────────────────────────────────────────────────────────────

/**
 * Reads a single prompt file from disk.
 * Does NOT use the cache — callers decide whether to cache.
 *
 * @param key - Which prompt to load.
 * @returns LoadedPrompt with content and parsed version.
 * @throws If the file does not exist or the VERSION header is invalid.
 */
export function readPromptFromDisk(key: PromptKey): LoadedPrompt {
  const filePath = path.join(PROMPTS_DIR, `${key}.md`)
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    throw new Error(
      `[PromptLoader] Failed to read docs/prompts/${key}.md: ` +
      (err instanceof Error ? err.message : String(err))
    )
  }
  const version = parseVersion(content, key)
  return { content, version, key }
}

// ── Cache-aware accessor ──────────────────────────────────────────────────────

/**
 * Returns the LoadedPrompt for the given key.
 * Reads from in-memory cache if available; otherwise reads from disk and
 * populates the cache.
 *
 * @param key - Which prompt to load.
 * @returns LoadedPrompt (possibly from cache).
 */
export function getPrompt(key: PromptKey): LoadedPrompt {
  const cached = _cache.get(key)
  if (cached !== undefined) return cached
  const loaded = readPromptFromDisk(key)
  _cache.set(key, loaded)
  return loaded
}

// ── Boot initialiser ──────────────────────────────────────────────────────────

/**
 * Eagerly loads ALL prompt files into the in-memory cache.
 * Call once at application boot. Subsequent `getPrompt()` calls are cache hits.
 *
 * @throws If any prompt file is missing or has an invalid VERSION header.
 */
export function loadAllPrompts(): void {
  for (const key of PROMPT_FILES) {
    getPrompt(key)
  }
}

/**
 * Returns all loaded prompts from cache (loading any uncached ones first).
 * Useful for introspection, health checks, and tests.
 */
export function getAllPrompts(): Record<PromptKey, LoadedPrompt> {
  const result = {} as Record<PromptKey, LoadedPrompt>
  for (const key of PROMPT_FILES) {
    result[key] = getPrompt(key)
  }
  return result
}

// ── Typed per-agent accessors ─────────────────────────────────────────────────

/** The shared system prefix (system.md). Identical for every agent call. */
export function getSystemPrompt(): LoadedPrompt {
  return getPrompt('system')
}

/** Conversation Agent prompt (claude-haiku-4-5). */
export function getConversationPrompt(): LoadedPrompt {
  return getPrompt('conversation')
}

/** Planning Agent prompt (claude-sonnet-4-6). */
export function getPlanningPrompt(): LoadedPrompt {
  return getPrompt('planning')
}

/** Tool Agent prompt (claude-haiku-4-5). */
export function getToolPrompt(): LoadedPrompt {
  return getPrompt('tool')
}

/** Memory Agent prompt (claude-haiku-4-5). */
export function getMemoryPrompt(): LoadedPrompt {
  return getPrompt('memory')
}

/** Clarification Engine prompt (claude-haiku-4-5 per PROMPT_ENGINEERING_GUIDE §2.3). */
export function getClarificationPrompt(): LoadedPrompt {
  return getPrompt('clarification')
}

/**
 * Fallback / degraded-mode library (fallback.md).
 * Not an agent — contains injectable instruction blocks and static templates.
 */
export function getFallbackPrompt(): LoadedPrompt {
  return getPrompt('fallback')
}

// ── Prompt assembly helpers ───────────────────────────────────────────────────

/**
 * Assembles the system message for an agent call.
 *
 * Per docs/PROMPT_ENGINEERING_GUIDE.md §6.1 and prompts/README.md §2:
 *   system message = [system.md content] + [agent-specific system prompt section]
 *
 * Extraction strategy for agent-specific system content:
 *  1. If the file contains a fenced code block that holds the system prompt
 *     (tool.md, memory.md, clarification.md pattern: ``` ... ```), extract it.
 *  2. Otherwise, extract the text after the first `---` separator that follows
 *     a `## SYSTEM PROMPT` or `## 1. SYSTEM PROMPT` heading. The blockquote
 *     note lines (starting with `>`) are skipped, and the text from the next
 *     `---` onward (until the next `##` heading or end) is used.
 *  3. If neither pattern matches, the full agent prompt content is appended.
 *
 * @param agentKey - The agent-specific prompt key (not 'system').
 * @param degradedModeBlock - Optional injection block from fallback.md
 *   prepended to the agent section (AP-6: conditional injection, not permanent).
 */
export function assembleSystemMessage(
  agentKey: Exclude<PromptKey, 'system' | 'fallback'>,
  degradedModeBlock?: string,
): string {
  const systemContent = getSystemPrompt().content
  const agentContent = getPrompt(agentKey).content

  const agentSystemSection = extractAgentSystemSection(agentContent)

  const parts: string[] = [systemContent.trim()]

  if (degradedModeBlock) {
    parts.push(degradedModeBlock.trim())
  }

  parts.push(agentSystemSection)

  return parts.join('\n\n')
}

/**
 * Extracts the agent-specific system prompt instructions from a prompt file.
 *
 * Handles both authoring styles present in docs/prompts/:
 *  - Fenced style (tool.md, memory.md, clarification.md): the system prompt
 *    lives inside a ``` code fence within the "System Prompt" h2 section.
 *  - Inline style (conversation.md, planning.md): the system prompt is the
 *    entire h2 section content (instructions, rule tables, subsections), with
 *    blockquote note lines stripped.
 *
 * The section is bounded by the next h2 (`## `) heading, which in every prompt
 * file is the USER MESSAGE TEMPLATE — so template `{{variables}}` never leak
 * into the system message (README.md §3 injection safety).
 *
 * Falls back to the full file content if no "SYSTEM PROMPT" heading is found.
 *
 * @internal
 */
export function extractAgentSystemSection(agentContent: string): string {
  // Find the first h2 heading whose text contains "SYSTEM PROMPT"
  // (matches "## SYSTEM PROMPT", "## 1. SYSTEM PROMPT", "## System Prompt",
  //  and "## 1. QUESTION GENERATION SYSTEM PROMPT").
  const headingMatch = agentContent.match(/^##[^\n#]*SYSTEM PROMPT[^\n]*$/im)
  if (headingMatch === null || headingMatch.index === undefined) {
    // No system prompt heading — use full content (defensive fallback).
    return agentContent.trim()
  }

  const sectionStart = headingMatch.index + headingMatch[0].length
  const rest = agentContent.slice(sectionStart)
  // Section ends at the next h2 heading ("\n## " — three chars so h3 "###" is
  // not matched) or at end of file.
  const nextH2 = rest.search(/\n## /)
  const section = nextH2 === -1 ? rest : rest.slice(0, nextH2)

  // Fenced style: system prompt inside a ``` fence. Reject fences containing
  // {{variables}} — those are user-message templates, not system prompts.
  const fenceMatch = section.match(/```\n([\s\S]*?)\n```/)
  if (fenceMatch) {
    const fenceContent = (fenceMatch[1] ?? '').trim()
    if (!fenceContent.includes('{{')) {
      return fenceContent
    }
  }

  // Inline style: the whole section minus blockquote note lines
  // ("> The global system context ... is prepended ...").
  const inline = section
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .trim()

  return inline.length > 0 ? inline : agentContent.trim()
}

/** Prompt keys that contain a fenced USER MESSAGE TEMPLATE section. */
export type UserTemplateKey = Exclude<PromptKey, 'system' | 'fallback'>

/**
 * Extracts the fenced user-message template from an agent prompt file.
 *
 * Every agent prompt with a user-message contract authors it the same way
 * (README.md §3): an h2 heading containing "USER MESSAGE TEMPLATE" followed by
 * a ``` fence holding the template with {{snake_case}} variables. This
 * function returns the fence content only — surrounding markdown (variable
 * reference tables, notes) never reaches the model.
 *
 * @param key - Prompt key with a user-message template section.
 * @returns The raw template string, ready for `injectVariables`.
 * @throws If the file has no USER MESSAGE TEMPLATE heading or no fence in it.
 */
export function getUserMessageTemplate(key: UserTemplateKey): string {
  const { content } = getPrompt(key)

  const headingMatch = content.match(/^##[^\n#]*USER MESSAGE TEMPLATE[^\n]*$/im)
  if (headingMatch === null || headingMatch.index === undefined) {
    throw new Error(
      `[PromptLoader] ${key}.md has no USER MESSAGE TEMPLATE heading — ` +
      'cannot extract user-message template'
    )
  }

  const rest = content.slice(headingMatch.index + headingMatch[0].length)
  const nextH2 = rest.search(/\n## /)
  const section = nextH2 === -1 ? rest : rest.slice(0, nextH2)

  const fenceMatch = section.match(/```\n([\s\S]*?)\n```/)
  if (!fenceMatch) {
    throw new Error(
      `[PromptLoader] ${key}.md USER MESSAGE TEMPLATE section has no fenced ` +
      'template block — cannot extract user-message template'
    )
  }

  return (fenceMatch[1] ?? '').trim()
}

/**
 * Injects {{snake_case}} variables into a template string using a replace chain.
 *
 * Per prompts/README.md §3 and PROMPT_ENGINEERING_GUIDE §5.5:
 * - All variables use double-brace {{snake_case}} format.
 * - Null/undefined values become the literal string "null".
 * - JSON payloads must be pre-stringified by the caller.
 * - Raw user input must only appear in USER MESSAGE templates, never system prompts.
 *
 * @param template - The template string with {{variable}} placeholders.
 * @param variables - Map of variable_name → string value.
 * @returns Template with all variables replaced.
 */
export function injectVariables(
  template: string,
  variables: Record<string, string>,
): string {
  let result = template
  for (const [key, value] of Object.entries(variables)) {
    // Replace all occurrences of {{key}} — use replaceAll for global replace
    result = result.replaceAll(`{{${key}}}`, value ?? 'null')
  }
  return result
}

/**
 * Returns the version string to embed in `model_used` log fields.
 * Format per prompts/README.md §4: "claude-haiku-4-5:v1.2.0"
 *
 * @param model - The Anthropic model ID.
 * @param promptKey - Which prompt version to append.
 */
export function versionedModelId(
  model: string,
  promptKey: PromptKey,
): string {
  const { version } = getPrompt(promptKey)
  return `${model}:v${version.raw}`
}

// ── Cache management (tests only) ─────────────────────────────────────────────

/**
 * Clears the in-memory prompt cache.
 * ONLY for use in tests — never call from application code.
 * @internal
 */
export function _clearPromptCache(): void {
  _cache.clear()
}

/**
 * Returns the current cache size.
 * ONLY for use in tests — never call from application code.
 * @internal
 */
export function _getCacheSize(): number {
  return _cache.size
}
