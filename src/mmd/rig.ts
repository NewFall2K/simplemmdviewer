import { Bone, Euler, MathUtils, Quaternion, SkinnedMesh, Vector3, type Camera } from 'three';
import { BlinkScheduler, NO_BLINK, type BlinkState } from '../lib/blink';
import { findBlinkMorphs, type BlinkMorphs } from '../lib/morphs';
import { mulberry32, randomSeed } from '../lib/rng';

export interface LifelikeOptions {
  lookAt: boolean;
  /** 0..1 blend of the look-at rotation */
  lookStrength: number;
  breathe: boolean;
  /** breaths per minute */
  breathRate: number;
  /** degrees of chest rotation */
  breathDepth: number;
  blink: boolean;
  /** average seconds between blinks */
  blinkInterval: number;
  /** 0..1 chance that a blink is a one-eye wink */
  winkChance: number;
  sway: boolean;
  /** degrees of idle torso sway */
  swayAmount: number;
}

export const DEFAULT_LIFELIKE: LifelikeOptions = {
  lookAt: true,
  lookStrength: 0.85,
  breathe: true,
  breathRate: 14,
  breathDepth: 2.6,
  blink: true,
  blinkInterval: 3.5,
  winkChance: 0.18,
  sway: true,
  swayAmount: 0.9,
};

export interface BoneSet {
  head?: Bone;
  neck?: Bone;
  upper?: Bone;
  upper2?: Bone;
  waist?: Bone;
  shoulderL?: Bone;
  shoulderR?: Bone;
  eyeL?: Bone;
  eyeR?: Bone;
}

const PATTERNS: Record<keyof BoneSet, RegExp[]> = {
  head: [/^頭$/, /^head$/i],
  neck: [/^首$/, /^neck$/i],
  upper: [/^上半身$/, /upper_?body$|^spine$/i],
  upper2: [/^上半身2$/, /upper_?body2|^chest$|^spine1$/i],
  waist: [/^腰$/, /^waist$|^hips?$/i],
  shoulderL: [/^左肩$/, /shoulder_?l|left_?shoulder/i],
  shoulderR: [/^右肩$/, /shoulder_?r|right_?shoulder/i],
  eyeL: [/^左目$/, /eye_?l|left_?eye/i],
  eyeR: [/^右目$/, /eye_?r|right_?eye/i],
};

export function findBones(bones: Bone[]): BoneSet {
  const out: BoneSet = {};
  for (const key of Object.keys(PATTERNS) as Array<keyof BoneSet>) {
    for (const re of PATTERNS[key]) {
      const hit = bones.find((b) => re.test(b.name.trim()));
      if (hit) {
        out[key] = hit;
        break;
      }
    }
  }
  return out;
}

/** Per-bone head/eye look-at limits in degrees (yaw, pitch). */
const HEAD_LIMIT = { yaw: 24, pitch: 13 };
const EYE_LIMIT = { yaw: 20, pitch: 12 };

/**
 * Everything that makes a static pose feel alive: gaze tracking, breathing,
 * idle sway and randomized blinks / winks.
 *
 * Runs *after* MMDAnimationHelper.update() so it layers on top of the motion,
 * and only touches rotations (positions stay owned by the mixer).
 */
export class LifelikeRig {
  readonly mesh: SkinnedMesh;
  readonly bones: BoneSet;
  readonly blinkMorphs: BlinkMorphs;
  /**
   * Gaze direction of the origin bone at rest, expressed in that bone's local
   * space. Because MMD bones are built with identity rest rotations this is
   * `(0, 0, 1)` for models that face +Z, but we derive it so models with a
   * different facing/orientation still work.
   */
  readonly forwardLocal = new Vector3(0, 0, 1);

  options: LifelikeOptions = { ...DEFAULT_LIFELIKE };

  private scheduler: BlinkScheduler;
  private time = 0;
  private blinkState: BlinkState = { ...NO_BLINK };
  /** last blink value we wrote per morph index, so we can release it again */
  private blinkWritten = new Map<number, number>();
  private bindPose = new Map<Bone, { position: Vector3; quaternion: Quaternion }>();
  /**
   * Bones we rotated last frame, with the pose they had *before* we touched
   * them. When nothing else (no animation mixer) resets a bone, our offset
   * would otherwise accumulate frame after frame and the model would spin.
   */
  private applied = new Map<Bone, { base: Quaternion; value: Quaternion }>();

  private vA = new Vector3();
  private vB = new Vector3();
  private vC = new Vector3();
  private vD = new Vector3();
  private qA = new Quaternion();
  private qB = new Quaternion();
  private qC = new Quaternion();
  private qD = new Quaternion();
  private e = new Euler();

  constructor(mesh: SkinnedMesh, seed = randomSeed()) {
    this.mesh = mesh;
    this.bones = findBones(mesh.skeleton.bones);

    const names = Object.keys(mesh.morphTargetDictionary ?? {});
    this.blinkMorphs = findBlinkMorphs(names);
    this.scheduler = new BlinkScheduler(mulberry32(seed), this.options.blinkInterval, this.options.winkChance);

    for (const bone of mesh.skeleton.bones) {
      this.bindPose.set(bone, { position: bone.position.clone(), quaternion: bone.quaternion.clone() });
    }

    this.deriveGaze();

    // The skeleton's bind pose has to be stored *after* matrices exist.
    mesh.updateMatrixWorld(true);
  }

  private deriveGaze(): void {
    const { head, eyeL, eyeR } = this.bones;
    if (!head) return;
    this.mesh.updateMatrixWorld(true);

    const meshQ = this.mesh.getWorldQuaternion(this.qA).clone();
    let faceSign = 1;
    if (eyeL && eyeR) {
      const headPos = head.getWorldPosition(this.vA).clone();
      const eyeMid = eyeL.getWorldPosition(this.vB).clone().add(eyeR.getWorldPosition(new Vector3())).multiplyScalar(0.5);
      const fwd = eyeMid.sub(headPos).applyQuaternion(meshQ.clone().invert());
      if (fwd.lengthSq() > 1e-8 && fwd.z < 0) faceSign = -1;
    }

    const worldForward = new Vector3(0, 0, faceSign).applyQuaternion(meshQ);
    const headWorldQ = head.getWorldQuaternion(this.qB).clone();
    this.forwardLocal.copy(worldForward).applyQuaternion(headWorldQ.invert()).normalize();
  }

  get hasGaze(): boolean {
    return !!(this.bones.head || this.bones.eyeL || this.bones.eyeR);
  }

  setBlinkSeed(seed: number): void {
    this.scheduler = new BlinkScheduler(mulberry32(seed), this.options.blinkInterval, this.options.winkChance);
  }

  /** Trigger a blink (or wink) immediately — used by the UI button. */
  triggerBlink(wink = 0): void {
    this.scheduler.trigger(wink);
  }

  /**
   * Put every bone back to the bind pose and forget the offsets we layered on
   * last frame. Used before (re)attaching a motion so a paused pose can never
   * become part of the animation.
   */
  resetBones(): void {
    this.applied.clear();
    for (const [bone, pose] of this.bindPose) {
      bone.position.copy(pose.position);
      bone.quaternion.copy(pose.quaternion);
    }
    this.mesh.updateMatrixWorld(true);
  }

  /** Full reset: bind pose plus cleared morphs (the "Rest pose" button). */
  resetPose(): void {
    this.resetBones();
    this.blinkWritten.clear();
    const influences = this.mesh.morphTargetInfluences;
    if (influences) influences.fill(0);
  }

  /**
   * Layer the lifelike behaviour on top of the current pose.
   * @param dt seconds since the last frame
   * @param camera used for gaze tracking
   */
  update(dt: number, camera: Camera): void {
    const o = this.options;
    const d = Math.min(dt, 0.1);
    this.time += d;
    this.beginFrame();

    if (o.breathe) this.applyBreathing();
    if (o.sway) this.applySway();
    if (o.lookAt && camera) this.applyLookAt(camera, o.lookStrength);
    this.applyBlink(d);
  }

  // ------------------------------------------------------------------ breathing

  private applyBreathing(): void {
    const o = this.options;
    const perMinute = Math.max(1, o.breathRate);
    const phase = (this.time * perMinute) / 60;
    // inhale: chest opens (backwards tilt), shoulders lift slightly
    const cycle = Math.sin(phase * Math.PI * 2);
    const depth = MathUtils.degToRad(o.breathDepth);

    if (this.bones.upper) this.rotate(this.bones.upper, -cycle * depth, 0, 0);
    if (this.bones.upper2) this.rotate(this.bones.upper2, -cycle * depth * 0.45, 0, 0);
    if (this.bones.neck) this.rotate(this.bones.neck, cycle * depth * 0.35, 0, 0);
    const lift = MathUtils.degToRad(o.breathDepth * 0.35) * cycle;
    if (this.bones.shoulderL) this.rotate(this.bones.shoulderL, 0, 0, -lift);
    if (this.bones.shoulderR) this.rotate(this.bones.shoulderR, 0, 0, lift);
  }

  // ----------------------------------------------------------------- idle sway

  private applySway(): void {
    const o = this.options;
    const slow = this.time * 0.11;
    const amount = MathUtils.degToRad(o.swayAmount);
    const yaw = Math.sin(slow * Math.PI * 2) * amount;
    const tilt = Math.sin(slow * Math.PI * 2 * 0.63 + 1.1) * amount * 0.45;

    if (this.bones.waist) this.rotate(this.bones.waist, tilt * 0.3, yaw * 0.4, tilt * 0.3);
    if (this.bones.upper) this.rotate(this.bones.upper, tilt * 0.35, yaw, tilt * 0.5);
    if (this.bones.neck) this.rotate(this.bones.neck, -tilt * 0.25, -yaw * 0.35, -tilt * 0.3);
  }

  // --------------------------------------------------------------- look-at

  private applyLookAt(camera: Camera, strength: number): void {
    if (strength <= 0.001) return;
    if (this.bones.head) this.aimBone(this.bones.head, camera, HEAD_LIMIT, strength);
    if (this.bones.eyeL) this.aimBone(this.bones.eyeL, camera, EYE_LIMIT, strength);
    if (this.bones.eyeR) this.aimBone(this.bones.eyeR, camera, EYE_LIMIT, strength);
  }

  /**
   * Rotate `bone` so its gaze points at `camera`, clamped to `limit` degrees.
   *
   * With `g` the gaze in the bone's local space and `R` the bone's local
   * rotation, `a = R * g` is the gaze in the bone's *parent* space. The target
   * direction is brought into the same space, so the fix-up rotation
   * `q = fromUnitVectors(a, target)` can simply be premultiplied onto `R`.
   */
  private aimBone(bone: Bone, camera: Camera, limit: { yaw: number; pitch: number }, strength: number): void {
    bone.updateWorldMatrix(true, false);

    const look = this.vA.copy(this.forwardLocal).applyQuaternion(bone.quaternion).normalize();
    const boneWorldPos = bone.getWorldPosition(this.vB);
    const toCamera = this.vC.copy(camera.getWorldPosition(this.vD)).sub(boneWorldPos).normalize();

    const invParent = bone.parent
      ? this.qA.copy(bone.parent.getWorldQuaternion(this.qB)).invert()
      : this.qA.identity();
    toCamera.applyQuaternion(invParent).normalize();

    const q = this.qC.setFromUnitVectors(look, toCamera);
    const euler = this.e.setFromQuaternion(q, 'YXZ');
    euler.y = MathUtils.clamp(euler.y, -MathUtils.degToRad(limit.yaw), MathUtils.degToRad(limit.yaw));
    euler.x = MathUtils.clamp(euler.x, -MathUtils.degToRad(limit.pitch), MathUtils.degToRad(limit.pitch));
    euler.z = 0;
    q.setFromEuler(euler);

    if (strength < 1) {
      q.slerp(IDENTITY, 1 - strength).normalize();
    }
    this.applyOffset(bone, q);
  }

  // ------------------------------------------------------------------ blinking

  private applyBlink(dt: number): void {
    const o = this.options;
    if (o.blink) {
      this.scheduler.setMeanInterval(o.blinkInterval);
      this.scheduler.winkChance = o.winkChance;
      this.blinkState = this.scheduler.update(dt);
    } else {
      // Still run the writers below so a blink in progress is released.
      this.blinkState = NO_BLINK;
    }

    this.writeBlink(this.blinkMorphs.blink, this.blinkState.blink);
    this.writeBlink(this.blinkMorphs.winkL, this.blinkState.winkL);
    this.writeBlink(this.blinkMorphs.winkR, this.blinkState.winkR);
  }

  /**
   * Push a blink value into a set of morphs.
   *
   * The eye has to *open again*, so a running blink must be released instead of
   * being max()-ed forever (which leaves the eyes shut). We therefore remember
   * what we wrote last frame: if the influence still holds that value we own
   * the morph and may set it back to 0. If a motion (or a pinned morph) took
   * the morph over in the meantime we stay additive and never fight it.
   */
  private writeBlink(indices: number[], value: number): void {
    const influences = this.mesh.morphTargetInfluences;
    if (!influences || indices.length === 0) return;

    const active = value > 0.0001;
    for (const index of indices) {
      const current = influences[index] ?? 0;
      const previous = this.blinkWritten.get(index);
      const ours = previous !== undefined && Math.abs(current - previous) < 1e-6;

      if (active) {
        if (ours || value > current) {
          influences[index] = value;
          this.blinkWritten.set(index, value);
        } else {
          // The motion is holding a higher value: stay additive, do not claim it.
          this.blinkWritten.delete(index);
        }
      } else if (ours) {
        influences[index] = 0;
        this.blinkWritten.set(index, 0);
      } else if (previous !== undefined) {
        this.blinkWritten.delete(index);
      }
    }
  }

  // ------------------------------------------------------------------- helpers

  private rotate(bone: Bone, x: number, y: number, z: number): void {
    if (x === 0 && y === 0 && z === 0) return;
    this.applyOffset(bone, this.qD.setFromEuler(this.e.set(x, y, z, 'YXZ')));
  }

  /**
   * Undo last frame's offsets on bones that nothing else has touched since.
   * Bones the animation mixer rewrote keep the mixer's value (and that value
   * becomes the new base), so playing a motion and idling both behave.
   */
  private beginFrame(): void {
    for (const [bone, record] of this.applied) {
      if (sameRotation(bone.quaternion, record.value)) bone.quaternion.copy(record.base);
    }
    this.applied.clear();
  }

  /** Premultiply a rotation onto a bone and remember how to undo it. */
  private applyOffset(bone: Bone, offset: Quaternion): void {
    const previous = this.applied.get(bone);
    const base = previous ? previous.base : bone.quaternion.clone();
    bone.quaternion.premultiply(offset);
    this.applied.set(bone, { base, value: bone.quaternion.clone() });
  }
}

const IDENTITY = new Quaternion();

/** Bit-exact-ish comparison: only a value we wrote ourselves counts as ours. */
function sameRotation(a: Quaternion, b: Quaternion): boolean {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  return Math.abs(Math.abs(dot) - 1) < 1e-9;
}
