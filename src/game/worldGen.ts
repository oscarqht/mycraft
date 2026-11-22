import { ParsedMinecraftSeed, parseMinecraftSeed } from './bedrockSeed';
import {
  BIOME_DISPLAY_NAMES,
  BiomeSample,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  getBiomeTints,
  MAX_Y,
  MIN_Y,
  MinecraftOverworldSession,
  SEA_LEVEL,
} from './mcOverworld';
import { BiomeId } from './types';
import type { WorldGenWorkerRequest, WorldGenWorkerResponse } from './worldGenWorker';

export {
  BIOME_DISPLAY_NAMES,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  getBiomeTints,
  MAX_Y,
  MIN_Y,
  SEA_LEVEL,
};
export type { BiomeSample };

const OCEAN_OR_WATER_BIOMES = new Set<BiomeId>([
  'ocean',
  'deep_ocean',
  'frozen_ocean',
  'deep_frozen_ocean',
  'cold_ocean',
  'deep_cold_ocean',
  'lukewarm_ocean',
  'deep_lukewarm_ocean',
  'warm_ocean',
  'river',
  'frozen_river',
]);

export class WorldGenerator {
  public readonly seedInfo: ParsedMinecraftSeed;
  public readonly seedInt: number;
  private readonly session: MinecraftOverworldSession;
  private workers: Worker[] = [];
  private nextWorker = 0;
  private nextReqId = 1;
  private disposed = false;
  private pending = new Map<
    number,
    {
      resolve: (res: { blocks: Uint8Array; biomeMap: BiomeId[] }) => void;
      reject: (err: Error) => void;
    }
  >();

  constructor(seed: string) {
    this.seedInfo = parseMinecraftSeed(seed);
    this.session = new MinecraftOverworldSession(this.seedInfo.seedBigInt);
    this.seedInt = this.session.seedInt32;
  }

  private ensureWorkers(): boolean {
    if (this.disposed || typeof Worker === 'undefined') return false;
    if (this.workers.length > 0) return true;

    const poolSize = 2;
    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker(new URL('./worldGenWorker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (e: MessageEvent<WorldGenWorkerResponse>) => {
        const msg = e.data;
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        if (msg.error) {
          entry.reject(new Error(msg.error));
        } else {
          entry.resolve({
            blocks: new Uint8Array(msg.blocksBuffer),
            biomeMap: msg.biomeMap,
          });
        }
      };
      worker.onerror = (err) => {
        // Reject nothing silently; allow fallback if needed
        void err;
      };
      this.workers.push(worker);
    }
    return true;
  }

  public sampleColumn(wx: number, wz: number): BiomeSample {
    return this.session.sampleColumn(wx, wz);
  }

  public generateChunk(cx: number, cz: number, blocks: Uint8Array, biomeMap: BiomeId[]): void {
    this.session.generateChunk(cx, cz, blocks, biomeMap);
  }

  public generateChunkAsync(cx: number, cz: number): Promise<{ blocks: Uint8Array; biomeMap: BiomeId[] }> {
    if (this.disposed) {
      return Promise.reject(new Error('WorldGenerator disposed'));
    }

    if (this.ensureWorkers()) {
      const id = this.nextReqId++;
      const worker = this.workers[this.nextWorker];
      this.nextWorker = (this.nextWorker + 1) % this.workers.length;

      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        const req: WorldGenWorkerRequest = {
          id,
          seedInt64: this.seedInfo.displayInt64,
          cx,
          cz,
        };
        worker.postMessage(req);
      });
    }

    // Fallback when Worker API is unavailable
    return new Promise((resolve) => {
      setTimeout(() => {
        const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
        const biomeMap: BiomeId[] = new Array(CHUNK_SIZE * CHUNK_SIZE);
        this.session.generateChunk(cx, cz, blocks, biomeMap);
        resolve({ blocks, biomeMap });
      }, 0);
    });
  }

  public findSafeSpawn(): { x: number; y: number; z: number } {
    // Prefer dry, non-ocean, non-extreme-peak terrain near (0, 0)
    const radii: number[] = [0];
    for (let r = 16; r <= 192; r += 16) radii.push(r);
    for (let r = 240; r <= 560; r += 40) radii.push(r);
    for (let r = 640; r <= 1200; r += 80) radii.push(r);

    for (const r of radii) {
      const steps = r === 0 ? 1 : 12;
      for (let a = 0; a < steps; a++) {
        const angle = (a / steps) * Math.PI * 2;
        const wx = Math.round(Math.cos(angle) * r);
        const wz = Math.round(Math.sin(angle) * r);
        const col = this.sampleColumn(wx, wz);
        if (
          col.height >= SEA_LEVEL + 1 &&
          col.height <= 120 &&
          !OCEAN_OR_WATER_BIOMES.has(col.biome)
        ) {
          return { x: wx + 0.5, y: col.height + 2.5, z: wz + 0.5 };
        }
      }
    }

    const fallback = this.sampleColumn(0, 0);
    return { x: 0.5, y: Math.max(SEA_LEVEL + 3, fallback.height + 3), z: 0.5 };
  }

  public dispose() {
    this.disposed = true;
    for (const entry of this.pending.values()) {
      entry.reject(new Error('WorldGenerator disposed'));
    }
    this.pending.clear();
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers = [];
  }
}
