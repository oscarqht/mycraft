import * as THREE from 'three';
import { BLOCK_BY_ID, BLOCK_ID } from './blocks';
import { hashCoords2D } from './noise';

export const ATLAS_GRID = 16; // 16x16 tiles = 256 slots
export const TILE_PX = 16;
export const ATLAS_PX = ATLAS_GRID * TILE_PX; // 256x256

export interface UVRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

class AtlasRegistry {
  public readonly canvas: HTMLCanvasElement;
  public readonly ctx: CanvasRenderingContext2D;
  public readonly texture: THREE.CanvasTexture;
  public readonly crackTextures: THREE.CanvasTexture[] = [];
  private slotByName = new Map<string, number>();
  private uvByName = new Map<string, UVRect>();
  private iconCache = new Map<number, string>();
  private nextSlot = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_PX;
    this.canvas.height = ATLAS_PX;
    const ctx = this.canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;

    this.generateAllTextures();

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;

    this.generateCrackTextures();
  }

  public getUV(name: string): UVRect {
    return this.uvByName.get(name) ?? this.uvByName.get('stone')!;
  }

  public getTileCoords(name: string): { gx: number; gy: number } {
    const slot = this.slotByName.get(name) ?? 0;
    return { gx: slot % ATLAS_GRID, gy: Math.floor(slot / ATLAS_GRID) };
  }

  private allocTile(name: string, draw: (px: (x: number, y: number, c: string) => void, rect: (x: number, y: number, w: number, h: number, c: string) => void) => void) {
    if (this.slotByName.has(name)) return;
    const slot = this.nextSlot++;
    this.slotByName.set(name, slot);
    const gx = slot % ATLAS_GRID;
    const gy = Math.floor(slot / ATLAS_GRID);
    const ox = gx * TILE_PX;
    const oy = gy * TILE_PX;

    const px = (x: number, y: number, color: string) => {
      if (x < 0 || x >= 16 || y < 0 || y >= 16) return;
      this.ctx.fillStyle = color;
      this.ctx.fillRect(ox + x, oy + y, 1, 1);
    };
    const rect = (x: number, y: number, w: number, h: number, color: string) => {
      this.ctx.fillStyle = color;
      this.ctx.fillRect(ox + x, oy + y, w, h);
    };

    draw(px, rect);

    // Three.js UV origin (0,0) is bottom-left; canvas (0,0) is top-left
    const eps = 0.0008;
    const u0 = gx / ATLAS_GRID + eps;
    const u1 = (gx + 1) / ATLAS_GRID - eps;
    const v1 = 1 - gy / ATLAS_GRID - eps;
    const v0 = 1 - (gy + 1) / ATLAS_GRID + eps;
    this.uvByName.set(name, { u0, v0, u1, v1 });
  }

  private noiseTile(name: string, palette: string[], seed: number) {
    this.allocTile(name, (px) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const n = hashCoords2D(x, y, seed);
          const idx = Math.min(palette.length - 1, Math.floor(n * palette.length));
          px(x, y, palette[idx]);
        }
      }
    });
  }

  private oreTile(name: string, basePalette: string[], oreColors: string[], seed: number) {
    this.allocTile(name, (px) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const n = hashCoords2D(x, y, seed);
          px(x, y, basePalette[Math.floor(n * basePalette.length)]);
        }
      }
      // Classic ore cluster speckles
      const spots = [
        [3, 3], [4, 3], [3, 4],
        [10, 4], [11, 4], [11, 5],
        [6, 8], [7, 8], [6, 9], [7, 9],
        [12, 11], [13, 11], [12, 12],
        [3, 12], [4, 12], [4, 13],
      ];
      spots.forEach(([sx, sy], i) => {
        const jx = (sx + Math.floor(hashCoords2D(i, 1, seed) * 2)) & 15;
        const jy = (sy + Math.floor(hashCoords2D(i, 2, seed) * 2)) & 15;
        px(jx, jy, oreColors[i % oreColors.length]);
      });
    });
  }

  private planksTile(name: string, tones: [string, string, string, string], seed: number) {
    this.allocTile(name, (px, rect) => {
      for (let y = 0; y < 16; y++) {
        const isSeam = y === 0 || y === 4 || y === 8 || y === 12;
        for (let x = 0; x < 16; x++) {
          if (isSeam) {
            px(x, y, tones[0]);
          } else {
            const v = hashCoords2D(x, y, seed);
            const c = v < 0.2 ? tones[1] : v < 0.72 ? tones[2] : tones[3];
            px(x, y, c);
          }
        }
      }
      rect(7, 1, 1, 3, tones[0]);
      rect(14, 5, 1, 3, tones[0]);
      rect(4, 9, 1, 3, tones[0]);
      rect(11, 13, 1, 3, tones[0]);
    });
  }

  private logTiles(prefix: string, bark: [string, string, string], ring: [string, string, string], seed: number, isBirch = false) {
    this.allocTile(`${prefix}_side`, (px) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          if (isBirch) {
            const stripe = hashCoords2D(Math.floor(x / 3), y, seed) > 0.84;
            px(x, y, stripe ? bark[0] : hashCoords2D(x, y, seed) > 0.4 ? bark[1] : bark[2]);
          } else {
            const streak = hashCoords2D(x, Math.floor(y / 3), seed);
            px(x, y, streak < 0.3 ? bark[0] : streak < 0.75 ? bark[1] : bark[2]);
          }
        }
      }
    });
    this.allocTile(`${prefix}_top`, (px, rect) => {
      rect(0, 0, 16, 16, bark[0]);
      rect(1, 1, 14, 14, ring[2]);
      rect(2, 2, 12, 12, ring[1]);
      rect(4, 4, 8, 8, ring[0]);
      rect(6, 6, 4, 4, ring[1]);
      px(7, 7, ring[0]);
      px(8, 8, ring[0]);
    });
  }

  private leavesTile(name: string, colors: [string, string, string], seed: number) {
    this.allocTile(name, (px) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const n = hashCoords2D(x, y, seed);
          if (n < 0.24) continue; // Transparent alpha cutout gaps
          px(x, y, n < 0.5 ? colors[0] : n < 0.8 ? colors[1] : colors[2]);
        }
      }
    });
  }

  private mineralBlockTile(name: string, edge: string, mid: string, light: string, shine: string) {
    this.allocTile(name, (px, rect) => {
      rect(0, 0, 16, 16, edge);
      rect(1, 1, 14, 14, mid);
      rect(2, 2, 12, 12, light);
      rect(3, 3, 4, 2, shine);
      px(3, 5, shine);
      rect(10, 10, 3, 3, mid);
    });
  }

  private concreteTile(name: string, base: string, speckle: string, seed: number) {
    this.allocTile(name, (px) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          px(x, y, hashCoords2D(x, y, seed) > 0.82 ? speckle : base);
        }
      }
    });
  }

  private woolTile(name: string, c1: string, c2: string, c3: string, seed: number) {
    this.allocTile(name, (px) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const n = hashCoords2D(x, y, seed);
          const weave = ((x + y) % 3 === 0) ? 0.15 : 0;
          const v = n + weave;
          px(x, y, v < 0.35 ? c1 : v < 0.75 ? c2 : c3);
        }
      }
    });
  }

  private bricksTile(name: string, mortar: string, b1: string, b2: string, seed: number) {
    this.allocTile(name, (px, rect) => {
      rect(0, 0, 16, 16, mortar);
      for (let row = 0; row < 4; row++) {
        const y = row * 4;
        const offset = (row % 2) * 4;
        for (let col = -1; col < 3; col++) {
          const x = col * 8 + offset;
          for (let dy = 0; dy < 3; dy++) {
            for (let dx = 0; dx < 7; dx++) {
              const cx = x + dx;
              const cy = y + dy;
              if (cx >= 0 && cx < 16) {
                px(cx, cy, hashCoords2D(cx, cy, seed + row) > 0.45 ? b1 : b2);
              }
            }
          }
        }
      }
    });
  }

  private toolTile(name: string, kind: 'pickaxe' | 'axe' | 'shovel', headDark: string, headLight: string) {
    this.allocTile(name, (px) => {
      const wood = '#7c532c';
      const woodDark = '#543519';
      // Diagonal handle from (2,13) to (11,4)
      for (let i = 0; i < 10; i++) {
        px(2 + i, 13 - i, i % 2 === 0 ? wood : woodDark);
      }
      if (kind === 'pickaxe') {
        const head = [
          [6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [11, 3], [12, 4], [13, 5], [13, 6], [13, 7], [13, 8], [13, 9],
          [5, 3], [12, 3], [12, 10],
        ];
        head.forEach(([x, y], idx) => px(x, y, idx % 3 === 0 ? headLight : headDark));
        px(11, 4, headLight);
        px(10, 3, headLight);
      } else if (kind === 'axe') {
        const blade = [
          [8, 2], [9, 2], [10, 2], [11, 2],
          [7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [12, 3],
          [8, 4], [9, 4], [10, 4], [11, 4], [12, 4], [13, 4],
          [10, 5], [11, 5], [12, 5], [13, 5],
          [11, 6], [12, 6],
        ];
        blade.forEach(([x, y], idx) => px(x, y, idx % 2 === 0 ? headLight : headDark));
      } else {
        const scoop = [
          [11, 1], [12, 1], [13, 1],
          [10, 2], [11, 2], [12, 2], [13, 2], [14, 2],
          [10, 3], [11, 3], [12, 3], [13, 3], [14, 3],
          [11, 4], [12, 4], [13, 4],
          [11, 5], [12, 5],
        ];
        scoop.forEach(([x, y], idx) => px(x, y, idx % 2 === 0 ? headLight : headDark));
      }
    });
  }

  private generateAllTextures() {
    // 1. Stone & Dirt base palettes
    const stonePal = ['#7d7d7d', '#737373', '#878787', '#6b6b6b'];
    const deepPal = ['#48484f', '#3f3f46', '#52525b', '#38383e'];
    const dirtPal = ['#866043', '#79553a', '#916a4b', '#6d4c33'];

    // Grass & Terrain
    this.noiseTile('grass_top', ['#b8b8b8', '#c8c8c8', '#d6d6d6', '#a8a8a8'], 101); // Neutral grayscale for biome vertex tint!
    this.allocTile('grass_side', (px) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const fringe = 3 + (hashCoords2D(x, 0, 102) > 0.5 ? 1 : 0) + (x % 3 === 0 ? 1 : 0);
          if (y < fringe) {
            px(x, y, hashCoords2D(x, y, 103) > 0.45 ? '#6ab04c' : '#569c3c');
          } else {
            px(x, y, dirtPal[Math.floor(hashCoords2D(x, y, 104) * dirtPal.length)]);
          }
        }
      }
    });
    this.noiseTile('dirt', dirtPal, 105);
    this.noiseTile('coarse_dirt', ['#775338', '#68472e', '#8b6344', '#5c402b'], 106);
    this.noiseTile('podzol_top', ['#6c4727', '#5a3a1e', '#7e5531', '#4d3219'], 107);
    this.allocTile('podzol_side', (px) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          if (y < 3 + (x % 2)) px(x, y, hashCoords2D(x, y, 108) > 0.5 ? '#6c4727' : '#58371c');
          else px(x, y, dirtPal[Math.floor(hashCoords2D(x, y, 109) * dirtPal.length)]);
        }
      }
    });
    this.noiseTile('mycelium_top', ['#786375', '#877284', '#695766', '#948192'], 110);
    this.allocTile('mycelium_side', (px) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          if (y < 3 + (x % 3 === 0 ? 1 : 0)) px(x, y, '#7b6679');
          else px(x, y, dirtPal[Math.floor(hashCoords2D(x, y, 111) * dirtPal.length)]);
        }
      }
    });

    this.noiseTile('sand', ['#e3d9a8', '#dbd09d', '#ece2b5', '#cfc492'], 112);
    this.noiseTile('red_sand', ['#c26925', '#b55e1c', '#d0742d', '#a55215'], 113);
    this.noiseTile('gravel', ['#85807f', '#747070', '#969190', '#656262'], 114);
    this.noiseTile('clay', ['#9da3b0', '#9197a4', '#aab0bd', '#878d99'], 115);
    this.noiseTile('mud', ['#3c383d', '#332f34', '#464147', '#2b282c'], 116);
    this.noiseTile('snow_block', ['#f1f5f9', '#e8eef5', '#ffffff', '#dde7f0'], 117);
    this.noiseTile('ice', ['#9bc2ff', '#8ab4fc', '#acd0ff', '#7fa8f5'], 118);
    this.noiseTile('packed_ice', ['#8ab3f5', '#7ca7ec', '#9ac0fa', '#729de3'], 119);
    this.noiseTile('blue_ice', ['#6da2ff', '#5c93f8', '#81b0ff', '#4b83ec'], 120);

    this.allocTile('water', (px) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const wave = Math.sin((x + y * 0.5) * 0.7) > 0.55;
          px(x, y, wave ? 'rgba(130, 195, 255, 0.85)' : 'rgba(65, 135, 235, 0.82)');
        }
      }
    });
    this.allocTile('lava', (px) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const n = hashCoords2D(x, y, 122);
          px(x, y, n < 0.2 ? '#fef08a' : n < 0.55 ? '#f97316' : n < 0.85 ? '#ea580c' : '#b91c1c');
        }
      }
    });

    // Stone & Underground
    this.noiseTile('stone', stonePal, 201);
    this.noiseTile('cobblestone', ['#636363', '#7a7a7a', '#525252', '#8c8c8c'], 202);
    this.allocTile('mossy_cobblestone', (px) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const m = hashCoords2D(x, y, 203);
          if (m > 0.68) px(x, y, m > 0.84 ? '#4d7c3f' : '#5e8c4c');
          else px(x, y, m < 0.2 ? '#595959' : m < 0.45 ? '#757575' : '#858585');
        }
      }
    });
    this.allocTile('smooth_stone', (px, rect) => {
      rect(0, 0, 16, 16, '#9c9c9c');
      rect(0, 0, 16, 1, '#b5b5b5');
      rect(0, 15, 16, 1, '#787878');
      for (let i = 0; i < 16; i++) px(i, 7, '#8f8f8f');
    });
    this.noiseTile('granite', ['#9b6b59', '#8a5d4c', '#ac7b68', '#784e3f'], 205);
    this.mineralBlockTile('polished_granite', '#7a4f40', '#9b6b59', '#aa7966', '#ba8a78');
    this.noiseTile('diorite', ['#cfcfcf', '#bdbdbd', '#e2e2e2', '#9e9e9e'], 206);
    this.mineralBlockTile('polished_diorite', '#a8a8a8', '#cfcfcf', '#dedede', '#ececec');
    this.noiseTile('andesite', ['#87898a', '#787a7b', '#969899', '#6c6e6f'], 207);
    this.mineralBlockTile('polished_andesite', '#6e7071', '#87898a', '#959798', '#a4a6a7');
    this.noiseTile('deepslate_top', deepPal, 208);
    this.noiseTile('deepslate_side', ['#46464e', '#3c3c44', '#505059', '#34343c'], 209);
    this.noiseTile('cobbled_deepslate', ['#38383f', '#4e4e56', '#2e2e34', '#5c5c64'], 210);
    this.noiseTile('tuff', ['#6d6e67', '#5e5f59', '#7b7c74', '#52534d'], 211);
    this.noiseTile('calcite', ['#e3e3de', '#d5d5cf', '#efefef', '#c9c9c2'], 212);
    this.noiseTile('basalt_top', ['#52525b', '#414149', '#64646e', '#35353c'], 213);
    this.allocTile('basalt_side', (px) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const s = hashCoords2D(x, Math.floor(y / 3), 214);
          px(x, y, s < 0.3 ? '#3a3a42' : s < 0.7 ? '#4d4d57' : '#5e5e68');
        }
      }
    });
    this.noiseTile('obsidian', ['#130d1f', '#1d1430', '#2b1e45', '#0b0712'], 215);
    this.noiseTile('bedrock', ['#1c1c1c', '#383838', '#4f4f4f', '#262626'], 216);

    // Ores
    this.oreTile('coal_ore', stonePal, ['#1e1e1e', '#2d2d2d', '#141414'], 301);
    this.oreTile('iron_ore', stonePal, ['#d8af93', '#bf9276', '#e6c6af'], 302);
    this.oreTile('gold_ore', stonePal, ['#facc15', '#eab308', '#fef08a'], 303);
    this.oreTile('copper_ore', stonePal, ['#d97757', '#c26040', '#5eead4'], 304);
    this.oreTile('redstone_ore', stonePal, ['#ef4444', '#dc2626', '#fca5a5'], 305);
    this.oreTile('lapis_ore', stonePal, ['#2563eb', '#1d4ed8', '#60a5fa'], 306);
    this.oreTile('emerald_ore', stonePal, ['#10b981', '#059669', '#6ee7b7'], 307);
    this.oreTile('diamond_ore', stonePal, ['#38bdf8', '#0ea5e9', '#a5f3fc'], 308);
    this.oreTile('deepslate_coal_ore', deepPal, ['#18181b', '#27272a', '#09090b'], 309);
    this.oreTile('deepslate_iron_ore', deepPal, ['#d8af93', '#bf9276', '#e6c6af'], 310);
    this.oreTile('deepslate_gold_ore', deepPal, ['#facc15', '#eab308', '#fef08a'], 311);
    this.oreTile('deepslate_diamond_ore', deepPal, ['#38bdf8', '#0ea5e9', '#a5f3fc'], 312);

    this.mineralBlockTile('coal_block', '#151518', '#1f1f24', '#2a2a30', '#383840');
    this.mineralBlockTile('iron_block', '#a8a8a8', '#d4d4d8', '#e4e4e7', '#ffffff');
    this.mineralBlockTile('gold_block', '#ca8a04', '#eab308', '#facc15', '#fef08a');
    this.mineralBlockTile('copper_block', '#9a4c32', '#c86a47', '#dc7d58', '#f09c7c');
    this.mineralBlockTile('diamond_block', '#0284c7', '#38bdf8', '#7dd3fc', '#e0f2fe');
    this.mineralBlockTile('emerald_block', '#047857', '#10b981', '#34d399', '#a7f3d0');
    this.mineralBlockTile('lapis_block', '#1e3a8a', '#1d4ed8', '#2563eb', '#60a5fa');
    this.mineralBlockTile('redstone_block', '#7f1d1d', '#b91c1c', '#dc2626', '#f87171');

    // Wood & Foliage
    this.logTiles('oak_log', ['#563e24', '#6d5030', '#7e5e39'], ['#9a7446', '#b38953', '#cfa46c'], 401);
    this.logTiles('birch_log', ['#2a2a28', '#e5e3da', '#d4d1c7'], ['#b49d6e', '#cdb684', '#dfc99b'], 402, true);
    this.logTiles('spruce_log', ['#2d1d10', '#412b19', '#523721'], ['#785735', '#8c6841', '#a0784e'], 403);
    this.logTiles('jungle_log', ['#4d3d24', '#624f31', '#735e3c'], ['#8f6944', '#a87e53', '#bd9266'], 404);
    this.logTiles('acacia_log', ['#544f48', '#6b655c', '#7a7369'], ['#9e512e', '#b76037', '#cc7347'], 405);
    this.logTiles('dark_oak_log', ['#261a0e', '#372616', '#46311d'], ['#593c21', '#6e4b2b', '#825a35'], 406);

    this.planksTile('oak_planks', ['#7f5e35', '#967042', '#b38953', '#c29861'], 411);
    this.planksTile('birch_planks', ['#a89765', '#c0ae78', '#d4c38e', '#e1d19e'], 412);
    this.planksTile('spruce_planks', ['#523921', '#64472b', '#765535', '#856240'], 413);
    this.planksTile('jungle_planks', ['#7a5538', '#916746', '#aa7c57', '#ba8b66'], 414);
    this.planksTile('acacia_planks', ['#8a4624', '#a2542d', '#ba6337', '#ca7347'], 415);
    this.planksTile('dark_oak_planks', ['#2f1e0f', '#3d2815', '#4c331c', '#5b3e23'], 416);

    this.leavesTile('oak_leaves', ['#989898', '#b5b5b5', '#d0d0d0'], 421);
    this.leavesTile('birch_leaves', ['#a6b29a', '#bac6ae', '#cdd8c0'], 422);
    this.leavesTile('spruce_leaves', ['#2b4c33', '#365e3f', '#42704c'], 423);
    this.leavesTile('jungle_leaves', ['#8fb888', '#a6cf9f', '#bee3b8'], 424);
    this.leavesTile('acacia_leaves', ['#9da88c', '#b4bf9f', '#c8d2b4'], 425);
    this.leavesTile('dark_oak_leaves', ['#879982', '#9db097', '#b2c5ac'], 426);

    this.allocTile('cactus_top', (px, rect) => {
      rect(0, 0, 16, 16, '#488832');
      rect(2, 2, 12, 12, '#5ba142');
      rect(5, 5, 6, 6, '#71b956');
      px(3, 3, '#2d5c1e');
      px(12, 3, '#2d5c1e');
    });
    this.allocTile('cactus_side', (px) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          if (x === 0 || x === 15) continue;
          const rib = x % 4 === 0;
          px(x, y, rib ? '#386f25' : hashCoords2D(x, y, 430) > 0.7 ? '#63a84a' : '#4f9137');
          if ((x === 2 || x === 13) && y % 4 === 1) px(x, y, '#d9e3b5');
        }
      }
    });

    this.allocTile('bamboo', (px, rect) => {
      rect(6, 0, 4, 16, '#64a32e');
      rect(7, 0, 1, 16, '#82c446');
      rect(5, 4, 6, 1, '#4c8020');
      rect(5, 11, 6, 1, '#4c8020');
      px(4, 3, '#72b838');
      px(10, 9, '#72b838');
    });
    this.allocTile('sugar_cane', (px, rect) => {
      rect(3, 0, 2, 16, '#78b84e');
      rect(7, 0, 2, 16, '#8ac95f');
      rect(11, 0, 2, 16, '#6da844');
      rect(2, 5, 12, 1, '#5b9035');
      rect(2, 12, 12, 1, '#5b9035');
    });
    this.allocTile('tall_grass', (px) => {
      for (let x = 2; x < 14; x += 2) {
        const h = 7 + Math.floor(hashCoords2D(x, 1, 440) * 7);
        for (let y = 15; y >= 15 - h; y--) {
          px(x + ((y % 3) === 0 ? 1 : 0), y, y < 7 ? '#d4d4d4' : '#a8a8a8');
        }
      }
    });
    this.allocTile('fern', (px) => {
      for (let y = 4; y < 16; y++) {
        px(7, y, '#9c9c9c');
        px(8, y, '#b8b8b8');
        if (y % 2 === 0 && y < 14) {
          const w = Math.floor((y - 3) * 0.55);
          for (let dx = 1; dx <= w; dx++) {
            px(7 - dx, y, '#c4c4c4');
            px(8 + dx, y, '#c4c4c4');
          }
        }
      }
    });
    this.allocTile('dandelion', (px, rect) => {
      rect(7, 8, 2, 8, '#4f8f34');
      rect(5, 4, 6, 4, '#facc15');
      rect(6, 3, 4, 6, '#fde047');
      px(7, 5, '#eab308');
    });
    this.allocTile('poppy', (px, rect) => {
      rect(7, 7, 2, 9, '#48852e');
      rect(5, 3, 6, 4, '#dc2626');
      rect(6, 2, 4, 6, '#ef4444');
      rect(7, 4, 2, 2, '#1f2937');
    });
    this.allocTile('blue_orchid', (px, rect) => {
      rect(7, 7, 2, 9, '#48852e');
      rect(4, 3, 8, 4, '#38bdf8');
      rect(6, 2, 4, 6, '#7dd3fc');
      px(7, 4, '#fef08a');
    });
    this.allocTile('kelp', (px) => {
      for (let y = 0; y < 16; y++) {
        const sx = 7 + Math.round(Math.sin(y * 0.6) * 2);
        px(sx, y, '#2f6c36');
        px(sx + 1, y, '#3f8446');
        if (y % 3 === 0) px(sx + 2, y, '#4a9852');
      }
    });
    this.allocTile('seagrass', (px) => {
      for (let x = 3; x <= 12; x += 3) {
        const h = 6 + (x % 4);
        for (let y = 15; y >= 15 - h; y--) {
          px(x, y, y < 10 ? '#5bb052' : '#3a843e');
        }
      }
    });

    // Building, Glass & Light
    this.bricksTile('bricks', '#b8b2a6', '#9b4b3d', '#863d31', 501);
    this.bricksTile('stone_bricks', '#5a5a5a', '#7c7c7c', '#707070', 502);
    this.bricksTile('mossy_stone_bricks', '#4c5c46', '#727a6c', '#63765b', 503);
    this.bricksTile('cracked_stone_bricks', '#3e3e3e', '#747474', '#666666', 504);

    this.noiseTile('sandstone_top', ['#dfd39e', '#d6ca94', '#eae0ae'], 505);
    this.noiseTile('sandstone_bottom', ['#c9bc86', '#bfb27c', '#d5c894'], 506);
    this.allocTile('sandstone_side', (px, rect) => {
      rect(0, 0, 16, 16, '#dbd09b');
      rect(0, 3, 16, 1, '#c8bc85');
      rect(0, 10, 16, 1, '#c8bc85');
      for (let x = 0; x < 16; x++) px(x, 0, '#e5dab0');
    });
    this.allocTile('cut_sandstone', (px, rect) => {
      rect(0, 0, 16, 16, '#e2d6a4');
      rect(0, 0, 16, 2, '#eee4b8');
      rect(0, 8, 16, 1, '#c8bc85');
      rect(8, 0, 1, 16, '#c8bc85');
    });
    this.noiseTile('red_sandstone_top', ['#b85e20', '#ab541a', '#c66a2a'], 507);
    this.allocTile('red_sandstone_side', (px, rect) => {
      rect(0, 0, 16, 16, '#b85e20');
      rect(0, 3, 16, 1, '#9e4c16');
      rect(0, 10, 16, 1, '#9e4c16');
      px(0, 0, '#c66a2a');
    });

    this.noiseTile('terracotta', ['#9a5d45', '#8e533c', '#a3654c'], 510);
    this.noiseTile('red_terracotta', ['#8f3d2e', '#833426', '#9b4536'], 511);
    this.noiseTile('orange_terracotta', ['#a35527', '#944b20', '#b05f2f'], 512);
    this.noiseTile('yellow_terracotta', ['#bb8624', '#ad7a1c', '#c79230'], 513);

    this.concreteTile('white_concrete', '#cfd5d6', '#c5cbcc', 520);
    this.concreteTile('red_concrete', '#8e2121', '#821c1c', 521);
    this.concreteTile('blue_concrete', '#2d2f8f', '#272982', 522);
    this.concreteTile('yellow_concrete', '#f1af15', '#e4a40f', 523);
    this.concreteTile('green_concrete', '#495b24', '#3f501e', 524);

    this.allocTile('glass', (px, rect) => {
      rect(0, 0, 16, 1, '#bae6fd');
      rect(0, 15, 16, 1, '#bae6fd');
      rect(0, 0, 1, 16, '#bae6fd');
      rect(15, 0, 1, 16, '#bae6fd');
      px(3, 3, '#e0f2fe');
      px(4, 2, '#e0f2fe');
      px(2, 4, '#e0f2fe');
      px(11, 12, '#e0f2fe');
      px(12, 11, '#e0f2fe');
    });
    this.allocTile('tinted_glass', (px, rect) => {
      rect(0, 0, 16, 16, 'rgba(42, 36, 66, 0.72)');
      rect(0, 0, 16, 1, '#5b5185');
      rect(0, 15, 16, 1, '#5b5185');
      rect(0, 0, 1, 16, '#5b5185');
      rect(15, 0, 1, 16, '#5b5185');
      px(3, 3, 'rgba(200, 190, 255, 0.5)');
    });
    this.noiseTile('glowstone', ['#f59e0b', '#fbbf24', '#fef08a', '#b45309'], 530);
    this.allocTile('sea_lantern', (px, rect) => {
      rect(0, 0, 16, 16, '#7dd3fc');
      rect(2, 2, 12, 12, '#bae6fd');
      rect(4, 4, 8, 8, '#ecfeff');
      px(0, 0, '#0284c7');
      px(15, 0, '#0284c7');
      px(0, 15, '#0284c7');
      px(15, 15, '#0284c7');
    });
    this.allocTile('torch', (px, rect) => {
      rect(7, 6, 2, 10, '#7c532c');
      rect(6, 2, 4, 4, '#f59e0b');
      rect(7, 1, 2, 4, '#fef08a');
    });
    this.allocTile('pumpkin_top', (px, rect) => {
      rect(0, 0, 16, 16, '#d97706');
      for (let i = 0; i < 16; i += 4) rect(i, 0, 1, 16, '#b45309');
      rect(7, 7, 2, 2, '#6d4c23');
    });
    this.allocTile('pumpkin_side', (px, rect) => {
      rect(0, 0, 16, 16, '#e67e22');
      for (let i = 0; i < 16; i += 4) rect(i, 0, 1, 16, '#b45309');
    });
    this.allocTile('jack_o_lantern_front', (px, rect) => {
      rect(0, 0, 16, 16, '#e67e22');
      for (let i = 0; i < 16; i += 4) rect(i, 0, 1, 16, '#b45309');
      rect(3, 4, 3, 3, '#fef08a');
      rect(10, 4, 3, 3, '#fef08a');
      rect(7, 8, 2, 2, '#fef08a');
      rect(3, 11, 10, 2, '#fef08a');
      px(5, 11, '#b45309');
      px(10, 11, '#b45309');
    });
    this.allocTile('redstone_lamp', (px, rect) => {
      rect(0, 0, 16, 16, '#78350f');
      rect(2, 2, 12, 12, '#d97706');
      rect(4, 4, 8, 8, '#fbbf24');
      rect(6, 6, 4, 4, '#fef08a');
    });
    this.allocTile('bookshelf', (px, rect) => {
      rect(0, 0, 16, 16, '#b38953');
      rect(0, 2, 16, 5, '#2b1d12');
      rect(0, 9, 16, 5, '#2b1d12');
      const bookColors = ['#b91c1c', '#1d4ed8', '#15803d', '#b45309', '#7e22ce'];
      for (let x = 1; x < 15; x += 2) {
        rect(x, 2, 2, 5, bookColors[(x * 3) % bookColors.length]);
        rect(x, 9, 2, 5, bookColors[(x * 7 + 1) % bookColors.length]);
      }
    });

    this.woolTile('white_wool', '#dcdedf', '#eceeef', '#f8fafc', 540);
    this.woolTile('red_wool', '#8b1f1b', '#a62a24', '#bf3730', 541);
    this.woolTile('blue_wool', '#2b2f84', '#383d9e', '#484eb5', 542);
    this.woolTile('green_wool', '#475c17', '#587020', '#698429', 543);
    this.woolTile('yellow_wool', '#dcae1b', '#f2c329', '#fbd54d', 544);
    this.woolTile('black_wool', '#141418', '#1f1f24', '#2b2b32', 545);

    // Utility & Dimensions
    this.allocTile('crafting_table_top', (px, rect) => {
      rect(0, 0, 16, 16, '#7f5e35');
      rect(1, 1, 14, 14, '#b38953');
      for (let i = 1; i <= 14; i += 4) {
        rect(i, 1, 1, 14, '#563e24');
        rect(1, i, 14, 1, '#563e24');
      }
    });
    this.allocTile('crafting_table_side', (px, rect) => {
      rect(0, 0, 16, 16, '#b38953');
      rect(0, 0, 16, 3, '#7f5e35');
      rect(3, 5, 4, 7, '#64748b');
      rect(9, 6, 3, 6, '#334155');
    });
    this.allocTile('crafting_table_front', (px, rect) => {
      rect(0, 0, 16, 16, '#b38953');
      rect(0, 0, 16, 3, '#7f5e35');
      rect(3, 5, 3, 9, '#94a3b8');
      rect(9, 5, 4, 9, '#64748b');
    });
    this.noiseTile('furnace_top', ['#686868', '#787878', '#5c5c5c'], 601);
    this.allocTile('furnace_side', (px, rect) => {
      rect(0, 0, 16, 16, '#737373');
      rect(0, 7, 16, 1, '#525252');
      rect(0, 14, 16, 2, '#525252');
    });
    this.allocTile('furnace_front', (px, rect) => {
      rect(0, 0, 16, 16, '#737373');
      rect(3, 2, 10, 4, '#262626');
      rect(4, 9, 8, 5, '#171717');
      rect(5, 11, 6, 2, '#f97316');
    });
    this.allocTile('chest_top', (px, rect) => {
      rect(0, 0, 16, 16, '#7c5328');
      rect(1, 1, 14, 14, '#a67438');
      rect(2, 2, 12, 12, '#b98646');
    });
    this.allocTile('chest_side', (px, rect) => {
      rect(0, 0, 16, 16, '#7c5328');
      rect(1, 1, 14, 14, '#a67438');
      rect(0, 5, 16, 1, '#4a3116');
    });
    this.allocTile('chest_front', (px, rect) => {
      rect(0, 0, 16, 16, '#7c5328');
      rect(1, 1, 14, 14, '#a67438');
      rect(0, 5, 16, 1, '#4a3116');
      rect(6, 4, 4, 3, '#cbd5e1');
    });
    this.allocTile('tnt_top', (px, rect) => {
      rect(0, 0, 16, 16, '#7c5328');
      rect(2, 2, 12, 12, '#dc2626');
      rect(4, 4, 8, 8, '#475569');
      rect(7, 7, 2, 2, '#e2e8f0');
    });
    this.allocTile('tnt_bottom', (px, rect) => {
      rect(0, 0, 16, 16, '#991b1b');
      rect(2, 2, 12, 12, '#dc2626');
    });
    this.allocTile('tnt_side', (px, rect) => {
      rect(0, 0, 16, 16, '#dc2626');
      rect(0, 5, 16, 6, '#f1f5f9');
      // Pixel "TNT"
      rect(2, 6, 3, 1, '#0f172a');
      rect(3, 6, 1, 4, '#0f172a');
      rect(7, 6, 1, 4, '#0f172a');
      px(8, 7, '#0f172a');
      rect(9, 6, 1, 4, '#0f172a');
      rect(11, 6, 3, 1, '#0f172a');
      rect(12, 6, 1, 4, '#0f172a');
    });
    this.noiseTile('sponge', ['#c7c442', '#b5b233', '#d9d655', '#8c8922'], 610);
    this.allocTile('hay_bale_top', (px, rect) => {
      rect(0, 0, 16, 16, '#ca9f2c');
      for (let y = 0; y < 16; y += 2) rect(0, y, 16, 1, '#b0861c');
    });
    this.allocTile('hay_bale_side', (px, rect) => {
      rect(0, 0, 16, 16, '#ca9f2c');
      rect(0, 4, 16, 2, '#991b1b');
      rect(0, 11, 16, 2, '#991b1b');
    });
    this.allocTile('melon_top', (px, rect) => {
      rect(0, 0, 16, 16, '#659e28');
      for (let i = 0; i < 16; i += 4) rect(i, 0, 1, 16, '#487619');
    });
    this.allocTile('melon_side', (px, rect) => {
      rect(0, 0, 16, 16, '#78b535');
      for (let i = 0; i < 16; i += 4) rect(i, 0, 2, 16, '#4e7d1d');
    });

    this.noiseTile('netherrack', ['#6e2b2b', '#571f1f', '#823636', '#451717'], 620);
    this.noiseTile('soul_sand', ['#534034', '#413127', '#644d3e', '#33261d'], 621);
    this.bricksTile('nether_bricks', '#210d11', '#381920', '#2d1319', 622);
    this.mineralBlockTile('quartz_block', '#d6cfc4', '#ebe6dd', '#f5f2ec', '#ffffff');
    this.noiseTile('end_stone', ['#dedda5', '#cecd93', '#ecebb8', '#b8b77e'], 623);
    this.bricksTile('end_stone_bricks', '#b8b77e', '#dedda5', '#d0cf96', 624);
    this.bricksTile('purpur_block', '#825782', '#a878a8', '#986998', 625);
    this.noiseTile('prismarine', ['#5a9e93', '#49867c', '#6fb5aa', '#3e736b'], 626);
    this.bricksTile('dark_prismarine', '#1f3b35', '#345e55', '#2a4f47', 627);

    // Tools & Items
    this.toolTile('wooden_pickaxe', 'pickaxe', '#8d6639', '#b38953');
    this.toolTile('stone_pickaxe', 'pickaxe', '#737373', '#9e9e9e');
    this.toolTile('iron_pickaxe', 'pickaxe', '#cbd5e1', '#f8fafc');
    this.toolTile('diamond_pickaxe', 'pickaxe', '#0284c7', '#67e8f9');

    this.toolTile('wooden_axe', 'axe', '#8d6639', '#b38953');
    this.toolTile('stone_axe', 'axe', '#737373', '#9e9e9e');
    this.toolTile('iron_axe', 'axe', '#cbd5e1', '#f8fafc');
    this.toolTile('diamond_axe', 'axe', '#0284c7', '#67e8f9');

    this.toolTile('wooden_shovel', 'shovel', '#8d6639', '#b38953');
    this.toolTile('stone_shovel', 'shovel', '#737373', '#9e9e9e');
    this.toolTile('iron_shovel', 'shovel', '#cbd5e1', '#f8fafc');
    this.toolTile('diamond_shovel', 'shovel', '#0284c7', '#67e8f9');

    this.allocTile('stick', (px) => {
      for (let i = 0; i < 11; i++) px(3 + i, 12 - i, i % 2 === 0 ? '#7c532c' : '#a67438');
    });
    this.allocTile('coal', (px, rect) => {
      rect(4, 4, 8, 8, '#1e1e22');
      rect(5, 3, 6, 10, '#2b2b30');
      px(6, 5, '#4b4b54');
    });
    const ingot = (name: string, dark: string, mid: string, light: string) => {
      this.allocTile(name, (px, rect) => {
        rect(3, 6, 10, 5, dark);
        rect(4, 5, 8, 4, mid);
        rect(5, 6, 6, 2, light);
      });
    };
    ingot('iron_ingot', '#94a3b8', '#cbd5e1', '#f8fafc');
    ingot('gold_ingot', '#b45309', '#eab308', '#fef08a');
    ingot('copper_ingot', '#9a4c32', '#d97757', '#f0a58b');

    this.allocTile('diamond', (px, rect) => {
      rect(5, 3, 6, 10, '#0284c7');
      rect(4, 5, 8, 6, '#38bdf8');
      rect(6, 5, 4, 4, '#a5f3fc');
    });
    this.allocTile('emerald', (px, rect) => {
      rect(5, 3, 6, 10, '#047857');
      rect(4, 5, 8, 6, '#10b981');
      rect(6, 5, 3, 4, '#a7f3d0');
    });
    this.allocTile('redstone', (px, rect) => {
      rect(5, 6, 6, 5, '#991b1b');
      rect(4, 8, 8, 4, '#ef4444');
      px(7, 7, '#fca5a5');
    });
    this.allocTile('lapis_lazuli', (px, rect) => {
      rect(5, 4, 6, 8, '#1e3a8a');
      rect(4, 5, 8, 6, '#2563eb');
      px(6, 6, '#93c5fd');
    });
    this.allocTile('raw_iron', (px, rect) => {
      rect(4, 5, 8, 6, '#a88367');
      rect(5, 4, 5, 5, '#d6b497');
      px(6, 6, '#f1dcc8');
    });
    this.allocTile('raw_gold', (px, rect) => {
      rect(4, 5, 8, 6, '#ca8a04');
      rect(5, 4, 5, 5, '#facc15');
      px(6, 6, '#fef08a');
    });
    this.allocTile('raw_copper', (px, rect) => {
      rect(4, 5, 8, 6, '#9a4c32');
      rect(5, 4, 5, 5, '#d97757');
      px(6, 6, '#5eead4');
    });
    this.allocTile('apple', (px, rect) => {
      rect(7, 2, 2, 2, '#7c532c');
      rect(4, 4, 8, 8, '#dc2626');
      rect(5, 11, 6, 2, '#b91c1c');
      px(6, 6, '#fca5a5');
    });
    this.allocTile('bread', (px, rect) => {
      rect(3, 6, 10, 5, '#b45309');
      rect(4, 5, 8, 4, '#d97706');
      px(6, 6, '#fbbf24');
      px(9, 6, '#fbbf24');
    });
    this.allocTile('melon_slice', (px, rect) => {
      rect(3, 9, 10, 2, '#4d7c0f');
      rect(4, 6, 8, 3, '#ef4444');
      rect(6, 4, 4, 2, '#ef4444');
      px(6, 7, '#1f2937');
      px(9, 7, '#1f2937');
    });
  }

  private generateCrackTextures() {
    for (let stage = 0; stage < 10; stage++) {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, 16, 16);
      const count = 4 + stage * 5;
      for (let i = 0; i < count; i++) {
        const x = Math.floor(hashCoords2D(i, stage, 900) * 16);
        const y = Math.floor(hashCoords2D(stage, i, 901) * 16);
        ctx.fillStyle = i % 2 === 0 ? 'rgba(0,0,0,0.68)' : 'rgba(255,255,255,0.22)';
        ctx.fillRect(x, y, 1, 1);
        if (stage > 3 && i % 2 === 0) {
          ctx.fillRect((x + 1) & 15, (y + 1) & 15, 1, 1);
        }
      }
      const tex = new THREE.CanvasTexture(c);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      this.crackTextures.push(tex);
    }
  }

  public getItemIcon(id: number): string {
    const cached = this.iconCache.get(id);
    if (cached) return cached;

    const block = BLOCK_BY_ID[id];
    if (!block || id === BLOCK_ID.AIR) return '';

    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    if (block.renderType === 'item' || block.renderType === 'cross' || block.renderType === 'torch') {
      const tileName = block.itemTexture ?? block.faces.side;
      const { gx, gy } = this.getTileCoords(tileName);
      if (block.tintType === 'grass' || block.tintType === 'foliage') {
        ctx.drawImage(this.canvas, gx * 16, gy * 16, 16, 16, 2, 2, 28, 28);
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = block.particleColor;
        ctx.fillRect(2, 2, 28, 28);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(this.canvas, gx * 16, gy * 16, 16, 16, 2, 2, 28, 28);
      } else {
        ctx.drawImage(this.canvas, gx * 16, gy * 16, 16, 16, 2, 2, 28, 28);
      }
    } else {
      // Crisp 3-face isometric voxel icon
      const topTile = this.getTileCoords(block.faces.top);
      const sideTile = this.getTileCoords(block.faces.front ?? block.faces.side);

      // Draw top diamond
      ctx.save();
      ctx.translate(16, 2);
      ctx.transform(0.85, 0.42, -0.85, 0.42, 0, 0);
      ctx.drawImage(this.canvas, topTile.gx * 16, topTile.gy * 16, 16, 16, 0, 0, 16, 16);
      if (block.tintType === 'grass' || block.tintType === 'foliage') {
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = block.particleColor;
        ctx.fillRect(0, 0, 16, 16);
      }
      ctx.restore();

      // Left face
      ctx.save();
      ctx.translate(2.4, 8.7);
      ctx.transform(0.85, 0.42, 0, 1.0, 0, 0);
      ctx.drawImage(this.canvas, sideTile.gx * 16, sideTile.gy * 16, 16, 16, 0, 0, 16, 16);
      if (block.tintType === 'foliage') {
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = block.particleColor;
        ctx.fillRect(0, 0, 16, 16);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(0, 0, 16, 16);
      ctx.restore();

      // Right face
      ctx.save();
      ctx.translate(16, 15.4);
      ctx.transform(0.85, -0.42, 0, 1.0, 0, 0);
      ctx.drawImage(this.canvas, sideTile.gx * 16, sideTile.gy * 16, 16, 16, 0, 0, 16, 16);
      if (block.tintType === 'foliage') {
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = block.particleColor;
        ctx.fillRect(0, 0, 16, 16);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.fillRect(0, 0, 16, 16);
      ctx.restore();
    }

    const url = c.toDataURL();
    this.iconCache.set(id, url);
    return url;
  }
}

let sharedAtlas: AtlasRegistry | null = null;

export function getAtlas(): AtlasRegistry {
  if (!sharedAtlas) {
    sharedAtlas = new AtlasRegistry();
  }
  return sharedAtlas;
}
