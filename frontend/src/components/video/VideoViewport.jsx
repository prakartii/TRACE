import { forwardRef } from 'react'
import PlaybackControls from './PlaybackControls.jsx'

// Layering plan (CLAUDE.md / Phase 2B design direction): this component
// owns only the native <video> element and playback controls. Later
// phases add sibling overlay layers inside the relative-positioned wrapper
// below — PerceptionOverlay (Phase 3), RiskOverlay (Phase 7),
// PlannerOverlay (Phase 8) — without this component changing:
//
//   <VideoViewport>
//     <NativeVideo/>
//     <PerceptionOverlay/>
//     <PlannerOverlay/>
//     <RiskOverlay/>
//   </VideoViewport>
//
// None of those overlays exist yet. No bounding boxes, risk scores, or
// planner recommendations are rendered in Phase 2B.
const VideoViewport = forwardRef(function VideoViewport(
  {
    src,
    playing,
    currentTime,
    duration,
    onTogglePlay,
    onSeekRatio,
    onLoadedMetadata,
    onTimeUpdate,
    onPlay,
    onPause,
    onEnded,
    children,
  },
  videoRef,
) {
  return (
    <div className="border border-line bg-raised">
      <div className="relative bg-black">
        <video
          ref={videoRef}
          src={src}
          className="block max-h-[520px] w-full bg-black"
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={onTimeUpdate}
          onPlay={onPlay}
          onPause={onPause}
          onEnded={onEnded}
        />
        {/* Overlay layers (PerceptionOverlay today; RiskOverlay/
            PlannerOverlay in later phases) mount here as children — see
            comment above. */}
        {children}
      </div>
      <PlaybackControls
        playing={playing}
        currentTime={currentTime}
        duration={duration}
        onTogglePlay={onTogglePlay}
        onSeekRatio={onSeekRatio}
      />
    </div>
  )
})

export default VideoViewport
