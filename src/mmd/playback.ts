import { LoopOnce, LoopRepeat } from 'three';
import type { AnimationClip, AnimationMixer, SkinnedMesh } from 'three';
import type { MMDAnimationHelper } from 'three/examples/jsm/animation/MMDAnimationHelper.js';
import type { LifelikeRig } from './rig';

export interface AttachOptions {
  clip: AnimationClip | null;
  physics: boolean;
  /** seconds into the clip to jump to right after attaching */
  time: number;
  loop: boolean;
}

export function mixerOf(helper: MMDAnimationHelper, mesh: SkinnedMesh): AnimationMixer | undefined {
  return helper.objects.get(mesh)?.mixer;
}

export function isAttached(helper: MMDAnimationHelper, mesh: SkinnedMesh | null): boolean {
  return !!mesh && helper.objects.has(mesh);
}

export function detachClip(helper: MMDAnimationHelper, mesh: SkinnedMesh): void {
  if (helper.objects.has(mesh)) helper.remove(mesh);
  helper.objects.delete(mesh);
}

/**
 * Attach (or re-attach) a motion so the pose is a pure function of clip + time.
 *
 * MMDAnimationHelper snapshots every bone *after* the mixer and restores that
 * snapshot before the next mixer update, so whatever pose the model is holding
 * when a clip is added becomes the baseline of the new mixer. Without care that
 * means: toggle physics (which has to re-add the mesh) and the pose you were
 * paused on gets baked into the motion, and the clip restarts from zero.
 *
 * So we always reset the bones to the bind pose first and then seek the fresh
 * mixer to the time the user was at.
 */
export function attachClip(
  helper: MMDAnimationHelper,
  mesh: SkinnedMesh,
  rig: LifelikeRig | null,
  options: AttachOptions,
): boolean {
  detachClip(helper, mesh);
  rig?.resetBones();

  if (!options.clip) return false;

  helper.add(mesh, {
    animation: options.clip,
    physics: options.physics,
    warmup: options.physics ? 60 : 0,
  });

  const mixer = mixerOf(helper, mesh);
  if (mixer) {
    const action = mixer.clipAction(options.clip);
    action.setLoop(options.loop ? LoopRepeat : LoopOnce, Infinity);
    action.clampWhenFinished = !options.loop;
    mixer.setTime(Math.max(0, options.time));
  }

  // Solve IK/grant/physics for the new pose and let the helper re-snapshot bones.
  helper.update(0);
  return true;
}

/**
 * Jump the playhead to `time` (the time slider).
 *
 * Seeking cannot use `mixer.setTime()` on a helper that is already running:
 * three's PropertyMixer only writes a bone when its accumulated value changed
 * since the previous frame, so moving the playhead behind the helper's back
 * leaves the skeleton on the *old* pose — and the helper's bone snapshot then
 * keeps restoring it. Advancing the mixer by a real delta instead keeps the
 * snapshot, the mixer buffers and the IK/physics solvers in step.
 */
export function seekClip(
  helper: MMDAnimationHelper,
  mesh: SkinnedMesh,
  rig: LifelikeRig | null,
  clip: AnimationClip,
  time: number,
): void {
  const mixer = mixerOf(helper, mesh);
  if (!mixer) return;
  const action = mixer.clipAction(clip);
  rig?.resetBones();
  helper.update(time - action.time);
}

export function setLoopMode(helper: MMDAnimationHelper, mesh: SkinnedMesh, clip: AnimationClip, loop: boolean): void {
  const mixer = mixerOf(helper, mesh);
  if (!mixer) return;
  const action = mixer.clipAction(clip);
  action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
  action.clampWhenFinished = !loop;
}
