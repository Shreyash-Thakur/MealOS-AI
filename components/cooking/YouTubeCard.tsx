'use client'

/**
 * components/cooking/YouTubeCard.tsx
 * MealOS AI — Recipe video card (ISSUE-132)
 *
 * Renders the attached recipe video: thumbnail with a play overlay, title,
 * channel name, and MM:SS duration. Tapping opens the YouTube watch URL in
 * a new tab. A null result renders a skeleton shimmer placeholder.
 */

import { formatDuration } from './format'
import type { YouTubeRecipeResult } from '@/types/swiggy'

interface YouTubeCardProps {
  youtube: YouTubeRecipeResult | null
}

function Skeleton() {
  return (
    <div
      data-testid="youtube-card-skeleton"
      style={{ border: '1px solid #e5e7eb', borderRadius: '12px', overflow: 'hidden' }}
    >
      <div style={{ aspectRatio: '16 / 9', background: '#f3f4f6' }} />
      <div style={{ padding: '12px 16px' }}>
        {[80, 45].map((w, i) => (
          <div key={i} style={{
            height: '14px',
            background: '#f3f4f6',
            borderRadius: '4px',
            width: `${w}%`,
            marginBottom: '8px',
          }} />
        ))}
      </div>
    </div>
  )
}

export function YouTubeCard({ youtube }: YouTubeCardProps) {
  if (youtube === null) return <Skeleton />

  const watchUrl = `https://www.youtube.com/watch?v=${youtube.videoId}`

  return (
    <a
      href={watchUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Watch "${youtube.title}" on YouTube`}
      style={{
        display: 'block',
        border: '1px solid #e5e7eb',
        borderRadius: '12px',
        overflow: 'hidden',
        background: '#fff',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#111' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- external CDN thumbnail; next/image needs remotePatterns config */}
        <img
          src={youtube.thumbnailUrl}
          alt={youtube.title}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            background: 'rgba(0, 0, 0, 0.7)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
          }}
        >
          ▶
        </span>
        <span
          style={{
            position: 'absolute',
            right: '8px',
            bottom: '8px',
            background: 'rgba(0, 0, 0, 0.8)',
            color: '#fff',
            borderRadius: '4px',
            padding: '2px 6px',
            fontSize: '0.75rem',
            fontWeight: 600,
          }}
        >
          {formatDuration(youtube.durationSeconds)}
        </span>
      </div>
      <div style={{ padding: '12px 16px' }}>
        <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '4px' }}>
          {youtube.title}
        </div>
        <div style={{ color: '#6b7280', fontSize: '0.85rem' }}>{youtube.channelName}</div>
      </div>
    </a>
  )
}
