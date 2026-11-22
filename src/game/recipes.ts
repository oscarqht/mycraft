import { BLOCK_ID } from './blocks';
import { ItemStack } from './types';

export interface CraftingRecipe {
  id: string;
  name: string;
  requiresTable: boolean; // false = fits in 2x2 pocket grid; true = requires 3x3 crafting table
  width: number;
  height: number;
  pattern: number[]; // row-major length = width * height, 0 = empty
  result: ItemStack;
  shapeless?: boolean;
}

export interface SmeltingRecipe {
  inputId: number;
  result: ItemStack;
  label: string;
}

export const CRAFTING_RECIPES: CraftingRecipe[] = [
  // Planks from Logs (shapeless 1x1)
  ...[
    [BLOCK_ID.OAK_LOG, BLOCK_ID.OAK_PLANKS, 'Oak Planks'],
    [BLOCK_ID.BIRCH_LOG, BLOCK_ID.BIRCH_PLANKS, 'Birch Planks'],
    [BLOCK_ID.SPRUCE_LOG, BLOCK_ID.SPRUCE_PLANKS, 'Spruce Planks'],
    [BLOCK_ID.JUNGLE_LOG, BLOCK_ID.JUNGLE_PLANKS, 'Jungle Planks'],
    [BLOCK_ID.ACACIA_LOG, BLOCK_ID.ACACIA_PLANKS, 'Acacia Planks'],
    [BLOCK_ID.DARK_OAK_LOG, BLOCK_ID.DARK_OAK_PLANKS, 'Dark Oak Planks'],
  ].map(([log, planks, name]) => ({
    id: `planks_${log}`,
    name: name as string,
    requiresTable: false,
    width: 1,
    height: 1,
    pattern: [log as number],
    result: { id: planks as number, count: 4 },
    shapeless: true,
  })),

  // Sticks
  {
    id: 'sticks',
    name: 'Sticks',
    requiresTable: false,
    width: 1,
    height: 2,
    pattern: [BLOCK_ID.OAK_PLANKS, BLOCK_ID.OAK_PLANKS],
    result: { id: BLOCK_ID.STICK, count: 4 },
  },
  // Crafting Table
  {
    id: 'crafting_table',
    name: 'Crafting Table',
    requiresTable: false,
    width: 2,
    height: 2,
    pattern: [BLOCK_ID.OAK_PLANKS, BLOCK_ID.OAK_PLANKS, BLOCK_ID.OAK_PLANKS, BLOCK_ID.OAK_PLANKS],
    result: { id: BLOCK_ID.CRAFTING_TABLE, count: 1 },
  },
  // Torches
  {
    id: 'torches',
    name: 'Torches',
    requiresTable: false,
    width: 1,
    height: 2,
    pattern: [BLOCK_ID.COAL, BLOCK_ID.STICK],
    result: { id: BLOCK_ID.TORCH, count: 4 },
  },
  // Furnace
  {
    id: 'furnace',
    name: 'Furnace',
    requiresTable: true,
    width: 3,
    height: 3,
    pattern: [
      BLOCK_ID.COBBLESTONE, BLOCK_ID.COBBLESTONE, BLOCK_ID.COBBLESTONE,
      BLOCK_ID.COBBLESTONE, 0, BLOCK_ID.COBBLESTONE,
      BLOCK_ID.COBBLESTONE, BLOCK_ID.COBBLESTONE, BLOCK_ID.COBBLESTONE,
    ],
    result: { id: BLOCK_ID.FURNACE, count: 1 },
  },
  // Chest
  {
    id: 'chest',
    name: 'Chest',
    requiresTable: true,
    width: 3,
    height: 3,
    pattern: [
      BLOCK_ID.OAK_PLANKS, BLOCK_ID.OAK_PLANKS, BLOCK_ID.OAK_PLANKS,
      BLOCK_ID.OAK_PLANKS, 0, BLOCK_ID.OAK_PLANKS,
      BLOCK_ID.OAK_PLANKS, BLOCK_ID.OAK_PLANKS, BLOCK_ID.OAK_PLANKS,
    ],
    result: { id: BLOCK_ID.CHEST, count: 1 },
  },

  // Tools: Pickaxes, Axes, Shovels across Wood, Stone, Iron, Diamond
  ...[
    ['wooden', BLOCK_ID.OAK_PLANKS, BLOCK_ID.WOODEN_PICKAXE, BLOCK_ID.WOODEN_AXE, BLOCK_ID.WOODEN_SHOVEL],
    ['stone', BLOCK_ID.COBBLESTONE, BLOCK_ID.STONE_PICKAXE, BLOCK_ID.STONE_AXE, BLOCK_ID.STONE_SHOVEL],
    ['iron', BLOCK_ID.IRON_INGOT, BLOCK_ID.IRON_PICKAXE, BLOCK_ID.IRON_AXE, BLOCK_ID.IRON_SHOVEL],
    ['diamond', BLOCK_ID.DIAMOND, BLOCK_ID.DIAMOND_PICKAXE, BLOCK_ID.DIAMOND_AXE, BLOCK_ID.DIAMOND_SHOVEL],
  ].flatMap(([tier, mat, pick, axe, shovel]) => [
    {
      id: `${tier}_pickaxe`,
      name: `${String(tier).charAt(0).toUpperCase() + String(tier).slice(1)} Pickaxe`,
      requiresTable: true,
      width: 3,
      height: 3,
      pattern: [
        mat as number, mat as number, mat as number,
        0, BLOCK_ID.STICK, 0,
        0, BLOCK_ID.STICK, 0,
      ],
      result: { id: pick as number, count: 1 },
    },
    {
      id: `${tier}_axe`,
      name: `${String(tier).charAt(0).toUpperCase() + String(tier).slice(1)} Axe`,
      requiresTable: true,
      width: 2,
      height: 3,
      pattern: [
        mat as number, mat as number,
        mat as number, BLOCK_ID.STICK,
        0, BLOCK_ID.STICK,
      ],
      result: { id: axe as number, count: 1 },
    },
    {
      id: `${tier}_shovel`,
      name: `${String(tier).charAt(0).toUpperCase() + String(tier).slice(1)} Shovel`,
      requiresTable: true,
      width: 1,
      height: 3,
      pattern: [mat as number, BLOCK_ID.STICK, BLOCK_ID.STICK],
      result: { id: shovel as number, count: 1 },
    },
  ]),

  // Building & Utility Blocks
  {
    id: 'stone_bricks',
    name: 'Stone Bricks',
    requiresTable: false,
    width: 2,
    height: 2,
    pattern: [BLOCK_ID.STONE, BLOCK_ID.STONE, BLOCK_ID.STONE, BLOCK_ID.STONE],
    result: { id: BLOCK_ID.STONE_BRICKS, count: 4 },
  },
  {
    id: 'sandstone',
    name: 'Sandstone',
    requiresTable: false,
    width: 2,
    height: 2,
    pattern: [BLOCK_ID.SAND, BLOCK_ID.SAND, BLOCK_ID.SAND, BLOCK_ID.SAND],
    result: { id: BLOCK_ID.SANDSTONE, count: 1 },
  },
  {
    id: 'bricks',
    name: 'Bricks',
    requiresTable: false,
    width: 2,
    height: 2,
    pattern: [BLOCK_ID.CLAY, BLOCK_ID.CLAY, BLOCK_ID.CLAY, BLOCK_ID.CLAY],
    result: { id: BLOCK_ID.BRICKS, count: 4 },
  },
  {
    id: 'bookshelf',
    name: 'Bookshelf',
    requiresTable: true,
    width: 3,
    height: 3,
    pattern: [
      BLOCK_ID.OAK_PLANKS, BLOCK_ID.OAK_PLANKS, BLOCK_ID.OAK_PLANKS,
      BLOCK_ID.SUGAR_CANE, BLOCK_ID.SUGAR_CANE, BLOCK_ID.SUGAR_CANE,
      BLOCK_ID.OAK_PLANKS, BLOCK_ID.OAK_PLANKS, BLOCK_ID.OAK_PLANKS,
    ],
    result: { id: BLOCK_ID.BOOKSHELF, count: 1 },
  },
  {
    id: 'tnt',
    name: 'TNT',
    requiresTable: true,
    width: 3,
    height: 3,
    pattern: [
      BLOCK_ID.SAND, BLOCK_ID.COAL, BLOCK_ID.SAND,
      BLOCK_ID.COAL, BLOCK_ID.SAND, BLOCK_ID.COAL,
      BLOCK_ID.SAND, BLOCK_ID.COAL, BLOCK_ID.SAND,
    ],
    result: { id: BLOCK_ID.TNT, count: 1 },
  },
  {
    id: 'jack_o_lantern',
    name: "Jack o'Lantern",
    requiresTable: false,
    width: 1,
    height: 2,
    pattern: [BLOCK_ID.PUMPKIN, BLOCK_ID.TORCH],
    result: { id: BLOCK_ID.JACK_O_LANTERN, count: 1 },
  },
  {
    id: 'redstone_lamp',
    name: 'Redstone Lamp',
    requiresTable: true,
    width: 3,
    height: 3,
    pattern: [
      0, BLOCK_ID.REDSTONE, 0,
      BLOCK_ID.REDSTONE, BLOCK_ID.GLOWSTONE, BLOCK_ID.REDSTONE,
      0, BLOCK_ID.REDSTONE, 0,
    ],
    result: { id: BLOCK_ID.REDSTONE_LAMP, count: 1 },
  },

  // Mineral Blocks (3x3) + Unpack (1x1)
  ...[
    [BLOCK_ID.COAL, BLOCK_ID.COAL_BLOCK, 'Block of Coal'],
    [BLOCK_ID.IRON_INGOT, BLOCK_ID.IRON_BLOCK, 'Block of Iron'],
    [BLOCK_ID.GOLD_INGOT, BLOCK_ID.GOLD_BLOCK, 'Block of Gold'],
    [BLOCK_ID.COPPER_INGOT, BLOCK_ID.COPPER_BLOCK, 'Block of Copper'],
    [BLOCK_ID.DIAMOND, BLOCK_ID.DIAMOND_BLOCK, 'Block of Diamond'],
    [BLOCK_ID.EMERALD, BLOCK_ID.EMERALD_BLOCK, 'Block of Emerald'],
    [BLOCK_ID.LAPIS_LAZULI, BLOCK_ID.LAPIS_BLOCK, 'Lapis Lazuli Block'],
    [BLOCK_ID.REDSTONE, BLOCK_ID.REDSTONE_BLOCK, 'Block of Redstone'],
  ].flatMap(([item, block, name]) => [
    {
      id: `pack_${block}`,
      name: name as string,
      requiresTable: true,
      width: 3,
      height: 3,
      pattern: new Array(9).fill(item as number),
      result: { id: block as number, count: 1 },
    },
    {
      id: `unpack_${item}`,
      name: `Unpack ${name as string}`,
      requiresTable: false,
      width: 1,
      height: 1,
      pattern: [block as number],
      result: { id: item as number, count: 9 },
      shapeless: true,
    },
  ]),
];

export const SMELTING_RECIPES: SmeltingRecipe[] = [
  { inputId: BLOCK_ID.RAW_IRON, result: { id: BLOCK_ID.IRON_INGOT, count: 1 }, label: 'Smelt Raw Iron → Iron Ingot' },
  { inputId: BLOCK_ID.RAW_GOLD, result: { id: BLOCK_ID.GOLD_INGOT, count: 1 }, label: 'Smelt Raw Gold → Gold Ingot' },
  { inputId: BLOCK_ID.RAW_COPPER, result: { id: BLOCK_ID.COPPER_INGOT, count: 1 }, label: 'Smelt Raw Copper → Copper Ingot' },
  { inputId: BLOCK_ID.SAND, result: { id: BLOCK_ID.GLASS, count: 1 }, label: 'Smelt Sand → Glass' },
  { inputId: BLOCK_ID.COBBLESTONE, result: { id: BLOCK_ID.STONE, count: 1 }, label: 'Smelt Cobblestone → Stone' },
  { inputId: BLOCK_ID.STONE, result: { id: BLOCK_ID.SMOOTH_STONE, count: 1 }, label: 'Smelt Stone → Smooth Stone' },
  { inputId: BLOCK_ID.COBBLED_DEEPSLATE, result: { id: BLOCK_ID.DEEPSLATE, count: 1 }, label: 'Smelt Cobbled Deepslate → Deepslate' },
  { inputId: BLOCK_ID.CLAY, result: { id: BLOCK_ID.TERRACOTTA, count: 1 }, label: 'Smelt Clay → Terracotta' },
];

// Any plank type counts as planks in stick/table/tool/chest/bookshelf recipes
const PLANK_SET = new Set<number>([
  BLOCK_ID.OAK_PLANKS,
  BLOCK_ID.BIRCH_PLANKS,
  BLOCK_ID.SPRUCE_PLANKS,
  BLOCK_ID.JUNGLE_PLANKS,
  BLOCK_ID.ACACIA_PLANKS,
  BLOCK_ID.DARK_OAK_PLANKS,
]);

function ingredientMatches(gridId: number, recipeId: number): boolean {
  if (gridId === recipeId) return true;
  if (recipeId === BLOCK_ID.OAK_PLANKS && PLANK_SET.has(gridId)) return true;
  return false;
}

export function matchCraftingGrid(grid: (ItemStack | null)[], gridSize: 2 | 3): CraftingRecipe | null {
  // Trim bounding box of non-empty slots
  let minR: number = gridSize;
  let maxR = -1;
  let minC: number = gridSize;
  let maxC = -1;
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const slot = grid[r * gridSize + c];
      if (slot && slot.count > 0) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  if (maxR < 0) return null;

  const w = maxC - minC + 1;
  const h = maxR - minR + 1;

  for (const recipe of CRAFTING_RECIPES) {
    if (recipe.width !== w || recipe.height !== h) continue;
    let matches = true;
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const gSlot = grid[(minR + r) * gridSize + (minC + c)];
        const gId = gSlot && gSlot.count > 0 ? gSlot.id : 0;
        const rId = recipe.pattern[r * w + c];
        if (!ingredientMatches(gId, rId)) {
          matches = false;
          break;
        }
      }
      if (!matches) break;
    }
    if (matches) return recipe;
  }
  return null;
}
