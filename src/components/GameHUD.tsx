import React from 'react';
import { BLOCK_ID, getBlock } from '../game/blocks';
import { HudSnapshot } from '../game/types';
import { ItemIcon } from './ItemIcon';

interface GameHUDProps {
  hud: HudSnapshot;
  showDebug: boolean;
  onSelectHotbar: (idx: number) => void;
  onRespawn: () => void;
  onLockPointer: () => void;
}

function getCardinal(yaw: number): string {
  const deg = (((-yaw * 180) / Math.PI) % 360 + 360) % 360;
  if (deg >= 315 || deg < 45) return 'North (-Z)';
  if (deg >= 45 && deg < 135) return 'East (+X)';
  if (deg >= 135 && deg < 225) return 'South (+Z)';
  return 'West (-X)';
}

function formatTime(t: number): string {
  const hours = Math.floor(((t * 24 + 6) % 24));
  const mins = Math.floor((t * 24 * 60) % 60);
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export const GameHUD: React.FC<GameHUDProps> = ({
  hud,
  showDebug,
  onSelectHotbar,
  onRespawn,
  onLockPointer,
}) => {
  const heldStack = hud.hotbar[hud.selectedHotbar];
  const heldDef = heldStack ? getBlock(heldStack.id) : null;

  const targetHint =
    hud.target?.blockId === BLOCK_ID.CRAFTING_TABLE
      ? 'Right-click to use Crafting Table'
      : hud.target?.blockId === BLOCK_ID.FURNACE
        ? 'Right-click to use Furnace'
        : null;

  return (
    <div className="fixed inset-0 z-10 pointer-events-none select-none">
      {/* Underwater Tint */}
      {hud.isUnderwater && (
        <div className="fixed inset-0 bg-[#0d3b66]/45 pointer-events-none" />
      )}

      {/* Center Crosshair */}
      {(hud.pointerLocked || hud.touchMode) && !hud.dead && (
        <div className="fixed inset-0 flex items-center justify-center">
          <div className="relative w-5 h-5">
            <div className="absolute left-1/2 top-0 -translate-x-1/2 w-[2px] h-5 bg-white/90 shadow-[0_0_2px_rgba(0,0,0,0.9)]" />
            <div className="absolute top-1/2 left-0 -translate-y-1/2 h-[2px] w-5 bg-white/90 shadow-[0_0_2px_rgba(0,0,0,0.9)]" />
          </div>
        </div>
      )}

      {/* F3 Debug Readout (Top-Left) */}
      {showDebug && (
        <div
          className={`fixed left-3 bg-slate-950/80 border border-slate-700/80 px-3 py-2 text-xs text-slate-100 font-mono-tabular space-y-0.5 max-w-[calc(100vw-24px)] sm:max-w-xs ${
            hud.touchMode ? 'top-16' : 'top-3'
          }`}
        >
          <div className="text-amber-400 font-semibold">
            VoxelCraft · {hud.mode === 'creative' ? 'Creative' : 'Survival'}
          </div>
          <div>
            XYZ: {hud.pos.x.toFixed(1)} / {hud.pos.y.toFixed(1)} / {hud.pos.z.toFixed(1)}
          </div>
          <div>
            Chunk: {Math.floor(hud.pos.x / 16)}, {Math.floor(hud.pos.z / 16)} · {getCardinal(hud.yaw)}
          </div>
          <div>Biome: {hud.biomeName}</div>
          {hud.seedInt64 && <div>Seed: {hud.seedInt64}</div>}
          <div>
            Time: {formatTime(hud.timeOfDay)} · FPS: {hud.fps} · Chunks: {hud.loadedChunks}
          </div>
          {hud.target && (
            <div className="text-sky-300">
              Looking at: {hud.target.blockName} ({hud.target.x}, {hud.target.y}, {hud.target.z})
            </div>
          )}
        </div>
      )}

      {/* Top-Right Compact Biome & Status Indicator */}
      <div className="fixed top-3 right-3 bg-slate-950/75 border border-slate-700/80 px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs text-slate-200 flex items-center gap-1.5 sm:gap-2 max-w-[46vw] sm:max-w-none">
        <span className="font-medium truncate">{hud.biomeName}</span>
        <span className="text-slate-500">·</span>
        <span className="font-mono-tabular text-slate-300 shrink-0">Y {Math.floor(hud.pos.y)}</span>
        {hud.isFlying && (
          <>
            <span className="text-slate-500 hidden sm:inline">·</span>
            <span className="text-amber-400 font-medium hidden sm:inline">Flying</span>
          </>
        )}
      </div>

      {/* Center Prompts */}
      {!hud.touchMode && !hud.pointerLocked && !hud.dead && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 pointer-events-auto">
          <button
            type="button"
            onClick={onLockPointer}
            className="bg-slate-950/88 hover:bg-slate-900 border-2 border-amber-500/70 px-4 py-2 text-xs font-semibold text-amber-200 cursor-pointer whitespace-nowrap"
          >
            Click anywhere on the world to lock mouse and play
          </button>
        </div>
      )}

      {(hud.pointerLocked || hud.touchMode) && targetHint && (
        <div className="fixed bottom-28 sm:bottom-32 left-1/2 -translate-x-1/2 bg-slate-950/85 border border-slate-700 px-3 py-1 text-xs text-amber-300 whitespace-nowrap">
          {hud.touchMode ? targetHint.replace('Right-click', 'Tap Place') : targetHint}
        </div>
      )}

      {hud.statusMessage && (
        <div className="fixed bottom-32 sm:bottom-36 left-1/2 -translate-x-1/2 bg-slate-950/85 border border-slate-700 px-3 py-1 text-xs font-medium text-white whitespace-nowrap">
          {hud.statusMessage}
        </div>
      )}

      {/* Bottom Center Hotbar + Survival Bars */}
      <div className="fixed bottom-2 sm:bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-auto max-w-[calc(100vw-8px)]">
        {heldDef && (
          <div className="text-[11px] sm:text-xs font-medium text-white bg-slate-950/75 px-2.5 py-0.5 border border-slate-800">
            {heldDef.name}
          </div>
        )}

        {/* Survival Health, Oxygen & Hunger Bars */}
        {hud.mode === 'survival' && (
          <div className="w-full flex items-center justify-between px-1 gap-2 sm:gap-4">
            {/* Hearts */}
            <div className="flex items-center gap-0.5" title={`Health: ${hud.health}/20`}>
              {Array.from({ length: 10 }).map((_, i) => {
                const full = hud.health >= (i + 1) * 2;
                const half = !full && hud.health === i * 2 + 1;
                return (
                  <span
                    key={i}
                    className={`inline-block w-3 h-3 sm:w-3.5 sm:h-3.5 border border-slate-950 ${
                      full ? 'bg-rose-500' : half ? 'bg-rose-400/70' : 'bg-slate-800/90'
                    }`}
                    style={{ clipPath: 'polygon(15% 0%, 45% 0%, 50% 15%, 55% 0%, 85% 0%, 100% 20%, 100% 50%, 50% 100%, 0% 50%, 0% 20%)' }}
                  />
                );
              })}
            </div>

            {/* Oxygen Bubbles */}
            {hud.isUnderwater && (
              <div className="flex items-center gap-0.5" title={`Oxygen: ${hud.oxygen}/20`}>
                {Array.from({ length: 10 }).map((_, i) => {
                  const full = hud.oxygen >= (i + 1) * 2;
                  return (
                    <span
                      key={i}
                      className={`inline-block w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full border border-sky-200/70 ${
                        full ? 'bg-sky-400' : 'bg-transparent opacity-30'
                      }`}
                    />
                  );
                })}
              </div>
            )}

            {/* Hunger */}
            <div className="flex items-center gap-0.5" title={`Hunger: ${hud.hunger}/20`}>
              {Array.from({ length: 10 }).map((_, i) => {
                const full = hud.hunger >= (i + 1) * 2;
                const half = !full && hud.hunger === i * 2 + 1;
                return (
                  <span
                    key={i}
                    className={`inline-block w-3 h-3 sm:w-3.5 sm:h-3.5 border border-slate-950 ${
                      full ? 'bg-amber-500' : half ? 'bg-amber-400/65' : 'bg-slate-800/90'
                    }`}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* 9-Slot Hotbar */}
        <div className="flex items-center gap-0.5 sm:gap-1 p-1 bg-slate-950/90 border-2 border-slate-700">
          {hud.hotbar.map((stack, idx) => {
            const active = idx === hud.selectedHotbar;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onSelectHotbar(idx)}
                className={`relative w-9 h-9 sm:w-11 sm:h-11 flex items-center justify-center cursor-pointer transition-transform ${
                  active ? 'voxel-slot-active scale-105 z-10' : 'voxel-slot hover:border-slate-500'
                }`}
              >
                <span className="font-mono-tabular absolute top-0.5 left-0.5 sm:left-1 text-[8px] sm:text-[9px] text-slate-400 leading-none">
                  {idx + 1}
                </span>
                {stack && <ItemIcon id={stack.id} count={stack.count} size={28} />}
              </button>
            );
          })}
        </div>

        {!hud.touchMode && (
          <div className="text-[11px] text-slate-300 bg-slate-950/70 px-2.5 py-0.5 border border-slate-800/80">
            E Inventory &amp; Crafting · Q Pick Block · F3 Debug · Esc Pause
          </div>
        )}
      </div>

      {/* Respawn Overlay */}
      {hud.dead && (
        <div className="fixed inset-0 z-40 bg-rose-950/70 flex items-center justify-center pointer-events-auto">
          <div className="voxel-panel p-6 sm:p-8 text-center max-w-sm w-full space-y-4">
            <h2 className="font-display text-3xl font-bold text-rose-300">You Died</h2>
            <p className="text-sm text-slate-300">
              Your adventure ended at {Math.floor(hud.pos.x)}, {Math.floor(hud.pos.y)}, {Math.floor(hud.pos.z)}.
            </p>
            <button
              type="button"
              onClick={onRespawn}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 border-2 border-emerald-400/50 text-white font-semibold cursor-pointer"
            >
              Respawn at Spawn
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
