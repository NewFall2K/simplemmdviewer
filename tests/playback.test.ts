import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimationMixer, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { MMDAnimationHelper } from 'three/examples/jsm/animation/MMDAnimationHelper.js';
import { attachClip, detachClip, isAttached, seekClip, mixerOf } from '../src/mmd/playback';
import { LifelikeRig } from '../src/mmd/rig';
import { CLIP_DURATION, makeTestClip, makeTestModel } from './fixtures/mmd';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const DEG = Math.PI / 180;
/** Quaternion keyframes are float32, so 0.06° is the noise floor of "same pose". */
const EXACT = 1e-3;
const angle = (a: Quaternion, b: Quaternion) => a.angleTo(b);
const IDENTITY = new Quaternion();

/** What the clip alone says every bone should be at `time`. */
function clipPoseAt(time: number): Record<string, Quaternion> {
  const t = Math.min(Math.max(time, 0), CLIP_DURATION - 1e-4); // stay off the loop boundary
  const { mesh, bones } = makeTestModel();
  const mixer = new AnimationMixer(mesh);
  mixer.clipAction(makeTestClip()).play();
  mixer.setTime(t);
  return Object.fromEntries(bones.map((bone) => [bone.name, bone.quaternion.clone()]));
}

function newSession() {
  const model = makeTestModel();
  const helper = new MMDAnimationHelper({ sync: true });
  const clip = makeTestClip();
  attachClip(helper, model.mesh, null, { clip, physics: false, time: 0, loop: true });
  const playhead = () => mixerOf(helper, model.mesh)!.clipAction(clip).time;
  const step = (frames: number) => {
    for (let i = 0; i < frames; i++) helper.update(1 / 60);
  };
  return { ...model, helper, clip, playhead, step };
}

describe('attachClip', () => {
  it('keeps the clip exactly where it was instead of restarting (the physics toggle)', () => {
    const { mesh, arm, upper, helper, clip, playhead, step } = newSession();
    step(90); // 1.5 s in
    expect(playhead()).toBeCloseTo(1.5, 6);

    // Toggling physics re-adds the mesh to the helper: the motion must not jump.
    attachClip(helper, mesh, null, { clip, physics: false, time: playhead(), loop: true });

    expect(playhead()).toBeCloseTo(1.5, 6);
    const reference = clipPoseAt(1.5);
    expect(angle(arm.quaternion, reference['左腕'])).toBeLessThan(EXACT);
    expect(angle(upper.quaternion, reference['上半身'])).toBeLessThan(EXACT);

    // ...and playback carries on from there.
    step(30);
    expect(playhead()).toBeCloseTo(2, 6);
    expect(angle(arm.quaternion, clipPoseAt(playhead())['左腕'])).toBeLessThan(EXACT);
  });

  it('never bakes the paused pose into the motion', () => {
    const { mesh, head, arm, helper, clip, playhead, step } = newSession();
    step(60);

    // A bone nobody animates holds a leftover pose — what the lifelike layer,
    // or a paused frame, leaves behind on the skeleton.
    head.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 25 * DEG);
    arm.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 40 * DEG);
    helper.update(1 / 60);

    attachClip(helper, mesh, null, { clip, physics: false, time: 1, loop: true });

    expect(playhead()).toBeCloseTo(1, 6);
    expect(angle(head.quaternion, IDENTITY)).toBeLessThan(EXACT); // reset to bind pose
    expect(angle(arm.quaternion, clipPoseAt(1)['左腕'])).toBeLessThan(EXACT); // motion continues
  });

  it('shows the first frame while paused and never drifts', () => {
    const model = makeTestModel();
    const helper = new MMDAnimationHelper({ sync: true });
    attachClip(helper, model.mesh, null, { clip: makeTestClip(), physics: false, time: 0.4, loop: true });

    expect(angle(model.arm.quaternion, clipPoseAt(0.4)['左腕'])).toBeLessThan(EXACT);
    for (let i = 0; i < 120; i++) helper.update(0); // paused frames
    expect(angle(model.arm.quaternion, clipPoseAt(0.4)['左腕'])).toBeLessThan(EXACT);
  });

  it('detaches cleanly and can be re-attached', () => {
    const { mesh, helper, clip } = newSession();
    expect(isAttached(helper, mesh)).toBe(true);
    detachClip(helper, mesh);
    expect(isAttached(helper, mesh)).toBe(false);
    expect(attachClip(helper, mesh, null, { clip, physics: false, time: 0, loop: true })).toBe(true);
    expect(isAttached(helper, mesh)).toBe(true);
  });
});

describe('seekClip', () => {
  it('lands exactly on the requested time and continues from there', () => {
    const { mesh, arm, helper, clip, playhead, step } = newSession();
    step(30);

    seekClip(helper, mesh, null, clip, 0.5);
    expect(playhead()).toBeCloseTo(0.5, 6);
    expect(angle(arm.quaternion, clipPoseAt(0.5)['左腕'])).toBeLessThan(EXACT);

    seekClip(helper, mesh, null, clip, 1.75);
    expect(playhead()).toBeCloseTo(1.75, 6);
    expect(angle(arm.quaternion, clipPoseAt(1.75)['左腕'])).toBeLessThan(EXACT);

    step(30); // 0.5 s later we are at 2.25 s -> looped to 0.25 s
    expect(playhead()).toBeCloseTo(0.25, 6);
    expect(angle(arm.quaternion, clipPoseAt(playhead())['左腕'])).toBeLessThan(EXACT);
  });

  it('loops instead of freezing at the end of the clip', () => {
    const { arm, playhead, step } = newSession();
    step(150); // 2.5 s: past the 2 s clip
    expect(playhead()).toBeCloseTo(0.5, 6);
    expect(angle(arm.quaternion, clipPoseAt(0.5)['左腕'])).toBeLessThan(EXACT);
  });
});

describe('lifelike layer interaction', () => {
  it('keeps the motion exact and its own offsets bounded', () => {
    const model = makeTestModel();
    model.mesh.morphTargetDictionary = { まばたき: 0 };
    model.mesh.morphTargetInfluences = [0];

    const helper = new MMDAnimationHelper({ sync: true });
    const rig = new LifelikeRig(model.mesh, 3);
    rig.options.blinkInterval = 1;
    const clip = makeTestClip();
    attachClip(helper, model.mesh, rig, { clip, physics: false, time: 0, loop: true });

    const camera = new PerspectiveCamera();
    camera.position.set(4, 1.2, 6);
    camera.updateMatrixWorld(true);

    for (let i = 0; i < 235; i++) {
      helper.update(1 / 60);
      rig.update(1 / 60, camera);
    }

    const playhead = mixerOf(helper, model.mesh)!.clipAction(clip).time;
    const reference = clipPoseAt(playhead);
    // Arms are driven by the clip alone.
    expect(angle(model.arm.quaternion, reference['左腕'])).toBeLessThan(EXACT);
    // Torso = clip + breathing/sway, head = look-at only.
    expect(angle(model.upper.quaternion, reference['上半身'])).toBeLessThan(8 * DEG);
    expect(angle(model.head.quaternion, IDENTITY)).toBeLessThan(30 * DEG);

    // Seeking while the lifelike layer runs stays deterministic too.
    seekClip(helper, model.mesh, rig, clip, 0.25);
    expect(angle(model.arm.quaternion, clipPoseAt(0.25)['左腕'])).toBeLessThan(EXACT);
    for (let i = 0; i < 30; i++) {
      helper.update(1 / 60);
      rig.update(1 / 60, camera);
    }
    const playhead2 = mixerOf(helper, model.mesh)!.clipAction(clip).time;
    expect(angle(model.arm.quaternion, clipPoseAt(playhead2)['左腕'])).toBeLessThan(EXACT);
  });
});
