/**
 * tests/api/memory.test.ts
 * Unit tests for GET /api/v1/memory and PATCH /api/v1/memory
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Env setup (must be before any module imports) ─────────────────────────────
process.env['DATABASE_URL'] ??= 'postgres://test:test@localhost:5432/test'
process.env['ANTHROPIC_API_KEY'] ??= 'test-key'
process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] ??= 'pk_test'
process.env['CLERK_SECRET_KEY'] ??= 'sk_test'
process.env['YOUTUBE_API_KEY'] ??= 'yt_test'

// ── Mocks ──────────────────────────────────────────────────────────────────────
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { user: { findUnique: vi.fn() } } }))
vi.mock('@/lib/repositories/memoryFactRepo', () => ({
  getFactRowsForUser: vi.fn(),
  upsertFactExact: vi.fn(),
  deleteFact: vi.fn(),
  getFactRowByKey: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import {
  getFactRowsForUser,
  upsertFactExact,
  deleteFact,
  getFactRowByKey,
} from '@/lib/repositories/memoryFactRepo'
import { GET, PATCH } from '@/app/api/v1/memory/route'

// ── Typed mock helpers ────────────────────────────────────────────────────────
const mockAuth = vi.mocked(auth)
const mockFindUnique = vi.mocked(db.user.findUnique)
const mockGetFactRows = vi.mocked(getFactRowsForUser)
const mockUpsertExact = vi.mocked(upsertFactExact)
const mockDeleteFact = vi.mocked(deleteFact)
const mockGetFactRowByKey = vi.mocked(getFactRowByKey)

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_USER = { id: 'user-db-id', clerkId: 'clerk-user-1' }

function makeFactRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'fact-1',
    userId: 'user-db-id',
    factKey: 'dietary.restrictions',
    factValue: ['vegetarian'],
    source: 'ONBOARDING',
    confidence: 1.0,
    timesConfirmed: 1,
    lastConfirmedAt: new Date('2026-07-01T00:00:00Z'),
    expiresAt: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  }
}

function makeGetRequest() {
  return new Request('http://localhost/api/v1/memory', { method: 'GET' })
}

function makePatchRequest(body: unknown) {
  return new Request('http://localhost/api/v1/memory', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── GET tests ─────────────────────────────────────────────────────────────────

describe('GET /api/v1/memory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth returns userId: null', async () => {
    mockAuth.mockResolvedValue({ userId: null } as never)

    const res = await GET(makeGetRequest())
    expect(res.status).toBe(401)
  })

  it('returns 404 when user not found in DB', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk-user-1' } as never)
    mockFindUnique.mockResolvedValue(null)

    const res = await GET(makeGetRequest())
    expect(res.status).toBe(404)
  })

  it('returns 200 with empty profile and empty facts when no facts exist', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk-user-1' } as never)
    mockFindUnique.mockResolvedValue(MOCK_USER as never)
    mockGetFactRows.mockResolvedValue([])

    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)

    const body = await res.json() as Record<string, unknown>
    expect(body['facts']).toEqual([])
    expect(body['fact_count']).toBe(0)
    expect(body['onboarding_complete']).toBe(false)
    expect(body['profile']).toBeDefined()
  })

  it('returns 200 with populated profile.diet_type when dietary.restrictions fact exists', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk-user-1' } as never)
    mockFindUnique.mockResolvedValue(MOCK_USER as never)
    mockGetFactRows.mockResolvedValue([makeFactRow()] as never)

    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)

    const body = await res.json() as Record<string, unknown>
    const profile = body['profile'] as Record<string, unknown>
    expect(profile['diet_type']).toBe('vegetarian')
  })

  it('each MemoryFactView has display_label, display_category, editable, fact_type', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk-user-1' } as never)
    mockFindUnique.mockResolvedValue(MOCK_USER as never)
    mockGetFactRows.mockResolvedValue([makeFactRow()] as never)

    const res = await GET(makeGetRequest())
    const body = await res.json() as Record<string, unknown>
    const facts = body['facts'] as Record<string, unknown>[]

    expect(facts).toHaveLength(1)
    const fact = facts[0]!
    expect(fact['display_label']).toBe('Dietary restrictions')
    expect(fact['display_category']).toBe('Dietary')
    expect(fact['fact_type']).toBe('array')
    expect(typeof fact['editable']).toBe('boolean')
  })

  it('AGENT_INFERRED facts have editable: false; ONBOARDING facts have editable: true', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk-user-1' } as never)
    mockFindUnique.mockResolvedValue(MOCK_USER as never)
    mockGetFactRows.mockResolvedValue([
      makeFactRow({ id: 'fact-1', source: 'ONBOARDING' }),
      makeFactRow({ id: 'fact-2', factKey: 'dietary.allergies', factValue: ['nuts'], source: 'AGENT_INFERRED' }),
    ] as never)

    const res = await GET(makeGetRequest())
    const body = await res.json() as Record<string, unknown>
    const facts = body['facts'] as Record<string, unknown>[]

    const onboarding = facts.find((f) => f['id'] === 'fact-1')
    const agentInferred = facts.find((f) => f['id'] === 'fact-2')

    expect(onboarding!['editable']).toBe(true)
    expect(agentInferred!['editable']).toBe(false)
  })

  it('onboarding_complete: true when all 4 required facts are present', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk-user-1' } as never)
    mockFindUnique.mockResolvedValue(MOCK_USER as never)
    mockGetFactRows.mockResolvedValue([
      makeFactRow({ id: 'f1', factKey: 'dietary.restrictions',    factValue: ['vegetarian'] }),
      makeFactRow({ id: 'f2', factKey: 'budget.daily_food_target', factValue: 500 }),
      makeFactRow({ id: 'f3', factKey: 'kitchen.skill_level',     factValue: 'intermediate' }),
      makeFactRow({ id: 'f4', factKey: 'location.home',           factValue: 'Bandra West, Mumbai' }),
    ] as never)

    const res = await GET(makeGetRequest())
    const body = await res.json() as Record<string, unknown>
    expect(body['onboarding_complete']).toBe(true)
  })
})

// ── PATCH tests ───────────────────────────────────────────────────────────────

describe('PATCH /api/v1/memory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue({ userId: null } as never)

    const res = await PATCH(makePatchRequest({ updates: [{ key: 'dietary.restrictions', value: ['vegan'] }] }))
    expect(res.status).toBe(401)
  })

  it('returns 400 on invalid body (missing updates field)', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk-user-1' } as never)
    mockFindUnique.mockResolvedValue(MOCK_USER as never)

    const res = await PATCH(makePatchRequest({ wrong: 'field' }))
    expect(res.status).toBe(400)
  })

  it('updates a fact successfully', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk-user-1' } as never)
    mockFindUnique.mockResolvedValue(MOCK_USER as never)
    mockGetFactRowByKey.mockResolvedValue(makeFactRow({ source: 'ONBOARDING' }) as never)
    mockUpsertExact.mockResolvedValue(makeFactRow() as never)

    const res = await PATCH(makePatchRequest({
      updates: [{ key: 'dietary.restrictions', value: ['vegan'] }],
    }))
    expect(res.status).toBe(200)

    const body = await res.json() as Record<string, unknown>
    expect(body['updated']).toBe(1)
    expect(body['created']).toBe(0)
    expect(body['deleted']).toBe(0)
    expect(body['failures']).toEqual([])
  })

  it('deletes a fact when value is null', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk-user-1' } as never)
    mockFindUnique.mockResolvedValue(MOCK_USER as never)
    mockDeleteFact.mockResolvedValue(undefined)

    const res = await PATCH(makePatchRequest({
      updates: [{ key: 'dietary.restrictions', value: null }],
    }))
    expect(res.status).toBe(200)

    const body = await res.json() as Record<string, unknown>
    expect(body['deleted']).toBe(1)
    expect(body['updated']).toBe(0)
    expect(body['created']).toBe(0)
    expect(body['failures']).toEqual([])
  })

  it('returns FACT_NOT_EDITABLE failure for AGENT_INFERRED fact', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk-user-1' } as never)
    mockFindUnique.mockResolvedValue(MOCK_USER as never)
    mockGetFactRowByKey.mockResolvedValue(makeFactRow({ source: 'AGENT_INFERRED' }) as never)

    const res = await PATCH(makePatchRequest({
      updates: [{ key: 'dietary.restrictions', value: ['vegan'] }],
    }))
    expect(res.status).toBe(200)

    const body = await res.json() as Record<string, unknown>
    const failures = body['failures'] as Record<string, unknown>[]
    expect(failures).toHaveLength(1)
    expect(failures[0]!['code']).toBe('FACT_NOT_EDITABLE')
    expect(failures[0]!['key']).toBe('dietary.restrictions')
  })

  it('returns INVALID_VALUE_TYPE failure when value fails FactValueSchemas validation', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk-user-1' } as never)
    mockFindUnique.mockResolvedValue(MOCK_USER as never)
    // dietary.restrictions expects string[] — pass a number instead
    mockGetFactRowByKey.mockResolvedValue(makeFactRow({ source: 'ONBOARDING' }) as never)

    const res = await PATCH(makePatchRequest({
      updates: [{ key: 'dietary.restrictions', value: 42 }],
    }))
    expect(res.status).toBe(200)

    const body = await res.json() as Record<string, unknown>
    const failures = body['failures'] as Record<string, unknown>[]
    expect(failures).toHaveLength(1)
    expect(failures[0]!['code']).toBe('INVALID_VALUE_TYPE')
  })

  it('returns ITEM_NOT_FOUND as failure (not 404) when deleting non-existent fact', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk-user-1' } as never)
    mockFindUnique.mockResolvedValue(MOCK_USER as never)

    // Simulate PrismaClientKnownRequestError P2025
    const prismaError = Object.assign(new Error('Record not found'), {
      code: 'P2025',
      name: 'PrismaClientKnownRequestError',
      clientVersion: '5.0.0',
    })
    mockDeleteFact.mockRejectedValue(prismaError)

    const res = await PATCH(makePatchRequest({
      updates: [{ key: 'dietary.restrictions', value: null }],
    }))
    expect(res.status).toBe(200)

    const body = await res.json() as Record<string, unknown>
    expect(body['deleted']).toBe(0)
    const failures = body['failures'] as Record<string, unknown>[]
    expect(failures).toHaveLength(1)
    expect(failures[0]!['code']).toBe('ITEM_NOT_FOUND')
  })
})
