import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Bot, FileText, Globe, Plug, Sparkles, SquareTerminal, Zap } from 'lucide-react'
import { useMemo } from 'react'
import type { CallKind, SkillCall, SkillGraph as Graph } from '../../shared/skillGraph'

const STEP_W = 236
// Calls hang on a rail down the step's left side, a little indented
const CALL_INDENT = 30
const GAP_X = 64
const POINTS_SHOWN = 5
const DETAILS_SHOWN = 3

const KIND_LABEL: Record<CallKind, string> = {
  mcp: 'MCP',
  cli: 'Commande',
  skill: 'Skill',
  file: 'Fichiers',
  web: 'Web',
  agent: 'Agent',
}

export function CallIcon({ kind, size = 14 }: { kind: CallKind; size?: number }) {
  const props = { size, 'aria-hidden': true as const }
  if (kind === 'mcp') return <Plug {...props} />
  if (kind === 'cli') return <SquareTerminal {...props} />
  if (kind === 'skill') return <Sparkles {...props} />
  if (kind === 'web') return <Globe {...props} />
  if (kind === 'agent') return <Bot {...props} />
  return <FileText {...props} />
}

type TriggerNode = Node<{ name: string; frame: string[] }, 'trigger'>
type StepNode = Node<{ index: number; title: string; points: string[] }, 'step'>
type CallNode = Node<{ call: SkillCall }, 'call'>

function TriggerCard({ data }: NodeProps<TriggerNode>) {
  return (
    <div className="flow-node flow-trigger">
      <span className="flow-trigger-icon">
        <Zap size={16} aria-hidden="true" />
      </span>
      <div className="flow-node-main">
        <span className="flow-kind">Déclencheur</span>
        <strong>/{data.name}</strong>
        {data.frame.length > 0 && <span className="flow-frame">Cadre : {data.frame.join(', ')}</span>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function StepCard({ data }: NodeProps<StepNode>) {
  const more = data.points.length - POINTS_SHOWN
  return (
    <div className="flow-node flow-step">
      <Handle type="target" position={Position.Left} />
      <header>
        <span className="flow-index">{data.index + 1}</span>
        <strong>{data.title}</strong>
      </header>
      {data.points.length > 0 && (
        <ol>
          {data.points.slice(0, POINTS_SHOWN).map((point, index) => (
            <li key={index}>{point}</li>
          ))}
          {more > 0 && <li className="flow-more">+ {more} autre{more > 1 ? 's' : ''}</li>}
        </ol>
      )}
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} id="calls" className="flow-rail" />
    </div>
  )
}

function CallCard({ data }: NodeProps<CallNode>) {
  const { call } = data
  return (
    <div className={`flow-node flow-call ${call.kind}`} title={call.details.join('\n')}>
      <Handle type="target" position={Position.Left} />
      <span className="flow-call-icon">
        <CallIcon kind={call.kind} />
      </span>
      <div className="flow-node-main">
        <span className="flow-kind">{KIND_LABEL[call.kind]}</span>
        <strong>{call.label}</strong>
        {call.details.slice(0, DETAILS_SHOWN).map(detail => (
          <code key={detail}>{detail}</code>
        ))}
        {call.details.length > DETAILS_SHOWN && <span className="flow-more">+ {call.details.length - DETAILS_SHOWN}</span>}
      </div>
    </div>
  )
}

const NODE_TYPES = { trigger: TriggerCard, step: StepCard, call: CallCard }

// Heights as the cards render them, so the calls hang below their step without overlapping it
const stepHeight = (points: number) => 58 + Math.min(points, POINTS_SHOWN + 1) * 19
const callHeight = (call: SkillCall) => 58 + Math.min(call.details.length, DETAILS_SHOWN + 1) * 18

// Left to right as n8n reads: the trigger, then each step, and under each step what it calls
export function graphLayout(name: string, graph: Graph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { name, frame: graph.frame }, draggable: false },
  ]
  const edges: Edge[] = []
  const arrow = { type: MarkerType.ArrowClosed, width: 16, height: 16 }
  let previous = 'trigger'
  graph.steps.forEach((step, index) => {
    const x = (index + 1) * (STEP_W + GAP_X)
    nodes.push({ id: step.id, type: 'step', position: { x, y: 0 }, data: { index, title: step.title, points: step.points } })
    edges.push({ id: `${previous}-${step.id}`, source: previous, target: step.id, markerEnd: arrow, className: 'flow-edge-step' })
    let y = stepHeight(step.points.length) + 34
    step.calls.forEach((call, callIndex) => {
      const id = `${step.id}-c${callIndex}`
      nodes.push({ id, type: 'call', position: { x: x + CALL_INDENT, y }, data: { call } })
      edges.push({
        id: `${step.id}-${id}`,
        source: step.id,
        sourceHandle: 'calls',
        target: id,
        type: 'smoothstep',
        className: 'flow-edge-call',
      })
      y += callHeight(call) + 16
    })
    previous = step.id
  })
  return { nodes, edges }
}

export function SkillGraph({ name, graph }: { name: string; graph: Graph }) {
  const { nodes, edges } = useMemo(() => graphLayout(name, graph), [name, graph])
  if (graph.steps.length === 0) {
    return <p className="skill-empty">Ce skill n’a ni sections ni étapes numérotées : rien à dessiner.</p>
  }
  return (
    <div className="skill-flow">
      <ReactFlow
        className="dark"
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesDraggable
        panOnScroll
        zoomOnDoubleClick={false}
        minZoom={0.25}
        maxZoom={1.4}
        fitView
        fitViewOptions={{ maxZoom: 1, minZoom: 0.6, padding: 0.12, nodes: nodes.slice(0, 5).map(node => ({ id: node.id })) }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeStrokeWidth={2} />
      </ReactFlow>
    </div>
  )
}
