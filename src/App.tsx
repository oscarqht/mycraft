import { useCallback, useEffect, useRef, useState } from 'react';
import { GameHUD } from './components/GameHUD';
import { InventoryModal } from './components/InventoryModal';
import { PauseModal } from './components/PauseModal';
import { TitleOverlay } from './components/TitleOverlay';
import { TouchControls } from './components/TouchControls';
import { soundEngine } from './game/audio';
import { deleteSavedWorld, listSavedWorlds, SavedWorldState } from './game/storage';
import { CraftingModalMode, GameMode, HudSnapshot, ItemStack, WorldConfig } from './game/types';
import { VoxelEngine } from './game/VoxelEngine';

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<VoxelEngine | null>(null);

  const [screen, setScreen] = useState<'title' | 'playing'>('title');
  const [modal, setModal] = useState<'none' | 'inventory' | 'pause'>('none');
  const [craftingMode, setCraftingMode] = useState<CraftingModalMode>('inventory');
  const [showDebug, setShowDebug] = useState(false);
  const [muted, setMuted] = useState(false);
  const [savedWorlds, setSavedWorlds] = useState<SavedWorldState[]>([]);
  const [contextLost, setContextLost] = useState(false);

  const [config, setConfig] = useState<WorldConfig>({
    seed: '8675309',
    mode: 'creative',
    renderDistance: 5,
  });

  const [hud, setHud] = useState<HudSnapshot | null>(null);

  const refreshSavedWorlds = useCallback(async () => {
    const list = await listSavedWorlds();
    setSavedWorlds(list);
  }, []);

  useEffect(() => {
    void refreshSavedWorlds();
  }, [refreshSavedWorlds]);

  useEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl || engineRef.current) return;

    const engine = new VoxelEngine(mountEl, config, {
      onHudUpdate: (snapshot) => setHud(snapshot),
      onOpenModal: (nextModal, craftMode) => {
        setModal(nextModal);
        if (craftMode) setCraftingMode(craftMode);
      },
      onContextLost: () => setContextLost(true),
    });
    engineRef.current = engine;

    // Render live scenic world immediately behind the title screen
    void engine.loadAndStart(config, false);

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global F3 & Modal Escape/E shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'F3') {
        e.preventDefault();
        setShowDebug((prev) => !prev);
      } else if (screen === 'playing' && modal === 'inventory' && (e.code === 'KeyE' || e.code === 'Escape')) {
        e.preventDefault();
        setModal('none');
        engineRef.current?.setPaused(false);
        engineRef.current?.requestPointerLock();
      } else if (screen === 'playing' && modal === 'pause' && e.code === 'Escape') {
        e.preventDefault();
        setModal('none');
        engineRef.current?.setPaused(false);
        engineRef.current?.requestPointerLock();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modal, screen]);

  const handleEnterWorld = async (resumeSaved: boolean) => {
    const engine = engineRef.current;
    if (!engine) return;
    await engine.loadAndStart(config, resumeSaved);
    setScreen('playing');
    setModal('none');
    engine.setPaused(false);
    engine.requestPointerLock();
  };

  const handleDeleteWorld = async (seed: string) => {
    await deleteSavedWorld(seed);
    await refreshSavedWorlds();
  };

  const handleResume = () => {
    setModal('none');
    engineRef.current?.setPaused(false);
    engineRef.current?.requestPointerLock();
  };

  const handleSwitchMode = (mode: GameMode) => {
    setConfig((prev) => ({ ...prev, mode }));
    engineRef.current?.setMode(mode);
  };

  const handleChangeRenderDistance = (rd: number) => {
    setConfig((prev) => ({ ...prev, renderDistance: rd }));
    engineRef.current?.setRenderDistance(rd);
  };

  const handleExitToTitle = async () => {
    await engineRef.current?.saveNow();
    await refreshSavedWorlds();
    engineRef.current?.setPaused(true);
    engineRef.current?.exitPointerLock();
    setModal('none');
    setScreen('title');
  };

  const handleUpdateInventory = (hotbar: (ItemStack | null)[], backpack: (ItemStack | null)[]) => {
    engineRef.current?.setInventory(hotbar, backpack);
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0b1017]">
      {/* Isolated WebGL Canvas Mount */}
      <div ref={mountRef} className="w-full h-full" />

      {contextLost && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 flex items-center justify-center p-6">
          <div className="voxel-panel p-6 max-w-sm text-center space-y-3">
            <h2 className="font-display text-xl font-bold text-rose-400">WebGL Context Lost</h2>
            <p className="text-sm text-slate-300">
              Your graphics driver reset the 3D viewport. Reload the page to restore rendering.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-amber-500 text-slate-950 font-semibold text-sm cursor-pointer"
            >
              Reload World
            </button>
          </div>
        </div>
      )}

      {screen === 'title' && (
        <TitleOverlay
          config={config}
          savedWorlds={savedWorlds}
          onChangeConfig={setConfig}
          onStart={handleEnterWorld}
          onDeleteWorld={handleDeleteWorld}
        />
      )}

      {screen === 'playing' && hud && (
        <GameHUD
          hud={hud}
          showDebug={showDebug}
          onSelectHotbar={(idx) => engineRef.current?.selectHotbarSlot(idx)}
          onRespawn={() => engineRef.current?.respawnPlayer()}
          onLockPointer={() => engineRef.current?.requestPointerLock()}
        />
      )}

      {screen === 'playing' && modal === 'none' && hud && hud.touchMode && !hud.dead && (
        <TouchControls
          mode={hud.mode}
          isFlying={hud.isFlying}
          isSneaking={hud.isSneaking}
          showDebug={showDebug}
          onMove={(x, f) => engineRef.current?.setVirtualMove(x, f)}
          onJump={(active) => engineRef.current?.setVirtualJump(active)}
          onToggleSneak={() => engineRef.current?.toggleVirtualSneak()}
          onToggleFlight={() => engineRef.current?.toggleFlight()}
          onMine={(active) => engineRef.current?.setVirtualMine(active)}
          onPlace={() => engineRef.current?.triggerVirtualPlace()}
          onOpenInventory={() => {
            engineRef.current?.setPaused(true);
            setCraftingMode('inventory');
            setModal('inventory');
          }}
          onOpenPause={() => {
            engineRef.current?.setPaused(true);
            setModal('pause');
          }}
          onToggleDebug={() => setShowDebug((prev) => !prev)}
        />
      )}

      {screen === 'playing' && modal === 'inventory' && hud && (
        <InventoryModal
          mode={hud.mode}
          craftingMode={craftingMode}
          hotbar={hud.hotbar}
          backpack={hud.backpack}
          selectedHotbar={hud.selectedHotbar}
          onUpdateInventory={handleUpdateInventory}
          onClose={handleResume}
        />
      )}

      {screen === 'playing' && modal === 'pause' && hud && (
        <PauseModal
          seed={config.seed}
          mode={hud.mode}
          renderDistance={config.renderDistance}
          timeOfDay={hud.timeOfDay}
          muted={muted}
          touchMode={hud.touchMode}
          onResume={handleResume}
          onSwitchMode={handleSwitchMode}
          onChangeRenderDistance={handleChangeRenderDistance}
          onSetTimeOfDay={(t) => engineRef.current?.setTimeOfDay(t)}
          onToggleMute={() => {
            soundEngine.muted = !soundEngine.muted;
            setMuted(soundEngine.muted);
          }}
          onToggleTouchMode={() => engineRef.current?.setTouchMode(!hud.touchMode)}
          onSave={async () => {
            await engineRef.current?.saveNow();
            await refreshSavedWorlds();
          }}
          onRespawn={() => {
            engineRef.current?.respawnPlayer();
            handleResume();
          }}
          onExitToTitle={handleExitToTitle}
        />
      )}
    </div>
  );
}
