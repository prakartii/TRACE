// Renders the world model's spatial relationships over the video
// (Phase 4). Purely presentational — all geometry happens server-side
// (backend/world_model/). Node positions/footprints in `snapshot` are
// already normalized [0,1] (see docs/WORLD_MODEL.md), so this draws
// directly into an SVG viewBox sized to the source frame's own
// resolution — no pixel-scaling math needed here, unlike
// PerceptionOverlay (which works from absolute-pixel Entity.bbox).
//
// Line style encodes relation type, not risk — this is a geometric
// observation, not a hazard signal. Deliberately monochrome (CLAUDE.md:
// no color-coded "AI" effects): support (directional, arrowhead) is
// darkest/thickest since it's the strongest claim, contact next, and
// proximity lightest/dashed since it's the loosest.
const EDGE_STYLE = {
  support: { stroke: '#18181b', width: 5, dash: undefined, marker: true },
  contact: { stroke: '#52525b', width: 3.5, dash: undefined, marker: false },
  proximity: { stroke: '#a1a1aa', width: 2.5, dash: '10 8', marker: false },
}

// Same class palette as PerceptionOverlay (Phase 4) — a node's color
// distinguishes its entity class only, not a relationship or a risk
// signal; edge styling above (support/contact/proximity) is unrelated.
const NODE_COLOR = {
  person: '#18181b',
  box: '#C28208',
  pallet: '#4d7c0f',
}
const DEFAULT_NODE_COLOR = '#71717a'

export default function SceneOverlay({ snapshot, sourceWidth, sourceHeight }) {
  if (!snapshot?.nodes?.length || !sourceWidth || !sourceHeight) {
    return null
  }

  const nodeById = Object.fromEntries(snapshot.nodes.map((node) => [node.entity_id, node]))
  const px = (node) => node.position[0] * sourceWidth
  const py = (node) => node.position[1] * sourceHeight

  return (
    <svg
      viewBox={`0 0 ${sourceWidth} ${sourceHeight}`}
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <defs>
        <marker
          id="scene-support-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="#18181b" />
        </marker>
      </defs>

      {snapshot.edges.map((edge, index) => {
        const source = nodeById[edge.source_id]
        const target = nodeById[edge.target_id]
        if (!source || !target) return null
        const style = EDGE_STYLE[edge.edge_type] ?? EDGE_STYLE.proximity
        return (
          <line
            key={index}
            x1={px(source)}
            y1={py(source)}
            x2={px(target)}
            y2={py(target)}
            stroke={style.stroke}
            strokeWidth={style.width}
            strokeDasharray={style.dash}
            markerEnd={style.marker ? 'url(#scene-support-arrow)' : undefined}
          />
        )
      })}

      {snapshot.nodes.map((node) => {
        const color = NODE_COLOR[node.entity_class] ?? DEFAULT_NODE_COLOR
        return (
          <g key={node.entity_id}>
            <circle cx={px(node)} cy={py(node)} r={9} fill={color} />
            <text
              x={px(node) + 12}
              y={py(node) + 5}
              fontSize="22"
              fontWeight="600"
              fill={color}
              stroke="#fff"
              strokeWidth="3"
              paintOrder="stroke"
            >
              {node.entity_class === 'person' ? 'Worker' : node.entity_class === 'box' ? 'Cargo' : node.entity_class === 'pallet' ? 'Pallet' : node.entity_class}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
