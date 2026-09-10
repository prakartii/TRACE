import React from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Boxes,
  CheckCircle2,
  CornerDownRight,
  Footprints,
  Maximize2,
  Minimize2,
  MoveDown,
  MoveRight,
  PackageCheck,
  PackageX,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  Truck,
  Users,
} from 'lucide-react'

/**
 * Scenario-specific visual counterfactual renderers for TRACE What-If Simulator.
 * Renders clear, evidence-anchored visual before/after states for all 12 warehouse hazard categories:
 * - heavy_on_light: Inverted mass stacking vs stable foundation
 * - throwing_dropping: High-velocity throw arc vs controlled lowering
 * - dragging: Floor friction scuff vs elevated wheeled transport
 * - rolling_carton: End-over-end tumble vs upright hand truck
 * - stepping_on_carton: Worker on cartons vs certified access platform
 * - wrong_product_orientation: Horizontal orientation vs vertical specification
 * - pallet_overhang: Cantilever deck overhang vs flush pallet alignment
 * - dock_gap: Open 1.2m ledge void vs deployed bridge plate
 * - wet_floor: Direct route through puddle vs dry perimeter detour
 * - loading_sequence: Manifest blocked cargo vs reverse delivery sequence
 * - solo_heavy: Solo 42kg overload vs synchronized team lift
 * - wrong_equipment: Dragged pallet / strap grip vs certified wheeled trolley
 */
export default function WhatIfScenarioVisualizer({ visualType, mode = 'before', data = {} }) {
  const isBefore = mode === 'before'

  switch (visualType) {
    case 'heavy_on_light':
      return <HeavyOnLightVisual isBefore={isBefore} data={data} />
    case 'throwing_dropping':
      return <ThrowingDroppingVisual isBefore={isBefore} data={data} />
    case 'dragging':
      return <DraggingVisual isBefore={isBefore} data={data} />
    case 'rolling_carton':
      return <RollingVisual isBefore={isBefore} data={data} />
    case 'stepping_on_carton':
      return <SteppingVisual isBefore={isBefore} data={data} />
    case 'wrong_product_orientation':
      return <OrientationVisual isBefore={isBefore} data={data} />
    case 'pallet_overhang':
      return <OverhangVisual isBefore={isBefore} data={data} />
    case 'dock_gap':
      return <DockGapVisual isBefore={isBefore} data={data} />
    case 'wet_floor':
      return <WetFloorVisual isBefore={isBefore} data={data} />
    case 'loading_sequence':
      return <LoadingSequenceVisual isBefore={isBefore} data={data} />
    case 'solo_heavy':
      return <SoloHeavyVisual isBefore={isBefore} data={data} />
    case 'wrong_equipment':
      return <WrongEquipmentVisual isBefore={isBefore} data={data} />
    default:
      return <GenericVisual isBefore={isBefore} data={data} />
  }
}

/* 1. Heavy-on-Light Stacking */
function HeavyOnLightVisual({ isBefore }) {
  return (
    <div className="relative flex h-48 w-full flex-col items-center justify-end rounded-md border border-line bg-paper/60 p-4 select-none">
      {/* Pallet Base Deck */}
      <div className="flex w-52 flex-col items-center">
        {/* Tier 2 (Top) */}
        {isBefore ? (
          <div className="z-10 flex h-14 w-40 flex-col items-center justify-center rounded border-2 border-danger bg-danger/15 px-2 text-center shadow-sm">
            <span className="text-[11px] font-bold text-danger">Heavy Overpack Crate (42 kg)</span>
            <span className="text-[9px] font-semibold text-danger/80">Mass Class H - 2.85x Load</span>
          </div>
        ) : (
          <div className="z-10 flex h-14 w-40 flex-col items-center justify-center rounded border-2 border-ok bg-ok/15 px-2 text-center shadow-sm">
            <span className="text-[11px] font-bold text-ok">KD Flatpack Packets</span>
            <span className="text-[9px] font-semibold text-ok/80">Mass Class L (Supported)</span>
          </div>
        )}

        {/* Compression / Contact Plane */}
        <div className="my-1 flex w-full items-center justify-center">
          {isBefore ? (
            <span className="rounded bg-danger px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-paper">
              Crush Pressure Applied
            </span>
          ) : (
            <span className="rounded bg-ok px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-paper">
              Stable Contact Plane
            </span>
          )}
        </div>

        {/* Tier 1 (Base) */}
        {isBefore ? (
          <div className="flex h-14 w-48 flex-col items-center justify-center rounded border-2 border-dashed border-danger/60 bg-surface px-2 text-center">
            <span className="text-[11px] font-bold text-ink">KD Flatpack Packets</span>
            <span className="text-[9px] text-danger font-semibold">Crushing & Fatigue Hazard</span>
          </div>
        ) : (
          <div className="flex h-14 w-48 flex-col items-center justify-center rounded border-2 border-ok bg-ok/25 px-2 text-center shadow-xs">
            <span className="text-[11px] font-bold text-ink">Heavy Overpack Crate (42 kg)</span>
            <span className="text-[9px] text-ok font-bold">Stable Foundation Deck</span>
          </div>
        )}

        {/* Pallet Runner */}
        <div className="mt-1.5 flex h-3 w-56 items-center justify-around rounded bg-line-strong px-2">
          <div className="h-2 w-4 bg-ink/40" />
          <div className="h-2 w-4 bg-ink/40" />
          <div className="h-2 w-4 bg-ink/40" />
        </div>
      </div>
    </div>
  )
}

/* 2. Throwing / Dropping Precursor */
function ThrowingDroppingVisual({ isBefore }) {
  return (
    <div className="relative flex h-48 w-full items-center justify-between rounded-md border border-line bg-paper/60 p-5 select-none">
      {/* Worker Zone */}
      <div className="flex flex-col items-center gap-1">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface text-ink font-bold text-caption">
          Worker
        </div>
        <span className="text-[10px] text-ink-soft font-medium">Trailer Threshold</span>
      </div>

      {/* Trajectory Path SVG */}
      <div className="relative flex-1 px-4">
        <svg viewBox="0 0 200 80" className="h-24 w-full">
          {isBefore ? (
            <>
              {/* Uncontrolled Throw Arc */}
              <path
                d="M 10 20 Q 90 -15, 180 65"
                fill="none"
                stroke="#B23A22"
                strokeWidth="3"
                strokeDasharray="6 3"
              />
              <circle cx="180" cy="65" r="5" fill="#B23A22" />
              {/* Impact Flash */}
              <circle cx="180" cy="65" r="12" fill="none" stroke="#B23A22" strokeWidth="1.5" opacity="0.6" />
            </>
          ) : (
            <>
              {/* Controlled Lowering Path */}
              <path
                d="M 10 30 L 100 30 L 180 60"
                fill="none"
                stroke="#3F6E4C"
                strokeWidth="3"
              />
              <circle cx="180" cy="60" r="5" fill="#3F6E4C" />
            </>
          )}
        </svg>

        <div className="absolute inset-x-0 bottom-0 text-center">
          {isBefore ? (
            <span className="rounded bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger">
              High Velocity Throw Spike (0.58 norm/s)
            </span>
          ) : (
            <span className="rounded bg-ok/10 px-2 py-0.5 text-[10px] font-bold text-ok">
              Controlled Two-Handed Lowering
            </span>
          )}
        </div>
      </div>

      {/* Vehicle Bed Floor */}
      <div className="flex flex-col items-center gap-1">
        <div className={`flex h-14 w-20 flex-col items-center justify-center rounded border-2 ${
          isBefore ? 'border-danger bg-danger/10 text-danger' : 'border-ok bg-ok/15 text-ok'
        } p-1 text-center`}>
          <Truck size={16} />
          <span className="text-[9px] font-bold uppercase">{isBefore ? 'Impact Shock' : 'Gentle Rest'}</span>
        </div>
        <span className="text-[10px] text-ink-soft font-medium">Vehicle Bed</span>
      </div>
    </div>
  )
}

/* 3. Dragging Precursor */
function DraggingVisual({ isBefore }) {
  return (
    <div className="relative flex h-48 w-full flex-col justify-end rounded-md border border-line bg-paper/60 p-5 select-none">
      <div className="flex items-center justify-between pb-6">
        <div className="flex items-center gap-3">
          {isBefore ? (
            <div className="flex flex-col items-center">
              <div className="h-16 w-28 -rotate-12 rounded border-2 border-danger bg-danger/15 flex items-center justify-center text-center shadow-xs">
                <span className="text-[10px] font-bold text-danger">Cupboard Carton</span>
              </div>
              <span className="mt-1 text-[9px] font-bold text-danger">Direct Ground Drag</span>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <div className="h-16 w-28 rounded border-2 border-ok bg-ok/15 flex flex-col items-center justify-center text-center shadow-xs">
                <span className="text-[10px] font-bold text-ok">Cupboard Carton</span>
                <span className="text-[8px] text-ok/80">Elevated</span>
              </div>
              {/* Wheeled Pallet Truck */}
              <div className="mt-0.5 flex h-3 w-32 items-center justify-between rounded bg-steel px-2">
                <span className="h-2.5 w-2.5 rounded-full bg-ink" />
                <span className="text-[7px] text-paper font-bold uppercase">Pallet Jack</span>
                <span className="h-2.5 w-2.5 rounded-full bg-ink" />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end">
          {isBefore ? (
            <div className="rounded border border-danger/40 bg-danger/10 p-2 text-right">
              <span className="block text-[10px] font-bold text-danger">78% Ground Friction Contact</span>
              <span className="text-[9px] text-ink-soft">Package base scuffing & seal wear</span>
            </div>
          ) : (
            <div className="rounded border border-ok/40 bg-ok/10 p-2 text-right">
              <span className="block text-[10px] font-bold text-ok">0% Floor Abrasive Friction</span>
              <span className="text-[9px] text-ink-soft">Smooth wheeled transit off the floor</span>
            </div>
          )}
        </div>
      </div>

      {/* Concrete Yard Floor Plane */}
      <div className="relative border-t-2 border-line-strong pt-1">
        <span className="text-[9px] font-mono text-ink-faint">Concrete Floor Plane</span>
        {isBefore && (
          <div className="absolute left-6 top-0 h-1 w-40 bg-danger animate-pulse" title="Friction scratch" />
        )}
      </div>
    </div>
  )
}

/* 4. Rolling Precursor */
function RollingVisual({ isBefore }) {
  return (
    <div className="relative flex h-48 w-full items-center justify-around rounded-md border border-line bg-paper/60 p-5 select-none">
      {isBefore ? (
        <>
          <div className="flex flex-col items-center gap-2">
            <div className="relative flex h-16 w-24 items-center justify-center rounded-lg border-2 border-danger bg-danger/15 shadow-sm">
              <RotateCw className="animate-spin motion-reduce:animate-none text-danger" size={24} />
              <span className="absolute bottom-1 text-[8px] font-bold text-danger">Flipping</span>
            </div>
            <span className="rounded bg-danger/10 px-2 py-0.5 text-[9px] font-bold text-danger">
              End-Over-End Tumbling
            </span>
          </div>

          <div className="flex flex-col items-center text-center max-w-[180px]">
            <PackageX className="text-danger mb-1" size={24} />
            <span className="text-caption font-bold text-danger">Inverted Internal Load</span>
            <span className="text-[9px] text-ink-soft mt-0.5">2 successive flips detected; edge seams crushed</span>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-20 w-16 items-center justify-center rounded border-2 border-ok bg-ok/15 shadow-sm">
              <span className="text-[10px] font-bold text-ok text-center leading-tight">Upright Carton</span>
            </div>
            <span className="rounded bg-ok/10 px-2 py-0.5 text-[9px] font-bold text-ok">
              Hand Truck Secured
            </span>
          </div>

          <div className="flex flex-col items-center text-center max-w-[180px]">
            <PackageCheck className="text-ok mb-1" size={24} />
            <span className="text-caption font-bold text-ok">Orientation Preserved</span>
            <span className="text-[9px] text-ink-soft mt-0.5">Upright handling keeps internal fragile contents aligned</span>
          </div>
        </>
      )}
    </div>
  )
}

/* 5. Stepping On Carton */
function SteppingVisual({ isBefore }) {
  return (
    <div className="relative flex h-48 w-full items-center justify-around rounded-md border border-line bg-paper/60 p-5 select-none">
      {isBefore ? (
        <>
          <div className="flex flex-col items-center">
            {/* Worker Foot Direct Contact */}
            <div className="flex items-center gap-1 text-danger font-bold text-caption">
              <Footprints size={20} className="animate-bounce" />
              <span>Worker Boots</span>
            </div>
            <ArrowDown size={14} className="text-danger" />
            <div className="mt-1 flex h-14 w-32 flex-col items-center justify-center rounded border-2 border-dashed border-danger bg-danger/20 text-center shadow-sm">
              <span className="text-[10px] font-bold text-danger">Carton Surface</span>
              <span className="text-[8px] font-semibold text-danger">Puncture & Collapse Hazard</span>
            </div>
          </div>

          <div className="flex flex-col items-center text-center max-w-[170px]">
            <AlertTriangle className="text-danger mb-1" size={24} />
            <span className="text-caption font-bold text-danger">&gt;75 kg Concentrated Load</span>
            <span className="text-[9px] text-ink-soft mt-0.5">Severe fall-from-height and carton collapse risk</span>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-end gap-3">
            {/* Safe Platform Ladder */}
            <div className="flex flex-col items-center">
              <div className="flex items-center gap-1 text-ok font-bold text-caption">
                <Footprints size={18} />
                <span>Worker Position</span>
              </div>
              <div className="mt-1 flex h-16 w-20 flex-col items-center justify-center rounded border-2 border-ok bg-ok/20 text-center">
                <span className="text-[9px] font-bold text-ok">Access Ladder</span>
                <span className="text-[7px] text-ok">Non-Slip Treads</span>
              </div>
            </div>

            {/* Unaffected Carton */}
            <div className="flex h-14 w-24 flex-col items-center justify-center rounded border border-line bg-surface text-center">
              <span className="text-[9px] font-bold text-ink">Carton Intact</span>
              <span className="text-[7px] text-ink-faint">Zero Foot Load</span>
            </div>
          </div>

          <div className="flex flex-col items-center text-center max-w-[170px]">
            <ShieldCheck className="text-ok mb-1" size={24} />
            <span className="text-caption font-bold text-ok">Designated Access Safe</span>
            <span className="text-[9px] text-ink-soft mt-0.5">Zero foot contact protects both personnel and goods</span>
          </div>
        </>
      )}
    </div>
  )
}

/* 6. Wrong Product Orientation */
function OrientationVisual({ isBefore }) {
  return (
    <div className="relative flex h-48 w-full items-center justify-around rounded-md border border-line bg-paper/60 p-5 select-none">
      {isBefore ? (
        <>
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex h-14 w-28 items-center justify-center rounded border-2 border-danger bg-danger/15 shadow-sm">
              <span className="flex items-center gap-1 font-mono text-[10px] font-bold text-danger">
                THIS WAY UP <ArrowRight size={12} />
              </span>
            </div>
            <span className="rounded bg-danger/10 px-2 py-0.5 text-[9px] font-bold text-danger">
              Horizontal Placement (1.72 Aspect)
            </span>
          </div>

          <div className="flex flex-col items-center text-center max-w-[180px]">
            <PackageX className="text-danger mb-1" size={22} />
            <span className="text-caption font-bold text-danger">Specification Violation</span>
            <span className="text-[9px] text-ink-soft mt-0.5">Compressive side load causes internal fluid/component shear</span>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex h-24 w-16 flex-col items-center justify-center rounded border-2 border-ok bg-ok/15 shadow-sm">
              <ArrowUp size={16} className="text-ok mb-1" />
              <span className="font-mono text-[9px] font-bold text-ok text-center leading-tight">
                THIS WAY UP
              </span>
            </div>
            <span className="rounded bg-ok/10 px-2 py-0.5 text-[9px] font-bold text-ok">
              Compliant Vertical Upright
            </span>
          </div>

          <div className="flex flex-col items-center text-center max-w-[180px]">
            <PackageCheck className="text-ok mb-1" size={22} />
            <span className="text-caption font-bold text-ok">Upright Conformance Verified</span>
            <span className="text-[9px] text-ink-soft mt-0.5">Package resting on engineered reinforced base</span>
          </div>
        </>
      )}
    </div>
  )
}

/* 7. Pallet / Box Overhang */
function OverhangVisual({ isBefore }) {
  return (
    <div className="relative flex h-48 w-full flex-col items-center justify-end rounded-md border border-line bg-paper/60 p-4 select-none">
      <div className="relative flex flex-col items-center w-64 pb-2">
        {/* Carton Layer */}
        {isBefore ? (
          <div className="relative ml-16 flex h-14 w-44 flex-col items-center justify-center rounded border-2 border-danger bg-danger/20 text-center shadow-xs">
            <span className="text-[10px] font-bold text-danger">Cantilever Carton</span>
            <span className="text-[8px] text-danger">46% Overhang Beyond Deck Edge</span>
          </div>
        ) : (
          <div className="relative flex h-14 w-44 flex-col items-center justify-center rounded border-2 border-ok bg-ok/20 text-center shadow-xs">
            <span className="text-[10px] font-bold text-ok">Flush Aligned Carton</span>
            <span className="text-[8px] text-ok">100% Supported by Pallet Deck</span>
          </div>
        )}

        {/* Pallet Base Deck */}
        <div className="mt-1 flex h-4 w-52 items-center justify-between rounded bg-steel/80 px-3">
          <span className="text-[8px] text-paper font-bold uppercase">Pallet Boundary</span>
          <span className="text-[8px] text-paper font-bold uppercase">Edge</span>
        </div>

        {/* Pallet Runners */}
        <div className="mt-1 flex w-52 justify-around">
          <div className="h-3 w-5 rounded-xs bg-line-strong" />
          <div className="h-3 w-5 rounded-xs bg-line-strong" />
          <div className="h-3 w-5 rounded-xs bg-line-strong" />
        </div>
      </div>

      <div className="mt-1 text-center">
        {isBefore ? (
          <span className="rounded bg-danger/15 px-2.5 py-0.5 text-[9px] font-bold text-danger">
            Tipping Moment: Cantilever overhang past support deck
          </span>
        ) : (
          <span className="rounded bg-ok/15 px-2.5 py-0.5 text-[9px] font-bold text-ok">
            Balanced Center of Mass: Zero cantilever overhang
          </span>
        )}
      </div>
    </div>
  )
}

/* 8. Dock Edge Gap */
function DockGapVisual({ isBefore }) {
  return (
    <div className="relative flex h-48 w-full items-center justify-around rounded-md border border-line bg-paper/60 p-4 select-none">
      <div className="flex w-full items-center justify-between px-4">
        {/* Warehouse Dock Floor */}
        <div className="flex h-24 w-24 flex-col justify-between rounded border border-line bg-surface p-2 text-center">
          <span className="text-[9px] font-bold text-ink">Warehouse Dock</span>
          <div className="border-t border-line text-[8px] text-ink-soft">Floor Level</div>
        </div>

        {/* Gap Transition Section */}
        <div className="flex flex-1 flex-col items-center px-3">
          {isBefore ? (
            <div className="flex flex-col items-center">
              <span className="text-danger font-bold text-caption">1.2m Void Drop</span>
              <div className="my-1 h-1 w-full border-t-2 border-dashed border-danger" />
              <span className="rounded bg-danger/10 px-2 py-0.5 text-[8px] font-bold text-danger">
                Bridge Plate Not Deployed
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <div className="h-4 w-full rounded bg-signal/70 border border-signal flex items-center justify-center">
                <span className="text-[8px] font-bold text-ink uppercase tracking-wider">Bridge Plate Deployed</span>
              </div>
              <span className="rounded bg-ok/10 px-2 py-0.5 text-[8px] font-bold text-ok mt-1">
                Continuous Safe Transit Deck
              </span>
            </div>
          )}
        </div>

        {/* Trailer Bed */}
        <div className="flex h-24 w-24 flex-col justify-between rounded border border-line bg-surface p-2 text-center">
          <span className="text-[9px] font-bold text-ink">Truck Trailer</span>
          <div className="border-t border-line text-[8px] text-ink-soft">Trailer Bed</div>
        </div>
      </div>
    </div>
  )
}

/* 9. Wet Floor Zone */
function WetFloorVisual({ isBefore }) {
  return (
    <div className="relative flex h-48 w-full items-center justify-around rounded-md border border-line bg-paper/60 p-4 select-none">
      {isBefore ? (
        <>
          <div className="relative flex h-24 w-32 items-center justify-center rounded-full border border-danger bg-danger/10 text-center p-2">
            <span className="text-[9px] font-bold text-danger">Active Wet Washdown Area</span>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-0.5 w-full bg-danger rotate-12" />
            </div>
          </div>
          <div className="flex flex-col items-center text-center max-w-[170px]">
            <AlertTriangle className="text-danger mb-1" size={22} />
            <span className="text-caption font-bold text-danger">Direct Wet Transit</span>
            <span className="text-[9px] text-ink-soft mt-0.5">60% traction loss elevates slip & cargo dampening risk</span>
          </div>
        </>
      ) : (
        <>
          <div className="relative flex flex-col items-center">
            {/* Safe Detour Aisle */}
            <div className="mb-2 flex h-8 w-36 items-center justify-center rounded border border-ok bg-ok/15">
              <span className="text-[9px] font-bold text-ok">Dry Perimeter Aisle Detour</span>
            </div>
            {/* Puddle Zone Avoided */}
            <div className="flex h-12 w-32 items-center justify-center rounded-full border border-dashed border-line-strong bg-paper text-center">
              <span className="text-[8px] text-ink-faint">Wet Zone Bypassed</span>
            </div>
          </div>
          <div className="flex flex-col items-center text-center max-w-[170px]">
            <ShieldCheck className="text-ok mb-1" size={22} />
            <span className="text-caption font-bold text-ok">Safe Dry Transit</span>
            <span className="text-[9px] text-ink-soft mt-0.5">Maintains 100% surface friction along designated walkway</span>
          </div>
        </>
      )}
    </div>
  )
}

/* 10. Improper Loading Sequence */
function LoadingSequenceVisual({ isBefore }) {
  return (
    <div className="relative flex h-48 w-full items-center justify-around rounded-md border border-line bg-paper/60 p-4 select-none">
      <div className="flex w-full flex-col items-center gap-2">
        <span className="text-[10px] font-bold text-ink-soft uppercase tracking-wider">
          Trailer Staging Order (Rear Door &rarr; Nose)
        </span>
        <div className="flex w-64 items-center justify-between rounded border border-line bg-surface p-2">
          {isBefore ? (
            <>
              <div className="flex h-12 w-28 flex-col items-center justify-center rounded border border-danger bg-danger/15 text-center">
                <span className="text-[9px] font-bold text-danger">Drop 2 (Interim)</span>
                <span className="text-[7px] text-danger">Blocks Drop 1</span>
              </div>
              <ArrowRight size={14} className="text-danger" />
              <div className="flex h-12 w-28 flex-col items-center justify-center rounded border border-line bg-paper text-center">
                <span className="text-[9px] font-bold text-ink">Drop 1 (First Out)</span>
                <span className="text-[7px] text-ink-faint">Trapped Inside</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex h-12 w-28 flex-col items-center justify-center rounded border border-ok bg-ok/15 text-center">
                <span className="text-[9px] font-bold text-ok">Drop 1 (First Out)</span>
                <span className="text-[7px] text-ok">At Rear Door</span>
              </div>
              <ArrowRight size={14} className="text-ok" />
              <div className="flex h-12 w-28 flex-col items-center justify-center rounded border border-ok bg-ok/25 text-center">
                <span className="text-[9px] font-bold text-ok">Drop 2 (Final)</span>
                <span className="text-[7px] text-ok">In Trailer Nose</span>
              </div>
            </>
          )}
        </div>
        <span className={`text-[9px] font-semibold ${isBefore ? 'text-danger' : 'text-ok'}`}>
          {isBefore ? 'Double handling required at destination' : 'Optimal reverse manifest delivery sequence'}
        </span>
      </div>
    </div>
  )
}

/* 11. Solo Heavy Handling */
function SoloHeavyVisual({ isBefore }) {
  return (
    <div className="relative flex h-48 w-full items-center justify-around rounded-md border border-line bg-paper/60 p-4 select-none">
      {isBefore ? (
        <>
          <div className="flex flex-col items-center gap-1">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-danger bg-danger/10 font-bold text-danger">
              1x
            </div>
            <span className="text-[10px] font-bold text-danger">Solo Worker</span>
          </div>

          <div className="flex flex-col items-center text-center max-w-[170px]">
            <span className="rounded border border-danger/40 bg-danger/15 px-2.5 py-1 text-caption font-bold text-danger">
              42 kg Load on Single Worker
            </span>
            <span className="mt-1 text-[9px] text-ink-soft">
              Exceeds 25kg individual safe ergonomic threshold by 68%
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-ok bg-ok/10 font-bold text-ok">
              <Users size={20} />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-ok">2x Workers</span>
              <span className="text-[8px] text-ink-soft">Team Lift</span>
            </div>
          </div>

          <div className="flex flex-col items-center text-center max-w-[170px]">
            <span className="rounded border border-ok/40 bg-ok/15 px-2.5 py-1 text-caption font-bold text-ok">
              21 kg Distributed Load
            </span>
            <span className="mt-1 text-[9px] text-ink-soft">
              Synchronized lifting keeps spinal compression within safe limits
            </span>
          </div>
        </>
      )}
    </div>
  )
}

/* 12. Wrong Equipment Usage */
function WrongEquipmentVisual({ isBefore }) {
  return (
    <div className="relative flex h-48 w-full items-center justify-around rounded-md border border-line bg-paper/60 p-4 select-none">
      {isBefore ? (
        <>
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex h-14 w-28 items-center justify-center rounded border-2 border-dashed border-danger bg-danger/10 text-center">
              <span className="text-[10px] font-bold text-danger">Dragged Wooden Pallet</span>
            </div>
            <span className="text-[8px] text-danger font-semibold">Makeshift Transport Drag</span>
          </div>

          <div className="flex flex-col items-center text-center max-w-[170px]">
            <PackageX className="text-danger mb-1" size={22} />
            <span className="text-caption font-bold text-danger">Unapproved Equipment</span>
            <span className="text-[9px] text-ink-soft mt-0.5">Tipping instability and floor abrasion hazard</span>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex h-14 w-28 items-center justify-center rounded border-2 border-ok bg-ok/15 text-center shadow-xs">
              <span className="text-[10px] font-bold text-ok">Wheeled Flatbed Cart</span>
            </div>
            <span className="text-[8px] text-ok font-bold">Approved Certified Equipment</span>
          </div>

          <div className="flex flex-col items-center text-center max-w-[170px]">
            <PackageCheck className="text-ok mb-1" size={22} />
            <span className="text-caption font-bold text-ok">Safe Wheeled Transport</span>
            <span className="text-[9px] text-ink-soft mt-0.5">Complies with facility equipment certification rules</span>
          </div>
        </>
      )}
    </div>
  )
}

/* Generic Fallback Visual */
function GenericVisual({ isBefore, data }) {
  return (
    <div className="relative flex h-48 w-full items-center justify-around rounded-md border border-line bg-paper/60 p-4 select-none">
      <div className="flex flex-col items-center gap-1">
        {isBefore ? (
          <>
            <PackageX className="text-danger" size={28} />
            <span className="text-caption font-bold text-danger">Observed Action</span>
          </>
        ) : (
          <>
            <PackageCheck className="text-ok" size={28} />
            <span className="text-caption font-bold text-ok">Verified Safer Action</span>
          </>
        )}
      </div>
    </div>
  )
}
