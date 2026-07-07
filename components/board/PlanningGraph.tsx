'use client'

import { useEffect, useState } from 'react'

type NodeId =
  | 'understood'
  | 'profile'
  | 'clarifying'
  | 'searching'
  | 'scoring'
  | 'plan_ready'

type NodeStatus = 'idle' | 'active' | 'completed'

interface GraphNode {
  id: NodeId
  label: string
  x: number
  y: number
}

const NODES: GraphNode[] = [
  { id: 'understood', label: 'Understood',  x: 40,  y: 50 },
  { id: 'profile',    label: 'Profile',     x: 140, y: 50 },
  { id: 'clarifying', label: 'Clarifying',  x: 240, y: 50 },
  { id: 'searching',  label: 'Searching',   x: 340, y: 50 },
  { id: 'scoring',    label: 'Scoring',     x: 440, y: 50 },
  { id: 'plan_ready', label: 'Plan Ready',  x: 540, y: 50 },
]

const EDGES: [NodeId, NodeId][] = [
  ['understood', 'profile'],
  ['profile',    'clarifying'],
  ['clarifying', 'searching'],
  ['searching',  'scoring'],
  ['scoring',    'plan_ready'],
]

/** Maps SSE event names to the node they activate. */
const EVENT_TO_NODE: Partial<Record<string, NodeId>> = {
  context_understood: 'understood',
  planning_started:   'searching',
  plan_ready:         'plan_ready',
}

/** Maps agent_progress `agent` values to graph nodes. */
const AGENT_TO_NODE: Partial<Record<string, NodeId>> = {
  swiggy:   'searching',
  planning: 'scoring',
}

interface PlanningGraphProps {
  /** EventSource URL for the SSE stream (e.g. /api/v1/situations/:id/stream). */
  streamUrl: string
  onPlanReady?: (recommendationId: string) => void
}

export function PlanningGraph({ streamUrl, onPlanReady }: PlanningGraphProps) {
  const [statuses, setStatuses] = useState<Record<NodeId, NodeStatus>>({
    understood: 'idle',
    profile:    'idle',
    clarifying: 'idle',
    searching:  'idle',
    scoring:    'idle',
    plan_ready: 'idle',
  })

  function activate(nodeId: NodeId) {
    setStatuses((prev) => {
      const next = { ...prev }
      // Mark all prior nodes as completed
      let reached = false
      for (const n of NODES) {
        if (n.id === nodeId) {
          reached = true
          next[n.id] = 'active'
        } else if (!reached && next[n.id] !== 'completed') {
          next[n.id] = 'completed'
        }
      }
      return next
    })
  }

  function complete(nodeId: NodeId) {
    setStatuses((prev) => ({ ...prev, [nodeId]: 'completed' }))
  }

  useEffect(() => {
    const es = new EventSource(streamUrl)

    const handleEvent = (eventName: string, data: Record<string, unknown>) => {
      const nodeId = EVENT_TO_NODE[eventName]
      if (nodeId) activate(nodeId)

      if (eventName === 'agent_progress') {
        const agentNode = AGENT_TO_NODE[data['agent'] as string]
        if (agentNode) {
          const status = data['status'] as string
          if (status === 'completed') complete(agentNode)
          else activate(agentNode)
        }
      }

      if (eventName === 'context_understood') {
        complete('understood')
        activate('profile')
      }

      if (eventName === 'plan_ready') {
        setStatuses({
          understood: 'completed',
          profile:    'completed',
          clarifying: 'completed',
          searching:  'completed',
          scoring:    'completed',
          plan_ready: 'completed',
        })
        if (onPlanReady) {
          onPlanReady(data['recommendation_id'] as string)
        }
        es.close()
      }
    }

    const SSE_EVENTS = [
      'context_understood',
      'clarification_needed',
      'planning_started',
      'agent_progress',
      'plan_ready',
      'non_food_redirect',
    ]

    for (const name of SSE_EVENTS) {
      es.addEventListener(name, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data as string) as Record<string, unknown>
          handleEvent(name, data)
        } catch {
          // malformed event — ignore
        }
      })
    }

    es.onerror = () => es.close()

    return () => es.close()
  }, [streamUrl, onPlanReady])

  const R = 24
  const WIDTH = 600
  const HEIGHT = 100

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      style={{ width: '100%', maxWidth: `${WIDTH}px`, display: 'block' }}
      role="img"
      aria-label="Planning progress graph"
    >
      {/* Edges */}
      {EDGES.map(([from, to]) => {
        const a = NODES.find((n) => n.id === from)!
        const b = NODES.find((n) => n.id === to)!
        const completed = statuses[from] === 'completed' && statuses[to] !== 'idle'
        return (
          <line
            key={`${from}-${to}`}
            x1={a.x + R} y1={a.y}
            x2={b.x - R} y2={b.y}
            stroke={completed ? '#22c55e' : '#d1d5db'}
            strokeWidth={2}
          />
        )
      })}

      {/* Nodes */}
      {NODES.map((node) => {
        const status = statuses[node.id]
        const fill =
          status === 'completed' ? '#bbf7d0' :
          status === 'active'    ? '#86efac' :
          '#f3f4f6'
        const stroke =
          status === 'completed' ? '#16a34a' :
          status === 'active'    ? '#22c55e' :
          '#d1d5db'
        const strokeWidth = status === 'active' ? 2.5 : 1.5

        return (
          <g key={node.id}>
            <circle
              cx={node.x}
              cy={node.y}
              r={R}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
              style={status === 'active' ? {
                animation: 'pulse 1s ease-in-out infinite',
              } : undefined}
            />
            <text
              x={node.x}
              y={node.y + R + 14}
              textAnchor="middle"
              fontSize={10}
              fill="#374151"
            >
              {node.label}
            </text>
          </g>
        )
      })}

      <style>{`
        @keyframes pulse {
          0%, 100% { r: ${R}; opacity: 1; }
          50% { r: ${R + 3}; opacity: 0.8; }
        }
      `}</style>
    </svg>
  )
}
