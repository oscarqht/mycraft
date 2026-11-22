export type GameMode = 'creative' | 'survival';

export type BiomeId =
  | 'badlands'
  | 'bamboo_jungle'
  | 'beach'
  | 'birch_forest'
  | 'cold_ocean'
  | 'dark_forest'
  | 'deep_cold_ocean'
  | 'deep_dark'
  | 'deep_frozen_ocean'
  | 'deep_lukewarm_ocean'
  | 'deep_ocean'
  | 'desert'
  | 'dripstone_caves'
  | 'eroded_badlands'
  | 'flower_forest'
  | 'forest'
  | 'frozen_ocean'
  | 'frozen_peaks'
  | 'frozen_river'
  | 'grove'
  | 'ice_spikes'
  | 'jagged_peaks'
  | 'jungle'
  | 'lukewarm_ocean'
  | 'lush_caves'
  | 'mangrove_swamp'
  | 'meadow'
  | 'mushroom_fields'
  | 'ocean'
  | 'old_growth_birch_forest'
  | 'old_growth_pine_taiga'
  | 'old_growth_spruce_taiga'
  | 'plains'
  | 'river'
  | 'savanna'
  | 'savanna_plateau'
  | 'snowy_beach'
  | 'snowy_plains'
  | 'snowy_slopes'
  | 'snowy_taiga'
  | 'sparse_jungle'
  | 'stony_peaks'
  | 'stony_shore'
  | 'sunflower_plains'
  | 'swamp'
  | 'taiga'
  | 'warm_ocean'
  | 'windswept_forest'
  | 'windswept_gravelly_hills'
  | 'windswept_hills'
  | 'windswept_savanna'
  | 'wooded_badlands';

export type BlockCategory =
  | 'natural'
  | 'stone'
  | 'ores'
  | 'wood'
  | 'foliage'
  | 'building'
  | 'glass_light'
  | 'utility'
  | 'dimensions'
  | 'tools_items';

export type BlockRenderType =
  | 'air'
  | 'opaque'
  | 'cutout'
  | 'cross'
  | 'fluid'
  | 'torch'
  | 'slab_low'
  | 'item';

export type ToolType = 'none' | 'pickaxe' | 'axe' | 'shovel';

export interface BlockFaces {
  top: string;
  side: string;
  bottom: string;
  front?: string;
}

export interface BlockDef {
  id: number;
  key: string;
  name: string;
  category: BlockCategory;
  renderType: BlockRenderType;
  solid: boolean;
  selectable: boolean;
  transparent: boolean;
  isFluid?: boolean;
  hardness: number; // Seconds to break by hand; -1 = unbreakable
  preferredTool: ToolType;
  minTier: number; // 0=hand, 1=wood, 2=stone, 3=iron, 4=diamond
  toolType?: ToolType;
  toolTier?: number; // 1=wood, 2=stone, 3=iron, 4=diamond
  toolSpeed?: number;
  foodPoints?: number;
  maxStack: number;
  dropId: number;
  dropCount: number;
  lightLevel: number;
  tintType: 'none' | 'grass' | 'foliage' | 'water';
  soundGroup: 'stone' | 'dirt' | 'grass' | 'wood' | 'sand' | 'glass' | 'snow' | 'water';
  faces: BlockFaces;
  itemTexture?: string;
  particleColor: string;
}

export interface ItemStack {
  id: number;
  count: number;
}

export type CraftingModalMode = 'inventory' | 'crafting_table' | 'furnace';

export interface TargetBlockInfo {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  blockId: number;
  blockName: string;
}

export interface HudSnapshot {
  mode: GameMode;
  health: number; // 0..20
  maxHealth: number;
  hunger: number; // 0..20
  maxHunger: number;
  oxygen: number; // 0..20
  isUnderwater: boolean;
  isFlying: boolean;
  isSprinting: boolean;
  isSneaking: boolean;
  pos: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  biome: BiomeId;
  biomeName: string;
  seedInt64?: string;
  timeOfDay: number; // 0..1 (0.25=noon, 0.5=sunset, 0.75=midnight, 0.0=sunrise)
  fps: number;
  loadedChunks: number;
  pendingChunks: number;
  target: TargetBlockInfo | null;
  breakProgress: number; // 0..1
  pointerLocked: boolean;
  touchMode: boolean;
  selectedHotbar: number;
  hotbar: (ItemStack | null)[];
  backpack: (ItemStack | null)[];
  dead: boolean;
  statusMessage: string | null;
}

export interface WorldConfig {
  seed: string;
  mode: GameMode;
  renderDistance: number;
}
