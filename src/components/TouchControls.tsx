import React, { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Backpack, Bug, Feather, Hammer, Layers, Pause } from 'lucide-react';
import { GameMode } from '../game/types';

interface TouchControlsProps {
  mode: GameMode;
  isFlying: boolean;
  isSneaking: boolean;
  showDebug: boolean;
  onMove: (strafe: number, forward: number) => void;
  onJump: (active: boolean) => void;
  onToggleSneak: () => void;
  onToggleFlight: () => void;
  onMine: (active: boolean) => void;
  onPlace: () => void;
  onOpenInventory: () => void;
  onOpenPause: () => void;
  onToggleDebug: () => void;
}

export const TouchControls: React.FC<TouchControlsProps> = ({
  mode,
  isFlying,
  isSneaking,
  showDebug,
  onMove,
  onJump,
  onToggleSneak,
  onToggleFlight,
  onMine,
  onPlace,
  onOpenInventory,
  onOpenPause,
  onToggleDebug,
}) => {
  const padRef = useRef<HTMLDivElement | null>(null);
  const joyTouchId = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [mineActive, setMineActive] = useState(false);
  const [jumpActive, setJumpActive] = useState(false);

  const maxRadius = 38;

  const updateJoystick = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxRadius) {
      dx = (dx / dist) * maxRadius;
      dy = (dy / dist) * maxRadius;
    }
    setKnob({ x: dx, y: dy });
    // Forward is -dy, Strafe is +dx
    onMove(dx / maxRadius, -dy / maxRadius);
  };

  const handleJoyStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (joyTouchId.current !== null) return;
    const t = e.changedTouches[0];
    if (!t) return;
    joyTouchId.current = t.identifier;
    updateJoystick(t.clientX, t.clientY);
  };

  const handleJoyMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (joyTouchId.current === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === joyTouchId.current) {
        updateJoystick(t.clientX, t.clientY);
        break;
      }
    }
  };

  const handleJoyEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (joyTouchId.current === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joyTouchId.current) {
        joyTouchId.current = null;
        setKnob({ x: 0, y: 0 });
        onMove(0, 0);
        break;
      }
    }
  };

  return (
    <div className="fixed inset-0 z-20 pointer-events-none select-none" style={{ touchAction: 'none' }}>
      {/* Top-Left Mobile Menu Bar (Pause, Inventory, Debug) */}
      <div className="fixed top-3 left-3 flex items-center gap-2 pointer-events-auto">
        <button
          type="button"
          onClick={onOpenPause}
          aria-label="Pause Game"
          className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-slate-950/80 active:bg-slate-800 border-2 border-slate-700 text-slate-100 cursor-pointer"
        >
          <Pause className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={onOpenInventory}
          aria-label="Open Inventory"
          className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-slate-950/80 active:bg-slate-800 border-2 border-slate-700 text-amber-300 cursor-pointer"
        >
          <Backpack className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={onToggleDebug}
          aria-label="Toggle Coordinates"
          className={`min-w-[44px] min-h-[44px] flex items-center justify-center border-2 cursor-pointer ${
            showDebug
              ? 'bg-amber-500/20 border-amber-500 text-amber-300'
              : 'bg-slate-950/80 border-slate-700 text-slate-300'
          }`}
        >
          <Bug className="w-4 h-4" />
        </button>
      </div>

      {/* Left-Thumb Virtual Joystick & Sneak */}
      <div className="fixed bottom-20 left-3 sm:left-5 flex items-end gap-3 pointer-events-auto">
        <div
          ref={padRef}
          onTouchStart={handleJoyStart}
          onTouchMove={handleJoyMove}
          onTouchEnd={handleJoyEnd}
          onTouchCancel={handleJoyEnd}
          className="relative w-28 h-28 rounded-full bg-slate-950/55 border-2 border-slate-400/40 flex items-center justify-center"
          style={{ touchAction: 'none' }}
        >
          <div className="w-12 h-12 rounded-full border border-white/15 pointer-events-none" />
          <div
            className="absolute w-11 h-11 rounded-full bg-slate-100/80 border-2 border-slate-900 shadow-md pointer-events-none"
            style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
          />
        </div>

        <button
          type="button"
          onTouchStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleSneak();
          }}
          aria-label={isSneaking ? 'Disable Sneak' : 'Enable Sneak'}
          className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full border-2 cursor-pointer ${
            isSneaking
              ? 'bg-amber-500/35 border-amber-400 text-amber-200'
              : 'bg-slate-950/65 border-slate-500/50 text-slate-200'
          }`}
        >
          <ArrowDown className="w-5 h-5" />
        </button>
      </div>

      {/* Right-Thumb Action Buttons (Mine, Place, Jump, Fly) */}
      <div className="fixed bottom-20 right-3 sm:right-5 flex flex-col items-end gap-2.5 pointer-events-auto">
        <div className="flex items-center gap-2.5">
          {mode === 'creative' && (
            <button
              type="button"
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleFlight();
              }}
              aria-label="Toggle Flight"
              className={`min-w-[46px] min-h-[46px] flex items-center justify-center rounded-full border-2 cursor-pointer ${
                isFlying
                  ? 'bg-amber-500/35 border-amber-400 text-amber-200'
                  : 'bg-slate-950/65 border-slate-500/50 text-slate-200'
              }`}
            >
              <Feather className="w-5 h-5" />
            </button>
          )}
          <button
            type="button"
            onTouchStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setJumpActive(true);
              onJump(true);
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setJumpActive(false);
              onJump(false);
            }}
            onTouchCancel={(e) => {
              e.stopPropagation();
              setJumpActive(false);
              onJump(false);
            }}
            aria-label="Jump"
            className={`w-14 h-14 rounded-full border-2 flex items-center justify-center cursor-pointer ${
              jumpActive
                ? 'bg-emerald-500/45 border-emerald-300 text-white'
                : 'bg-slate-950/65 border-slate-400/55 text-slate-100'
            }`}
          >
            <ArrowUp className="w-6 h-6" />
          </button>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onTouchStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMineActive(true);
              onMine(true);
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMineActive(false);
              onMine(false);
            }}
            onTouchCancel={(e) => {
              e.stopPropagation();
              setMineActive(false);
              onMine(false);
            }}
            aria-label="Mine Block"
            className={`w-14 h-14 rounded-full border-2 flex flex-col items-center justify-center cursor-pointer ${
              mineActive
                ? 'bg-rose-500/50 border-rose-300 text-white'
                : 'bg-slate-950/70 border-slate-400/55 text-slate-100'
            }`}
          >
            <Hammer className="w-5 h-5" />
            <span className="text-[9px] font-semibold leading-none mt-0.5">Mine</span>
          </button>

          <button
            type="button"
            onTouchStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onPlace();
            }}
            aria-label="Place or Use"
            className="w-14 h-14 rounded-full bg-slate-950/70 active:bg-amber-500/45 border-2 border-amber-400/65 text-amber-200 flex flex-col items-center justify-center cursor-pointer"
          >
            <Layers className="w-5 h-5" />
            <span className="text-[9px] font-semibold leading-none mt-0.5">Place</span>
          </button>
        </div>
      </div>
    </div>
  );
};
