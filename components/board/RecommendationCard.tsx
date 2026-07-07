'use client'

import type { PlanPath, BoardRecommendation } from './types'

interface RecommendationCardProps {
  recommendation: BoardRecommendation
  onExecute?: () => void
  loading?: boolean
}

function Skeleton() {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '20px 24px' }}>
      {[100, 60, 80, 45].map((w, i) => (
        <div key={i} style={{
          height: '16px',
          background: '#f3f4f6',
          borderRadius: '4px',
          width: `${w}%`,
          marginBottom: '12px',
        }} />
      ))}
    </div>
  )
}

const PATH_EXEC_LABEL: Record<PlanPath, string | null> = {
  COOK:     null,
  ORDER:    'Order on Swiggy',
  DINE_OUT: 'Book on Swiggy Dineout',
}

export function RecommendationCard({ recommendation, onExecute, loading }: RecommendationCardProps) {
  if (loading) return <Skeleton />

  const execLabel = PATH_EXEC_LABEL[recommendation.primaryPath]

  return (
    <div style={{
      border: '1px solid #e5e7eb',
      borderRadius: '12px',
      padding: '20px 24px',
      background: '#fff',
    }}>
      <h3 style={{ margin: '0 0 8px', fontSize: '1.2rem', fontWeight: 700 }}>
        {recommendation.title}
      </h3>

      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <Stat label="Cost" value={`₹${recommendation.estimatedCost}`} />
        <Stat label="Time" value={`${recommendation.estimatedTimeMin} min`} />
        {recommendation.calories != null && (
          <Stat label="Cal" value={`${recommendation.calories} kcal`} />
        )}
        {recommendation.proteinG != null && (
          <Stat label="Protein" value={`${recommendation.proteinG}g`} />
        )}
        {recommendation.carbsG != null && (
          <Stat label="Carbs" value={`${recommendation.carbsG}g`} />
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {execLabel && (
          <button
            onClick={onExecute}
            style={{
              background: '#f97316',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              padding: '10px 20px',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            {execLabel}
          </button>
        )}
        <button
          style={{
            background: '#f9fafb',
            color: '#374151',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '10px 20px',
            fontWeight: 500,
            cursor: 'pointer',
            fontSize: '0.9rem',
          }}
        >
          Save for Later
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <span style={{ fontSize: '0.7rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
      <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#111827' }}>
        {value}
      </span>
    </div>
  )
}
