import * as THREE from 'three';
import { getAtlas } from './atlas';
import { BLOCK_ID, getBlock } from './blocks';
import { CHUNK_HEIGHT, CHUNK_SIZE, getBiomeTints, MAX_Y, MIN_Y } from './worldGen';
import { BiomeId } from './types';

export interface ChunkMeshes {
  opaque: THREE.BufferGeometry | null;
  cutout: THREE.BufferGeometry | null;
  fluid: THREE.BufferGeometry | null;
}

interface MeshBuilderBuffers {
  pos: number[];
  norm: number[];
  uv: number[];
  col: number[];
  idx: number[];
}

function createBuffers(): MeshBuilderBuffers {
  return { pos: [], norm: [], uv: [], col: [], idx: [] };
}

function buildGeometry(b: MeshBuilderBuffers): THREE.BufferGeometry | null {
  if (b.idx.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.norm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  geo.setIndex(b.idx);
  geo.computeBoundingSphere();
  return geo;
}

// 6 face definitions: normal, 4 quad vertices (CCW looking from outside), U-axis, V-axis for AO
const FACES = [
  {
    // +Y Top
    dir: [0, 1, 0],
    shade: 1.0,
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, 1],
    uvMap: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    aoSigns: [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ],
  },
  {
    // -Y Bottom
    dir: [0, -1, 0],
    shade: 0.6,
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, 1],
    uvMap: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    aoSigns: [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ],
  },
  {
    // +X East
    dir: [1, 0, 0],
    shade: 0.82,
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
    uAxis: [0, 0, 1],
    vAxis: [0, 1, 0],
    uvMap: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    aoSigns: [
      [1, -1],
      [-1, -1],
      [-1, 1],
      [1, 1],
    ],
  },
  {
    // -X West
    dir: [-1, 0, 0],
    shade: 0.78,
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
    uAxis: [0, 0, 1],
    vAxis: [0, 1, 0],
    uvMap: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    aoSigns: [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ],
  },
  {
    // +Z South
    dir: [0, 0, 1],
    shade: 0.9,
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
    uAxis: [1, 0, 0],
    vAxis: [0, 1, 0],
    uvMap: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    aoSigns: [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ],
  },
  {
    // -Z North
    dir: [0, 0, -1],
    shade: 0.85,
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
    uAxis: [1, 0, 0],
    vAxis: [0, 1, 0],
    uvMap: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    aoSigns: [
      [1, -1],
      [-1, -1],
      [-1, 1],
      [1, 1],
    ],
  },
] as const;

export function meshChunk(
  cx: number,
  cz: number,
  blocks: Uint8Array,
  biomeMap: BiomeId[],
  getNeighborBlock: (wx: number, wy: number, wz: number) => number
): ChunkMeshes {
  const atlas = getAtlas();
  const opaqueBuf = createBuffers();
  const cutoutBuf = createBuffers();
  const fluidBuf = createBuffers();

  const startX = cx * CHUNK_SIZE;
  const startZ = cz * CHUNK_SIZE;

  // Cache biome colors per column in chunk using O(1) biomeMap lookup
  const grassCols: [number, number, number][] = new Array(CHUNK_SIZE * CHUNK_SIZE);
  const leafCols: [number, number, number][] = new Array(CHUNK_SIZE * CHUNK_SIZE);
  const waterCols: [number, number, number][] = new Array(CHUNK_SIZE * CHUNK_SIZE);

  for (let colIdx = 0; colIdx < CHUNK_SIZE * CHUNK_SIZE; colIdx++) {
    const tints = getBiomeTints(biomeMap[colIdx] ?? 'plains');
    grassCols[colIdx] = tints.grassTint;
    leafCols[colIdx] = tints.foliageTint;
    waterCols[colIdx] = tints.waterTint;
  }

  const blockAt = (lx: number, wy: number, lz: number): number => {
    if (wy < MIN_Y || wy >= MAX_Y) return BLOCK_ID.AIR;
    if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
      return blocks[((wy - MIN_Y) * CHUNK_SIZE + lz) * CHUNK_SIZE + lx];
    }
    return getNeighborBlock(startX + lx, wy, startZ + lz);
  };

  const isOpaqueSolid = (lx: number, wy: number, lz: number): boolean => {
    const id = blockAt(lx, wy, lz);
    if (id === BLOCK_ID.AIR) return false;
    return !getBlock(id).transparent;
  };

  for (let iy = 0; iy < CHUNK_HEIGHT; iy++) {
    const y = iy + MIN_Y;
    const rowBase = iy * CHUNK_SIZE * CHUNK_SIZE;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const id = blocks[rowBase + lz * CHUNK_SIZE + lx];
        if (id === BLOCK_ID.AIR) continue;

        const block = getBlock(id);
        const colIdx = lz * CHUNK_SIZE + lx;
        let tintR = 1;
        let tintG = 1;
        let tintB = 1;

        if (block.tintType === 'grass') {
          [tintR, tintG, tintB] = grassCols[colIdx];
        } else if (block.tintType === 'foliage') {
          [tintR, tintG, tintB] = leafCols[colIdx];
        } else if (block.tintType === 'water') {
          [tintR, tintG, tintB] = waterCols[colIdx];
        }

        // Cross-billboard plants (grass, flowers, kelp, bamboo, sugar cane)
        if (block.renderType === 'cross') {
          const uv = atlas.getUV(block.faces.side);
          const vStart = cutoutBuf.pos.length / 3;
          const x0 = lx + 0.15;
          const x1 = lx + 0.85;
          const z0 = lz + 0.15;
          const z1 = lz + 0.85;
          const y0 = y;
          const y1 = y + 0.92;

          // 2 intersecting diagonal quads
          const quads = [
            [x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0],
            [x0, y0, z1, x1, y0, z0, x1, y1, z0, x0, y1, z1],
          ];
          for (let q = 0; q < 2; q++) {
            const p = quads[q];
            const bBase = vStart + q * 4;
            cutoutBuf.pos.push(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11]);
            cutoutBuf.norm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
            cutoutBuf.uv.push(uv.u0, uv.v0, uv.u1, uv.v0, uv.u1, uv.v1, uv.u0, uv.v1);
            for (let k = 0; k < 4; k++) {
              cutoutBuf.col.push(tintR * 0.92, tintG * 0.92, tintB * 0.92);
            }
            cutoutBuf.idx.push(bBase, bBase + 1, bBase + 2, bBase, bBase + 2, bBase + 3);
          }
          continue;
        }

        // Torch (slender vertical post)
        if (block.renderType === 'torch') {
          const uv = atlas.getUV(block.faces.side);
          const w = 0.12;
          const h = 0.65;
          const cx0 = lx + 0.5 - w;
          const cx1 = lx + 0.5 + w;
          const cz0 = lz + 0.5 - w;
          const cz1 = lz + 0.5 + w;
          const torchFaces = [
            [cx0, y, cz1, cx1, y, cz1, cx1, y + h, cz1, cx0, y + h, cz1, 0, 0, 1],
            [cx1, y, cz0, cx0, y, cz0, cx0, y + h, cz0, cx1, y + h, cz0, 0, 0, -1],
            [cx1, y, cz1, cx1, y, cz0, cx1, y + h, cz0, cx1, y + h, cz1, 1, 0, 0],
            [cx0, y, cz0, cx0, y, cz1, cx0, y + h, cz1, cx0, y + h, cz0, -1, 0, 0],
            [cx0, y + h, cz1, cx1, y + h, cz1, cx1, y + h, cz0, cx0, y + h, cz0, 0, 1, 0],
          ];
          for (const tf of torchFaces) {
            const base = cutoutBuf.pos.length / 3;
            cutoutBuf.pos.push(tf[0], tf[1], tf[2], tf[3], tf[4], tf[5], tf[6], tf[7], tf[8], tf[9], tf[10], tf[11]);
            for (let k = 0; k < 4; k++) {
              cutoutBuf.norm.push(tf[12], tf[13], tf[14]);
              cutoutBuf.col.push(1.15, 1.1, 0.95);
            }
            cutoutBuf.uv.push(uv.u0, uv.v0, uv.u1, uv.v0, uv.u1, uv.v1, uv.u0, uv.v1);
            cutoutBuf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
          continue;
        }

        const isSnowLayer = block.renderType === 'slab_low';
        const isFluid = block.renderType === 'fluid';
        const isCutout = block.renderType === 'cutout';
        const targetBuf = isFluid ? fluidBuf : isCutout ? cutoutBuf : opaqueBuf;

        const fluidTopOffset =
          isFluid && block.isFluid && blockAt(lx, y + 1, lz) !== id ? 0.875 : isSnowLayer ? 0.16 : 1.0;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = lx + face.dir[0];
          const ny = y + face.dir[1];
          const nz = lz + face.dir[2];

          const neighborId = blockAt(nx, ny, nz);
          const neighbor = getBlock(neighborId);

          // Face culling rules
          if (isFluid) {
            if (neighborId === id || (!neighbor.transparent && neighbor.renderType === 'opaque')) continue;
          } else if (isCutout) {
            if (id === BLOCK_ID.GLASS && neighborId === BLOCK_ID.GLASS) continue;
            if (!neighbor.transparent) continue;
          } else if (isSnowLayer) {
            if (f !== 0 && !neighbor.transparent) continue;
          } else {
            if (!neighbor.transparent) continue;
          }

          // Choose texture per face
          let texName = block.faces.side;
          if (f === 0) texName = block.faces.top;
          else if (f === 1) texName = block.faces.bottom;
          else if (f === 4 && block.faces.front) texName = block.faces.front;

          const uv = atlas.getUV(texName);
          const applyTint = block.tintType === 'foliage' || block.tintType === 'water' || (block.tintType === 'grass' && f === 0);

          const base = targetBuf.pos.length / 3;
          const aoVals: [number, number, number, number] = [1, 1, 1, 1];

          for (let c = 0; c < 4; c++) {
            const corner = face.corners[c];
            const py = corner[1] === 1 ? y + fluidTopOffset : y;
            targetBuf.pos.push(lx + corner[0], py, lz + corner[2]);
            targetBuf.norm.push(face.dir[0], face.dir[1], face.dir[2]);

            const uCorner = face.uvMap[c][0] === 0 ? uv.u0 : uv.u1;
            const vCorner = face.uvMap[c][1] === 0 ? uv.v0 : uv.v1;
            targetBuf.uv.push(uCorner, vCorner);

            // 4-neighbor Vertex Ambient Occlusion for opaque/cutout blocks
            let ao = 1.0;
            if (!isFluid && !isSnowLayer && block.lightLevel === 0) {
              const sU = face.aoSigns[c][0];
              const sV = face.aoSigns[c][1];
              const ax = lx + face.dir[0] + face.uAxis[0] * sU;
              const ay = y + face.dir[1] + face.uAxis[1] * sU;
              const az = lz + face.dir[2] + face.uAxis[2] * sU;

              const bx = lx + face.dir[0] + face.vAxis[0] * sV;
              const by = y + face.dir[1] + face.vAxis[1] * sV;
              const bz = lz + face.dir[2] + face.vAxis[2] * sV;

              const cxAO = lx + face.dir[0] + face.uAxis[0] * sU + face.vAxis[0] * sV;
              const cyAO = y + face.dir[1] + face.uAxis[1] * sU + face.vAxis[1] * sV;
              const czAO = lz + face.dir[2] + face.uAxis[2] * sU + face.vAxis[2] * sV;

              const side1 = isOpaqueSolid(ax, ay, az) ? 1 : 0;
              const side2 = isOpaqueSolid(bx, by, bz) ? 1 : 0;
              const cornerOcc = side1 && side2 ? 1 : isOpaqueSolid(cxAO, cyAO, czAO) ? 1 : 0;
              const occCount = side1 + side2 + cornerOcc;
              ao = occCount === 0 ? 1.0 : occCount === 1 ? 0.83 : occCount === 2 ? 0.67 : 0.52;
            }
            aoVals[c] = ao;

            const shade = block.lightLevel > 0 ? 1.15 : face.shade * ao;
            if (applyTint) {
              targetBuf.col.push(tintR * shade, tintG * shade, tintB * shade);
            } else {
              targetBuf.col.push(shade, shade, shade);
            }
          }

          // Flip quad diagonal when AO differs to prevent anisotropic interpolation artifacts
          if (aoVals[0] + aoVals[2] > aoVals[1] + aoVals[3]) {
            targetBuf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          } else {
            targetBuf.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          }
        }
      }
    }
  }

  return {
    opaque: buildGeometry(opaqueBuf),
    cutout: buildGeometry(cutoutBuf),
    fluid: buildGeometry(fluidBuf),
  };
}
