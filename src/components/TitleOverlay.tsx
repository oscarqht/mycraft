import React, { useMemo } from 'react';
import { Compass, Dices, Pickaxe, Play, Sparkles, Trash2 } from 'lucide-react';
import { parseMinecraftSeed } from '../game/bedrockSeed';
import { SavedWorldState } from '../game/storage';
import { GameMode, WorldConfig } from '../game/types';

interface TitleOverlayProps {
  config: WorldConfig;
  savedWorlds: SavedWorldState[];
  onChangeConfig: (next: WorldConfig) => void;
  onStart: (resumeSaved: boolean) => void;
  onDeleteWorld: (seed: string) => void;
}

const BEDROCK_SEED_PRESETS = [
  '8675309',
  '-4172144997902289642',
  '12345',
  '3257840388504953787',
  '-1251937210',
  '42',
];

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  config,
  savedWorlds,
  onChangeConfig,
  onStart,
  onDeleteWorld,
}) => {
  const parsedSeed = useMemo(() => parseMinecraftSeed(config.seed), [config.seed]);

  const randomizeSeed = () => {
    const usePreset = Math.random() < 0.4;
    if (usePreset) {
      const candidates = BEDROCK_SEED_PRESETS.filter((s) => s !== config.seed);
      const pick = candidates[Math.floor(Math.random() * candidates.length)] ?? BEDROCK_SEED_PRESETS[0];
      onChangeConfig({ ...config, seed: pick });
      return;
    }
    const sign = Math.random() < 0.5 ? -1n : 1n;
    const hi = BigInt(Math.floor(Math.random() * 0x7fffffff));
    const lo = BigInt(Math.floor(Math.random() * 0xffffffff));
    const num = sign * ((hi << 32n) | lo);
    onChangeConfig({ ...config, seed: num.toString() });
  };

  const setMode = (mode: GameMode) => {
    onChangeConfig({ ...config, mode });
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-3 sm:p-6 bg-slate-950/65">
      <div className="voxel-panel w-full max-w-2xl max-h-[92dvh] overflow-y-auto p-5 sm:p-8 text-slate-100">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-5 border-b border-slate-800">
          <div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white">
              VoxelCraft
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Bedrock 1.18+ seed terrain · 52 biomes · Y -64 to 319 · 3D caves, mountains &amp; oceans
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-5">
          {/* Left Column: World Configuration */}
          <div className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">
                Minecraft Bedrock Seed
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={config.seed}
                  onChange={(e) => onChangeConfig({ ...config, seed: e.target.value })}
                  placeholder="Enter Bedrock numeric or text seed..."
                  className="flex-1 min-w-0 bg-slate-900 border-2 border-slate-700 focus:border-amber-500 outline-none px-3 py-2.5 text-sm text-white font-mono-tabular"
                />
                <button
                  type="button"
                  onClick={randomizeSeed}
                  title="Randomize Bedrock Seed"
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-slate-800 hover:bg-slate-700 border-2 border-slate-700 text-slate-200 transition-colors cursor-pointer"
                >
                  <Dices className="w-4 h-4" />
                </button>
              </div>
              <div className="text-[11px] text-slate-400 mt-1.5 font-mono-tabular truncate">
                64-bit seed: <span className="text-amber-300">{parsedSeed.displayInt64}</span>
                {!parsedSeed.isNumeric && config.seed.trim().length > 0 && (
                  <span className="text-slate-500"> (text hash)</span>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">
                Game Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode('creative')}
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold border-2 transition-colors cursor-pointer whitespace-nowrap ${
                    config.mode === 'creative'
                      ? 'bg-amber-500/15 border-amber-500 text-amber-300'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span>Creative</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('survival')}
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold border-2 transition-colors cursor-pointer whitespace-nowrap ${
                    config.mode === 'survival'
                      ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <Pickaxe className="w-4 h-4 shrink-0" />
                  <span>Survival</span>
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                {config.mode === 'creative'
                  ? 'Double-tap Jump/Space to fly, instant block breaking, and full catalog access.'
                  : 'Mine ores with tool tiers, craft recipes, manage hunger, and survive depths.'}
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300 mb-2">
                <span>Render Distance</span>
                <span className="font-mono-tabular text-amber-400">{config.renderDistance} chunks</span>
              </div>
              <input
                type="range"
                min={3}
                max={9}
                step={1}
                value={config.renderDistance}
                onChange={(e) => onChangeConfig({ ...config, renderDistance: Number(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>

            <button
              type="button"
              onClick={() => onStart(true)}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 px-4 border-2 border-emerald-400/50 transition-colors cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Enter World</span>
            </button>
          </div>

          {/* Right Column: Controls Guide & Saved Worlds */}
          <div className="flex flex-col justify-between space-y-5 md:border-l md:border-slate-800 md:pl-6">
            <div>
              <h2 className="text-xs font-semibold text-slate-300 mb-2.5">Controls</h2>
              <div className="space-y-1.5 text-xs text-slate-300">
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span className="text-slate-400">Move</span>
                  <span className="font-mono-tabular">WASD · Touch Joystick</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span className="text-slate-400">Look</span>
                  <span className="font-mono-tabular">Mouse · Drag Screen</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span className="text-slate-400">Mine</span>
                  <span className="font-mono-tabular">Left Click · Hold / Mine Btn</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span className="text-slate-400">Place / Use</span>
                  <span className="font-mono-tabular">Right Click · Tap / Place Btn</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span className="text-slate-400">Jump / Fly</span>
                  <span className="font-mono-tabular">Space · 2×Jump</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">Inventory &amp; Pause</span>
                  <span className="font-mono-tabular">E / Esc · Top-Left Icons</span>
                </div>
              </div>
            </div>

            {savedWorlds.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-slate-300 mb-2">Saved Worlds</h2>
                <div className="max-h-32 overflow-y-auto space-y-1.5 pr-1">
                  {savedWorlds.map((w) => (
                    <div
                      key={w.seed}
                      className="flex items-center justify-between gap-2 px-2.5 py-2 bg-slate-900 border border-slate-800 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onChangeConfig({
                            seed: w.seed,
                            mode: w.mode,
                            renderDistance: w.renderDistance,
                          });
                        }}
                        className="flex-1 text-left flex items-center gap-2 hover:text-amber-300 truncate cursor-pointer"
                      >
                        <Compass className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="font-mono-tabular truncate">{w.seed}</span>
                        <span className="text-slate-500 shrink-0">· {w.mode}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteWorld(w.seed)}
                        title="Delete saved world"
                        className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
