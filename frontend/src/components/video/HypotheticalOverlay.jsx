// Renders the hypothetical candidate placement geometry over the video viewport (Phase 7B).
// Deliberately uses dashed styling and explicit "HYPOTHETICAL" labels so simulated
// geometry is never mistaken for real detected objects (CLAUDE.md & Phase 7B rules).

export default function HypotheticalOverlay({
  candidate,
  current,
  sourceWidth,
  sourceHeight,
}) {
  if (!candidate?.footprint || !sourceWidth || !sourceHeight) {
    return null
  }

  const toPx = (val, dim) => val * dim

  // Hypothetical candidate coordinates
  const cX1 = toPx(candidate.footprint.x1, sourceWidth)
  const cY1 = toPx(candidate.footprint.y1, sourceHeight)
  const cW = toPx(candidate.footprint.x2 - candidate.footprint.x1, sourceWidth)
  const cH = toPx(candidate.footprint.y2 - candidate.footprint.y1, sourceHeight)

  // Current observed coordinates (if available)
  const oBox = current?.footprint
  const oX1 = oBox ? toPx(oBox.x1, sourceWidth) : 0
  const oY1 = oBox ? toPx(oBox.y1, sourceHeight) : 0
  const oW = oBox ? toPx(oBox.x2 - oBox.x1, sourceWidth) : 0
  const oH = oBox ? toPx(oBox.y2 - oBox.y1, sourceHeight) : 0

  // Support deck coordinates (if available)
  const sBox = current?.supporting_footprint
  const sX1 = sBox ? toPx(sBox.x1, sourceWidth) : 0
  const sY1 = sBox ? toPx(sBox.y1, sourceHeight) : 0
  const sW = sBox ? toPx(sBox.x2 - sBox.x1, sourceWidth) : 0
  const sH = sBox ? toPx(sBox.y2 - sBox.y1, sourceHeight) : 0

  return (
    <svg
      viewBox={`0 0 ${sourceWidth} ${sourceHeight}`}
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      {/* 1. Highlight Support Foundation Deck if present */}
      {sBox && (
        <g>
          <rect
            x={sX1}
            y={sY1}
            width={sW}
            height={sH}
            fill="none"
            stroke="#3f3f46"
            strokeWidth="2.5"
            strokeDasharray="6 4"
          />
          <text
            x={sX1 + 6}
            y={sY1 + sH - 8}
            fill="#3f3f46"
            fontSize="12"
            fontFamily="monospace"
            fontWeight="bold"
          >
            SUPPORT DECK FOUNDATION
          </text>
        </g>
      )}

      {/* 2. Observed Placement Outline */}
      {oBox && (
        <g opacity="0.65">
          <rect
            x={oX1}
            y={oY1}
            width={oW}
            height={oH}
            fill="#f59e0b"
            fillOpacity="0.1"
            stroke="#d97706"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
          <text
            x={oX1 + 4}
            y={Math.max(14, oY1 - 5)}
            fill="#b45309"
            fontSize="11"
            fontFamily="sans-serif"
            fontWeight="bold"
          >
            OBSERVED (Score: {current.stability_score?.toFixed(0) || 0})
          </text>
        </g>
      )}

      {/* 3. Hypothetical Candidate Placement (High Prominence, Dashed, Labeled) */}
      <g>
        <rect
          x={cX1}
          y={cY1}
          width={cW}
          height={cH}
          fill="#059669"
          fillOpacity="0.18"
          stroke="#059669"
          strokeWidth="3.5"
          strokeDasharray="8 6"
        />

        {/* Diagonal Crosshair Indicators inside Hypothetical Box */}
        <line
          x1={cX1}
          y1={cY1}
          x2={cX1 + cW}
          y2={cY1 + cH}
          stroke="#059669"
          strokeWidth="1"
          strokeDasharray="4 4"
          opacity="0.3"
        />
        <line
          x1={cX1 + cW}
          y1={cY1}
          x2={cX1}
          y2={cY1 + cH}
          stroke="#059669"
          strokeWidth="1"
          strokeDasharray="4 4"
          opacity="0.3"
        />

        {/* Prominent Hypothetical Badge */}
        <rect
          x={cX1}
          y={Math.max(0, cY1 - 22)}
          width={Math.max(220, cW)}
          height={20}
          fill="#059669"
          rx="2"
        />
        <text
          x={cX1 + 6}
          y={Math.max(14, cY1 - 8)}
          fill="#ffffff"
          fontSize="11"
          fontFamily="monospace"
          fontWeight="bold"
        >
          WHAT-IF HYPOTHETICAL: {candidate.score?.toFixed(0)} STABILITY
        </text>
      </g>
    </svg>
  )
}
