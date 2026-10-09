import {
  AmbientLight,
  Box3,
  Clock,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  MathUtils,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { AnimationClip, SkinnedMesh } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MMDAnimationHelper } from 'three/examples/jsm/animation/MMDAnimationHelper.js';
import { DEFAULT_LIFELIKE, LifelikeRig, type LifelikeOptions } from './mmd/rig';
import { attachClip, detachClip, isAttached, seekClip, setLoopMode } from './mmd/playback';
import { classifyMorph, morphHint, type MorphGroup } from './lib/morphs';
import { mergeClips } from './lib/clip';

export interface MotionEntry {
  id: string;
  name: string;
  detail: string;
  clip: AnimationClip;
  enabled: boolean;
}

export interface MorphView {
  index: number;
  name: string;
  group: MorphGroup;
  hint: string;
}

export class Viewer {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly controls: OrbitControls;
  readonly helper: MMDAnimationHelper;
  readonly lifelike: LifelikeOptions = { ...DEFAULT_LIFELIKE };

  mesh: SkinnedMesh | null = null;
  rig: LifelikeRig | null = null;
  morphs: MorphView[] = [];
  motions: MotionEntry[] = [];
  /** permanent (🔒) morphs, keyed by morph name */
  readonly pins = new Map<string, number>();

  playing = false;
  speed = 1;
  loop = true;
  time = 0;
  duration = 0;
  showGrid = true;

  onBeforeFrame?: () => void;
  onAfterFrame?: (dt: number) => void;

  private clock = new Clock();
  private fps = 0;
  private frames = 0;
  private fpsTimer = 0;
  private grid: GridHelper;
  private activeClip: AnimationClip | null = null;
  private physicsEnabled = false;
  private pendingSeek: number | null = null;
  private raf = 0;
  private canvas: HTMLCanvasElement;
  private observer: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearAlpha(0);

    this.camera = new PerspectiveCamera(35, 1, 0.1, 4000);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 400;
    this.controls.maxPolarAngle = Math.PI * 0.98;
    this.controls.target.set(0, 12, 0);
    this.camera.position.set(0, 13, 34);

    this.scene.add(new HemisphereLight(0xbdd7ff, 0x40304a, 1.5));
    const key = new DirectionalLight(0xffffff, 2.1);
    key.position.set(-6, 14, 16);
    this.scene.add(key);
    const fill = new DirectionalLight(0x9fd8ff, 0.7);
    fill.position.set(9, 6, -8);
    this.scene.add(fill);
    this.scene.add(new AmbientLight(0xffffff, 0.35));

    this.grid = new GridHelper(80, 40, 0x39d0d8, 0x2a3346);
    (this.grid.material as { transparent: boolean; opacity: number }).transparent = true;
    (this.grid.material as { transparent: boolean; opacity: number }).opacity = 0.25;
    this.scene.add(this.grid);

    this.helper = new MMDAnimationHelper({ sync: true, afterglow: 0, resetPhysicsOnLoop: true });

    this.resize();
    // The canvas is a fixed, full-viewport element: watching it covers window
    // resizes, phone rotation and mobile URL-bar collapse in one go.
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);
    }
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this.resize(), 200);
      setTimeout(() => this.resize(), 600);
    });
    this.raf = requestAnimationFrame(this.tick);
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ model

  /** Adopt a freshly loaded model: reset motion state and (re)build the rig. */
  useModel(mesh: SkinnedMesh): LifelikeRig {
    if (this.mesh) this.detachMesh();

    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.mesh = mesh;
    this.rig = new LifelikeRig(mesh);
    this.rig.options = this.lifelike;
    this.pins.clear();
    this.motions = [];
    this.time = 0;
    this.duration = 0;
    this.activeClip = null;

    const dictionary = mesh.morphTargetDictionary ?? {};
    this.morphs = Object.entries(dictionary)
      .map(([name, index]) => ({ index, name, group: classifyMorph(name), hint: morphHint(name) }))
      .sort((a, b) => a.index - b.index);

    this.frameCamera();
    return this.rig;
  }

  private detachMesh(): void {
    if (this.mesh) {
      detachClip(this.helper, this.mesh);
      this.scene.remove(this.mesh);
      disposeObject(this.mesh);
    }
    this.mesh = null;
    this.rig = null;
  }

  /** Place the camera so the whole model is visible. */
  frameCamera(): void {
    if (!this.mesh) return;
    const box = new Box3().setFromObject(this.mesh);
    if (!isFinite(box.min.y) || box.isEmpty()) {
      box.set(new Vector3(-6, 0, -6), new Vector3(6, 20, 6));
    }
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const distance = Math.max(size.y, 12) * 1.75;
    const dir = new Vector3(0, 0.16, 1).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, distance);
    this.camera.near = Math.max(0.1, distance / 200);
    this.camera.far = distance * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.grid.position.y = Math.max(box.min.y, center.y - size.y * 0.55);
  }

  setGridVisible(visible: boolean): void {
    this.showGrid = visible;
    this.grid.visible = visible;
  }

  // ----------------------------------------------------------------- motion

  /**
   * Rebuild the merged clip from the enabled motions and hand it to the helper.
   * The clip keeps playing from wherever the player was, it does not restart.
   */
  private refreshAnimation(): void {
    if (!this.mesh) return;

    const merged = mergeClips(this.motions.filter((m) => m.enabled).map((m) => m.clip));
    this.activeClip = merged;
    this.duration = merged?.duration ?? 0;
    this.time = merged ? MathUtils.clamp(this.time, 0, this.duration) : 0;

    attachClip(this.helper, this.mesh, this.rig, {
      clip: merged,
      physics: this.physicsEnabled,
      time: this.time,
      loop: this.loop,
    });
    if (!merged) this.playing = false;
  }

  addMotion(entry: MotionEntry): void {
    this.motions = [...this.motions, entry];
    this.refreshAnimation();
  }

  setMotionEnabled(id: string, enabled: boolean): void {
    const motion = this.motions.find((m) => m.id === id);
    if (!motion) return;
    motion.enabled = enabled;
    this.refreshAnimation();
  }

  clearMotions(): void {
    this.motions = [];
    this.refreshAnimation();
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    if (this.mesh && this.activeClip) setLoopMode(this.helper, this.mesh, this.activeClip, loop);
  }

  /** Start (or resume) playback, re-attaching the motion if it was detached. */
  play(): boolean {
    if (!this.mesh) return false;
    if (!isAttached(this.helper, this.mesh) || !this.activeClip) {
      const anyEnabled = this.motions.some((m) => m.enabled);
      if (!anyEnabled) return false;
      this.refreshAnimation();
      if (!this.activeClip) return false;
    }
    this.playing = true;
    return true;
  }

  pause(): void {
    this.playing = false;
  }

  togglePlay(): boolean {
    if (this.playing) this.pause();
    else if (!this.play()) return false;
    return this.playing;
  }

  /** Stop playback and restore the bind pose (T-pose). */
  restPose(): void {
    if (!this.mesh || !this.rig) return;
    detachClip(this.helper, this.mesh);
    this.activeClip = null;
    this.duration = 0;
    this.time = 0;
    this.playing = false;
    this.pendingSeek = null;
    this.rig.resetPose();
    this.pins.clear();
  }

  /** Ammo.js must already be loaded (see loadAmmo) before enabling physics. */
  setPhysics(enabled: boolean): void {
    if (this.physicsEnabled === enabled) return;
    this.physicsEnabled = enabled;
    this.refreshAnimation();
    this.helper.enable('physics', enabled);
  }

  get isPhysicsEnabled(): boolean {
    return this.physicsEnabled;
  }

  /** Seek to a normalized position; applied on the next frame. */
  seek(normalized: number): void {
    if (!this.activeClip) return;
    this.pendingSeek = MathUtils.clamp(normalized, 0, 1);
  }

  private applyPendingSeek(): void {
    if (this.pendingSeek === null || !this.mesh || !this.activeClip) return;
    const target = this.pendingSeek * this.activeClip.duration;
    this.pendingSeek = null;
    this.time = target;
    seekClip(this.helper, this.mesh, this.rig, this.activeClip, target);
  }

  // ----------------------------------------------------------------- morphs

  /** Move a morph slider. Locked morphs are re-applied every frame. */
  setMorph(name: string, value: number, locked: boolean): void {
    const influences = this.mesh?.morphTargetInfluences;
    if (!influences || !this.mesh) return;
    const index = this.mesh.morphTargetDictionary?.[name];
    if (index === undefined) return;

    if (locked) {
      this.pins.set(name, value);
      influences[index] = value;
    } else {
      this.pins.delete(name);
      influences[index] = value;
    }
  }

  isPinned(name: string): boolean {
    return this.pins.has(name);
  }

  /** Zero every morph that is not locked. */
  clearTemporaryMorphs(): void {
    const influences = this.mesh?.morphTargetInfluences;
    if (!influences || !this.mesh) return;
    for (const morph of this.morphs) {
      if (!this.pins.has(morph.name)) influences[morph.index] = 0;
    }
  }

  unlockAll(): void {
    this.pins.clear();
  }

  applyPins(): void {
    const influences = this.mesh?.morphTargetInfluences;
    if (!influences || !this.mesh) return;
    for (const [name, value] of this.pins) {
      const index = this.mesh.morphTargetDictionary?.[name];
      if (index !== undefined) influences[index] = value;
    }
  }

  setLifelike(options: Partial<LifelikeOptions>): void {
    Object.assign(this.lifelike, options);
    if (this.rig) {
      Object.assign(this.rig.options, options);
      if (options.blinkInterval !== undefined) this.rig.options.blinkInterval = options.blinkInterval;
    }
  }

  // ------------------------------------------------------------------- loop

  private tick = (): void => {
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(this.clock.getDelta(), 0.1);

    this.onBeforeFrame?.();
    this.applyPendingSeek();
    const advance = this.playing && this.activeClip ? dt * this.speed : 0;
    if (advance > 0 && this.duration > 0) {
      this.time += advance;
      if (this.time > this.duration) {
        this.time = this.loop ? this.time % this.duration : this.duration;
      }
    }

    this.helper.update(advance);
    // Lifelike layers run on top of the motion and behind the pinned morphs.
    this.rig?.update(dt, this.camera);
    this.applyPins();

    if (this.mesh) this.mesh.updateMatrixWorld(true);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.onAfterFrame?.(dt);

    this.frames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
    }
  };

  get fpsValue(): number {
    return this.fps;
  }

  dispose(): void {
    this.observer?.disconnect();
    cancelAnimationFrame(this.raf);
    this.detachMesh();
  }
}

function disposeObject(root: SkinnedMesh): void {
  root.geometry.dispose();
  const materials = Array.isArray(root.material) ? root.material : [root.material];
  for (const material of materials) {
    for (const value of Object.values(material as unknown as Record<string, unknown>)) {
      if (value && typeof value === 'object' && 'isTexture' in value) {
        (value as unknown as { dispose(): void }).dispose();
      }
    }
    material.dispose();
  }
}
