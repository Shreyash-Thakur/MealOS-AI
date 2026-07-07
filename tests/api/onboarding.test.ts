/**
 * tests/api/onboarding.test.ts
 * Unit tests for POST /api/v1/onboarding
 *
 * All external dependencies are mocked: no DB, no Clerk, no actual writes.
 */

// ── Environment stubs (must precede any module that reads process.env) ─────────
process.env['DATABASE_URL'] ??= 'postgres://test:test@localhost:5432/test'
process.env['ANTHROPIC_API_KEY'] ??= 'test-key'
process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] ??= 'pk_test'
process.env['CLERK_SECRET_KEY'] ??= 'sk_test'
process.env['YOUTUBE_API_KEY'] ??= 'yt_test'

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { user: { findUnique: vi.fn() } } }))
vi.mock('@/lib/repositories/memoryFactRepo', () => ({ upsertFactsBatch: vi.fn() }))

// Import after mocks are registered
import { POST } from '@/app/api/v1/onboarding/route'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { upsertFactsBatch } from '@/lib/repositories/memoryFactRepo'

const mockAuth = vi.mocked(auth)
const mockFindUnique = vi.mocked(db.user.findUnique)
const mockUpsertBatch = vi.mocked(upsertFactsBatch)

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_USER = { id: 'usr_abc123' }

const REQUIRED_BODY = {
  diet_type: 'vegetarian',
  home_address: '123 Test Street, Mumbai 400001',
  daily_food_budget: 500,
  cooking_skill: 'intermediate',
}

const FULL_BODY = {
  ...REQUIRED_BODY,
  allergies: ['peanuts', 'shellfish', 'gluten', 'dairy', 'eggs'],
  kitchen_equipment: ['gas stove', 'mixer', 'pressure cooker'],
  daily_protein_target: 120,
  daily_calorie_target: 2000,
  gym_days: ['Monday', 'Wednesday', 'Friday'],
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: authenticated + user found + upsert succeeds
  mockAuth.mockResolvedValue({ userId: 'clerk_user_001' } as ReturnType<typeof auth> extends Promise<infer T> ? T : never)
  mockFindUnique.mockResolvedValue(FAKE_USER as never)
  mockUpsertBatch.mockResolvedValue([] as never)
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/v1/onboarding', () => {
  it('returns 401 when auth() returns userId: null', async () => {
    mockAuth.mockResolvedValue({ userId: null } as ReturnType<typeof auth> extends Promise<infer T> ? T : never)

    const res = await POST(makeRequest(REQUIRED_BODY))

    expect(res.status).toBe(401)
  })

  it('returns 404 when db.user.findUnique returns null', async () => {
    mockFindUnique.mockResolvedValue(null as never)

    const res = await POST(makeRequest(REQUIRED_BODY))

    expect(res.status).toBe(404)
  })

  it('returns 400 on invalid body (missing required fields)', async () => {
    const res = await POST(makeRequest({ diet_type: 'vegetarian' }))

    expect(res.status).toBe(400)
    const json = await res.json() as { code: string; message: string }
    expect(json.code).toBe('INVALID_ONBOARDING_DATA')
    expect(typeof json.message).toBe('string')
  })

  it('returns 201 with correct shape on happy path', async () => {
    const res = await POST(makeRequest(REQUIRED_BODY))

    expect(res.status).toBe(201)
    const json = await res.json() as Record<string, unknown>
    expect(json['user_id']).toBe(FAKE_USER.id)
    expect(json['onboarding_complete']).toBe(true)
    expect(json['profile_complete']).toBe(true)
    expect(json['next_step']).toBe('home')
    expect(typeof json['facts_stored']).toBe('number')
  })

  it('facts_stored equals 4 when only required fields given', async () => {
    const res = await POST(makeRequest(REQUIRED_BODY))

    expect(res.status).toBe(201)
    const json = await res.json() as { facts_stored: number }
    // diet_type, home_address, daily_food_budget, cooking_skill = 4 facts
    expect(json.facts_stored).toBe(4)
  })

  it('facts_stored equals 9 when all optional fields given', async () => {
    const res = await POST(makeRequest(FULL_BODY))

    expect(res.status).toBe(201)
    const json = await res.json() as { facts_stored: number }
    // 4 required + allergies + kitchen_equipment + daily_protein_target + daily_calorie_target + gym_days = 9
    expect(json.facts_stored).toBe(9)
  })

  it("writes 'dietary.restrictions' fact with value ['vegetarian'] when diet_type is 'vegetarian'", async () => {
    await POST(makeRequest(REQUIRED_BODY))

    expect(mockUpsertBatch).toHaveBeenCalledOnce()
    const [inputs] = mockUpsertBatch.mock.calls[0] as unknown as [Array<{ factKey: string; factValue: unknown }>, boolean]
    const dietFact = inputs.find((f) => f.factKey === 'dietary.restrictions')
    expect(dietFact).toBeDefined()
    expect(dietFact!.factValue).toEqual(['vegetarian'])
  })

  it('budget fact has expiresAt ~30 days from now; dietary.restrictions fact has expiresAt: null', async () => {
    const before = Date.now()
    await POST(makeRequest(REQUIRED_BODY))
    const after = Date.now()

    const [inputs] = mockUpsertBatch.mock.calls[0] as unknown as [Array<{ factKey: string; expiresAt: Date | null }>, boolean]

    const budgetFact = inputs.find((f) => f.factKey === 'budget.daily_food_target')
    expect(budgetFact).toBeDefined()
    expect(budgetFact!.expiresAt).toBeInstanceOf(Date)
    const expectedMs = 30 * 86400000
    const expiresAtMs = (budgetFact!.expiresAt as Date).getTime()
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + expectedMs)
    expect(expiresAtMs).toBeLessThanOrEqual(after + expectedMs)

    const dietFact = inputs.find((f) => f.factKey === 'dietary.restrictions')
    expect(dietFact).toBeDefined()
    expect(dietFact!.expiresAt).toBeNull()
  })
})
