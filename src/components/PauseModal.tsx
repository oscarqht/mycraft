import React from 'react';
import { Gamepad2, Home, Pickaxe, Play, RotateCcw, Save, Sparkles, Sun, Volume2, VolumeX } from 'lucide-react';
import { GameMode } from '../game/types';

interface PauseModalProps {
  seed: string;
  mode: GameMode;
  renderDistance: number;
  timeOfDay: number;
  muted: boolean;
  touchMode: boolean;
  onResume: () => void;
  onSwitchMode: (mode: GameMode) => void;
  onChangeRenderDistance: (rd: number) => void;
  onSetTimeOfDay: (t: number) => void;
  onToggleMute: () => void;
  onToggleTouchMode: () => void;
  onSave: () => void;
  onRespawn: () => void;
  onExitToTitle: () => void;
}

const TIME_PRESETS = [
  { label: 'Sunrise', value: 0.02 },
  { label: 'Noon', value: 0.25 },
  { label: 'Sunset', value: 0.5 },
  { label: 'Midnight', value: 0.75 },
];

export const PauseModal: React.FC<PauseModalProps> = ({
  seed,
  mode,
  renderDistance,
  timeOfDay,
  muted,
  touchMode,
  onResume,
  onSwitchMode,
  onChangeRenderDistance,
  onSetTimeOfDay,
  onToggleMute,
  onToggleTouchMode,
  onSave,
  onRespawn,
  onExitToTitle,
}) => {
  return (
    <div className="fixed inset-0 z-30 bg-slate-950/75 flex items-center justify-center p-4">
      <div className="voxel-panel w-full max-w-md max-h-[92dvh] overflow-y-auto p-5 sm:p-6 text-slate-100 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">Game Paused</h2>
            <p className="text-xs text-slate-400 font-mono-tabular mt-0.5">Seed: {seed}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleTouchMode}
              className={`min-w-[40px] min-h-[40px] px-2.5 flex items-center gap-1.5 text-xs font-medium border cursor-pointer ${
                touchMode
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                  : 'bg-slate-900 border-slate-700 text-slate-300'
              }`}
              title="Toggle On-Screen Touch Controls"
            >
              <Gamepad2 className="w-4 h-4" />
              <span className="hidden sm:inline">Touch</span>
            </button>
            <button
              type="button"
              onClick={onToggleMute}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 cursor-pointer"
              title={muted ? 'Unmute Audio' : 'Mute Audio'}
            >
              {muted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onResume}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 border-2 border-emerald-400/50 text-white font-semibold cursor-pointer"
        >
          <Play className="w-4 h-4 fill-current" />
          <span>Resume Playing</span>
        </button>

        {/* Mode Switcher */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-300">Game Mode</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onSwitchMode('creative')}
              className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border cursor-pointer ${
                mode === 'creative'
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Creative</span>
            </button>
            <button
              type="button"
              onClick={() => onSwitchMode('survival')}
              className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border cursor-pointer ${
                mode === 'survival'
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
              }`}
            >
              <Pickaxe className="w-3.5 h-3.5" />
              <span>Survival</span>
            </button>
          </div>
        </div>

        {/* Time of Day */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span className="flex items-center gap-1.5">
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              Time of Day
            </span>
            <span className="font-mono-tabular text-slate-400">{Math.round(timeOfDay * 100)}%</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {TIME_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => onSetTimeOfDay(p.value)}
                className="py-2 text-xs bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 cursor-pointer"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Render Distance */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span>Render Distance</span>
            <span className="font-mono-tabular text-amber-400">{renderDistance} chunks</span>
          </div>
          <input
            type="range"
            min={3}
            max={9}
            step={1}
            value={renderDistance}
            onChange={(e) => onChangeRenderDistance(Number(e.target.value))}
            className="w-full accent-amber-500 cursor-pointer"
          />
        </div>

        {/* Utility Actions */}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onSave}
            className="flex items-center justify-center gap-1.5 py-2.5 text-xs bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save</span>
          </button>
          <button
            type="button"
            onClick={onRespawn}
            className="flex items-center justify-center gap-1.5 py-2.5 text-xs bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Spawn</span>
          </button>
          <button
            type="button"
            onClick={onExitToTitle}
            className="flex items-center justify-center gap-1.5 py-2.5 text-xs bg-slate-900 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-500/50 text-slate-200 cursor-pointer"
          >
            <Home className="w-3.5 h-3.5" />
            <span>Title</span>
          </button>
        </div>
      </div>
    </div>
  );
};
