import {
  Climate,
  DensityFunction,
  Identifier,
  MultiNoiseBiomeSource,
  NoiseGeneratorSettings,
  NoiseParameters,
  NormalNoise,
  RandomState,
  WorldgenRegistries,
  XoroshiroRandom,
} from 'deepslate';
import { BLOCK_ID, isBlockTransparent } from './blocks';
import mcDataRaw from './mcWorldgenData.json';
import { hashCoords2D, hashCoords3D } from './noise';
import { BiomeId } from './types';

export const CHUNK_SIZE = 16;
export const MIN_Y = -64;
export const CHUNK_HEIGHT = 384;
export const MAX_Y = MIN_Y + CHUNK_HEIGHT; // 320
export const SEA_LEVEL = 62; // Blocks with y <= 62 are water (Minecraft sea_level: 63 => y < 63)

export const BIOME_DISPLAY_NAMES: Record<BiomeId, string> = {
  badlands: 'Badlands',
  bamboo_jungle: 'Bamboo Jungle',
  beach: 'Beach',
  birch_forest: 'Birch Forest',
  cold_ocean: 'Cold Ocean',
  dark_forest: 'Dark Forest',
  deep_cold_ocean: 'Deep Cold Ocean',
  deep_dark: 'Deep Dark',
  deep_frozen_ocean: 'Deep Frozen Ocean',
  deep_lukewarm_ocean: 'Deep Lukewarm Ocean',
  deep_ocean: 'Deep Ocean',
  desert: 'Desert',
  dripstone_caves: 'Dripstone Caves',
  eroded_badlands: 'Eroded Badlands',
  flower_forest: 'Flower Forest',
  forest: 'Forest',
  frozen_ocean: 'Frozen Ocean',
  frozen_peaks: 'Frozen Peaks',
  frozen_river: 'Frozen River',
  grove: 'Grove',
  ice_spikes: 'Ice Spikes',
  jagged_peaks: 'Jagged Peaks',
  jungle: 'Jungle',
  lukewarm_ocean: 'Lukewarm Ocean',
  lush_caves: 'Lush Caves',
  mangrove_swamp: 'Mangrove Swamp',
  meadow: 'Meadow',
  mushroom_fields: 'Mushroom Fields',
  ocean: 'Ocean',
  old_growth_birch_forest: 'Old Growth Birch Forest',
  old_growth_pine_taiga: 'Old Growth Pine Taiga',
  old_growth_spruce_taiga: 'Old Growth Spruce Taiga',
  plains: 'Plains',
  river: 'River',
  savanna: 'Savanna',
  savanna_plateau: 'Savanna Plateau',
  snowy_beach: 'Snowy Beach',
  snowy_plains: 'Snowy Plains',
  snowy_slopes: 'Snowy Slopes',
  snowy_taiga: 'Snowy Taiga',
  sparse_jungle: 'Sparse Jungle',
  stony_peaks: 'Stony Peaks',
  stony_shore: 'Stony Shore',
  sunflower_plains: 'Sunflower Plains',
  swamp: 'Swamp',
  taiga: 'Taiga',
  warm_ocean: 'Warm Ocean',
  windswept_forest: 'Windswept Forest',
  windswept_gravelly_hills: 'Windswept Gravelly Hills',
  windswept_hills: 'Windswept Hills',
  windswept_savanna: 'Windswept Savanna',
  wooded_badlands: 'Wooded Badlands',
};

interface McWorldgenBundle {
  noises: Record<string, { firstOctave: number; amplitudes: number[] }>;
  densityFunctions: [string, unknown][];
  noiseSettings: Record<string, unknown>;
  biomeSource: {
    biomeNames: string[];
    entries: number[];
  };
  biomeMeta: Record<
    string,
    {
      temperature: number;
      downfall: number;
      waterColor: string | null;
      grassColor: string | null;
      foliageColor: string | null;
      grassModifier: string | null;
    }
  >;
}

const mcData = mcDataRaw as unknown as McWorldgenBundle;

export interface BiomeTints {
  grassTint: [number, number, number];
  foliageTint: [number, number, number];
  waterTint: [number, number, number];
}

function hexToRgbNorm(hex: string | null | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return fallback;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Minecraft vanilla grass/foliage colormap triangle approximation from temperature & downfall
function sampleGrassColormap(temp: number, downfall: number): [number, number, number] {
  const t = clamp01(temp);
  const d = clamp01(downfall) * t;
  // Triangle vertices in MC grass.png: (t=1,d=1)->lush green, (t=1,d=0)->dry yellow, (t=0,d=0)->cold teal
  const lush: [number, number, number] = [0.29, 0.72, 0.21];
  const dry: [number, number, number] = [0.75, 0.71, 0.34];
  const cold: [number, number, number] = [0.50, 0.70, 0.59];
  const wLush = d;
  const wDry = t - d;
  const wCold = 1 - t;
  return [
    wCold * cold[0] + wDry * dry[0] + wLush * lush[0],
    wCold * cold[1] + wDry * dry[1] + wLush * lush[1],
    wCold * cold[2] + wDry * dry[2] + wLush * lush[2],
  ];
}

function sampleFoliageColormap(temp: number, downfall: number): [number, number, number] {
  const t = clamp01(temp);
  const d = clamp01(downfall) * t;
  const lush: [number, number, number] = [0.18, 0.64, 0.14];
  const dry: [number, number, number] = [0.68, 0.62, 0.24];
  const cold: [number, number, number] = [0.38, 0.62, 0.48];
  const wLush = d;
  const wDry = t - d;
  const wCold = 1 - t;
  return [
    wCold * cold[0] + wDry * dry[0] + wLush * lush[0],
    wCold * cold[1] + wDry * dry[1] + wLush * lush[1],
    wCold * cold[2] + wDry * dry[2] + wLush * lush[2],
  ];
}

const BIOME_TINTS_CACHE: Partial<Record<BiomeId, BiomeTints>> = {};

export function getBiomeTints(biome: BiomeId): BiomeTints {
  const cached = BIOME_TINTS_CACHE[biome];
  if (cached) return cached;

  const meta = mcData.biomeMeta[biome];
  const temp = meta?.temperature ?? 0.7;
  const downfall = meta?.downfall ?? 0.4;

  let grassTint = meta?.grassColor
    ? hexToRgbNorm(meta.grassColor, [0.48, 0.78, 0.34])
    : sampleGrassColormap(temp, downfall);
  let foliageTint = meta?.foliageColor
    ? hexToRgbNorm(meta.foliageColor, [0.42, 0.72, 0.28])
    : sampleFoliageColormap(temp, downfall);
  const waterTint = hexToRgbNorm(meta?.waterColor, [0.24, 0.46, 0.89]);

  if (meta?.grassModifier === 'dark_forest') {
    grassTint = [(grassTint[0] + 0.16) * 0.5, (grassTint[1] + 0.2) * 0.5, (grassTint[2] + 0.11) * 0.5];
  } else if (meta?.grassModifier === 'swamp') {
    grassTint = [0.41, 0.44, 0.24];
    foliageTint = [0.38, 0.42, 0.21];
  }

  const res: BiomeTints = { grassTint, foliageTint, waterTint };
  BIOME_TINTS_CACHE[biome] = res;
  return res;
}

let initialized = false;
let cachedNoiseSettings: NoiseGeneratorSettings | null = null;
let cachedBiomeSource: MultiNoiseBiomeSource | null = null;

function ensureInitialized(): {
  noiseSettings: NoiseGeneratorSettings;
  biomeSource: MultiNoiseBiomeSource;
} {
  if (initialized && cachedNoiseSettings && cachedBiomeSource) {
    return { noiseSettings: cachedNoiseSettings, biomeSource: cachedBiomeSource };
  }

  // 1. Register noises (WorldgenRegistries.NOISE)
  for (const [name, params] of Object.entries(mcData.noises)) {
    const id = Identifier.create(name);
    if (!WorldgenRegistries.NOISE.has(id)) {
      WorldgenRegistries.NOISE.register(id, NoiseParameters.fromJson(params));
    }
  }

  // 2. Register density functions in pre-sorted topological order
  for (const [name, json] of mcData.densityFunctions) {
    const id = Identifier.create(name);
    if (json !== undefined && !WorldgenRegistries.DENSITY_FUNCTION.has(id)) {
      WorldgenRegistries.DENSITY_FUNCTION.register(id, DensityFunction.fromJson(json));
    }
  }

  // 3. Build NoiseGeneratorSettings with preliminary_surface_level wired to initial_density_without_jaggedness
  const rawSettings = JSON.parse(JSON.stringify(mcData.noiseSettings)) as Record<string, unknown>;
  const routerObj = rawSettings.noise_router as Record<string, unknown>;
  if (!routerObj.preliminary_surface_level && routerObj.initial_density_without_jaggedness) {
    routerObj.preliminary_surface_level = {
      type: 'minecraft:find_top_surface',
      density: routerObj.initial_density_without_jaggedness,
      upper_bound: MAX_Y,
      lower_bound: MIN_Y,
      cell_height: 8,
    };
  }
  cachedNoiseSettings = NoiseGeneratorSettings.fromJson(rawSettings);

  // 4. Build MultiNoiseBiomeSource from compact packed 7,593-entry parameter table
  const { biomeNames, entries } = mcData.biomeSource;
  const biomeIds = biomeNames.map((n) => Identifier.create(n));
  const paramEntries: [Climate.ParamPoint, () => Identifier][] = [];
  for (let i = 0; i < entries.length; i += 14) {
    const bIdx = entries[i];
    const bid = biomeIds[bIdx];
    const point = Climate.parameters(
      Climate.param(entries[i + 1], entries[i + 2]),
      Climate.param(entries[i + 3], entries[i + 4]),
      Climate.param(entries[i + 5], entries[i + 6]),
      Climate.param(entries[i + 7], entries[i + 8]),
      Climate.param(entries[i + 9], entries[i + 10]),
      Climate.param(entries[i + 11], entries[i + 12]),
      entries[i + 13]
    );
    paramEntries.push([point, () => bid]);
  }
  cachedBiomeSource = new MultiNoiseBiomeSource(paramEntries);
  initialized = true;

  return { noiseSettings: cachedNoiseSettings, biomeSource: cachedBiomeSource };
}

function lerp(t: number, a: number, b: number): number {
  return a + t * (b - a);
}

function lerp3(
  dx: number,
  dy: number,
  dz: number,
  v000: number,
  v100: number,
  v010: number,
  v110: number,
  v001: number,
  v101: number,
  v011: number,
  v111: number
): number {
  const x00 = lerp(dx, v000, v100);
  const x10 = lerp(dx, v010, v110);
  const x01 = lerp(dx, v001, v101);
  const x11 = lerp(dx, v011, v111);
  const y0 = lerp(dy, x00, x10);
  const y1 = lerp(dy, x01, x11);
  return lerp(dz, y0, y1);
}

function squeezeDensity(d: number): number {
  const c = d < -1 ? -1 : d > 1 ? 1 : d;
  return c * 0.5 - (c * c * c) / 24;
}

// Fast typed-array Interpolated replacement: eliminates string-key Map lookups inside deepslate's Interpolated
class FastInterpolated extends DensityFunction {
  public readonly wrapped: DensityFunction;
  public readonly cellWidth: number;
  public readonly cellHeight: number;
  private chunkMinX = 0;
  private chunkMinZ = 0;
  private active = false;
  // Grid is 5 (X) x 49 (Y) x 5 (Z) = 1225 corners for 4x8x4 cells over [-64, 320)
  private readonly gridValues = new Float64Array(5 * 49 * 5);
  private readonly gridValid = new Uint8Array(5 * 49 * 5);

  constructor(wrapped: DensityFunction, cellWidth = 4, cellHeight = 8) {
    super();
    this.wrapped = wrapped;
    this.cellWidth = cellWidth;
    this.cellHeight = cellHeight;
  }

  public beginChunk(minX: number, minZ: number) {
    this.chunkMinX = minX;
    this.chunkMinZ = minZ;
    this.gridValid.fill(0);
    this.active = true;
  }

  public endChunk() {
    this.active = false;
  }

  private getCornerGrid(gx: number, gy: number, gz: number): number {
    const slot = (gy * 5 + gz) * 5 + gx;
    if (this.gridValid[slot]) {
      return this.gridValues[slot];
    }
    const wx = this.chunkMinX + gx * this.cellWidth;
    const wy = MIN_Y + gy * this.cellHeight;
    const wz = this.chunkMinZ + gz * this.cellWidth;
    const val = this.wrapped.compute(DensityFunction.context(wx, wy, wz));
    this.gridValues[slot] = val;
    this.gridValid[slot] = 1;
    return val;
  }

  public getCellCorners(
    cx: number,
    cy: number,
    cz: number
  ): [number, number, number, number, number, number, number, number] {
    return [
      this.getCornerGrid(cx, cy, cz),
      this.getCornerGrid(cx + 1, cy, cz),
      this.getCornerGrid(cx, cy + 1, cz),
      this.getCornerGrid(cx + 1, cy + 1, cz),
      this.getCornerGrid(cx, cy, cz + 1),
      this.getCornerGrid(cx + 1, cy, cz + 1),
      this.getCornerGrid(cx, cy + 1, cz + 1),
      this.getCornerGrid(cx + 1, cy + 1, cz + 1),
    ];
  }

  compute(context: DensityFunction.Context): number {
    const w = this.cellWidth;
    const h = this.cellHeight;
    const blockX = context.x;
    const blockY = context.y;
    const blockZ = context.z;

    if (
      this.active &&
      blockX >= this.chunkMinX &&
      blockX < this.chunkMinX + 16 &&
      blockZ >= this.chunkMinZ &&
      blockZ < this.chunkMinZ + 16 &&
      blockY >= MIN_Y &&
      blockY < MAX_Y
    ) {
      const lx = blockX - this.chunkMinX;
      const ly = blockY - MIN_Y;
      const lz = blockZ - this.chunkMinZ;
      const gx = lx >> 2;
      const gy = Math.floor(ly / h);
      const gz = lz >> 2;
      const fx = (lx & 3) / w;
      const fy = (ly - gy * h) / h;
      const fz = (lz & 3) / w;
      return lerp3(
        fx,
        fy,
        fz,
        this.getCornerGrid(gx, gy, gz),
        this.getCornerGrid(gx + 1, gy, gz),
        this.getCornerGrid(gx, gy + 1, gz),
        this.getCornerGrid(gx + 1, gy + 1, gz),
        this.getCornerGrid(gx, gy, gz + 1),
        this.getCornerGrid(gx + 1, gy, gz + 1),
        this.getCornerGrid(gx, gy + 1, gz + 1),
        this.getCornerGrid(gx + 1, gy + 1, gz + 1)
      );
    }

    // Fallback outside active chunk bounds
    const firstX = Math.floor(blockX / w) * w;
    const firstY = Math.floor(blockY / h) * h;
    const firstZ = Math.floor(blockZ / w) * w;
    const fx = (((blockX % w) + w) % w) / w;
    const fy = (((blockY % h) + h) % h) / h;
    const fz = (((blockZ % w) + w) % w) / w;
    return lerp3(
      fx,
      fy,
      fz,
      this.wrapped.compute(DensityFunction.context(firstX, firstY, firstZ)),
      this.wrapped.compute(DensityFunction.context(firstX + w, firstY, firstZ)),
      this.wrapped.compute(DensityFunction.context(firstX, firstY + h, firstZ)),
      this.wrapped.compute(DensityFunction.context(firstX + w, firstY + h, firstZ)),
      this.wrapped.compute(DensityFunction.context(firstX, firstY, firstZ + w)),
      this.wrapped.compute(DensityFunction.context(firstX + w, firstY, firstZ + w)),
      this.wrapped.compute(DensityFunction.context(firstX, firstY + h, firstZ + w)),
      this.wrapped.compute(DensityFunction.context(firstX + w, firstY + h, firstZ + w))
    );
  }

  mapChildren(visitor: DensityFunction.Visitor): DensityFunction {
    return new FastInterpolated(visitor.apply(this.wrapped), this.cellWidth, this.cellHeight);
  }

  range() {
    return this.wrapped.range();
  }
}

// Compiled Surface Rule AST for full 16x16 chunk surface painting
type CompiledCondition = (ctx: SurfaceEvalContext) => boolean;
type CompiledRule = (ctx: SurfaceEvalContext) => number; // returns BLOCK_ID or -1 if unmatched

interface SurfaceEvalContext {
  wx: number;
  wy: number;
  wz: number;
  lx: number;
  lz: number;
  stoneDepthAbove: number;
  stoneDepthBelow: number;
  waterHeight: number;
  surfaceDepth: number;
  surfaceSecondary: number;
  minSurfaceLevel: number;
  isSteep: boolean;
  getBiome: () => BiomeId;
  noiseSample: (noiseName: string) => number;
  getRandomFloat: (randomName: string) => number;
  getBandlandsBlock: (wx: number, wy: number, wz: number) => number;
}

const MC_BLOCK_TO_ID: Record<string, number> = {
  'minecraft:air': BLOCK_ID.AIR,
  'minecraft:bedrock': BLOCK_ID.BEDROCK,
  'minecraft:calcite': BLOCK_ID.CALCITE,
  'minecraft:coarse_dirt': BLOCK_ID.COARSE_DIRT,
  'minecraft:deepslate': BLOCK_ID.DEEPSLATE,
  'minecraft:dirt': BLOCK_ID.DIRT,
  'minecraft:grass_block': BLOCK_ID.GRASS_BLOCK,
  'minecraft:gravel': BLOCK_ID.GRAVEL,
  'minecraft:ice': BLOCK_ID.ICE,
  'minecraft:mud': BLOCK_ID.MUD,
  'minecraft:mycelium': BLOCK_ID.MYCELIUM,
  'minecraft:orange_terracotta': BLOCK_ID.ORANGE_TERRACOTTA,
  'minecraft:packed_ice': BLOCK_ID.PACKED_ICE,
  'minecraft:podzol': BLOCK_ID.PODZOL,
  'minecraft:powder_snow': BLOCK_ID.SNOW_BLOCK,
  'minecraft:red_sand': BLOCK_ID.RED_SAND,
  'minecraft:red_sandstone': BLOCK_ID.RED_SANDSTONE,
  'minecraft:sand': BLOCK_ID.SAND,
  'minecraft:sandstone': BLOCK_ID.SANDSTONE,
  'minecraft:snow_block': BLOCK_ID.SNOW_BLOCK,
  'minecraft:stone': BLOCK_ID.STONE,
  'minecraft:terracotta': BLOCK_ID.TERRACOTTA,
  'minecraft:water': BLOCK_ID.WATER,
  'minecraft:white_terracotta': BLOCK_ID.CALCITE,
};

function resolveAnchor(anchor: unknown): number {
  const obj = anchor as Record<string, number>;
  if (typeof obj.absolute === 'number') return obj.absolute;
  if (typeof obj.above_bottom === 'number') return MIN_Y + obj.above_bottom;
  if (typeof obj.below_top === 'number') return MAX_Y - 1 - obj.below_top;
  return 0;
}

function compileSurfaceCondition(raw: unknown): CompiledCondition {
  const c = raw as Record<string, unknown>;
  const type = String(c?.type ?? '').replace(/^minecraft:/, '');
  switch (type) {
    case 'above_preliminary_surface':
      return (ctx) => ctx.wy >= ctx.minSurfaceLevel;
    case 'biome': {
      const set = new Set(((c.biome_is as string[]) ?? []).map((b) => b.replace(/^minecraft:/, '')));
      return (ctx) => set.has(ctx.getBiome());
    }
    case 'not': {
      const inner = compileSurfaceCondition(c.invert);
      return (ctx) => !inner(ctx);
    }
    case 'hole':
      return (ctx) => ctx.surfaceDepth <= 0;
    case 'steep':
      return (ctx) => ctx.isSteep;
    case 'temperature':
      return (ctx) => {
        const meta = mcData.biomeMeta[ctx.getBiome()];
        const baseTemp = meta?.temperature ?? 0.5;
        const elevDrop = ctx.wy > 80 ? (ctx.wy - 80) * 0.00125 : 0;
        return baseTemp - elevDrop < 0.15;
      };
    case 'noise_threshold': {
      const noiseName = String(c.noise ?? '').replace(/^minecraft:/, '');
      const minT = Number(c.min_threshold ?? 0);
      const maxT = Number(c.max_threshold ?? 0);
      return (ctx) => {
        const val = ctx.noiseSample(noiseName);
        return val >= minT && val <= maxT;
      };
    }
    case 'stone_depth': {
      const offset = Number(c.offset ?? 0);
      const addSurfaceDepth = Boolean(c.add_surface_depth);
      const secondaryRange = Number(c.secondary_depth_range ?? 0);
      const isCeiling = c.surface_type === 'ceiling';
      return (ctx) => {
        const depth = isCeiling ? ctx.stoneDepthBelow : ctx.stoneDepthAbove;
        const sd = addSurfaceDepth ? ctx.surfaceDepth : 0;
        const sec = secondaryRange === 0 ? 0 : ((ctx.surfaceSecondary + 1) * 0.5) * secondaryRange;
        return depth <= 1 + offset + sd + sec;
      };
    }
    case 'vertical_gradient': {
      const randomName = String(c.random_name ?? '');
      const trueAt = resolveAnchor(c.true_at_and_below);
      const falseAt = resolveAnchor(c.false_at_and_above);
      return (ctx) => {
        if (ctx.wy <= trueAt) return true;
        if (ctx.wy >= falseAt) return false;
        const chance = (falseAt - ctx.wy) / (falseAt - trueAt);
        return ctx.getRandomFloat(randomName) < chance;
      };
    }
    case 'water': {
      const offset = Number(c.offset ?? 0);
      const mult = Number(c.surface_depth_multiplier ?? 0);
      const addStoneDepth = Boolean(c.add_surface_depth);
      return (ctx) => {
        if (ctx.waterHeight === Number.MIN_SAFE_INTEGER) return true;
        const stoneDepth = addStoneDepth ? ctx.stoneDepthAbove : 0;
        return ctx.wy + stoneDepth >= ctx.waterHeight + offset + ctx.surfaceDepth * mult;
      };
    }
    case 'y_above': {
      const anchorY = resolveAnchor(c.anchor);
      const mult = Number(c.surface_depth_multiplier ?? 0);
      const addStoneDepth = Boolean(c.add_surface_depth);
      return (ctx) => {
        const stoneDepth = addStoneDepth ? ctx.stoneDepthAbove : 0;
        return ctx.wy + stoneDepth >= anchorY + ctx.surfaceDepth * mult;
      };
    }
    default:
      return () => false;
  }
}

function compileSurfaceRule(raw: unknown): CompiledRule {
  const r = raw as Record<string, unknown>;
  const type = String(r?.type ?? '').replace(/^minecraft:/, '');
  switch (type) {
    case 'block': {
      const name = String((r.result_state as Record<string, unknown>)?.Name ?? 'minecraft:stone');
      const blockId = MC_BLOCK_TO_ID[name] ?? BLOCK_ID.STONE;
      return () => blockId;
    }
    case 'sequence': {
      const rules = ((r.sequence as unknown[]) ?? []).map(compileSurfaceRule);
      return (ctx) => {
        for (let i = 0; i < rules.length; i++) {
          const res = rules[i](ctx);
          if (res !== -1) return res;
        }
        return -1;
      };
    }
    case 'condition': {
      const cond = compileSurfaceCondition(r.if_true);
      const thenRun = compileSurfaceRule(r.then_run);
      return (ctx) => (cond(ctx) ? thenRun(ctx) : -1);
    }
    case 'bandlands':
      return (ctx) => ctx.getBandlandsBlock(ctx.wx, ctx.wy, ctx.wz);
    default:
      return () => -1;
  }
}

let compiledOverworldSurfaceRule: CompiledRule | null = null;
function getCompiledOverworldSurfaceRule(): CompiledRule {
  if (!compiledOverworldSurfaceRule) {
    compiledOverworldSurfaceRule = compileSurfaceRule((mcData.noiseSettings as Record<string, unknown>).surface_rule);
  }
  return compiledOverworldSurfaceRule;
}

export interface BiomeSample {
  biome: BiomeId;
  height: number;
  grassTint: [number, number, number];
  foliageTint: [number, number, number];
  waterTint: [number, number, number];
}

export class MinecraftOverworldSession {
  public readonly seedBigInt: bigint;
  public readonly seedInt32: number;
  private readonly biomeSource: MultiNoiseBiomeSource;
  private readonly randomState: RandomState;
  private readonly fastInterps: FastInterpolated[] = [];
  private readonly baseInterp: FastInterpolated | null = null;
  private readonly noodleDensity: DensityFunction | null = null;
  private readonly optimizedFinalDensity: DensityFunction;
  private readonly preliminarySurfaceLevel: DensityFunction;
  private readonly surfaceRule: CompiledRule;
  private readonly surfaceNoise: NormalNoise;
  private readonly surfaceSecondaryNoise: NormalNoise;
  private readonly clayBandsOffsetNoise: NormalNoise;
  private readonly clayBands: Uint8Array;
  private readonly positionalRandomRoot;
  private readonly namedRandoms = new Map<string, ReturnType<XoroshiroRandom['forkPositional']>>();
  private readonly ruleNoises = new Map<string, NormalNoise>();

  constructor(seedBigInt: bigint) {
    this.seedBigInt = seedBigInt;
    this.seedInt32 = Number(BigInt.asIntN(32, seedBigInt));

    const { noiseSettings, biomeSource } = ensureInitialized();
    this.biomeSource = biomeSource;
    this.randomState = new RandomState(noiseSettings, seedBigInt);
    this.preliminarySurfaceLevel = this.randomState.router.preliminarySurfaceLevel;
    this.surfaceRule = getCompiledOverworldSurfaceRule();

    // Replace all DensityFunction.Interpolated with FastInterpolated
    const interpVisitor: DensityFunction.Visitor = {
      apply: (fn) => {
        if (fn instanceof DensityFunction.Interpolated) {
          const fast = new FastInterpolated((fn as unknown as { wrapped: DensityFunction }).wrapped, 4, 8);
          this.fastInterps.push(fast);
          return fast;
        }
        return fn;
      },
    };
    this.optimizedFinalDensity = this.randomState.router.finalDensity.mapAll(interpVisitor);

    // Inspect top-level min(squeeze(mul(0.64, baseInterp)), noodle) to enable empty-cell skip
    const fd = this.optimizedFinalDensity;
    if (
      fd instanceof DensityFunction.Binary &&
      fd.type === 'min' &&
      fd.argument1 instanceof DensityFunction.Unary &&
      fd.argument1.type === 'squeeze'
    ) {
      const mulNode = fd.argument1.input as unknown as { input?: DensityFunction; argument1?: DensityFunction; argument2?: DensityFunction };
      const maybeInterp = mulNode.input ?? mulNode.argument2 ?? mulNode.argument1;
      if (maybeInterp instanceof FastInterpolated) {
        this.baseInterp = maybeInterp;
        this.noodleDensity = fd.argument2;
      }
    }

    // Surface system noises & clay bands matching vanilla MC
    const sysRandom = XoroshiroRandom.create(seedBigInt).forkPositional();
    this.positionalRandomRoot = sysRandom;
    this.surfaceNoise = this.randomState.getOrCreateNoise(Identifier.create('surface'));
    this.surfaceSecondaryNoise = this.randomState.getOrCreateNoise(Identifier.create('surface_secondary'));
    this.clayBandsOffsetNoise = this.randomState.getOrCreateNoise(Identifier.create('clay_bands_offset'));
    this.clayBands = this.buildClayBands(sysRandom.fromHashOf('minecraft:clay_bands'));
  }

  private buildClayBands(prng: ReturnType<XoroshiroRandom['forkPositional']> extends { fromHashOf(s: string): infer R } ? R : never): Uint8Array {
    const bands = new Uint8Array(192).fill(BLOCK_ID.TERRACOTTA);
    for (let i = 0; i < 192; i++) {
      i += prng.nextInt(5) + 1;
      if (i < 192) bands[i] = BLOCK_ID.ORANGE_TERRACOTTA;
    }
    const paintBand = (count: number, minLen: number, blockId: number) => {
      for (let k = 0; k < count; k++) {
        const len = prng.nextInt(3) + minLen;
        const start = prng.nextInt(192);
        for (let j = 0; start + j < 192 && j < len; j++) {
          bands[start + j] = blockId;
        }
      }
    };
    paintBand(prng.nextInt(4) + 2, 1, BLOCK_ID.YELLOW_TERRACOTTA);
    paintBand(prng.nextInt(4) + 2, 2, BLOCK_ID.RED_TERRACOTTA);
    paintBand(prng.nextInt(4) + 2, 1, BLOCK_ID.TERRACOTTA);
    for (let k = 0, s = 0; k < prng.nextInt(3) + 3; k++) {
      s += prng.nextInt(16) + 4;
      for (let j = 0; s + j < 192 && j < 1; j++) {
        bands[s + j] = BLOCK_ID.CALCITE;
      }
    }
    return bands;
  }

  private getRuleNoise(name: string): NormalNoise {
    let n = this.ruleNoises.get(name);
    if (!n) {
      n = this.randomState.getOrCreateNoise(Identifier.create(name));
      this.ruleNoises.set(name, n);
    }
    return n;
  }

  private getPositionalRandom(name: string) {
    let r = this.namedRandoms.get(name);
    if (!r) {
      r = this.positionalRandomRoot.fromHashOf(name).forkPositional();
      this.namedRandoms.set(name, r);
    }
    return r;
  }

  public getBiomeAt(wx: number, wy: number, wz: number): BiomeId {
    return this.biomeSource.getBiome(wx >> 2, wy >> 2, wz >> 2, this.randomState.sampler).path as BiomeId;
  }

  public sampleColumn(wx: number, wz: number): BiomeSample {
    // Evaluate terrain column top using FindTopSurface + targeted surface scan around preliminary level
    const prelim = Math.floor(this.preliminarySurfaceLevel.compute(DensityFunction.context(wx, 0, wz)));
    let surfaceY = MIN_Y;
    const densityFn = this.baseInterp ? this.baseInterp.wrapped : this.optimizedFinalDensity;
    const scanTop = Math.min(MAX_Y - 1, Math.max(SEA_LEVEL + 4, prelim + 14));
    const scanBottom = Math.max(MIN_Y, prelim - 14);
    for (let y = scanTop; y >= scanBottom; y--) {
      if (densityFn.compute(DensityFunction.context(wx, y, wz)) > 0) {
        surfaceY = y;
        break;
      }
    }
    if (surfaceY === MIN_Y) {
      for (let y = scanBottom - 1; y >= MIN_Y; y -= 4) {
        if (densityFn.compute(DensityFunction.context(wx, y, wz)) > 0) {
          surfaceY = y;
          break;
        }
      }
    }
    const biome = this.getBiomeAt(wx, Math.max(surfaceY, SEA_LEVEL + 1), wz);
    const tints = getBiomeTints(biome);
    return {
      biome,
      height: surfaceY,
      ...tints,
    };
  }

  public generateChunk(cx: number, cz: number, blocks: Uint8Array, biomeMap: BiomeId[]): void {
    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;

    for (let i = 0; i < this.fastInterps.length; i++) {
      this.fastInterps[i].beginChunk(startX, startZ);
    }

    // 1. Fill base density (STONE / WATER / LAVA / AIR) using 4x8x4 cell interpolation
    const cellWidth = 4;
    const cellHeight = 8;
    const cellCountXZ = 4;
    const cellCountY = CHUNK_HEIGHT / cellHeight; // 48

    if (this.baseInterp && this.noodleDensity) {
      const base = this.baseInterp;
      const noodle = this.noodleDensity;
      for (let czCell = 0; czCell < cellCountXZ; czCell++) {
        for (let cxCell = 0; cxCell < cellCountXZ; cxCell++) {
          for (let cyCell = cellCountY - 1; cyCell >= 0; cyCell--) {
            const c = base.getCellCorners(cxCell, cyCell, czCell);
            const allAirOrFluid =
              c[0] <= 0 &&
              c[1] <= 0 &&
              c[2] <= 0 &&
              c[3] <= 0 &&
              c[4] <= 0 &&
              c[5] <= 0 &&
              c[6] <= 0 &&
              c[7] <= 0;

            const baseIy = cyCell * cellHeight;
            const baseLx = cxCell * cellWidth;
            const baseLz = czCell * cellWidth;

            if (allAirOrFluid) {
              for (let offY = 0; offY < cellHeight; offY++) {
                const iy = baseIy + offY;
                const wy = MIN_Y + iy;
                const fill = wy < -54 ? BLOCK_ID.LAVA : wy <= SEA_LEVEL ? BLOCK_ID.WATER : BLOCK_ID.AIR;
                if (fill === BLOCK_ID.AIR) continue; // Uint8Array is zero-initialized (AIR=0)
                const rowBase = iy * 256;
                for (let offZ = 0; offZ < cellWidth; offZ++) {
                  const lz = baseLz + offZ;
                  const idxBase = rowBase + lz * 16 + baseLx;
                  blocks[idxBase] = fill;
                  blocks[idxBase + 1] = fill;
                  blocks[idxBase + 2] = fill;
                  blocks[idxBase + 3] = fill;
                }
              }
              continue;
            }

            for (let offY = 0; offY < cellHeight; offY++) {
              const fy = offY / cellHeight;
              const iy = baseIy + offY;
              const wy = MIN_Y + iy;
              const defaultFluid = wy < -54 ? BLOCK_ID.LAVA : wy <= SEA_LEVEL ? BLOCK_ID.WATER : BLOCK_ID.AIR;
              const rowBase = iy * 256;

              for (let offZ = 0; offZ < cellWidth; offZ++) {
                const fz = offZ / cellWidth;
                const lz = baseLz + offZ;
                const wz = startZ + lz;
                const idxBase = rowBase + lz * 16 + baseLx;

                for (let offX = 0; offX < cellWidth; offX++) {
                  const fx = offX / cellWidth;
                  const baseVal = lerp3(fx, fy, fz, c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]);
                  if (baseVal <= 0) {
                    if (defaultFluid !== BLOCK_ID.AIR) {
                      blocks[idxBase + offX] = defaultFluid;
                    }
                  } else {
                    const sq = squeezeDensity(0.64 * baseVal);
                    const nv = noodle.compute(DensityFunction.context(startX + baseLx + offX, wy, wz));
                    if (sq > 0 && nv > 0) {
                      blocks[idxBase + offX] = BLOCK_ID.STONE;
                    } else if (defaultFluid !== BLOCK_ID.AIR) {
                      blocks[idxBase + offX] = defaultFluid;
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      const fd = this.optimizedFinalDensity;
      for (let iy = CHUNK_HEIGHT - 1; iy >= 0; iy--) {
        const wy = MIN_Y + iy;
        const defaultFluid = wy < -54 ? BLOCK_ID.LAVA : wy <= SEA_LEVEL ? BLOCK_ID.WATER : BLOCK_ID.AIR;
        const rowBase = iy * 256;
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          const wz = startZ + lz;
          const zBase = rowBase + lz * 16;
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const d = fd.compute(DensityFunction.context(startX + lx, wy, wz));
            if (d > 0) blocks[zBase + lx] = BLOCK_ID.STONE;
            else if (defaultFluid !== BLOCK_ID.AIR) blocks[zBase + lx] = defaultFluid;
          }
        }
      }
    }

    for (let i = 0; i < this.fastInterps.length; i++) {
      this.fastInterps[i].endChunk();
    }

    // 2. Compute preliminary surface heights at the 4 chunk corners + column heights & steepness
    const p00 = Math.floor(this.preliminarySurfaceLevel.compute(DensityFunction.context(startX, 0, startZ)));
    const p10 = Math.floor(this.preliminarySurfaceLevel.compute(DensityFunction.context(startX + 16, 0, startZ)));
    const p01 = Math.floor(this.preliminarySurfaceLevel.compute(DensityFunction.context(startX, 0, startZ + 16)));
    const p11 = Math.floor(this.preliminarySurfaceLevel.compute(DensityFunction.context(startX + 16, 0, startZ + 16)));

    const surfaceHeights = new Int16Array(256);
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        let topSolid = MIN_Y;
        const colOff = lz * CHUNK_SIZE + lx;
        for (let iy = CHUNK_HEIGHT - 1; iy >= 0; iy--) {
          if (blocks[iy * 256 + colOff] === BLOCK_ID.STONE) {
            topSolid = MIN_Y + iy;
            break;
          }
        }
        surfaceHeights[colOff] = topSolid;
      }
    }

    // Quart-grid biome cache per chunk (4 x 96 x 4 = 1536 slots, lazy populated)
    const qBiomeCache: (BiomeId | undefined)[] = new Array(4 * 96 * 4);
    const getQuartBiome = (lx: number, wy: number, lz: number): BiomeId => {
      const qx = lx >> 2;
      const qy = (wy - MIN_Y) >> 2;
      const qz = lz >> 2;
      const slot = (qy * 4 + qz) * 4 + qx;
      let b = qBiomeCache[slot];
      if (!b) {
        b = this.getBiomeAt(startX + lx, wy, startZ + lz);
        qBiomeCache[slot] = b;
      }
      return b;
    };

    // 3. Apply full 16x16 vanilla Overworld surface rules
    const noiseRowCache = new Map<string, number>();
    const ctx: SurfaceEvalContext = {
      wx: 0,
      wy: 0,
      wz: 0,
      lx: 0,
      lz: 0,
      stoneDepthAbove: 0,
      stoneDepthBelow: 0,
      waterHeight: Number.MIN_SAFE_INTEGER,
      surfaceDepth: 0,
      surfaceSecondary: 0,
      minSurfaceLevel: 0,
      isSteep: false,
      getBiome: () => getQuartBiome(ctx.lx, ctx.wy, ctx.lz),
      noiseSample: (name) => {
        let v = noiseRowCache.get(name);
        if (v === undefined) {
          v = this.getRuleNoise(name).sample(ctx.wx, 0, ctx.wz);
          noiseRowCache.set(name, v);
        }
        return v;
      },
      getRandomFloat: (name) => this.getPositionalRandom(name).at(ctx.wx, ctx.wy, ctx.wz).nextFloat(),
      getBandlandsBlock: (wx, wy, wz) => {
        const offset = Math.round(this.clayBandsOffsetNoise.sample(wx, 0, wz) * 4.0);
        const idx = (((wy + offset) % 192) + 192) % 192;
        return this.clayBands[idx];
      },
    };

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wz = startZ + lz;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = startX + lx;
        const colOff = lz * CHUNK_SIZE + lx;
        const hCol = surfaceHeights[colOff];

        // Record surface biome for chunk biomeMap (used for O(1) tinting & HUD)
        biomeMap[colOff] = getQuartBiome(lx, Math.max(hCol, SEA_LEVEL + 1), lz);

        // Compute steepness across neighbor columns
        const hN = lz > 0 ? surfaceHeights[(lz - 1) * 16 + lx] : hCol;
        const hS = lz < 15 ? surfaceHeights[(lz + 1) * 16 + lx] : hCol;
        const hW = lx > 0 ? surfaceHeights[lz * 16 + (lx - 1)] : hCol;
        const hE = lx < 15 ? surfaceHeights[lz * 16 + (lx + 1)] : hCol;
        ctx.isSteep = hCol - hN >= 4 || hCol - hS >= 4 || hCol - hW >= 4 || hCol - hE >= 4;

        ctx.wx = wx;
        ctx.wz = wz;
        ctx.lx = lx;
        ctx.lz = lz;
        noiseRowCache.clear();

        const sdNoise = this.surfaceNoise.sample(wx, 0, wz);
        const sdOffset = this.positionalRandomRoot.at(wx, 0, wz).nextDouble() * 0.25;
        ctx.surfaceDepth = sdNoise * 2.75 + 3 + sdOffset;
        ctx.surfaceSecondary = this.surfaceSecondaryNoise.sample(wx, 0, wz);

        const prelim = Math.floor(lerp(lz / 16, lerp(lx / 16, p00, p10), lerp(lx / 16, p01, p11)));
        ctx.minSurfaceLevel = prelim + ctx.surfaceDepth - 8;

        let stoneDepthAbove = 0;
        let waterHeight = Number.MIN_SAFE_INTEGER;
        let stoneDepthOffset = Number.MAX_SAFE_INTEGER;

        for (let iy = CHUNK_HEIGHT - 1; iy >= 0; iy--) {
          const idx = iy * 256 + colOff;
          const oldId = blocks[idx];
          const wy = MIN_Y + iy;

          if (oldId === BLOCK_ID.AIR) {
            stoneDepthAbove = 0;
            waterHeight = Number.MIN_SAFE_INTEGER;
            continue;
          }
          if (oldId === BLOCK_ID.WATER || oldId === BLOCK_ID.LAVA) {
            if (waterHeight === Number.MIN_SAFE_INTEGER) {
              waterHeight = wy + 1;
            }
            continue;
          }

          if (stoneDepthOffset >= wy) {
            stoneDepthOffset = Number.MIN_SAFE_INTEGER;
            for (let searchIy = iy - 1; searchIy >= 0; searchIy--) {
              const sId = blocks[searchIy * 256 + colOff];
              if (sId === BLOCK_ID.AIR || sId === BLOCK_ID.WATER || sId === BLOCK_ID.LAVA) {
                stoneDepthOffset = MIN_Y + searchIy + 1;
                break;
              }
            }
          }

          stoneDepthAbove += 1;
          const stoneDepthBelow = wy - stoneDepthOffset + 1;

          if (oldId !== BLOCK_ID.STONE) continue;

          ctx.wy = wy;
          ctx.stoneDepthAbove = stoneDepthAbove;
          ctx.stoneDepthBelow = stoneDepthBelow;
          ctx.waterHeight = waterHeight;

          const newBlock = this.surfaceRule(ctx);
          if (newBlock !== -1) {
            blocks[idx] = newBlock;
          }
        }
      }
    }

    // 4. Underground rock pockets & Minecraft 1.18+ vertical ore distribution
    this.populateOresAndStoneVariants(startX, startZ, blocks, biomeMap);

    // 5. Biome surface flora, underwater kelp/seagrass, snow layers & cross-chunk trees
    this.populateDecorations(startX, startZ, blocks, biomeMap, surfaceHeights);
  }

  private populateOresAndStoneVariants(
    startX: number,
    startZ: number,
    blocks: Uint8Array,
    biomeMap: BiomeId[]
  ) {
    const seed = this.seedInt32;
    for (let iy = 1; iy < CHUNK_HEIGHT - 1; iy++) {
      const wy = MIN_Y + iy;
      const rowBase = iy * 256;
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wz = startZ + lz;
        const zBase = rowBase + lz * 16;
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const id = blocks[zBase + lx];
          if (id !== BLOCK_ID.STONE && id !== BLOCK_ID.DEEPSLATE) continue;
          const wx = startX + lx;

          const h = hashCoords3D(wx, wy, wz, seed + 55);
          // Fast skip ~92% of solid stone voxels
          if (h > 0.08 && h < 0.92) continue;

          const pocket = hashCoords3D(wx >> 2, wy >> 2, wz >> 2, seed + 17);

          if (id === BLOCK_ID.DEEPSLATE) {
            if (wy < 16 && h < 0.011 && pocket > 0.55) {
              blocks[zBase + lx] = BLOCK_ID.DEEPSLATE_DIAMOND_ORE;
            } else if (wy < 32 && h < 0.018 && pocket < 0.42) {
              blocks[zBase + lx] = BLOCK_ID.DEEPSLATE_GOLD_ORE;
            } else if (h < 0.028 && pocket > 0.65) {
              blocks[zBase + lx] = BLOCK_ID.DEEPSLATE_IRON_ORE;
            } else if (wy > -16 && h > 0.96 && pocket < 0.35) {
              blocks[zBase + lx] = BLOCK_ID.DEEPSLATE_COAL_ORE;
            } else if (pocket > 0.84 && h > 0.93) {
              blocks[zBase + lx] = BLOCK_ID.TUFF;
            }
          } else {
            const biome = biomeMap[lz * 16 + lx];
            if (wy > 40 && (biome === 'jagged_peaks' || biome === 'frozen_peaks' || biome === 'stony_peaks' || biome === 'windswept_hills' || biome === 'grove') && h < 0.012 && pocket > 0.6) {
              blocks[zBase + lx] = BLOCK_ID.EMERALD_ORE;
            } else if (wy < 14 && h < 0.008 && pocket > 0.6) {
              blocks[zBase + lx] = BLOCK_ID.DIAMOND_ORE;
            } else if (wy < 28 && h < 0.015 && pocket < 0.3) {
              blocks[zBase + lx] = BLOCK_ID.REDSTONE_ORE;
            } else if (wy < 32 && h < 0.012 && pocket > 0.72) {
              blocks[zBase + lx] = BLOCK_ID.LAPIS_ORE;
            } else if (wy < 32 && h < 0.014 && pocket > 0.4 && pocket < 0.55) {
              blocks[zBase + lx] = BLOCK_ID.GOLD_ORE;
            } else if (wy > -16 && wy < 72 && h < 0.025 && pocket > 0.55) {
              blocks[zBase + lx] = BLOCK_ID.IRON_ORE;
            } else if (wy > -10 && wy < 96 && h > 0.965 && pocket < 0.38) {
              blocks[zBase + lx] = BLOCK_ID.COPPER_ORE;
            } else if (wy > 0 && wy < 140 && h > 0.955 && pocket > 0.52) {
              blocks[zBase + lx] = BLOCK_ID.COAL_ORE;
            } else if (pocket > 0.86) {
              blocks[zBase + lx] = BLOCK_ID.GRANITE;
            } else if (pocket < 0.14) {
              blocks[zBase + lx] = BLOCK_ID.DIORITE;
            } else if (pocket > 0.48 && pocket < 0.54) {
              blocks[zBase + lx] = BLOCK_ID.ANDESITE;
            }
          }
        }
      }
    }
  }

  private populateDecorations(
    startX: number,
    startZ: number,
    blocks: Uint8Array,
    biomeMap: BiomeId[],
    surfaceHeights: Int16Array
  ) {
    const seed = this.seedInt32;

    // 4a. Underwater kelp/seagrass + surface flora/snow
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wz = startZ + lz;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = startX + lx;
        const colIdx = lz * CHUNK_SIZE + lx;
        const h = surfaceHeights[colIdx];
        if (h <= MIN_Y + 2 || h >= MAX_Y - 12) continue;
        const biome = biomeMap[colIdx];

        const iy = h - MIN_Y;
        const groundId = blocks[iy * 256 + colIdx];
        if (groundId === BLOCK_ID.AIR || groundId === BLOCK_ID.WATER) continue;

        if (h < SEA_LEVEL - 2) {
          const r = hashCoords2D(wx, wz, seed + 200);
          if ((biome === 'deep_ocean' || biome === 'warm_ocean') && r > 0.992) {
            blocks[iy * 256 + colIdx] = BLOCK_ID.PRISMARINE;
          } else if (r > 0.91 && h + 2 < SEA_LEVEL) {
            const kelpH = 1 + Math.floor(hashCoords2D(wx + 3, wz - 5, seed + 201) * Math.min(7, SEA_LEVEL - h - 2));
            for (let ky = 1; ky <= kelpH; ky++) {
              const kIdx = (iy + ky) * 256 + colIdx;
              if (blocks[kIdx] === BLOCK_ID.WATER) {
                blocks[kIdx] = ky === 1 && kelpH === 1 ? BLOCK_ID.SEAGRASS : BLOCK_ID.KELP;
              }
            }
          }
          continue;
        }

        const r = hashCoords2D(wx, wz, seed + 300);
        const aboveIdx = (iy + 1) * 256 + colIdx;
        if (blocks[aboveIdx] !== BLOCK_ID.AIR) continue;

        const isSnowBiome =
          biome === 'snowy_plains' ||
          biome === 'snowy_taiga' ||
          biome === 'snowy_slopes' ||
          biome === 'grove' ||
          biome === 'ice_spikes' ||
          biome === 'frozen_peaks' ||
          biome === 'snowy_beach';

        if (isSnowBiome && h >= SEA_LEVEL && groundId !== BLOCK_ID.ICE && groundId !== BLOCK_ID.PACKED_ICE) {
          if (r > 0.35) blocks[aboveIdx] = BLOCK_ID.SNOW_LAYER;
        } else if (biome === 'desert' && groundId === BLOCK_ID.SAND) {
          if (r > 0.992) {
            const ch = 2 + Math.floor(hashCoords2D(wx, wz, seed + 305) * 2);
            for (let cy = 1; cy <= ch && iy + cy < CHUNK_HEIGHT; cy++) {
              const cIdx = (iy + cy) * 256 + colIdx;
              if (blocks[cIdx] === BLOCK_ID.AIR) blocks[cIdx] = BLOCK_ID.CACTUS;
            }
          }
        } else if ((biome === 'beach' || biome === 'river') && groundId === BLOCK_ID.SAND && h <= SEA_LEVEL + 2) {
          if (r > 0.985) {
            const sh = 2 + Math.floor(hashCoords2D(wx, wz, seed + 306) * 2);
            for (let sy = 1; sy <= sh && iy + sy < CHUNK_HEIGHT; sy++) {
              const sIdx = (iy + sy) * 256 + colIdx;
              if (blocks[sIdx] === BLOCK_ID.AIR) blocks[sIdx] = BLOCK_ID.SUGAR_CANE;
            }
          }
        } else if (groundId === BLOCK_ID.GRASS_BLOCK) {
          if ((biome === 'bamboo_jungle' || biome === 'jungle') && r > (biome === 'bamboo_jungle' ? 0.82 : 0.955) && r < 0.985) {
            const bh = 4 + Math.floor(hashCoords2D(wx, wz, seed + 307) * 6);
            for (let by = 1; by <= bh && iy + by < CHUNK_HEIGHT; by++) {
              const bIdx = (iy + by) * 256 + colIdx;
              if (blocks[bIdx] === BLOCK_ID.AIR) blocks[bIdx] = BLOCK_ID.BAMBOO;
            }
          } else if (r > 0.85 && r < 0.95) {
            blocks[aboveIdx] =
              biome === 'taiga' || biome === 'old_growth_pine_taiga' || biome === 'old_growth_spruce_taiga' || biome === 'jungle'
                ? BLOCK_ID.FERN
                : BLOCK_ID.TALL_GRASS;
          } else if (r > 0.968 && r < 0.988) {
            blocks[aboveIdx] =
              biome === 'swamp' || biome === 'mangrove_swamp'
                ? BLOCK_ID.BLUE_ORCHID
                : hashCoords2D(wx, wz, seed + 308) > 0.5
                  ? BLOCK_ID.DANDELION
                  : BLOCK_ID.POPPY;
          } else if (r > 0.997) {
            blocks[aboveIdx] = biome === 'jungle' ? BLOCK_ID.MELON : BLOCK_ID.PUMPKIN;
          }
        }
      }
    }

    // 4b. Deterministic cross-chunk trees (scanned across 3-block padding)
    for (let wz = startZ - 3; wz <= startZ + CHUNK_SIZE + 2; wz++) {
      for (let wx = startX - 3; wx <= startX + CHUNK_SIZE + 2; wx++) {
        const cellX = Math.floor(wx / 3);
        const cellZ = Math.floor(wz / 3);
        const pickX = cellX * 3 + Math.floor(hashCoords2D(cellX, cellZ, seed + 400) * 3);
        const pickZ = cellZ * 3 + Math.floor(hashCoords2D(cellX, cellZ, seed + 401) * 3);
        if (wx !== pickX || wz !== pickZ) continue;

        let groundY: number;
        let biome: BiomeId;
        let spec: { chance: number; logId: number; leafId: number; trunkH: number; radius: number } | null;
        const lx = wx - startX;
        const lz = wz - startZ;
        if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
          const colIdx = lz * CHUNK_SIZE + lx;
          groundY = surfaceHeights[colIdx];
          biome = biomeMap[colIdx];
          if (groundY <= SEA_LEVEL || groundY >= MAX_Y - 16) continue;
          const groundId = blocks[(groundY - MIN_Y) * 256 + colIdx];
          if (groundId !== BLOCK_ID.GRASS_BLOCK && groundId !== BLOCK_ID.DIRT && groundId !== BLOCK_ID.PODZOL && groundId !== BLOCK_ID.MUD) {
            continue;
          }
          spec = this.getTreeSpec(biome, wx, wz);
          if (!spec) continue;
          if (hashCoords2D(wx, wz, seed + 403) > spec.chance) continue;
        } else {
          // Check probability and approximate surface biome before running column scan
          const prelim = Math.floor(this.preliminarySurfaceLevel.compute(DensityFunction.context(wx, 0, wz)));
          if (prelim <= SEA_LEVEL - 4 || prelim >= MAX_Y - 16) continue;
          biome = this.getBiomeAt(wx, Math.max(prelim, SEA_LEVEL + 1), wz);
          spec = this.getTreeSpec(biome, wx, wz);
          if (!spec) continue;
          if (hashCoords2D(wx, wz, seed + 403) > spec.chance) continue;
          const col = this.sampleColumn(wx, wz);
          groundY = col.height;
          if (groundY <= SEA_LEVEL || groundY >= MAX_Y - 16) continue;
        }

        this.stampTree(blocks, startX, startZ, wx, groundY + 1, wz, spec.logId, spec.leafId, spec.trunkH, spec.radius);
      }
    }
  }

  private getTreeSpec(
    biome: BiomeId,
    wx: number,
    wz: number
  ): { chance: number; logId: number; leafId: number; trunkH: number; radius: number } | null {
    const r = hashCoords2D(wx, wz, this.seedInt32 + 402);
    switch (biome) {
      case 'forest':
      case 'flower_forest':
        return r > 0.72
          ? { chance: 0.34, logId: BLOCK_ID.BIRCH_LOG, leafId: BLOCK_ID.BIRCH_LEAVES, trunkH: 6, radius: 2 }
          : { chance: 0.34, logId: BLOCK_ID.OAK_LOG, leafId: BLOCK_ID.OAK_LEAVES, trunkH: 5, radius: 2 };
      case 'birch_forest':
      case 'old_growth_birch_forest':
        return { chance: 0.36, logId: BLOCK_ID.BIRCH_LOG, leafId: BLOCK_ID.BIRCH_LEAVES, trunkH: 7, radius: 2 };
      case 'dark_forest':
        return { chance: 0.55, logId: BLOCK_ID.DARK_OAK_LOG, leafId: BLOCK_ID.DARK_OAK_LEAVES, trunkH: 6, radius: 2 };
      case 'taiga':
      case 'snowy_taiga':
      case 'grove':
      case 'old_growth_pine_taiga':
      case 'old_growth_spruce_taiga':
        return { chance: 0.34, logId: BLOCK_ID.SPRUCE_LOG, leafId: BLOCK_ID.SPRUCE_LEAVES, trunkH: 7, radius: 2 };
      case 'jungle':
      case 'sparse_jungle':
      case 'bamboo_jungle':
        return {
          chance: biome === 'sparse_jungle' ? 0.14 : 0.42,
          logId: BLOCK_ID.JUNGLE_LOG,
          leafId: BLOCK_ID.JUNGLE_LEAVES,
          trunkH: 9,
          radius: 3,
        };
      case 'savanna':
      case 'savanna_plateau':
      case 'windswept_savanna':
        return { chance: 0.09, logId: BLOCK_ID.ACACIA_LOG, leafId: BLOCK_ID.ACACIA_LEAVES, trunkH: 6, radius: 2 };
      case 'swamp':
      case 'mangrove_swamp':
        return { chance: 0.16, logId: BLOCK_ID.OAK_LOG, leafId: BLOCK_ID.OAK_LEAVES, trunkH: 5, radius: 2 };
      case 'windswept_forest':
        return { chance: 0.22, logId: BLOCK_ID.SPRUCE_LOG, leafId: BLOCK_ID.SPRUCE_LEAVES, trunkH: 6, radius: 2 };
      case 'plains':
      case 'sunflower_plains':
      case 'meadow':
        return { chance: 0.03, logId: BLOCK_ID.OAK_LOG, leafId: BLOCK_ID.OAK_LEAVES, trunkH: 5, radius: 2 };
      case 'wooded_badlands':
        return { chance: 0.14, logId: BLOCK_ID.OAK_LOG, leafId: BLOCK_ID.OAK_LEAVES, trunkH: 4, radius: 2 };
      default:
        return null;
    }
  }

  private stampTree(
    blocks: Uint8Array,
    chunkStartX: number,
    chunkStartZ: number,
    wx: number,
    baseY: number,
    wz: number,
    logId: number,
    leafId: number,
    trunkH: number,
    radius: number
  ) {
    const place = (tx: number, ty: number, tz: number, id: number, overwriteNonSolid = true) => {
      const lx = tx - chunkStartX;
      const lz = tz - chunkStartZ;
      const iy = ty - MIN_Y;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || iy < 1 || iy >= CHUNK_HEIGHT) return;
      const idx = iy * 256 + lz * CHUNK_SIZE + lx;
      const existing = blocks[idx];
      if (existing === BLOCK_ID.AIR || (overwriteNonSolid && isBlockTransparent(existing))) {
        blocks[idx] = id;
      }
    };

    if (logId === BLOCK_ID.SPRUCE_LOG) {
      for (let dy = 2; dy <= trunkH + 1; dy++) {
        const layerRadius = Math.max(0, Math.round(((trunkH + 1 - dy) / (trunkH - 1)) * 2.4));
        for (let dz = -layerRadius; dz <= layerRadius; dz++) {
          for (let dx = -layerRadius; dx <= layerRadius; dx++) {
            if (Math.abs(dx) + Math.abs(dz) > layerRadius + 1) continue;
            place(wx + dx, baseY + dy, wz + dz, leafId, false);
          }
        }
      }
      place(wx, baseY + trunkH + 2, wz, leafId, false);
    } else {
      const topY = baseY + trunkH;
      for (let dy = -2; dy <= 1; dy++) {
        const r = dy === 1 ? 1 : radius;
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dz !== undefined && dx <= r; dx++) {
            const dist = Math.abs(dx) + Math.abs(dz);
            if (dist > r * 2 - (dy === 1 ? 0 : 1)) continue;
            if (Math.abs(dx) === r && Math.abs(dz) === r && hashCoords3D(wx + dx, topY + dy, wz + dz, 777) > 0.55) continue;
            place(wx + dx, topY + dy, wz + dz, leafId, false);
          }
        }
      }
    }

    for (let dy = 0; dy < trunkH; dy++) {
      place(wx, baseY + dy, wz, logId, true);
    }
  }
}
