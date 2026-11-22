import { CHUNK_HEIGHT, CHUNK_SIZE, MinecraftOverworldSession } from './mcOverworld';
import { BiomeId } from './types';

export interface WorldGenWorkerRequest {
  id: number;
  seedInt64: string;
  cx: number;
  cz: number;
}

export interface WorldGenWorkerResponse {
  id: number;
  cx: number;
  cz: number;
  blocksBuffer: ArrayBuffer;
  biomeMap: BiomeId[];
  error?: string;
}

let cachedSeed = '';
let cachedSession: MinecraftOverworldSession | null = null;

self.onmessage = (e: MessageEvent<WorldGenWorkerRequest>) => {
  const { id, seedInt64, cx, cz } = e.data;
  try {
    if (!cachedSession || cachedSeed !== seedInt64) {
      cachedSession = new MinecraftOverworldSession(BigInt(seedInt64));
      cachedSeed = seedInt64;
    }

    const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    const biomeMap: BiomeId[] = new Array(CHUNK_SIZE * CHUNK_SIZE);
    cachedSession.generateChunk(cx, cz, blocks, biomeMap);

    const response: WorldGenWorkerResponse = {
      id,
      cx,
      cz,
      blocksBuffer: blocks.buffer,
      biomeMap,
    };
    (self as unknown as Worker).postMessage(response, [blocks.buffer]);
  } catch (err) {
    const response: WorldGenWorkerResponse = {
      id,
      cx,
      cz,
      blocksBuffer: new ArrayBuffer(0),
      biomeMap: [],
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
};
