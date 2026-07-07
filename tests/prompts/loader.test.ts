/**
 * Tests for lib/prompts/loader.ts
 *
 * All prompt files load from docs/prompts/*.md (real disk reads).
 * No mocking of the file system — these are integration tests of the loader.
 * No live API calls.
 *
 * Coverage:
 *  - parseVersion: valid, missing header, malformed
 *  - readPromptFromDisk: all 7 prompt files exist and parse
 *  - getPrompt: cache population on first call, cache hit on second
 *  - loadAllPrompts: all 7 keys in cache after call
 *  - assembleSystemMessage: system + agent content concatenation
 *  - injectVariables: replace chain, null encoding, missing variable passthrough
 *  - versionedModelId: correct format
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseVersion,
  readPromptFromDisk,
  getPrompt,
  getAllPrompts,
  loadAllPrompts,
  assembleSystemMessage,
  getUserMessageTemplate,
  injectVariables,
  versionedModelId,
  _clearPromptCache,
  _getCacheSize,
  type PromptKey,
} from '@/lib/prompts'

const ALL_KEYS: PromptKey[] = [
  'system',
  'conversation',
  'planning',
  'tool',
  'memory',
  'clarification',
  'fallback',
]

// ── parseVersion ──────────────────────────────────────────────────────────────

describe('parseVersion', () => {
  it('parses a valid "VERSION: 1.0.0" header', () => {
    const content = 'VERSION: 1.0.0\n\nsome prompt content'
    const version = parseVersion(content, 'system')
    expect(version.major).toBe(1)
    expect(version.minor).toBe(0)
    expect(version.patch).toBe(0)
    expect(version.raw).toBe('1.0.0')
  })

  it('parses a higher version "VERSION: 2.14.3"', () => {
    const content = 'VERSION: 2.14.3\n'
    const version = parseVersion(content, 'conversation')
    expect(version.major).toBe(2)
    expect(version.minor).toBe(14)
    expect(version.patch).toBe(3)
    expect(version.raw).toBe('2.14.3')
  })

  it('throws when VERSION header is missing', () => {
    const content = '# Some Prompt\n\nContent without version'
    expect(() => parseVersion(content, 'planning')).toThrow(
      /missing a valid VERSION header/
    )
  })

  it('throws when VERSION header is malformed (not semver)', () => {
    const content = 'VERSION: v1.0\n\ncontent'
    expect(() => parseVersion(content, 'tool')).toThrow(
      /missing a valid VERSION header/
    )
  })

  it('throws when VERSION header has extra text', () => {
    const content = 'VERSION: 1.0.0-beta\n\ncontent'
    expect(() => parseVersion(content, 'memory')).toThrow(
      /missing a valid VERSION header/
    )
  })
})

// ── readPromptFromDisk ────────────────────────────────────────────────────────

describe('readPromptFromDisk', () => {
  beforeEach(() => {
    _clearPromptCache()
  })

  it.each(ALL_KEYS)('loads %s.md from disk successfully', (key) => {
    const loaded = readPromptFromDisk(key)
    expect(loaded.key).toBe(key)
    expect(loaded.content.length).toBeGreaterThan(50)
    expect(loaded.version.raw).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('every prompt file has a valid semver version >= 1.0.0', () => {
    for (const key of ALL_KEYS) {
      const { version } = readPromptFromDisk(key)
      expect(version.major).toBeGreaterThanOrEqual(1)
    }
  })

  it('throws for a non-existent prompt key', () => {
    // Cast to bypass TypeScript — we want to test the runtime guard
    expect(() => readPromptFromDisk('nonexistent' as PromptKey)).toThrow()
  })
})

// ── getPrompt + cache ─────────────────────────────────────────────────────────

describe('getPrompt (cache behaviour)', () => {
  beforeEach(() => {
    _clearPromptCache()
  })

  it('starts with empty cache', () => {
    expect(_getCacheSize()).toBe(0)
  })

  it('populates cache on first call', () => {
    getPrompt('system')
    expect(_getCacheSize()).toBe(1)
  })

  it('returns the same object reference on cache hit', () => {
    const first = getPrompt('system')
    const second = getPrompt('system')
    expect(first).toBe(second)
  })

  it('populates cache independently for each key', () => {
    getPrompt('system')
    getPrompt('conversation')
    expect(_getCacheSize()).toBe(2)
  })
})

// ── loadAllPrompts ────────────────────────────────────────────────────────────

describe('loadAllPrompts', () => {
  beforeEach(() => {
    _clearPromptCache()
  })

  it('loads all 7 prompt files into cache', () => {
    loadAllPrompts()
    expect(_getCacheSize()).toBe(7)
  })

  it('all 7 keys are present after loadAllPrompts', () => {
    loadAllPrompts()
    const all = getAllPrompts()
    for (const key of ALL_KEYS) {
      expect(all[key]).toBeDefined()
      expect(all[key]!.key).toBe(key)
    }
  })
})

// ── getAllPrompts ─────────────────────────────────────────────────────────────

describe('getAllPrompts', () => {
  beforeEach(() => {
    _clearPromptCache()
  })

  it('returns all 7 prompts even with empty cache (lazy load)', () => {
    const all = getAllPrompts()
    expect(Object.keys(all)).toHaveLength(7)
  })

  it('all loaded prompts have non-empty content', () => {
    const all = getAllPrompts()
    for (const key of ALL_KEYS) {
      expect(all[key]!.content.trim().length).toBeGreaterThan(0)
    }
  })
})

// ── Typed accessors ───────────────────────────────────────────────────────────

describe('typed accessors', () => {
  beforeEach(() => {
    _clearPromptCache()
  })

  it('getSystemPrompt returns key=system', async () => {
    const { getSystemPrompt } = await import('@/lib/prompts')
    expect(getSystemPrompt().key).toBe('system')
  })

  it('getConversationPrompt returns key=conversation', async () => {
    const { getConversationPrompt } = await import('@/lib/prompts')
    expect(getConversationPrompt().key).toBe('conversation')
  })

  it('getPlanningPrompt returns key=planning', async () => {
    const { getPlanningPrompt } = await import('@/lib/prompts')
    expect(getPlanningPrompt().key).toBe('planning')
  })

  it('getToolPrompt returns key=tool', async () => {
    const { getToolPrompt } = await import('@/lib/prompts')
    expect(getToolPrompt().key).toBe('tool')
  })

  it('getMemoryPrompt returns key=memory', async () => {
    const { getMemoryPrompt } = await import('@/lib/prompts')
    expect(getMemoryPrompt().key).toBe('memory')
  })

  it('getClarificationPrompt returns key=clarification', async () => {
    const { getClarificationPrompt } = await import('@/lib/prompts')
    expect(getClarificationPrompt().key).toBe('clarification')
  })

  it('getFallbackPrompt returns key=fallback', async () => {
    const { getFallbackPrompt } = await import('@/lib/prompts')
    expect(getFallbackPrompt().key).toBe('fallback')
  })
})

// ── assembleSystemMessage ─────────────────────────────────────────────────────

describe('assembleSystemMessage', () => {
  beforeEach(() => {
    _clearPromptCache()
    loadAllPrompts()
  })

  it('output contains content from system.md', () => {
    const result = assembleSystemMessage('conversation')
    const systemContent = getPrompt('system').content
    // First significant line of system.md should be present
    expect(result).toContain('IDENTITY')
  })

  it('output contains content from the agent-specific prompt', () => {
    const result = assembleSystemMessage('conversation')
    // Conversation agent instructions mention SituationContext or JSON output
    expect(result).toMatch(/SituationContext|Conversation Agent|parse.*raw.*food/i)
  })

  it('planning agent system message contains planning content', () => {
    const result = assembleSystemMessage('planning')
    // Planning agent instructions mention scores or the planning role
    expect(result).toMatch(/Planning Agent|pre-calculated scores|winning path/i)
  })

  it('degraded mode block is prepended when provided', () => {
    const degradedBlock = 'DEGRADED MODE ACTIVE: SWIGGY_UNAVAILABLE'
    const result = assembleSystemMessage('planning', degradedBlock)
    // Degraded block should appear somewhere in the assembled message
    expect(result).toContain('DEGRADED MODE ACTIVE')
    // Scores-related content should also be present (from planning.md)
    expect(result).toMatch(/pre-calculated scores|winning path|Planning Agent/i)
  })

  it('output without degraded block does not contain degraded keywords', () => {
    const result = assembleSystemMessage('conversation')
    expect(result).not.toContain('DEGRADED MODE ACTIVE')
  })
})

// ── injectVariables ───────────────────────────────────────────────────────────

describe('injectVariables', () => {
  it('replaces a single variable', () => {
    const template = 'Hello {{name}}!'
    const result = injectVariables(template, { name: 'MealOS' })
    expect(result).toBe('Hello MealOS!')
  })

  it('replaces multiple different variables', () => {
    const template = 'USER INPUT: {{raw_input}}\nMEMORY: {{user_memory_summary}}'
    const result = injectVariables(template, {
      raw_input: 'I am sick',
      user_memory_summary: 'Vegetarian',
    })
    expect(result).toBe('USER INPUT: I am sick\nMEMORY: Vegetarian')
  })

  it('replaces all occurrences of the same variable', () => {
    const template = '{{x}} and {{x}}'
    const result = injectVariables(template, { x: 'foo' })
    expect(result).toBe('foo and foo')
  })

  it('injects literal "null" for null-ish values via explicit null string', () => {
    const template = 'MEMORY: {{user_memory_summary}}'
    const result = injectVariables(template, { user_memory_summary: 'null' })
    expect(result).toBe('MEMORY: null')
  })

  it('leaves unmatched {{variables}} in the template unchanged', () => {
    const template = '{{raw_input}} and {{unknown_var}}'
    const result = injectVariables(template, { raw_input: 'hungry' })
    expect(result).toContain('{{unknown_var}}')
    expect(result).toContain('hungry')
  })

  it('handles empty string values', () => {
    const template = 'Value: {{val}}'
    const result = injectVariables(template, { val: '' })
    expect(result).toBe('Value: ')
  })

  it('handles JSON-encoded objects as values', () => {
    const template = 'DATA: {{context_json}}'
    const obj = JSON.stringify({ situationType: 'sick', confidence: 85 })
    const result = injectVariables(template, { context_json: obj })
    expect(result).toContain('"situationType":"sick"')
  })
})

// ── versionedModelId ──────────────────────────────────────────────────────────

describe('versionedModelId', () => {
  beforeEach(() => {
    _clearPromptCache()
  })

  it('produces model:vVERSION format', () => {
    const system = readPromptFromDisk('system')
    const expected = `claude-haiku-4-5:v${system.version.raw}`
    const result = versionedModelId('claude-haiku-4-5', 'system')
    expect(result).toBe(expected)
  })

  it('works for planning agent (sonnet)', () => {
    const planning = readPromptFromDisk('planning')
    const expected = `claude-sonnet-4-6:v${planning.version.raw}`
    const result = versionedModelId('claude-sonnet-4-6', 'planning')
    expect(result).toBe(expected)
  })

  it('version string matches semver pattern', () => {
    const result = versionedModelId('claude-haiku-4-5', 'conversation')
    expect(result).toMatch(/^claude-haiku-4-5:v\d+\.\d+\.\d+$/)
  })
})

// ── Prompt structure validation ───────────────────────────────────────────────

describe('prompt content structure', () => {
  beforeEach(() => {
    _clearPromptCache()
  })

  it('system.md has no live injection variables (byte-stable prefix rule)', () => {
    const { content } = readPromptFromDisk('system')
    // Per PROMPT_ENGINEERING_GUIDE §6.1: date/time vars should be in user messages
    // system.md is allowed to MENTION {{variables}} in a doc comment but must not
    // inject runtime user-data variables (raw_input, situation_context_json, etc.)
    // The file contains `{{variables}}` in a documentation note — that is fine.
    // The critical constraint is that user-data slots (raw_input, context_json, etc.)
    // do NOT appear in system.md. Only {{current_date}}, {{current_time}},
    // {{day_of_week}} are tolerated per the guide's note.
    const liveVarMatches = content.match(
      /\{\{(?:raw_input|situation_context_json|user_memory_json|pre_calculated_scores_json|swiggy_results_json|pantry_items_json|missing_fields_json)\}\}/g
    )
    expect(liveVarMatches).toBeNull()
  })

  it('conversation.md contains USER MESSAGE TEMPLATE section', () => {
    const { content } = readPromptFromDisk('conversation')
    expect(content).toContain('USER MESSAGE TEMPLATE')
  })

  it('planning.md contains USER MESSAGE TEMPLATE section', () => {
    const { content } = readPromptFromDisk('planning')
    expect(content).toContain('USER MESSAGE TEMPLATE')
  })

  it('planning.md contains pre_calculated_scores_json variable', () => {
    const { content } = readPromptFromDisk('planning')
    expect(content).toContain('{{pre_calculated_scores_json}}')
  })

  it('conversation.md contains raw_input variable', () => {
    const { content } = readPromptFromDisk('conversation')
    expect(content).toContain('{{raw_input}}')
  })

  it('memory.md is an array-output prompt (returns [])', () => {
    const { content } = readPromptFromDisk('memory')
    // Memory agent outputs an array
    expect(content).toContain('[]')
  })
})

// ── getUserMessageTemplate ────────────────────────────────────────────────────

describe('getUserMessageTemplate', () => {
  beforeEach(() => {
    _clearPromptCache()
  })

  it('extracts the conversation user-message template with its variables', () => {
    const template = getUserMessageTemplate('conversation')
    expect(template).toContain('USER INPUT: {{raw_input}}')
    expect(template).toContain('{{user_memory_summary}}')
    expect(template).toContain('{{previous_situation_type}}')
    expect(template).toContain('{{current_date}}')
    expect(template).toContain('{{current_time}}')
    expect(template).toContain('{{day_of_week}}')
  })

  it('extracts the planning user-message template with its variables', () => {
    const template = getUserMessageTemplate('planning')
    expect(template).toContain('{{situation_context_json}}')
    expect(template).toContain('{{pre_calculated_scores_json}}')
    expect(template).toContain('{{swiggy_results_json}}')
  })

  it('extracts the clarification question-generation template', () => {
    const template = getUserMessageTemplate('clarification')
    expect(template).toContain('{{')
  })

  it('returns only the fenced template, not surrounding markdown', () => {
    const template = getUserMessageTemplate('conversation')
    expect(template).not.toContain('```')
    expect(template).not.toContain('## ')
    expect(template).not.toContain('Variable notes')
  })

  it('throws for a prompt file without a user-message template section', () => {
    // system.md has no USER MESSAGE TEMPLATE h2 — the runtime guard must fire
    expect(() => getUserMessageTemplate('system' as never)).toThrow(
      /user.message template/i
    )
  })
})
