import React, { useMemo, useState } from 'react';
import { ArrowRight, Flame, Hammer, Search, Sparkles, X } from 'lucide-react';
import { ALL_CATALOG_ITEMS, BLOCK_ID, CATEGORY_LABELS, getBlock } from '../game/blocks';
import { CRAFTING_RECIPES, CraftingRecipe, matchCraftingGrid, SMELTING_RECIPES, SmeltingRecipe } from '../game/recipes';
import { BlockCategory, CraftingModalMode, GameMode, ItemStack } from '../game/types';
import { ItemIcon } from './ItemIcon';

interface InventoryModalProps {
  mode: GameMode;
  craftingMode: CraftingModalMode;
  hotbar: (ItemStack | null)[];
  backpack: (ItemStack | null)[];
  selectedHotbar: number;
  onUpdateInventory: (hotbar: (ItemStack | null)[], backpack: (ItemStack | null)[]) => void;
  onClose: () => void;
}

const PLANK_IDS = new Set<number>([
  BLOCK_ID.OAK_PLANKS,
  BLOCK_ID.BIRCH_PLANKS,
  BLOCK_ID.SPRUCE_PLANKS,
  BLOCK_ID.JUNGLE_PLANKS,
  BLOCK_ID.ACACIA_PLANKS,
  BLOCK_ID.DARK_OAK_PLANKS,
]);

export const InventoryModal: React.FC<InventoryModalProps> = ({
  mode,
  craftingMode,
  hotbar,
  backpack,
  selectedHotbar,
  onUpdateInventory,
  onClose,
}) => {
  const [tab, setTab] = useState<'catalog' | 'crafting'>(
    craftingMode !== 'inventory' || mode === 'survival' ? 'crafting' : 'catalog'
  );
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<BlockCategory | 'all'>('all');
  const [cursor, setCursor] = useState<ItemStack | null>(null);
  const [touchSplitMode, setTouchSplitMode] = useState(false);

  const gridSize: 2 | 3 = craftingMode === 'crafting_table' ? 3 : 2;
  const [craftGrid, setCraftGrid] = useState<(ItemStack | null)[]>(() => new Array(9).fill(null));
  const [furnaceInput, setFurnaceInput] = useState<ItemStack | null>(null);
  const [furnaceFuel, setFurnaceFuel] = useState<ItemStack | null>(null);

  const activeRecipe = useMemo(
    () => matchCraftingGrid(craftGrid.slice(0, gridSize * gridSize), gridSize),
    [craftGrid, gridSize]
  );

  const activeSmelt = useMemo(
    () => (furnaceInput ? SMELTING_RECIPES.find((r) => r.inputId === furnaceInput.id) ?? null : null),
    [furnaceInput]
  );

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ALL_CATALOG_ITEMS.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (q && !item.name.toLowerCase().includes(q) && !item.key.includes(q)) return false;
      return true;
    });
  }, [category, search]);

  const countInInventory = (itemId: number): number => {
    let total = 0;
    const match = (id: number) => id === itemId || (itemId === BLOCK_ID.OAK_PLANKS && PLANK_IDS.has(id));
    for (const s of hotbar) if (s && match(s.id)) total += s.count;
    for (const s of backpack) if (s && match(s.id)) total += s.count;
    return total;
  };

  const canCraftRecipe = (recipe: CraftingRecipe): boolean => {
    if (recipe.requiresTable && gridSize < 3) return false;
    if (mode === 'creative') return true;
    const needed = new Map<number, number>();
    for (const id of recipe.pattern) {
      if (id > 0) needed.set(id, (needed.get(id) ?? 0) + 1);
    }
    for (const [id, qty] of needed.entries()) {
      if (countInInventory(id) < qty) return false;
    }
    return true;
  };

  const consumeFromInventory = (
    nextHotbar: (ItemStack | null)[],
    nextBackpack: (ItemStack | null)[],
    itemId: number,
    amount: number
  ) => {
    let rem = amount;
    const match = (id: number) => id === itemId || (itemId === BLOCK_ID.OAK_PLANKS && PLANK_IDS.has(id));
    const consumeArr = (arr: (ItemStack | null)[]) => {
      for (let i = 0; i < arr.length && rem > 0; i++) {
        const s = arr[i];
        if (s && match(s.id)) {
          const take = Math.min(rem, s.count);
          s.count -= take;
          rem -= take;
          if (s.count <= 0) arr[i] = null;
        }
      }
    };
    consumeArr(nextBackpack);
    consumeArr(nextHotbar);
  };

  const giveResultToInventory = (
    nextHotbar: (ItemStack | null)[],
    nextBackpack: (ItemStack | null)[],
    result: ItemStack
  ) => {
    let rem = result.count;
    const maxS = getBlock(result.id).maxStack;
    const mergeArr = (arr: (ItemStack | null)[]) => {
      for (let i = 0; i < arr.length && rem > 0; i++) {
        const s = arr[i];
        if (s && s.id === result.id && s.count < maxS) {
          const add = Math.min(rem, maxS - s.count);
          s.count += add;
          rem -= add;
        }
      }
    };
    const fillArr = (arr: (ItemStack | null)[]) => {
      for (let i = 0; i < arr.length && rem > 0; i++) {
        if (!arr[i]) {
          const add = Math.min(rem, maxS);
          arr[i] = { id: result.id, count: add };
          rem -= add;
        }
      }
    };
    mergeArr(nextHotbar);
    mergeArr(nextBackpack);
    fillArr(nextHotbar);
    fillArr(nextBackpack);
  };

  const handleQuickCraft = (recipe: CraftingRecipe) => {
    if (!canCraftRecipe(recipe)) return;
    const nextHotbar = hotbar.map((s) => (s ? { ...s } : null));
    const nextBackpack = backpack.map((s) => (s ? { ...s } : null));

    if (mode === 'survival') {
      for (const id of recipe.pattern) {
        if (id > 0) consumeFromInventory(nextHotbar, nextBackpack, id, 1);
      }
    }
    giveResultToInventory(nextHotbar, nextBackpack, recipe.result);
    onUpdateInventory(nextHotbar, nextBackpack);
  };

  const handleSlotClick = (
    target: 'hotbar' | 'backpack' | 'craft' | 'furnace_in' | 'furnace_fuel',
    idx: number,
    rightClick: boolean
  ) => {
    const nextHotbar = hotbar.map((s) => (s ? { ...s } : null));
    const nextBackpack = backpack.map((s) => (s ? { ...s } : null));
    const nextCraft = craftGrid.map((s) => (s ? { ...s } : null));

    let slot: ItemStack | null = null;
    if (target === 'hotbar') slot = nextHotbar[idx];
    else if (target === 'backpack') slot = nextBackpack[idx];
    else if (target === 'craft') slot = nextCraft[idx];
    else if (target === 'furnace_in') slot = furnaceInput ? { ...furnaceInput } : null;
    else if (target === 'furnace_fuel') slot = furnaceFuel ? { ...furnaceFuel } : null;

    let nextCursor = cursor ? { ...cursor } : null;
    let nextSlot = slot ? { ...slot } : null;

    if (!rightClick) {
      if (!nextCursor && nextSlot) {
        nextCursor = nextSlot;
        nextSlot = null;
      } else if (nextCursor && !nextSlot) {
        nextSlot = nextCursor;
        nextCursor = null;
      } else if (nextCursor && nextSlot) {
        if (nextCursor.id === nextSlot.id) {
          const maxS = getBlock(nextSlot.id).maxStack;
          const add = Math.min(nextCursor.count, maxS - nextSlot.count);
          nextSlot.count += add;
          nextCursor.count -= add;
          if (nextCursor.count <= 0) nextCursor = null;
        } else {
          const tmp = nextSlot;
          nextSlot = nextCursor;
          nextCursor = tmp;
        }
      }
    } else {
      // Right-click: split half or place 1
      if (!nextCursor && nextSlot) {
        const half = Math.ceil(nextSlot.count / 2);
        nextCursor = { id: nextSlot.id, count: half };
        nextSlot.count -= half;
        if (nextSlot.count <= 0) nextSlot = null;
      } else if (nextCursor) {
        const maxS = getBlock(nextCursor.id).maxStack;
        if (!nextSlot) {
          nextSlot = { id: nextCursor.id, count: 1 };
          nextCursor.count -= 1;
          if (nextCursor.count <= 0) nextCursor = null;
        } else if (nextSlot.id === nextCursor.id && nextSlot.count < maxS) {
          nextSlot.count += 1;
          nextCursor.count -= 1;
          if (nextCursor.count <= 0) nextCursor = null;
        }
      }
    }

    setCursor(nextCursor);
    if (target === 'hotbar') {
      nextHotbar[idx] = nextSlot;
      onUpdateInventory(nextHotbar, nextBackpack);
    } else if (target === 'backpack') {
      nextBackpack[idx] = nextSlot;
      onUpdateInventory(nextHotbar, nextBackpack);
    } else if (target === 'craft') {
      nextCraft[idx] = nextSlot;
      setCraftGrid(nextCraft);
    } else if (target === 'furnace_in') {
      setFurnaceInput(nextSlot);
    } else if (target === 'furnace_fuel') {
      setFurnaceFuel(nextSlot);
    }
  };

  const handleTakeCraftResult = () => {
    if (!activeRecipe) return;
    const res = activeRecipe.result;
    if (cursor && (cursor.id !== res.id || cursor.count + res.count > getBlock(res.id).maxStack)) {
      return;
    }
    const nextCraft = craftGrid.map((s) => (s ? { ...s } : null));
    for (let i = 0; i < gridSize * gridSize; i++) {
      if (nextCraft[i]) {
        nextCraft[i]!.count -= 1;
        if (nextCraft[i]!.count <= 0) nextCraft[i] = null;
      }
    }
    setCraftGrid(nextCraft);
    setCursor(cursor ? { id: res.id, count: cursor.count + res.count } : { ...res });
  };

  const handleSmeltOne = (recipe: SmeltingRecipe) => {
    const hasFuel =
      mode === 'creative' ||
      (furnaceFuel && (furnaceFuel.id === BLOCK_ID.COAL || PLANK_IDS.has(furnaceFuel.id) || furnaceFuel.id === BLOCK_ID.STICK)) ||
      countInInventory(BLOCK_ID.COAL) > 0;

    const inFurnace = furnaceInput?.id === recipe.inputId && furnaceInput.count > 0;
    const inInv = countInInventory(recipe.inputId) > 0;
    if (!hasFuel || (!inFurnace && !inInv && mode !== 'creative')) return;

    const nextHotbar = hotbar.map((s) => (s ? { ...s } : null));
    const nextBackpack = backpack.map((s) => (s ? { ...s } : null));

    if (mode === 'survival') {
      if (inFurnace && furnaceInput) {
        const rem = furnaceInput.count - 1;
        setFurnaceInput(rem > 0 ? { id: furnaceInput.id, count: rem } : null);
      } else {
        consumeFromInventory(nextHotbar, nextBackpack, recipe.inputId, 1);
      }

      if (furnaceFuel && furnaceFuel.count > 0) {
        const rem = furnaceFuel.count - 1;
        setFurnaceFuel(rem > 0 ? { id: furnaceFuel.id, count: rem } : null);
      } else {
        consumeFromInventory(nextHotbar, nextBackpack, BLOCK_ID.COAL, 1);
      }
    }

    giveResultToInventory(nextHotbar, nextBackpack, recipe.result);
    onUpdateInventory(nextHotbar, nextBackpack);
  };

  const handleCatalogClick = (id: number) => {
    const def = getBlock(id);
    const nextHotbar = hotbar.map((s) => (s ? { ...s } : null));
    const nextBackpack = backpack.map((s) => (s ? { ...s } : null));
    const stack: ItemStack = { id, count: def.maxStack };

    if (!nextHotbar[selectedHotbar]) {
      nextHotbar[selectedHotbar] = stack;
    } else {
      const existingHotbar = nextHotbar.findIndex((s) => s?.id === id);
      if (existingHotbar >= 0) {
        nextHotbar[existingHotbar] = stack;
      } else {
        const emptyHotbar = nextHotbar.findIndex((s) => !s);
        if (emptyHotbar >= 0) nextHotbar[emptyHotbar] = stack;
        else {
          const emptyBack = nextBackpack.findIndex((s) => !s);
          if (emptyBack >= 0) nextBackpack[emptyBack] = stack;
          else nextHotbar[selectedHotbar] = stack;
        }
      }
    }
    onUpdateInventory(nextHotbar, nextBackpack);
  };

  const renderSlot = (
    stack: ItemStack | null,
    onLeft: () => void,
    onRight: () => void,
    highlight = false,
    key?: string | number
  ) => (
    <button
      key={key}
      type="button"
      title={stack ? getBlock(stack.id).name : undefined}
      onClick={() => (touchSplitMode ? onRight() : onLeft())}
      onContextMenu={(e) => {
        e.preventDefault();
        onRight();
      }}
      className={`w-8 h-8 sm:w-11 sm:h-11 flex items-center justify-center cursor-pointer transition-colors ${
        highlight ? 'voxel-slot-active' : 'voxel-slot hover:border-slate-500'
      }`}
    >
      {stack && <ItemIcon id={stack.id} count={stack.count} size={26} />}
    </button>
  );

  return (
    <div className="fixed inset-0 z-30 bg-slate-950/75 flex items-center justify-center p-2 sm:p-4">
      <div className="voxel-panel w-full max-w-4xl max-h-[92dvh] flex flex-col text-slate-100 overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-5 py-3 border-b border-slate-800">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 min-w-0">
            <h2 className="font-display text-lg sm:text-xl font-bold text-white">
              {craftingMode === 'crafting_table'
                ? 'Crafting Table (3×3)'
                : craftingMode === 'furnace'
                  ? 'Furnace & Smelting'
                  : 'Inventory & Crafting'}
            </h2>
            {mode === 'creative' && (
              <div className="flex items-center gap-1 bg-slate-900 p-1 border border-slate-700">
                <button
                  type="button"
                  onClick={() => setTab('catalog')}
                  className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap ${
                    tab === 'catalog' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Blocks ({ALL_CATALOG_ITEMS.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTab('crafting')}
                  className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap ${
                    tab === 'crafting' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Hammer className="w-3.5 h-3.5" />
                  <span>Crafting &amp; Bag</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3 ml-auto">
            {cursor && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-900 border border-amber-500/60 text-xs">
                <span className="text-slate-400 hidden sm:inline">Held:</span>
                <ItemIcon id={cursor.id} count={cursor.count} size={20} />
                <span className="text-amber-300 font-medium max-w-[90px] truncate">{getBlock(cursor.id).name}</span>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 cursor-pointer"
              title="Close (E / Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4 sm:space-y-5">
          {tab === 'catalog' && mode === 'creative' ? (
            <div className="space-y-4">
              {/* Search & Category Filters */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search blocks, ores, tools, plants..."
                    className="w-full bg-slate-900 border-2 border-slate-700 focus:border-amber-500 outline-none pl-9 pr-3 py-2 text-sm text-white"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {CATEGORY_LABELS.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategory(cat.id)}
                    className={`px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                      category === cat.id
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Block Grid */}
              <div className="grid grid-cols-4 sm:grid-cols-8 md:grid-cols-11 gap-1.5 max-h-64 sm:max-h-72 overflow-y-auto p-2 bg-slate-950/70 border border-slate-800">
                {filteredCatalog.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleCatalogClick(item.id)}
                    title={`${item.name} — Click to add to hotbar`}
                    className="voxel-slot hover:border-amber-400 min-h-[60px] p-1.5 flex flex-col items-center justify-center gap-1 cursor-pointer group"
                  >
                    <ItemIcon id={item.id} size={28} />
                    <span className="text-[10px] text-slate-400 group-hover:text-white truncate w-full text-center">
                      {item.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left: Crafting / Furnace Station */}
              <div className="lg:col-span-5 bg-slate-950/60 border border-slate-800 p-4 space-y-4">
                {craftingMode === 'furnace' ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
                      <Flame className="w-4 h-4" />
                      <span>Furnace Smelting</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="space-y-2">
                        <div className="text-[11px] text-slate-400">Ore / Sand</div>
                        {renderSlot(
                          furnaceInput,
                          () => handleSlotClick('furnace_in', 0, false),
                          () => handleSlotClick('furnace_in', 0, true)
                        )}
                        <div className="text-[11px] text-slate-400">Fuel (Coal)</div>
                        {renderSlot(
                          furnaceFuel,
                          () => handleSlotClick('furnace_fuel', 0, false),
                          () => handleSlotClick('furnace_fuel', 0, true)
                        )}
                      </div>
                      <ArrowRight className="w-5 h-5 text-slate-400" />
                      <div>
                        {activeSmelt ? (
                          <button
                            type="button"
                            onClick={() => handleSmeltOne(activeSmelt)}
                            className="voxel-slot-active w-12 h-12 flex items-center justify-center cursor-pointer"
                            title={`Click to ${activeSmelt.label}`}
                          >
                            <ItemIcon id={activeSmelt.result.id} count={activeSmelt.result.count} size={34} />
                          </button>
                        ) : (
                          <div className="voxel-slot w-12 h-12 opacity-60" />
                        )}
                      </div>
                    </div>
                    <div className="space-y-1.5 pt-2 border-t border-slate-800">
                      <div className="text-xs font-semibold text-slate-300">Quick Smelt (uses inventory)</div>
                      <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto">
                        {SMELTING_RECIPES.map((sr) => (
                          <button
                            key={sr.inputId}
                            type="button"
                            onClick={() => handleSmeltOne(sr)}
                            className="flex items-center gap-2 p-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-left text-[11px] cursor-pointer"
                          >
                            <ItemIcon id={sr.result.id} size={22} />
                            <span className="truncate">{getBlock(sr.result.id).name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="text-xs font-semibold text-slate-300">
                      {gridSize === 3 ? '3×3 Crafting Grid' : '2×2 Pocket Crafting'}
                    </div>
                    <div className="flex items-center gap-4">
                      <div
                        className="grid gap-1"
                        style={{ gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))` }}
                      >
                        {Array.from({ length: gridSize * gridSize }).map((_, i) =>
                          renderSlot(
                            craftGrid[i],
                            () => handleSlotClick('craft', i, false),
                            () => handleSlotClick('craft', i, true),
                            false,
                            `craft-${i}`
                          )
                        )}
                      </div>
                      <ArrowRight className="w-5 h-5 text-slate-400" />
                      <button
                        type="button"
                        onClick={handleTakeCraftResult}
                        title={activeRecipe ? `Craft ${activeRecipe.name}` : 'Empty'}
                        className={`w-12 h-12 flex items-center justify-center cursor-pointer ${
                          activeRecipe ? 'voxel-slot-active' : 'voxel-slot opacity-70'
                        }`}
                      >
                        {activeRecipe && (
                          <ItemIcon id={activeRecipe.result.id} count={activeRecipe.result.count} size={34} />
                        )}
                      </button>
                    </div>

                    {/* Recipe Book */}
                    <div className="pt-3 border-t border-slate-800 space-y-2">
                      <div className="text-xs font-semibold text-slate-300">
                        Recipe Book {gridSize === 2 ? '(2×2 Pocket · Use Crafting Table for 3×3)' : '(All Recipes)'}
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-1">
                        {CRAFTING_RECIPES.filter((r) => !r.requiresTable || gridSize === 3).map((recipe) => {
                          const ok = canCraftRecipe(recipe);
                          return (
                            <button
                              key={recipe.id}
                              type="button"
                              disabled={!ok}
                              onClick={() => handleQuickCraft(recipe)}
                              className={`flex items-center gap-2 p-1.5 border text-left text-xs transition-colors ${
                                ok
                                  ? 'bg-slate-900 hover:bg-slate-800 border-slate-700 hover:border-amber-500 text-slate-100 cursor-pointer'
                                  : 'bg-slate-950/50 border-slate-800/70 text-slate-500 cursor-not-allowed'
                              }`}
                            >
                              <ItemIcon id={recipe.result.id} count={recipe.result.count} size={24} />
                              <span className="truncate">{recipe.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right: 27-Slot Backpack */}
              <div className="lg:col-span-7 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-300">Backpack (27 Slots)</span>
                  <button
                    type="button"
                    onClick={() => setTouchSplitMode((prev) => !prev)}
                    className={`px-2.5 py-1 text-[11px] font-semibold border cursor-pointer ${
                      touchSplitMode
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    Tap Mode: {touchSplitMode ? 'Split / 1×' : 'Move All'}
                  </button>
                </div>
                <div className="grid grid-cols-9 gap-0.5 sm:gap-1.5 w-fit">
                  {backpack.map((stack, i) =>
                    renderSlot(
                      stack,
                      () => handleSlotClick('backpack', i, false),
                      () => handleSlotClick('backpack', i, true),
                      false,
                      `bp-${i}`
                    )
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Shared Bottom Hotbar */}
          <div className="pt-3 border-t border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <span className="text-xs font-semibold text-slate-300">Hotbar (Slots 1–9)</span>
              <div className="flex items-center gap-2">
                {tab === 'catalog' && mode === 'creative' && (
                  <button
                    type="button"
                    onClick={() => setTouchSplitMode((prev) => !prev)}
                    className={`px-2 py-0.5 text-[11px] font-semibold border cursor-pointer ${
                      touchSplitMode
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'bg-slate-900 border-slate-700 text-slate-300'
                    }`}
                  >
                    Tap: {touchSplitMode ? 'Split / 1×' : 'Move All'}
                  </button>
                )}
                <span className="text-[11px] text-slate-400 hidden sm:inline">
                  Left-click move/stack · Right-click split half
                </span>
              </div>
            </div>
            <div className="grid grid-cols-9 gap-0.5 sm:gap-1.5 w-fit">
              {hotbar.map((stack, i) =>
                renderSlot(
                  stack,
                  () => handleSlotClick('hotbar', i, false),
                  () => handleSlotClick('hotbar', i, true),
                  i === selectedHotbar,
                  `hb-${i}`
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
