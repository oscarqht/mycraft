import { GameMode, ItemStack } from './types';

export interface SavedWorldState {
  seed: string;
  mode: GameMode;
  renderDistance: number;
  timeOfDay: number;
  playerPos: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  health: number;
  hunger: number;
  hotbar: (ItemStack | null)[];
  backpack: (ItemStack | null)[];
  selectedHotbar: number;
  deltas: Record<string, [number, number][]>; // chunkKey -> [voxelIndex, blockId][]
  updatedAt: number;
}

const DB_NAME = 'voxelcraft_worlds_v1';
const STORE_NAME = 'worlds';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'seed' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveWorldState(state: SavedWorldState): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(state);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore storage quota / private mode failures gracefully
  }
}

export async function loadWorldState(seed: string): Promise<SavedWorldState | null> {
  try {
    const db = await openDB();
    const res = await new Promise<SavedWorldState | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(seed);
      req.onsuccess = () => resolve((req.result as SavedWorldState) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return res;
  } catch {
    return null;
  }
}

export async function listSavedWorlds(): Promise<SavedWorldState[]> {
  try {
    const db = await openDB();
    const res = await new Promise<SavedWorldState[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as SavedWorldState[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return res.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function deleteSavedWorld(seed: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(seed);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}
