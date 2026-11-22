import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { getAtlas } from './atlas';
import { soundEngine } from './audio';
import {
  BLOCK_ID,
  canHarvestBlock,
  getBlock,
  getMiningDuration,
  isBlockPlaceable,
  isBlockSolid,
} from './blocks';
import { meshChunk } from './chunkMesher';
import { loadWorldState, SavedWorldState, saveWorldState } from './storage';
import {
  BiomeId,
  CraftingModalMode,
  GameMode,
  HudSnapshot,
  ItemStack,
  TargetBlockInfo,
  WorldConfig,
} from './types';
import { BIOME_DISPLAY_NAMES, CHUNK_HEIGHT, CHUNK_SIZE, MAX_Y, MIN_Y, SEA_LEVEL, WorldGenerator } from './worldGen';

interface ChunkRecord {
  cx: number;
  cz: number;
  key: string;
  blocks: Uint8Array;
  biomeMap: BiomeId[];
  group: THREE.Group;
  opaqueMesh: THREE.Mesh | null;
  cutoutMesh: THREE.Mesh | null;
  fluidMesh: THREE.Mesh | null;
  dirty: boolean;
}

interface DroppedItem {
  id: number;
  count: number;
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
}

interface BreakParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

const _vec3 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _skyColor = new THREE.Color();
const _fogColor = new THREE.Color();
const _underwaterFog = new THREE.Color('#13467a');

export interface EngineCallbacks {
  onHudUpdate: (snapshot: HudSnapshot) => void;
  onOpenModal: (modal: 'inventory' | 'pause', craftingMode?: CraftingModalMode) => void;
  onContextLost?: () => void;
}

export class VoxelEngine {
  private container: HTMLElement;
  private callbacks: EngineCallbacks;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private isSoftwareGl = false;

  private opaqueMat!: THREE.MeshLambertMaterial;
  private cutoutMat!: THREE.MeshLambertMaterial;
  private fluidMat!: THREE.MeshLambertMaterial;

  private sunLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private sunMesh!: THREE.Mesh;
  private moonMesh!: THREE.Mesh;
  private starsPoints!: THREE.Points;

  private highlightBox!: THREE.LineSegments;
  private crackBox!: THREE.Mesh;
  private crackMat!: THREE.MeshBasicMaterial;
  private handGroup!: THREE.Group;
  private handMesh: THREE.Mesh | null = null;
  private handItemId = -1;

  private worldGen!: WorldGenerator;
  private config: WorldConfig;

  private chunks = new Map<string, ChunkRecord>();
  private deltas = new Map<string, Map<number, number>>();
  private pendingGen = new Set<string>();
  private genEpoch = 0;
  private droppedItems: DroppedItem[] = [];
  private particles: BreakParticle[] = [];

  // Player state
  private pos = new THREE.Vector3(0.5, 75, 0.5);
  private vel = new THREE.Vector3();
  private yaw = 0;
  private pitch = -0.15;
  private onGround = false;
  private isFlying = false;
  private isSprinting = false;
  private isSneaking = false;
  private isUnderwater = false;
  private wasUnderwater = false;
  private fallPeakY = 75;

  private health = 20;
  private hunger = 20;
  private oxygen = 20;
  private dead = false;
  private timeOfDay = 0.24; // Morning sunlight
  private statusMessage: string | null = null;
  private statusTimer = 0;

  // Inventory (9 hotbar + 27 backpack)
  public hotbar: (ItemStack | null)[] = new Array(9).fill(null);
  public backpack: (ItemStack | null)[] = new Array(27).fill(null);
  public selectedHotbar = 0;

  // Input state
  private keys = new Set<string>();
  private mouseDownLeft = false;
  private mouseDownRight = false;
  private pointerLocked = false;
  private touchMode =
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  private virtualMoveX = 0;
  private virtualMoveF = 0;
  private virtualJump = false;
  private virtualSneak = false;
  private virtualMining = false;
  private canvasTouchId: number | null = null;
  private canvasTouchStartX = 0;
  private canvasTouchStartY = 0;
  private canvasTouchLastX = 0;
  private canvasTouchLastY = 0;
  private canvasTouchMoved = false;
  private canvasTouchHoldTimer = 0;
  private canvasTouchLongMining = false;
  private paused = true;
  private lastSpaceTap = 0;
  private lastWTap = 0;
  private breakCooldown = 0;
  private placeCooldown = 0;
  private hitSoundCooldown = 0;
  private stepDist = 0;
  private walkBobPhase = 0;
  private swingTimer = 0;

  // Mining state
  private currentTarget: TargetBlockInfo | null = null;
  private miningKey = '';
  private miningTime = 0;

  // Loop & Perf
  private frameId = 0;
  private disposed = false;
  private lastTime = performance.now();
  private fps = 60;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private hudEmitTimer = 0;
  private autosaveTimer = 0;
  private hungerTimer = 0;
  private drownTimer = 0;

  constructor(container: HTMLElement, initialConfig: WorldConfig, callbacks: EngineCallbacks) {
    this.container = container;
    this.config = { ...initialConfig };
    this.callbacks = callbacks;

    this.initRendererAndScene();
    this.setupStarterInventory();
  }

  private initRendererAndScene() {
    this.isSoftwareGl = (() => {
      try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = false;

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.container.appendChild(this.renderer.domElement);

    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.callbacks.onContextLost?.();
    });

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#8ec5ff');
    this.scene.fog = new THREE.Fog('#9fd0ff', 42, 128);

    // Mandatory RoomEnvironment IBL
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.18;
    pmremGenerator.dispose();

    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.08, 480);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // Shared Chunk Materials using procedural 16x16 texture atlas
    const atlas = getAtlas();
    this.opaqueMat = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      vertexColors: true,
    });
    this.cutoutMat = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      vertexColors: true,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
    });
    this.fluidMat = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // Lighting Rig
    this.hemiLight = new THREE.HemisphereLight('#cce8ff', '#4b5563', 0.95);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#fff7e6', 1.15);
    this.sunLight.position.set(60, 120, 40);
    this.scene.add(this.sunLight);

    // Celestial Sun, Moon, Stars
    const sunGeo = new THREE.PlaneGeometry(24, 24);
    const sunMat = new THREE.MeshBasicMaterial({ color: '#fef08a', side: THREE.DoubleSide, fog: false });
    this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
    this.scene.add(this.sunMesh);

    const moonGeo = new THREE.PlaneGeometry(18, 18);
    const moonMat = new THREE.MeshBasicMaterial({ color: '#e2e8f0', side: THREE.DoubleSide, fog: false });
    this.moonMesh = new THREE.Mesh(moonGeo, moonMat);
    this.scene.add(this.moonMesh);

    const starCount = 420;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.9 + 0.1);
      const r = 210;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi);
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: '#f8fafc', size: 1.6, transparent: true, opacity: 0, fog: false });
    this.starsPoints = new THREE.Points(starGeo, starMat);
    this.scene.add(this.starsPoints);

    // Block target wireframe highlight
    const boxEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006));
    this.highlightBox = new THREE.LineSegments(
      boxEdges,
      new THREE.LineBasicMaterial({ color: '#0f172a', transparent: true, opacity: 0.72 })
    );
    this.highlightBox.visible = false;
    this.scene.add(this.highlightBox);

    // 10-stage break crack overlay
    this.crackMat = new THREE.MeshBasicMaterial({
      map: atlas.crackTextures[0],
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.crackBox = new THREE.Mesh(new THREE.BoxGeometry(1.008, 1.008, 1.008), this.crackMat);
    this.crackBox.visible = false;
    this.scene.add(this.crackBox);

    // First-person held item
    this.handGroup = new THREE.Group();
    this.handGroup.position.set(0.42, -0.36, -0.58);
    this.camera.add(this.handGroup);

    this.bindEvents();
  }

  private setupStarterInventory() {
    this.hotbar.fill(null);
    this.backpack.fill(null);
    if (this.config.mode === 'creative') {
      const defaults = [
        BLOCK_ID.GRASS_BLOCK,
        BLOCK_ID.STONE,
        BLOCK_ID.OAK_PLANKS,
        BLOCK_ID.OAK_LOG,
        BLOCK_ID.GLASS,
        BLOCK_ID.TORCH,
        BLOCK_ID.STONE_BRICKS,
        BLOCK_ID.CRAFTING_TABLE,
        BLOCK_ID.GLOWSTONE,
      ];
      defaults.forEach((id, i) => {
        this.hotbar[i] = { id, count: 64 };
      });
    } else {
      this.hotbar[0] = { id: BLOCK_ID.WOODEN_PICKAXE, count: 1 };
      this.hotbar[1] = { id: BLOCK_ID.WOODEN_AXE, count: 1 };
      this.hotbar[2] = { id: BLOCK_ID.WOODEN_SHOVEL, count: 1 };
      this.hotbar[3] = { id: BLOCK_ID.TORCH, count: 16 };
      this.hotbar[4] = { id: BLOCK_ID.OAK_PLANKS, count: 16 };
      this.hotbar[5] = { id: BLOCK_ID.BREAD, count: 6 };
    }
  }

  public async loadAndStart(config: WorldConfig, resumeSaved = true): Promise<void> {
    this.config = { ...config };
    this.clearWorld();
    this.worldGen = new WorldGenerator(config.seed);

    const saved = resumeSaved ? await loadWorldState(config.seed) : null;
    if (saved) {
      this.config.mode = saved.mode;
      this.config.renderDistance = saved.renderDistance || config.renderDistance;
      this.timeOfDay = saved.timeOfDay ?? 0.24;
      this.pos.set(saved.playerPos.x, saved.playerPos.y, saved.playerPos.z);
      this.yaw = saved.yaw ?? 0;
      this.pitch = saved.pitch ?? -0.1;
      this.health = saved.health ?? 20;
      this.hunger = saved.hunger ?? 20;
      this.hotbar = saved.hotbar ?? new Array(9).fill(null);
      this.backpack = saved.backpack ?? new Array(27).fill(null);
      this.selectedHotbar = saved.selectedHotbar ?? 0;
      for (const [k, entries] of Object.entries(saved.deltas ?? {})) {
        const m = new Map<number, number>();
        for (const [idx, bid] of entries) m.set(idx, bid);
        this.deltas.set(k, m);
      }
    } else {
      const spawn = this.worldGen.findSafeSpawn();
      this.pos.set(spawn.x, spawn.y, spawn.z);
      this.vel.set(0, 0, 0);
      this.yaw = 0;
      this.pitch = -0.12;
      this.health = 20;
      this.hunger = 20;
      this.oxygen = 20;
      this.dead = false;
      this.isFlying = this.config.mode === 'creative';
      this.setupStarterInventory();
    }

    this.fallPeakY = this.pos.y;
    this.isFlying = this.config.mode === 'creative' && this.isFlying;

    // Pre-generate the spawn chunk synchronously so player never falls into empty space,
    // then let the Web Worker pool stream surrounding chunks asynchronously
    const pcx = Math.floor(this.pos.x / CHUNK_SIZE);
    const pcz = Math.floor(this.pos.z / CHUNK_SIZE);
    this.ensureChunkData(pcx, pcz);
    this.rebuildChunkMesh(pcx, pcz);
    this.streamChunks();

    this.updateCameraTransform();
    this.updateAtmosphere(0);
    this.emitHud(true);

    if (!this.frameId) {
      this.lastTime = performance.now();
      this.scheduleNextTick();
    }
  }

  public setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) {
      this.keys.clear();
      this.mouseDownLeft = false;
      this.mouseDownRight = false;
      this.virtualMoveX = 0;
      this.virtualMoveF = 0;
      this.virtualJump = false;
      this.virtualMining = false;
      this.canvasTouchId = null;
      this.canvasTouchLongMining = false;
      window.clearTimeout(this.canvasTouchHoldTimer);
      this.miningTime = 0;
      this.crackBox.visible = false;
    }
  }

  public setTouchMode(enabled: boolean) {
    this.touchMode = enabled;
    if (enabled) {
      this.exitPointerLock();
    }
    this.emitHud(true);
  }

  public setVirtualMove(strafe: number, forward: number) {
    this.virtualMoveX = Math.max(-1, Math.min(1, strafe));
    this.virtualMoveF = Math.max(-1, Math.min(1, forward));
    if (forward > 0.85 && !this.isSneaking) {
      this.isSprinting = true;
    } else if (forward <= 0.85 && !this.keys.has('KeyW')) {
      this.isSprinting = false;
    }
  }

  public setVirtualJump(active: boolean) {
    if (active && !this.virtualJump) {
      const now = performance.now();
      if (this.config.mode === 'creative' && now - this.lastSpaceTap < 300) {
        this.isFlying = !this.isFlying;
        this.vel.y = 0;
        this.showStatus(this.isFlying ? 'Flight Enabled' : 'Flight Disabled');
        this.lastSpaceTap = 0;
      } else {
        this.lastSpaceTap = now;
      }
    }
    this.virtualJump = active;
  }

  public toggleVirtualSneak() {
    this.virtualSneak = !this.virtualSneak;
    this.showStatus(this.virtualSneak ? 'Sneak On' : 'Sneak Off');
    this.emitHud(true);
  }

  public toggleFlight() {
    if (this.config.mode !== 'creative') return;
    this.isFlying = !this.isFlying;
    this.vel.y = 0;
    this.showStatus(this.isFlying ? 'Flight Enabled' : 'Flight Disabled');
    this.emitHud(true);
  }

  public setVirtualMine(active: boolean) {
    this.virtualMining = active;
    if (active) {
      this.swingTimer = 0.22;
      if (this.config.mode === 'creative' && !this.paused && !this.dead) {
        this.tryCreativeBreak();
        this.breakCooldown = 0.2;
      }
    } else {
      this.miningTime = 0;
      this.crackBox.visible = false;
    }
  }

  public triggerVirtualPlace() {
    if (this.paused || this.dead) return;
    this.tryRightClickAction();
  }

  public addLookDelta(dx: number, dy: number) {
    if (this.paused || this.dead) return;
    const sens = 0.0042;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    const maxPitch = Math.PI / 2 - 0.015;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
  }

  public requestPointerLock() {
    if (this.touchMode) return;
    if (!this.dead && this.renderer?.domElement) {
      try {
        this.renderer.domElement.requestPointerLock();
      } catch {
        // Ignore browser pointer lock rejection
      }
    }
  }

  public exitPointerLock() {
    if (document.pointerLockElement === this.renderer?.domElement) {
      document.exitPointerLock();
    }
  }

  public setMode(mode: GameMode) {
    this.config.mode = mode;
    if (mode === 'survival') {
      this.isFlying = false;
      this.dead = false;
      this.health = 20;
      this.hunger = 20;
    }
    this.showStatus(`Switched to ${mode === 'creative' ? 'Creative' : 'Survival'} Mode`);
    this.emitHud(true);
  }

  public setRenderDistance(rd: number) {
    this.config.renderDistance = Math.max(3, Math.min(10, rd));
    this.emitHud(true);
  }

  public setTimeOfDay(t: number) {
    this.timeOfDay = ((t % 1) + 1) % 1;
    this.updateAtmosphere(0);
    this.emitHud(true);
  }

  public selectHotbarSlot(index: number) {
    this.selectedHotbar = ((index % 9) + 9) % 9;
    this.emitHud(true);
  }

  public setInventory(hotbar: (ItemStack | null)[], backpack: (ItemStack | null)[]) {
    this.hotbar = hotbar.map((s) => (s ? { ...s } : null));
    this.backpack = backpack.map((s) => (s ? { ...s } : null));
    this.emitHud(true);
  }

  public respawnPlayer() {
    const spawn = this.worldGen.findSafeSpawn();
    this.pos.set(spawn.x, spawn.y, spawn.z);
    this.vel.set(0, 0, 0);
    this.health = 20;
    this.hunger = 20;
    this.oxygen = 20;
    this.dead = false;
    this.fallPeakY = spawn.y;
    this.emitHud(true);
    this.requestPointerLock();
  }

  public async saveNow(): Promise<void> {
    if (!this.worldGen) return;
    const serializedDeltas: Record<string, [number, number][]> = {};
    this.deltas.forEach((map, key) => {
      if (map.size > 0) {
        serializedDeltas[key] = Array.from(map.entries());
      }
    });

    const state: SavedWorldState = {
      seed: this.config.seed,
      mode: this.config.mode,
      renderDistance: this.config.renderDistance,
      timeOfDay: this.timeOfDay,
      playerPos: { x: this.pos.x, y: this.pos.y, z: this.pos.z },
      yaw: this.yaw,
      pitch: this.pitch,
      health: this.health,
      hunger: this.hunger,
      hotbar: this.hotbar,
      backpack: this.backpack,
      selectedHotbar: this.selectedHotbar,
      deltas: serializedDeltas,
      updatedAt: Date.now(),
    };
    await saveWorldState(state);
  }

  private showStatus(msg: string) {
    this.statusMessage = msg;
    this.statusTimer = 2.6;
  }

  private clearWorld() {
    this.genEpoch++;
    this.pendingGen.clear();
    if (this.worldGen) {
      this.worldGen.dispose();
    }
    this.chunks.forEach((c) => this.disposeChunk(c));
    this.chunks.clear();
    this.deltas.clear();
    for (const d of this.droppedItems) {
      this.scene.remove(d.mesh);
      d.mesh.geometry.dispose();
      (d.mesh.material as THREE.Material).dispose();
    }
    this.droppedItems = [];
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    }
    this.particles = [];
  }

  private disposeChunk(chunk: ChunkRecord) {
    this.scene.remove(chunk.group);
    if (chunk.opaqueMesh) chunk.opaqueMesh.geometry.dispose();
    if (chunk.cutoutMesh) chunk.cutoutMesh.geometry.dispose();
    if (chunk.fluidMesh) chunk.fluidMesh.geometry.dispose();
  }

  private chunkKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  private registerGeneratedChunk(
    cx: number,
    cz: number,
    blocks: Uint8Array,
    biomeMap: BiomeId[]
  ): ChunkRecord {
    const key = this.chunkKey(cx, cz);
    const existing = this.chunks.get(key);
    if (existing) return existing;

    // Apply saved/player deltas
    const deltaMap = this.deltas.get(key);
    if (deltaMap) {
      deltaMap.forEach((bid, idx) => {
        blocks[idx] = bid;
      });
    }

    const group = new THREE.Group();
    group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    this.scene.add(group);

    const record: ChunkRecord = {
      cx,
      cz,
      key,
      blocks,
      biomeMap,
      group,
      opaqueMesh: null,
      cutoutMesh: null,
      fluidMesh: null,
      dirty: true,
    };
    this.chunks.set(key, record);
    // Mark cardinal neighbors dirty so chunk border faces update cleanly
    this.markDirty(cx - 1, cz);
    this.markDirty(cx + 1, cz);
    this.markDirty(cx, cz - 1);
    this.markDirty(cx, cz + 1);
    return record;
  }

  private ensureChunkData(cx: number, cz: number): ChunkRecord {
    const key = this.chunkKey(cx, cz);
    const existing = this.chunks.get(key);
    if (existing) return existing;

    const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    const biomeMap: BiomeId[] = new Array(CHUNK_SIZE * CHUNK_SIZE);
    this.worldGen.generateChunk(cx, cz, blocks, biomeMap);
    return this.registerGeneratedChunk(cx, cz, blocks, biomeMap);
  }

  public getBlockAt(wx: number, wy: number, wz: number): number {
    if (wy < MIN_Y || wy >= MAX_Y) return BLOCK_ID.AIR;
    const bx = Math.floor(wx);
    const by = Math.floor(wy);
    const bz = Math.floor(wz);
    const cx = Math.floor(bx / CHUNK_SIZE);
    const cz = Math.floor(bz / CHUNK_SIZE);
    const chunk = this.chunks.get(this.chunkKey(cx, cz));
    if (!chunk) return BLOCK_ID.AIR;
    const lx = ((bx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((bz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const iy = by - MIN_Y;
    return chunk.blocks[(iy * CHUNK_SIZE + lz) * CHUNK_SIZE + lx];
  }

  private setBlockAt(wx: number, wy: number, wz: number, id: number) {
    if (wy <= MIN_Y || wy >= MAX_Y - 1) return;
    const bx = Math.floor(wx);
    const by = Math.floor(wy);
    const bz = Math.floor(wz);
    const cx = Math.floor(bx / CHUNK_SIZE);
    const cz = Math.floor(bz / CHUNK_SIZE);
    const key = this.chunkKey(cx, cz);
    const chunk = this.ensureChunkData(cx, cz);
    const lx = ((bx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((bz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const iy = by - MIN_Y;
    const idx = (iy * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
    chunk.blocks[idx] = id;
    chunk.dirty = true;

    let deltaMap = this.deltas.get(key);
    if (!deltaMap) {
      deltaMap = new Map();
      this.deltas.set(key, deltaMap);
    }
    deltaMap.set(idx, id);

    // Mark border neighbor chunks dirty so exposed faces update cleanly
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
  }

  private markDirty(cx: number, cz: number) {
    const c = this.chunks.get(this.chunkKey(cx, cz));
    if (c) c.dirty = true;
  }

  private rebuildChunkMesh(cx: number, cz: number) {
    const chunk = this.chunks.get(this.chunkKey(cx, cz));
    if (!chunk) return;
    chunk.dirty = false;

    const getNeighbor = (wx: number, wy: number, wz: number) => this.getBlockAt(wx, wy, wz);
    const geos = meshChunk(cx, cz, chunk.blocks, chunk.biomeMap, getNeighbor);

    if (chunk.opaqueMesh) {
      chunk.group.remove(chunk.opaqueMesh);
      chunk.opaqueMesh.geometry.dispose();
      chunk.opaqueMesh = null;
    }
    if (chunk.cutoutMesh) {
      chunk.group.remove(chunk.cutoutMesh);
      chunk.cutoutMesh.geometry.dispose();
      chunk.cutoutMesh = null;
    }
    if (chunk.fluidMesh) {
      chunk.group.remove(chunk.fluidMesh);
      chunk.fluidMesh.geometry.dispose();
      chunk.fluidMesh = null;
    }

    if (geos.opaque) {
      chunk.opaqueMesh = new THREE.Mesh(geos.opaque, this.opaqueMat);
      chunk.group.add(chunk.opaqueMesh);
    }
    if (geos.cutout) {
      chunk.cutoutMesh = new THREE.Mesh(geos.cutout, this.cutoutMat);
      chunk.group.add(chunk.cutoutMesh);
    }
    if (geos.fluid) {
      chunk.fluidMesh = new THREE.Mesh(geos.fluid, this.fluidMat);
      chunk.fluidMesh.renderOrder = 2;
      chunk.group.add(chunk.fluidMesh);
    }
  }

  private streamChunks() {
    if (!this.worldGen) return;
    const pcx = Math.floor(this.pos.x / CHUNK_SIZE);
    const pcz = Math.floor(this.pos.z / CHUNK_SIZE);
    const rd = this.config.renderDistance;

    // Unload distant chunks beyond rd + 2
    for (const [key, c] of this.chunks.entries()) {
      if (Math.abs(c.cx - pcx) > rd + 2 || Math.abs(c.cz - pcz) > rd + 2) {
        this.disposeChunk(c);
        this.chunks.delete(key);
      }
    }

    // Build queue sorted by proximity to player
    const toGenerate: { cx: number; cz: number; key: string; dist: number }[] = [];
    const toMesh: { cx: number; cz: number; dist: number }[] = [];

    for (let dz = -rd; dz <= rd; dz++) {
      for (let dx = -rd; dx <= rd; dx++) {
        if (dx * dx + dz * dz > rd * rd + 2) continue;
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = this.chunkKey(cx, cz);
        const dist = dx * dx + dz * dz;
        const c = this.chunks.get(key);
        if (!c) {
          if (!this.pendingGen.has(key)) {
            toGenerate.push({ cx, cz, key, dist });
          }
        } else if (c.dirty) {
          toMesh.push({ cx, cz, dist });
        }
      }
    }

    toGenerate.sort((a, b) => a.dist - b.dist);
    const maxInFlight = this.isSoftwareGl ? 3 : 6;
    const epoch = this.genEpoch;
    for (let i = 0; i < toGenerate.length && this.pendingGen.size < maxInFlight; i++) {
      const { cx, cz, key } = toGenerate[i];
      this.pendingGen.add(key);
      void this.worldGen
        .generateChunkAsync(cx, cz)
        .then(({ blocks, biomeMap }) => {
          this.pendingGen.delete(key);
          if (this.disposed || epoch !== this.genEpoch) return;
          const curPcx = Math.floor(this.pos.x / CHUNK_SIZE);
          const curPcz = Math.floor(this.pos.z / CHUNK_SIZE);
          const curRd = this.config.renderDistance;
          if (Math.abs(cx - curPcx) > curRd + 2 || Math.abs(cz - curPcz) > curRd + 2) return;
          this.registerGeneratedChunk(cx, cz, blocks, biomeMap);
        })
        .catch(() => {
          this.pendingGen.delete(key);
        });
    }

    toMesh.sort((a, b) => a.dist - b.dist);
    const meshBudget = this.isSoftwareGl ? 2 : 3;
    for (let i = 0; i < Math.min(meshBudget, toMesh.length); i++) {
      const { cx, cz } = toMesh[i];
      this.rebuildChunkMesh(cx, cz);
    }
  }

  private bindEvents() {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);

    const dom = this.renderer.domElement;
    dom.style.touchAction = 'none';
    dom.addEventListener('touchstart', this.onCanvasTouchStart, { passive: false });
    dom.addEventListener('touchmove', this.onCanvasTouchMove, { passive: false });
    dom.addEventListener('touchend', this.onCanvasTouchEnd, { passive: false });
    dom.addEventListener('touchcancel', this.onCanvasTouchEnd, { passive: false });
  }

  private onCanvasTouchStart = (e: TouchEvent) => {
    if (this.paused || this.dead) return;
    if (!this.touchMode) {
      this.touchMode = true;
      this.emitHud(true);
    }
    if (this.canvasTouchId !== null) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    e.preventDefault();

    this.canvasTouchId = touch.identifier;
    this.canvasTouchStartX = touch.clientX;
    this.canvasTouchStartY = touch.clientY;
    this.canvasTouchLastX = touch.clientX;
    this.canvasTouchLastY = touch.clientY;
    this.canvasTouchMoved = false;
    this.canvasTouchLongMining = false;

    window.clearTimeout(this.canvasTouchHoldTimer);
    this.canvasTouchHoldTimer = window.setTimeout(() => {
      if (this.canvasTouchId !== null && !this.canvasTouchMoved && !this.paused && !this.dead) {
        this.canvasTouchLongMining = true;
        this.setVirtualMine(true);
      }
    }, 240);
  };

  private onCanvasTouchMove = (e: TouchEvent) => {
    if (this.canvasTouchId === null || this.paused || this.dead) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.canvasTouchId) {
        e.preventDefault();
        const dx = t.clientX - this.canvasTouchLastX;
        const dy = t.clientY - this.canvasTouchLastY;
        this.canvasTouchLastX = t.clientX;
        this.canvasTouchLastY = t.clientY;

        if (!this.canvasTouchMoved) {
          const totalDist = Math.hypot(t.clientX - this.canvasTouchStartX, t.clientY - this.canvasTouchStartY);
          if (totalDist > 9) {
            this.canvasTouchMoved = true;
            window.clearTimeout(this.canvasTouchHoldTimer);
            if (this.canvasTouchLongMining) {
              this.canvasTouchLongMining = false;
              this.setVirtualMine(false);
            }
          }
        }
        if (this.canvasTouchMoved) {
          this.addLookDelta(dx, dy);
        }
        break;
      }
    }
  };

  private onCanvasTouchEnd = (e: TouchEvent) => {
    if (this.canvasTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.canvasTouchId) {
        e.preventDefault();
        window.clearTimeout(this.canvasTouchHoldTimer);
        if (this.canvasTouchLongMining) {
          this.canvasTouchLongMining = false;
          this.setVirtualMine(false);
        } else if (!this.canvasTouchMoved && !this.paused && !this.dead) {
          // Quick tap places block or interacts with utility block / eats food
          this.tryRightClickAction();
        }
        this.canvasTouchId = null;
        break;
      }
    }
  };

  private onResize = () => {
    if (!this.container || !this.renderer) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private onContextMenu = (e: MouseEvent) => {
    if (this.pointerLocked || this.touchMode) e.preventDefault();
  };

  private onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
    if (!this.pointerLocked && !this.touchMode && !this.paused && !this.dead) {
      this.setPaused(true);
      this.callbacks.onOpenModal('pause');
    }
    this.emitHud(true);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked || this.paused || this.dead) return;
    const sens = 0.0021;
    this.yaw -= e.movementX * sens;
    this.pitch -= e.movementY * sens;
    const maxPitch = Math.PI / 2 - 0.015;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
  };

  private onMouseDown = (e: MouseEvent) => {
    if (this.paused || this.dead) return;
    if (!this.pointerLocked) {
      if (!this.touchMode && e.target === this.renderer.domElement) {
        this.requestPointerLock();
      }
      return;
    }
    if (e.button === 0) {
      this.mouseDownLeft = true;
      this.swingTimer = 0.22;
      if (this.config.mode === 'creative') {
        this.tryCreativeBreak();
        this.breakCooldown = 0.2;
      }
    } else if (e.button === 2) {
      this.mouseDownRight = true;
      this.tryRightClickAction();
      this.placeCooldown = 0.22;
    } else if (e.button === 1) {
      e.preventDefault();
      this.tryPickBlock();
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) {
      this.mouseDownLeft = false;
      this.miningTime = 0;
      this.crackBox.visible = false;
    } else if (e.button === 2) {
      this.mouseDownRight = false;
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (this.paused || !this.pointerLocked) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    this.selectHotbarSlot(this.selectedHotbar + dir);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.dead) return;
    if (e.code === 'KeyE' && !this.paused) {
      e.preventDefault();
      this.setPaused(true);
      this.exitPointerLock();
      this.callbacks.onOpenModal('inventory', 'inventory');
      return;
    }

    if (this.paused) return;

    if (e.code.startsWith('Digit')) {
      const idx = Number(e.code.replace('Digit', '')) - 1;
      if (idx >= 0 && idx < 9) this.selectHotbarSlot(idx);
    }

    if (e.code === 'Space' && !e.repeat) {
      const now = performance.now();
      if (this.config.mode === 'creative' && now - this.lastSpaceTap < 280) {
        this.isFlying = !this.isFlying;
        this.vel.y = 0;
        this.showStatus(this.isFlying ? 'Flight Enabled' : 'Flight Disabled');
        this.lastSpaceTap = 0;
      } else {
        this.lastSpaceTap = now;
      }
    }

    if (e.code === 'KeyW' && !e.repeat) {
      const now = performance.now();
      if (now - this.lastWTap < 260) {
        this.isSprinting = true;
      }
      this.lastWTap = now;
    }

    if (e.code === 'KeyQ' && !e.repeat) {
      this.tryPickBlock();
    }

    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    if (e.code === 'KeyW') {
      this.isSprinting = false;
    }
  };

  private getHeldStack(): ItemStack | null {
    return this.hotbar[this.selectedHotbar] ?? null;
  }

  private tryPickBlock() {
    if (!this.currentTarget) return;
    const id = this.currentTarget.blockId;
    const existingIdx = this.hotbar.findIndex((s) => s && s.id === id);
    if (existingIdx >= 0) {
      this.selectHotbarSlot(existingIdx);
      return;
    }
    if (this.config.mode === 'creative') {
      this.hotbar[this.selectedHotbar] = { id, count: 64 };
      this.emitHud(true);
    }
  }

  private tryCreativeBreak() {
    if (!this.currentTarget) return;
    const { x, y, z, blockId } = this.currentTarget;
    if (y <= MIN_Y) return;
    const block = getBlock(blockId);
    this.setBlockAt(x, y, z, BLOCK_ID.AIR);
    soundEngine.playBreak(block.soundGroup);
    this.spawnBreakParticles(x, y, z, block.particleColor);
  }

  private tryRightClickAction() {
    if (this.currentTarget) {
      const { x, y, z, nx, ny, nz, blockId } = this.currentTarget;
      if (blockId === BLOCK_ID.CRAFTING_TABLE && !this.isSneaking) {
        this.setPaused(true);
        this.exitPointerLock();
        this.callbacks.onOpenModal('inventory', 'crafting_table');
        return;
      }
      if (blockId === BLOCK_ID.FURNACE && !this.isSneaking) {
        this.setPaused(true);
        this.exitPointerLock();
        this.callbacks.onOpenModal('inventory', 'furnace');
        return;
      }

      const held = this.getHeldStack();
      if (held && isBlockPlaceable(held.id)) {
        const px = x + nx;
        const py = y + ny;
        const pz = z + nz;
        if (py <= MIN_Y || py >= MAX_Y - 1) return;

        // Prevent placing block inside player AABB if solid
        const placeBlock = getBlock(held.id);
        if (placeBlock.solid && this.intersectsPlayerAABB(px, py, pz)) {
          return;
        }

        const existing = this.getBlockAt(px, py, pz);
        if (existing === BLOCK_ID.AIR || existing === BLOCK_ID.WATER || getBlock(existing).renderType === 'cross') {
          this.setBlockAt(px, py, pz, held.id);
          this.swingTimer = 0.2;
          soundEngine.playPlace(placeBlock.soundGroup);

          if (this.config.mode === 'survival') {
            held.count -= 1;
            if (held.count <= 0) {
              this.hotbar[this.selectedHotbar] = null;
            }
            this.emitHud(true);
          }
          return;
        }
      }
    }

    // Eat food if holding edible item in Survival
    const held = this.getHeldStack();
    if (held && this.config.mode === 'survival' && this.hunger < 20) {
      const def = getBlock(held.id);
      if (def.foodPoints && def.foodPoints > 0) {
        this.hunger = Math.min(20, this.hunger + def.foodPoints);
        this.health = Math.min(20, this.health + 1);
        held.count -= 1;
        if (held.count <= 0) this.hotbar[this.selectedHotbar] = null;
        soundEngine.playEat();
        this.swingTimer = 0.25;
        this.emitHud(true);
      }
    }
  }

  private intersectsPlayerAABB(bx: number, by: number, bz: number): boolean {
    const hw = 0.29;
    const pMinX = this.pos.x - hw;
    const pMaxX = this.pos.x + hw;
    const pMinY = this.pos.y;
    const pMaxY = this.pos.y + 1.78;
    const pMinZ = this.pos.z - hw;
    const pMaxZ = this.pos.z + hw;
    return pMaxX > bx && pMinX < bx + 1 && pMaxY > by && pMinY < by + 1 && pMaxZ > bz && pMinZ < bz + 1;
  }

  private spawnBreakParticles(bx: number, by: number, bz: number, colorHex: string) {
    const count = this.isSoftwareGl ? 6 : 10;
    const geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshLambertMaterial({ color: colorHex });
      const mesh = new THREE.Mesh(geo.clone(), mat);
      mesh.position.set(bx + 0.2 + Math.random() * 0.6, by + 0.2 + Math.random() * 0.6, bz + 0.2 + Math.random() * 0.6);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        vel: new THREE.Vector3((Math.random() - 0.5) * 3.5, 1.5 + Math.random() * 3.0, (Math.random() - 0.5) * 3.5),
        life: 0,
        maxLife: 0.45 + Math.random() * 0.3,
      });
    }
    geo.dispose();
  }

  private spawnDroppedItem(bx: number, by: number, bz: number, id: number, count: number) {
    if (id === BLOCK_ID.AIR || count <= 0) return;
    const atlas = getAtlas();
    const def = getBlock(id);
    const texName = def.itemTexture ?? def.faces.front ?? def.faces.side;
    const uv = atlas.getUV(texName);

    const geo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    const uvAttr = geo.attributes.uv;
    for (let i = 0; i < uvAttr.count; i++) {
      const u = uvAttr.getX(i);
      const v = uvAttr.getY(i);
      uvAttr.setXY(i, u === 0 ? uv.u0 : uv.u1, v === 0 ? uv.v0 : uv.v1);
    }
    uvAttr.needsUpdate = true;

    const mat = new THREE.MeshLambertMaterial({
      map: atlas.texture,
      color: def.tintType === 'grass' || def.tintType === 'foliage' ? def.particleColor : '#ffffff',
      alphaTest: 0.4,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(bx + 0.5, by + 0.4, bz + 0.5);
    this.scene.add(mesh);

    this.droppedItems.push({
      id,
      count,
      mesh,
      pos: mesh.position.clone(),
      vel: new THREE.Vector3((Math.random() - 0.5) * 2.2, 3.2, (Math.random() - 0.5) * 2.2),
      age: 0,
    });
  }

  public addItemToInventory(id: number, count: number): boolean {
    const def = getBlock(id);
    let remaining = count;

    // 1. Merge into existing hotbar or backpack stacks
    const mergeInto = (arr: (ItemStack | null)[]) => {
      for (let i = 0; i < arr.length && remaining > 0; i++) {
        const s = arr[i];
        if (s && s.id === id && s.count < def.maxStack) {
          const add = Math.min(remaining, def.maxStack - s.count);
          s.count += add;
          remaining -= add;
        }
      }
    };
    mergeInto(this.hotbar);
    mergeInto(this.backpack);

    // 2. Fill empty slots
    const fillEmpty = (arr: (ItemStack | null)[]) => {
      for (let i = 0; i < arr.length && remaining > 0; i++) {
        if (!arr[i]) {
          const add = Math.min(remaining, def.maxStack);
          arr[i] = { id, count: add };
          remaining -= add;
        }
      }
    };
    fillEmpty(this.hotbar);
    fillEmpty(this.backpack);

    this.emitHud(true);
    return remaining < count;
  }

  private raycastVoxel(): TargetBlockInfo | null {
    _dir.set(0, 0, -1).applyEuler(this.camera.rotation).normalize();
    const ox = this.camera.position.x;
    const oy = this.camera.position.y;
    const oz = this.camera.position.z;

    let x = Math.floor(ox);
    let y = Math.floor(oy);
    let z = Math.floor(oz);

    const stepX = _dir.x > 0 ? 1 : -1;
    const stepY = _dir.y > 0 ? 1 : -1;
    const stepZ = _dir.z > 0 ? 1 : -1;

    const tDeltaX = _dir.x !== 0 ? Math.abs(1 / _dir.x) : 1e6;
    const tDeltaY = _dir.y !== 0 ? Math.abs(1 / _dir.y) : 1e6;
    const tDeltaZ = _dir.z !== 0 ? Math.abs(1 / _dir.z) : 1e6;

    let tMaxX = _dir.x > 0 ? (x + 1 - ox) * tDeltaX : (ox - x) * tDeltaX;
    let tMaxY = _dir.y > 0 ? (y + 1 - oy) * tDeltaY : (oy - y) * tDeltaY;
    let tMaxZ = _dir.z > 0 ? (z + 1 - oz) * tDeltaZ : (oz - z) * tDeltaZ;

    let nx = 0, ny = 0, nz = 0;
    const maxDist = 5.5;
    let dist = 0;

    while (dist <= maxDist) {
      const id = this.getBlockAt(x, y, z);
      const def = getBlock(id);
      if (def.selectable) {
        return { x, y, z, nx, ny, nz, blockId: id, blockName: def.name };
      }

      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          dist = tMaxX;
          tMaxX += tDeltaX;
          x += stepX;
          nx = -stepX; ny = 0; nz = 0;
        } else {
          dist = tMaxZ;
          tMaxZ += tDeltaZ;
          z += stepZ;
          nx = 0; ny = 0; nz = -stepZ;
        }
      } else {
        if (tMaxY < tMaxZ) {
          dist = tMaxY;
          tMaxY += tDeltaY;
          y += stepY;
          nx = 0; ny = -stepY; nz = 0;
        } else {
          dist = tMaxZ;
          tMaxZ += tDeltaZ;
          z += stepZ;
          nx = 0; ny = 0; nz = -stepZ;
        }
      }
    }
    return null;
  }

  private updateMining(dt: number) {
    this.breakCooldown = Math.max(0, this.breakCooldown - dt);
    this.placeCooldown = Math.max(0, this.placeCooldown - dt);
    this.hitSoundCooldown = Math.max(0, this.hitSoundCooldown - dt);

    const canAct = !this.paused && !this.dead && (this.pointerLocked || this.touchMode);
    if (!canAct) {
      this.crackBox.visible = false;
      this.miningTime = 0;
      return;
    }

    if (this.mouseDownRight && this.placeCooldown <= 0) {
      this.tryRightClickAction();
      this.placeCooldown = 0.22;
    }

    const miningActive = this.mouseDownLeft || this.virtualMining;
    if (!miningActive || !this.currentTarget) {
      this.miningTime = 0;
      this.miningKey = '';
      this.crackBox.visible = false;
      return;
    }

    if (this.config.mode === 'creative') {
      if (this.breakCooldown <= 0) {
        this.tryCreativeBreak();
        this.breakCooldown = 0.18;
        this.swingTimer = 0.18;
      }
      this.crackBox.visible = false;
      return;
    }

    // Survival Mining
    const t = this.currentTarget;
    const key = `${t.x},${t.y},${t.z}`;
    if (key !== this.miningKey) {
      this.miningKey = key;
      this.miningTime = 0;
    }

    const heldId = this.getHeldStack()?.id ?? null;
    const duration = getMiningDuration(t.blockId, heldId);
    if (!Number.isFinite(duration)) {
      this.crackBox.visible = false;
      return;
    }

    this.miningTime += dt;
    this.swingTimer = Math.max(this.swingTimer, 0.14);

    if (this.hitSoundCooldown <= 0) {
      soundEngine.playHit(getBlock(t.blockId).soundGroup);
      this.hitSoundCooldown = 0.24;
    }

    const progress = Math.min(1, this.miningTime / duration);
    const stage = Math.min(9, Math.floor(progress * 10));
    this.crackMat.map = getAtlas().crackTextures[stage];
    this.crackMat.needsUpdate = true;
    this.crackBox.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
    this.crackBox.visible = true;

    if (progress >= 1) {
      const def = getBlock(t.blockId);
      const harvestable = canHarvestBlock(t.blockId, heldId);
      const replaceId = this.shouldWaterFill(t.x, t.y, t.z) ? BLOCK_ID.WATER : BLOCK_ID.AIR;
      this.setBlockAt(t.x, t.y, t.z, replaceId);
      soundEngine.playBreak(def.soundGroup);
      this.spawnBreakParticles(t.x, t.y, t.z, def.particleColor);
      if (harvestable && def.dropId !== BLOCK_ID.AIR) {
        this.spawnDroppedItem(t.x, t.y, t.z, def.dropId, def.dropCount);
      }
      this.miningTime = 0;
      this.miningKey = '';
      this.crackBox.visible = false;
    }
  }

  private shouldWaterFill(x: number, y: number, z: number): boolean {
    if (y > SEA_LEVEL) return false;
    let waterNeighbors = 0;
    if (this.getBlockAt(x + 1, y, z) === BLOCK_ID.WATER) waterNeighbors++;
    if (this.getBlockAt(x - 1, y, z) === BLOCK_ID.WATER) waterNeighbors++;
    if (this.getBlockAt(x, y, z + 1) === BLOCK_ID.WATER) waterNeighbors++;
    if (this.getBlockAt(x, y, z - 1) === BLOCK_ID.WATER) waterNeighbors++;
    if (this.getBlockAt(x, y + 1, z) === BLOCK_ID.WATER) waterNeighbors += 2;
    return waterNeighbors >= 2;
  }

  private updatePhysics(dt: number) {
    if (this.paused || this.dead) return;
    // Prevent falling through terrain before the chunk under the player finishes streaming
    const curChunk = this.chunks.get(
      this.chunkKey(Math.floor(this.pos.x / CHUNK_SIZE), Math.floor(this.pos.z / CHUNK_SIZE))
    );
    if (!curChunk) return;

    const footBlock = this.getBlockAt(this.pos.x, this.pos.y + 0.2, this.pos.z);
    const eyeBlock = this.getBlockAt(this.pos.x, this.pos.y + 1.55, this.pos.z);
    const inWater = footBlock === BLOCK_ID.WATER || eyeBlock === BLOCK_ID.WATER;
    this.isUnderwater = eyeBlock === BLOCK_ID.WATER;

    if (this.isUnderwater !== this.wasUnderwater) {
      soundEngine.playSplash();
      this.wasUnderwater = this.isUnderwater;
    }

    this.isSneaking = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.virtualSneak;
    const sprintKey = this.keys.has('ControlLeft') || this.keys.has('KeyR');
    if (sprintKey && this.keys.has('KeyW') && !this.isSneaking) {
      this.isSprinting = true;
    }

    // Horizontal movement input (Keyboard + Virtual Joystick)
    let moveF = this.virtualMoveF;
    let moveR = this.virtualMoveX;
    if (this.keys.has('KeyW')) moveF += 1;
    if (this.keys.has('KeyS')) moveF -= 1;
    if (this.keys.has('KeyD')) moveR += 1;
    if (this.keys.has('KeyA')) moveR -= 1;

    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    let wishX = -sinY * moveF + cosY * moveR;
    let wishZ = -cosY * moveF - sinY * moveR;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 1) {
      wishX /= wishLen;
      wishZ /= wishLen;
    }

    let targetSpeed = 4.5;
    if (this.isFlying) targetSpeed = this.isSprinting ? 16.5 : 10.5;
    else if (inWater) targetSpeed = 3.1;
    else if (this.isSneaking) targetSpeed = 1.9;
    else if (this.isSprinting && moveF > 0) targetSpeed = 6.6;

    const accel = this.onGround || this.isFlying ? 18 : 6.5;
    this.vel.x = THREE.MathUtils.damp(this.vel.x, wishX * targetSpeed, accel, dt);
    this.vel.z = THREE.MathUtils.damp(this.vel.z, wishZ * targetSpeed, accel, dt);

    const jumpHeld = this.keys.has('Space') || this.virtualJump;

    // Vertical physics
    if (this.isFlying) {
      let flyY = 0;
      if (jumpHeld) flyY += 1;
      if (this.isSneaking) flyY -= 1;
      this.vel.y = THREE.MathUtils.damp(this.vel.y, flyY * (this.isSprinting ? 12 : 8.5), 14, dt);
      this.fallPeakY = this.pos.y;
    } else if (inWater) {
      this.vel.y -= 7.5 * dt; // Buoyancy slows sinking
      if (jumpHeld) {
        this.vel.y = Math.min(4.6, this.vel.y + 22 * dt);
      }
      this.vel.y = Math.max(-4.5, Math.min(4.8, this.vel.y));
      this.fallPeakY = this.pos.y;
    } else {
      this.vel.y -= 26.0 * dt;
      this.vel.y = Math.max(-45, this.vel.y);
      if (jumpHeld && this.onGround) {
        this.vel.y = 8.75;
        this.onGround = false;
      }
      if (this.pos.y > this.fallPeakY) this.fallPeakY = this.pos.y;
    }

    // Move & Collide Axis-by-Axis
    const oldX = this.pos.x;
    const oldZ = this.pos.z;

    this.moveAxis('x', this.vel.x * dt);
    if (this.isSneaking && this.onGround && !this.isFlying && !this.hasGroundSupport(this.pos.x, this.pos.y, this.pos.z)) {
      this.pos.x = oldX;
      this.vel.x = 0;
    }

    this.moveAxis('z', this.vel.z * dt);
    if (this.isSneaking && this.onGround && !this.isFlying && !this.hasGroundSupport(this.pos.x, this.pos.y, this.pos.z)) {
      this.pos.z = oldZ;
      this.vel.z = 0;
    }

    const prevOnGround = this.onGround;
    this.onGround = false;
    this.moveAxis('y', this.vel.y * dt);

    // Fall Damage in Survival
    if (!prevOnGround && this.onGround && !this.isFlying && !inWater) {
      const fallDist = this.fallPeakY - this.pos.y;
      if (this.config.mode === 'survival' && fallDist > 3.6) {
        const dmg = Math.floor(fallDist - 3.0);
        if (dmg > 0) this.applyDamage(dmg);
      }
      this.fallPeakY = this.pos.y;
    } else if (this.onGround) {
      this.fallPeakY = this.pos.y;
    }

    // Footstep sound & view bobbing
    const horizDist = Math.hypot(this.pos.x - oldX, this.pos.z - oldZ);
    if ((this.onGround || inWater) && horizDist > 0.001) {
      this.stepDist += horizDist;
      this.walkBobPhase += horizDist * 2.1;
      if (this.stepDist >= 1.9) {
        this.stepDist = 0;
        const underId = this.getBlockAt(this.pos.x, this.pos.y - 0.15, this.pos.z);
        soundEngine.playStep(inWater ? 'water' : getBlock(underId).soundGroup);
      }
    }

    // Survival Oxygen & Hunger loops
    if (this.config.mode === 'survival') {
      if (this.isUnderwater) {
        this.drownTimer += dt;
        if (this.oxygen > 0 && this.drownTimer >= 0.75) {
          this.oxygen = Math.max(0, this.oxygen - 1);
          this.drownTimer = 0;
        } else if (this.oxygen <= 0 && this.drownTimer >= 1.0) {
          this.applyDamage(2);
          this.drownTimer = 0;
        }
      } else {
        this.oxygen = Math.min(20, this.oxygen + dt * 6);
        this.drownTimer = 0;
      }

      const effort = horizDist * (this.isSprinting ? 0.045 : 0.012);
      this.hungerTimer += dt * 0.02 + effort;
      if (this.hungerTimer >= 1.0) {
        this.hungerTimer = 0;
        if (this.hunger > 0) this.hunger = Math.max(0, this.hunger - 1);
      }
      if (this.hunger >= 18 && this.health < 20) {
        this.health = Math.min(20, this.health + dt * 0.35);
      }
    }

    // Smooth Sprint FOV
    const targetFov = this.isSprinting && wishLen > 0 ? 83 : 75;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 10, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  private applyDamage(amount: number) {
    if (this.dead || this.config.mode === 'creative') return;
    this.health = Math.max(0, this.health - amount);
    soundEngine.playHurt();
    if (this.health <= 0) {
      this.dead = true;
      this.exitPointerLock();
    }
    this.emitHud(true);
  }

  private hasGroundSupport(px: number, py: number, pz: number): boolean {
    const hw = 0.28;
    const checkY = Math.floor(py - 0.08);
    for (const dx of [-hw, hw]) {
      for (const dz of [-hw, hw]) {
        if (isBlockSolid(this.getBlockAt(px + dx, checkY, pz + dz))) return true;
      }
    }
    return false;
  }

  private moveAxis(axis: 'x' | 'y' | 'z', delta: number) {
    if (delta === 0) return;
    const hw = 0.28;
    const height = 1.78;
    this.pos[axis] += delta;

    const minX = Math.floor(this.pos.x - hw);
    const maxX = Math.floor(this.pos.x + hw);
    const minY = Math.floor(this.pos.y);
    const maxY = Math.floor(this.pos.y + height);
    const minZ = Math.floor(this.pos.z - hw);
    const maxZ = Math.floor(this.pos.z + hw);

    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if (!isBlockSolid(this.getBlockAt(x, y, z))) continue;
          if (axis === 'x') {
            this.pos.x = delta > 0 ? x - hw - 0.001 : x + 1 + hw + 0.001;
            this.vel.x = 0;
            return;
          } else if (axis === 'z') {
            this.pos.z = delta > 0 ? z - hw - 0.001 : z + 1 + hw + 0.001;
            this.vel.z = 0;
            return;
          } else {
            if (delta > 0) {
              this.pos.y = y - height - 0.001;
              this.vel.y = 0;
            } else {
              this.pos.y = y + 1 + 0.001;
              this.vel.y = 0;
              this.onGround = true;
            }
            return;
          }
        }
      }
    }
  }

  private updateCameraTransform() {
    const eyeH = this.isSneaking && !this.isFlying ? 1.38 : 1.62;
    const bobY = this.onGround && !this.isFlying ? Math.sin(this.walkBobPhase) * 0.035 : 0;
    const bobX = this.onGround && !this.isFlying ? Math.cos(this.walkBobPhase * 0.5) * 0.02 : 0;

    this.camera.position.set(this.pos.x + bobX, this.pos.y + eyeH + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  private updateHeldHand(dt: number) {
    const heldId = this.getHeldStack()?.id ?? 0;
    if (heldId !== this.handItemId) {
      this.handItemId = heldId;
      if (this.handMesh) {
        this.handGroup.remove(this.handMesh);
        this.handMesh.geometry.dispose();
        (this.handMesh.material as THREE.Material).dispose();
        this.handMesh = null;
      }

      if (heldId > 0) {
        const def = getBlock(heldId);
        const atlas = getAtlas();
        const isItem = def.renderType === 'item' || def.renderType === 'cross' || def.renderType === 'torch';
        const geo = isItem ? new THREE.BoxGeometry(0.28, 0.28, 0.04) : new THREE.BoxGeometry(0.26, 0.26, 0.26);
        const texName = def.itemTexture ?? def.faces.front ?? def.faces.side;
        const uv = atlas.getUV(texName);
        const uvAttr = geo.attributes.uv;
        for (let i = 0; i < uvAttr.count; i++) {
          uvAttr.setXY(i, uvAttr.getX(i) === 0 ? uv.u0 : uv.u1, uvAttr.getY(i) === 0 ? uv.v0 : uv.v1);
        }
        uvAttr.needsUpdate = true;

        const mat = new THREE.MeshLambertMaterial({
          map: atlas.texture,
          color: def.tintType === 'grass' || def.tintType === 'foliage' ? def.particleColor : '#ffffff',
          alphaTest: 0.4,
        });
        this.handMesh = new THREE.Mesh(geo, mat);
        this.handMesh.rotation.set(0.2, -0.55, 0.1);
        this.handGroup.add(this.handMesh);
      }
    }

    if (this.swingTimer > 0) {
      this.swingTimer = Math.max(0, this.swingTimer - dt);
    }
    const swing = Math.sin((this.swingTimer / 0.22) * Math.PI);
    const idleBob = Math.sin(this.walkBobPhase) * 0.015;
    this.handGroup.position.set(0.42 - swing * 0.14, -0.35 + idleBob - swing * 0.12, -0.58 - swing * 0.16);
    this.handGroup.rotation.set(-swing * 0.85, swing * 0.35, 0);
  }

  private updateEntitiesAndParticles(dt: number) {
    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= 14 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const s = 1 - p.life / p.maxLife;
      p.mesh.scale.setScalar(Math.max(0.1, s));
    }

    // Dropped Items
    for (let i = this.droppedItems.length - 1; i >= 0; i--) {
      const item = this.droppedItems[i];
      item.age += dt;
      item.vel.y -= 16 * dt;

      const nextY = item.pos.y + item.vel.y * dt;
      if (isBlockSolid(this.getBlockAt(item.pos.x, nextY - 0.14, item.pos.z))) {
        item.vel.y = 0;
        item.vel.x *= 0.8;
        item.vel.z *= 0.8;
      } else {
        item.pos.y = nextY;
      }
      item.pos.x += item.vel.x * dt;
      item.pos.z += item.vel.z * dt;

      item.mesh.position.set(item.pos.x, item.pos.y + Math.sin(item.age * 3.5) * 0.07, item.pos.z);
      item.mesh.rotation.y += dt * 2.2;

      // Magnetize toward player & collect
      const dx = this.pos.x - item.pos.x;
      const dy = this.pos.y + 0.8 - item.pos.y;
      const dz = this.pos.z - item.pos.z;
      const dist = Math.hypot(dx, dy, dz);

      if (item.age > 0.35 && dist < 2.3) {
        item.pos.x += dx * 6 * dt;
        item.pos.y += dy * 6 * dt;
        item.pos.z += dz * 6 * dt;
      }
      if (item.age > 0.35 && dist < 0.95) {
        if (this.addItemToInventory(item.id, item.count)) {
          soundEngine.playPickup();
          this.scene.remove(item.mesh);
          item.mesh.geometry.dispose();
          (item.mesh.material as THREE.Material).dispose();
          this.droppedItems.splice(i, 1);
          continue;
        }
      }
      if (item.age > 180) {
        this.scene.remove(item.mesh);
        item.mesh.geometry.dispose();
        (item.mesh.material as THREE.Material).dispose();
        this.droppedItems.splice(i, 1);
      }
    }
  }

  private updateAtmosphere(dt: number) {
    if (!this.paused) {
      this.timeOfDay = (this.timeOfDay + dt / 720) % 1; // 12-minute day/night cycle
    }
    const angle = this.timeOfDay * Math.PI * 2;
    const sunY = Math.sin(angle);
    const sunX = Math.cos(angle);
    const dayFactor = THREE.MathUtils.clamp((sunY + 0.25) / 0.6, 0, 1);
    const sunsetFactor = Math.exp(-Math.pow(sunY * 4.5, 2));

    this.sunLight.position.set(sunX * 90, Math.max(12, sunY * 110), 40);
    this.sunLight.intensity = 0.2 + dayFactor * 1.05;
    this.hemiLight.intensity = 0.32 + dayFactor * 0.68;

    // Sky & Fog colors
    _skyColor.set('#0b1224').lerp(new THREE.Color('#78b4ff'), dayFactor);
    if (sunsetFactor > 0.15) {
      _skyColor.lerp(new THREE.Color('#f59e6b'), sunsetFactor * 0.45);
    }

    const fogFar = Math.max(48, this.config.renderDistance * CHUNK_SIZE - 8);
    const fogNear = fogFar * 0.42;

    if (this.isUnderwater) {
      this.scene.background = _underwaterFog;
      (this.scene.fog as THREE.Fog).color.copy(_underwaterFog);
      (this.scene.fog as THREE.Fog).near = 2;
      (this.scene.fog as THREE.Fog).far = 34;
    } else {
      this.scene.background = _skyColor;
      _fogColor.copy(_skyColor).lerp(new THREE.Color('#dbeafe'), dayFactor * 0.22);
      (this.scene.fog as THREE.Fog).color.copy(_fogColor);
      (this.scene.fog as THREE.Fog).near = fogNear;
      (this.scene.fog as THREE.Fog).far = fogFar;
    }

    // Position Sun, Moon & Stars around camera
    const cx = this.camera.position.x;
    const cy = this.camera.position.y;
    const cz = this.camera.position.z;

    this.sunMesh.position.set(cx + sunX * 190, cy + sunY * 190, cz + 25);
    this.sunMesh.lookAt(cx, cy, cz);
    this.moonMesh.position.set(cx - sunX * 190, cy - sunY * 190, cz - 25);
    this.moonMesh.lookAt(cx, cy, cz);

    this.starsPoints.position.set(cx, cy, cz);
    (this.starsPoints.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - dayFactor * 1.4);
  }

  private emitHud(force = false) {
    if (!force && this.hudEmitTimer < 0.08) return;
    this.hudEmitTimer = 0;

    let biome: BiomeId = 'plains';
    const bx = Math.floor(this.pos.x);
    const bz = Math.floor(this.pos.z);
    const cx = Math.floor(bx / CHUNK_SIZE);
    const cz = Math.floor(bz / CHUNK_SIZE);
    const chunk = this.chunks.get(this.chunkKey(cx, cz));
    if (chunk) {
      const lx = ((bx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const lz = ((bz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      biome = chunk.biomeMap[lz * CHUNK_SIZE + lx] ?? 'plains';
    } else if (this.worldGen) {
      biome = this.worldGen.sampleColumn(bx, bz).biome;
    }

    let pendingChunks = this.pendingGen.size;
    this.chunks.forEach((c) => {
      if (c.dirty) pendingChunks++;
    });

    this.callbacks.onHudUpdate({
      mode: this.config.mode,
      health: Math.ceil(this.health),
      maxHealth: 20,
      hunger: Math.ceil(this.hunger),
      maxHunger: 20,
      oxygen: Math.ceil(this.oxygen),
      isUnderwater: this.isUnderwater,
      isFlying: this.isFlying,
      isSprinting: this.isSprinting,
      isSneaking: this.isSneaking,
      pos: { x: this.pos.x, y: this.pos.y, z: this.pos.z },
      yaw: this.yaw,
      pitch: this.pitch,
      biome,
      biomeName: BIOME_DISPLAY_NAMES[biome] ?? biome,
      seedInt64: this.worldGen?.seedInfo.displayInt64,
      timeOfDay: this.timeOfDay,
      fps: this.fps,
      loadedChunks: this.chunks.size,
      pendingChunks,
      target: this.currentTarget,
      breakProgress:
        this.currentTarget && this.miningTime > 0
          ? Math.min(1, this.miningTime / getMiningDuration(this.currentTarget.blockId, this.getHeldStack()?.id ?? null))
          : 0,
      pointerLocked: this.pointerLocked,
      touchMode: this.touchMode,
      selectedHotbar: this.selectedHotbar,
      hotbar: this.hotbar.map((s) => (s ? { ...s } : null)),
      backpack: this.backpack.map((s) => (s ? { ...s } : null)),
      dead: this.dead,
      statusMessage: this.statusMessage,
    });
  }

  private scheduleNextTick() {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = () => {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;

    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    if (this.statusTimer > 0) {
      this.statusTimer -= dt;
      if (this.statusTimer <= 0) this.statusMessage = null;
    }

    this.streamChunks();
    this.updatePhysics(dt);
    this.updateCameraTransform();

    this.currentTarget = this.raycastVoxel();
    if (this.currentTarget && !this.paused && !this.dead && (this.pointerLocked || this.touchMode)) {
      this.highlightBox.position.set(
        this.currentTarget.x + 0.5,
        this.currentTarget.y + 0.5,
        this.currentTarget.z + 0.5
      );
      this.highlightBox.visible = true;
    } else {
      this.highlightBox.visible = false;
    }

    this.updateMining(dt);
    this.updateHeldHand(dt);
    this.updateEntitiesAndParticles(dt);
    this.updateAtmosphere(dt);

    this.renderer.render(this.scene, this.camera);

    this.hudEmitTimer += dt;
    this.emitHud(false);

    this.autosaveTimer += dt;
    if (this.autosaveTimer >= 12) {
      this.autosaveTimer = 0;
      void this.saveNow();
    }

    this.scheduleNextTick();
  };

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    window.clearTimeout(this.canvasTouchHoldTimer);
    if (this.renderer?.domElement) {
      const dom = this.renderer.domElement;
      dom.removeEventListener('touchstart', this.onCanvasTouchStart);
      dom.removeEventListener('touchmove', this.onCanvasTouchMove);
      dom.removeEventListener('touchend', this.onCanvasTouchEnd);
      dom.removeEventListener('touchcancel', this.onCanvasTouchEnd);
    }

    this.clearWorld();
    this.opaqueMat.dispose();
    this.cutoutMat.dispose();
    this.fluidMat.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
