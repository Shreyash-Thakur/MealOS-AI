'use client'

import type { PlanPath, BoardRecommendation } from './types'

const PATH_META: Record<PlanPath, { icon: string; headline: string }> = {
  COOK:     { icon: '🍳', headline: 'Cook Tonight' },
  ORDER:    { icon: '📦', headline: 'Order In' },
  DINE_OUT: { icon: '🍽️', headline: 'Dine Out' },
}

function ConfidenceBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? '#22c55e' :
    score >= 60 ? '#f59e0b' :
    '#ef4444'
  return (
    <span style={{
      backgroundColor: color,
      color: '#fff',
      borderRadius: '9999px',
      padding: '2px 10px',
      fontSize: '0.75rem',
      fontWeight: 600,
      marginLeft: '8px',
    }}>
      {score}% confident
    </span>
  )
}

interface DecisionCardProps {
  recommendation: Pick<
    BoardRecommendation,
    'primaryPath' | 'explanation' | 'confidenceScore'
  >
  degraded?: boolean
}

export function DecisionCard({ recommendation, degraded }: DecisionCardProps) {
  const { icon, headline } = PATH_META[recommendation.primaryPath]

  return (
    <div style={{
      border: '1px solid #e5e7eb',
      borderRadius: '12px',
      padding: '20px 24px',
      background: '#fff',
    }}>
      {degraded && (
        <div style={{
          background: '#fef3c7',
          border: '1px solid #f59e0b',
          borderRadius: '8px',
          padding: '8px 12px',
          marginBottom: '12px',
          fontSize: '0.875rem',
          color: '#92400e',
        }}>
          Swiggy is unavailable right now — showing cook options only.
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ fontSize: '2rem', marginRight: '12px' }}>{icon}</span>
        <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>{headline}</h2>
        <ConfidenceBadge score={recommendation.confidenceScore} />
      </div>
      <p style={{ margin: 0, color: '#374151', lineHeight: 1.6 }}>
        {recommendation.explanation}
      </p>
    </div>
  )
}
