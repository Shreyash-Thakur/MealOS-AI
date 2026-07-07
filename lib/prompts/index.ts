/**
 * MealOS AI — Prompt Library Barrel
 *
 * Re-exports everything from lib/prompts/loader.ts so callers write:
 *   import { getSystemPrompt, assembleSystemMessage } from '@/lib/prompts'
 *
 * @module lib/prompts
 */

export type { PromptKey, LoadedPrompt, PromptVersion, UserTemplateKey } from './loader'

export {
  // Core accessors
  getPrompt,
  getAllPrompts,
  loadAllPrompts,

  // Typed per-agent accessors
  getSystemPrompt,
  getConversationPrompt,
  getPlanningPrompt,
  getToolPrompt,
  getMemoryPrompt,
  getClarificationPrompt,
  getFallbackPrompt,

  // Assembly helpers
  assembleSystemMessage,
  getUserMessageTemplate,
  injectVariables,
  versionedModelId,

  // Parsing utility (used by tests and the loader itself)
  parseVersion,
  readPromptFromDisk,

  // Test-only utilities (prefixed _)
  _clearPromptCache,
  _getCacheSize,
} from './loader'
