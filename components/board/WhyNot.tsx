'use client'

import { useState } from 'react'
import type { PlanPath } from './types'

interface WhyNotProps {
  path: PlanPath
  reason: string | null | undefined
  isWinner: boolean
}

export function WhyNot({ path, reason, isWinner }: WhyNotProps) {
  const [open, setOpen] = useState(false)

  const label = path === 'COOK' ? 'Cook' : path === 'ORDER' ? 'Order' : 'Dine'
  const buttonText = isWinner
    ? `Why we chose ${label}`
    : `Why not ${label}?`
  const bodyText = isWinner
    ? 'This is why we chose this.'
    : (reason ?? 'Not the best fit for your current situation.')

  return (
    <div style={{ marginTop: '8px' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: '#6b7280',
          fontSize: '0.8rem',
          textDecoration: 'underline',
          padding: 0,
        }}
        aria-expanded={open}
      >
        {buttonText}
      </button>
      {open && (
        <p style={{
          margin: '6px 0 0',
          fontSize: '0.8rem',
          color: '#4b5563',
          lineHeight: 1.5,
        }}>
          {bodyText}
        </p>
      )}
    </div>
  )
}
