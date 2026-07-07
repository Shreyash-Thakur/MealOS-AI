'use client'

import type { PathColumn, PlanPath } from './types'
import { WhyNot } from './WhyNot'

const PATH_LABEL: Record<PlanPath, string> = {
  COOK:     'Cook',
  ORDER:    'Order',
  DINE_OUT: 'Dine',
}

interface ComparisonTableProps {
  columns: PathColumn[]
  winner: PlanPath
  whyNot?: { path: PlanPath; reason: string }[]
}

function Cell({ value }: { value: string }) {
  return (
    <td style={{
      padding: '10px 14px',
      textAlign: 'center',
      borderBottom: '1px solid #f3f4f6',
      fontSize: '0.9rem',
    }}>
      {value}
    </td>
  )
}

export function ComparisonTable({ columns, winner, whyNot }: ComparisonTableProps) {
  const whyNotMap = Object.fromEntries((whyNot ?? []).map((w) => [w.path, w.reason]))

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        minWidth: '320px',
      }}>
        <thead>
          <tr>
            <th style={{
              padding: '10px 14px',
              textAlign: 'left',
              borderBottom: '2px solid #e5e7eb',
              fontSize: '0.85rem',
              color: '#6b7280',
              fontWeight: 500,
              width: '100px',
            }}>
            </th>
            {columns.map((col) => {
              const isWinner = col.path === winner
              return (
                <th key={col.path} style={{
                  padding: '10px 14px',
                  textAlign: 'center',
                  borderBottom: '2px solid #e5e7eb',
                  background: isWinner ? '#f0fdf4' : undefined,
                  position: 'relative',
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                      {PATH_LABEL[col.path]}
                    </span>
                    {isWinner && (
                      <span style={{
                        background: '#22c55e',
                        color: '#fff',
                        borderRadius: '9999px',
                        padding: '1px 8px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                      }}>
                        Winner
                      </span>
                    )}
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {/* Score row */}
          <tr>
            <td style={{ padding: '10px 14px', fontSize: '0.85rem', color: '#6b7280', borderBottom: '1px solid #f3f4f6' }}>Score</td>
            {columns.map((col) => (
              <td key={col.path} style={{
                padding: '10px 14px',
                textAlign: 'center',
                borderBottom: '1px solid #f3f4f6',
                background: col.path === winner ? '#f0fdf4' : undefined,
                position: 'relative',
              }}>
                {col.available ? (
                  <span style={{ fontWeight: 600 }}>{col.score}</span>
                ) : (
                  <UnavailableOverlay />
                )}
              </td>
            ))}
          </tr>

          {/* Cost row */}
          <tr>
            <td style={{ padding: '10px 14px', fontSize: '0.85rem', color: '#6b7280', borderBottom: '1px solid #f3f4f6' }}>Cost</td>
            {columns.map((col) => (
              <td key={col.path} style={{
                padding: '10px 14px',
                textAlign: 'center',
                borderBottom: '1px solid #f3f4f6',
                background: col.path === winner ? '#f0fdf4' : undefined,
              }}>
                {col.available
                  ? (col.estimatedCost != null ? `₹${col.estimatedCost}` : '—')
                  : <UnavailableOverlay />
                }
              </td>
            ))}
          </tr>

          {/* Time row */}
          <tr>
            <td style={{ padding: '10px 14px', fontSize: '0.85rem', color: '#6b7280', borderBottom: '1px solid #f3f4f6' }}>Time</td>
            {columns.map((col) => (
              <td key={col.path} style={{
                padding: '10px 14px',
                textAlign: 'center',
                borderBottom: '1px solid #f3f4f6',
                background: col.path === winner ? '#f0fdf4' : undefined,
              }}>
                {col.available
                  ? (col.estimatedTimeMin != null ? `${col.estimatedTimeMin} min` : '—')
                  : <UnavailableOverlay />
                }
              </td>
            ))}
          </tr>

          {/* Protein row */}
          <tr>
            <td style={{ padding: '10px 14px', fontSize: '0.85rem', color: '#6b7280' }}>Protein</td>
            {columns.map((col) => (
              <td key={col.path} style={{
                padding: '10px 14px',
                textAlign: 'center',
                background: col.path === winner ? '#f0fdf4' : undefined,
              }}>
                {col.available
                  ? (col.proteinG != null ? `${col.proteinG}g` : '—')
                  : <UnavailableOverlay />
                }
              </td>
            ))}
          </tr>

          {/* Why Not row */}
          <tr>
            <td style={{ padding: '10px 14px', fontSize: '0.85rem', color: '#6b7280' }}></td>
            {columns.map((col) => (
              <td key={col.path} style={{
                padding: '10px 14px',
                textAlign: 'center',
                background: col.path === winner ? '#f0fdf4' : undefined,
              }}>
                <WhyNot
                  path={col.path}
                  reason={whyNotMap[col.path]}
                  isWinner={col.path === winner}
                />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function UnavailableOverlay() {
  return (
    <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>Not available</span>
  )
}
