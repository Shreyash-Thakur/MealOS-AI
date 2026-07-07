/** Shared prop types for all board components. */

export type PlanPath = 'COOK' | 'ORDER' | 'DINE_OUT'

export interface ComparisonScores {
  cook: number
  order: number
  dineout: number
}

export interface PathColumn {
  path: PlanPath
  label: string
  score: number
  estimatedCost: number | null
  estimatedTimeMin: number | null
  proteinG: number | null
  available: boolean
  rejectionReason?: string | null
}

export interface PlanDelta {
  costDiff: number       // winner.cost − alt.cost (negative = winner cheaper)
  timeDiff: number       // winner.time − alt.time (negative = winner faster)
  proteinDiff: number    // winner.protein − alt.protein (positive = winner more protein)
  altLabel: string
}

export interface BoardRecommendation {
  id: string
  primaryPath: PlanPath
  title: string
  explanation: string
  confidenceScore: number
  estimatedCost: number
  estimatedTimeMin: number
  calories: number | null
  proteinG: number | null
  carbsG: number | null
  fatG: number | null
  youtubeUrl: string | null
  swiggyData: unknown
  comparisonScores: ComparisonScores
  whyNot?: { path: PlanPath; reason: string }[]
}
