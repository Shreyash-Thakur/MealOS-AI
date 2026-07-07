'use client'

import { useState } from 'react'
import type { PlanDelta } from './types'

interface PlanSimulatorProps {
  delta: PlanDelta | null
}

function DeltaRow({
  label,
  diff,
  unit,
  lowerIsBetter,
}: {
  label: string
  diff: number
  unit: string
  lowerIsBetter: boolean
}) {
  // Positive diff = winner is higher. For cost/time, lower is better; for protein, higher is better.
  const winnerIsBetter = lowerIsBetter ? diff < 0 : diff > 0
  const sign = diff > 0 ? '+' : ''
  const color = winnerIsBetter ? '#22c55e' : '#f59e0b'

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
      <span style={{ fontSize: '0.875rem', color: '#4b5563' }}>{label}</span>
      <span style={{ fontSize: '0.875rem', fontWeight: 600, color }}>
        {sign}{diff}{unit} vs alt
      </span>
    </div>
  )
}

export function PlanSimulator({ delta }: PlanSimulatorProps) {
  const [open, setOpen] = useState(false)

  if (!delta) return null

  return (
    <div style={{
      border: '1px solid #e5e7eb',
      borderRadius: '12px',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          background: '#f9fafb',
          border: 'none',
          padding: '12px 16px',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.875rem',
          fontWeight: 500,
          color: '#374151',
        }}
        aria-expanded={open}
      >
        <span>Compare with {delta.altLabel}</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '12px 16px', background: '#fff' }}>
          <DeltaRow
            label="Cost"
            diff={delta.costDiff}
            unit="₹"
            lowerIsBetter
          />
          <DeltaRow
            label="Time"
            diff={delta.timeDiff}
            unit=" min"
            lowerIsBetter
          />
          <DeltaRow
            label="Protein"
            diff={delta.proteinDiff}
            unit="g"
            lowerIsBetter={false}
          />
        </div>
      )}
    </div>
  )
}
