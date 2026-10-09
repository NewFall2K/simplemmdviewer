import { describe, expect, it } from 'vitest';
import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import { LifelikeRig, findBones } from '../src/mmd/rig';

/** Head at (0, 1.8, 0) facing +Z, with eyes and an upper-body chain, MMD style. */
function makeModel() {
  const upper = new Bone();
  upper.name = '上半身';
  const neck = new Bone();
  neck.name = '首';
  neck.position.set(0, 1.2, 0);
  upper.add(neck);
  const head = new Bone();
  head.name = '頭';
  head.position.set(0, 0.6, 0);
  neck.add(head);
  const eyeL = new Bone();
  eyeL.name = '左目';
  eyeL.position.set(0.15, 0, 0.3);
  head.add(eyeL);
  const eyeR = new Bone();
  eyeR.name = '右目';
  eyeR.position.set(-0.15, 0, 0.3);
  head.add(eyeR);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 1, 0, 1, 0, 0], 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(12).fill(0), 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  mesh.add(upper);
  mesh.bind(new Skeleton([upper, neck, head, eyeL, eyeR]));
  mesh.updateMatrixWorld(true);
  return { mesh, upper, neck, head, eyeL, eyeR };
}

function gaze(mesh: SkinnedMesh, bone: Bone): Vector3 {
  mesh.updateMatrixWorld(true);
  return new Vector3(0, 0, 1).applyQuaternion(bone.getWorldQuaternion(new Quaternion())).normalize();
}

function cameraAt(x: number, y: number, z: number): PerspectiveCamera {
  const camera = new PerspectiveCamera();
  camera.position.set(x, y, z);
  camera.updateMatrixWorld(true);
  return camera;
}

const quiet = { lookAt: false, breathe: false, sway: false, blink: false };

describe('findBones', () => {
  it('matches the standard MMD bone names', () => {
    const { mesh } = makeModel();
    const bones = findBones(mesh.skeleton.bones);
    expect(bones.head?.name).toBe('頭');
    expect(bones.neck?.name).toBe('首');
    expect(bones.upper?.name).toBe('上半身');
    expect(bones.eyeL?.name).toBe('左目');
    expect(bones.eyeR?.name).toBe('右目');
    expect(bones.waist).toBeUndefined();
  });
});

describe('look-at', () => {
  it('turns the head towards the viewer', () => {
    const { mesh, head } = makeModel();
    const rig = new LifelikeRig(mesh, 1);
    Object.assign(rig.options, quiet, { lookAt: true, lookStrength: 1 });

    const camera = cameraAt(2, 2.0, 8);
    rig.update(1 / 60, camera);

    const expected = camera.position.clone().sub(head.getWorldPosition(new Vector3())).normalize();
    expect(gaze(mesh, head).dot(expected)).toBeGreaterThan(0.999);
  });

  it('clamps pitch so the head does not bend backwards', () => {
    const { mesh, head } = makeModel();
    const rig = new LifelikeRig(mesh, 1);
    Object.assign(rig.options, quiet, { lookAt: true, lookStrength: 1 });

    rig.update(1 / 60, cameraAt(0, 20, 2));

    const dir = gaze(mesh, head);
    expect(dir.y).toBeGreaterThan(0.2); // looking up…
    expect(dir.y).toBeLessThan(0.28); // …but only ~13° above the horizon
  });

  it('clamps yaw to a natural head turn', () => {
    const { mesh, head } = makeModel();
    const rig = new LifelikeRig(mesh, 1);
    Object.assign(rig.options, quiet, { lookAt: true, lookStrength: 1 });

    rig.update(1 / 60, cameraAt(-50, 1.8, 1));

    const dir = gaze(mesh, head);
    const yaw = Math.atan2(dir.x, dir.z) * (180 / Math.PI);
    expect(Math.abs(yaw)).toBeGreaterThan(20);
    expect(Math.abs(yaw)).toBeLessThan(25);
  });

  it('honours the strength slider', () => {
    const { mesh, head } = makeModel();
    const rig = new LifelikeRig(mesh, 1);
    Object.assign(rig.options, quiet, { lookAt: true, lookStrength: 0.5 });

    rig.update(1 / 60, cameraAt(2, 1.8, 8));

    const dir = gaze(mesh, head);
    const yaw = Math.atan2(dir.x, dir.z) * (180 / Math.PI);
    // Full look-at would be ~14°; half strength lands near half of it.
    expect(yaw).toBeGreaterThan(5);
    expect(yaw).toBeLessThan(10);
  });

  it('does nothing when disabled', () => {
    const { mesh, head } = makeModel();
    const rig = new LifelikeRig(mesh, 1);
    Object.assign(rig.options, quiet, { lookAt: false });
    rig.update(1 / 60, cameraAt(20, 2, 8));
    expect(head.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-6);
  });
});

describe('layered offsets', () => {
  const DEG = Math.PI / 180;

  it('does not accumulate when no animation mixer is running', () => {
    const { mesh, upper } = makeModel();
    const rig = new LifelikeRig(mesh, 1);
    Object.assign(rig.options, quiet, { breathe: true, breathRate: 14, breathDepth: 3 });

    for (let i = 0; i < 600; i++) rig.update(1 / 60, cameraAt(0, 1.8, 8));

    expect(upper.quaternion.angleTo(new Quaternion())).toBeLessThan(10 * DEG);
  });

  it('lays on top of a pose written by the mixer every frame', () => {
    const { mesh, upper } = makeModel();
    const rig = new LifelikeRig(mesh, 1);
    Object.assign(rig.options, quiet, { breathe: true, breathRate: 14, breathDepth: 3, sway: true, swayAmount: 1 });

    const animated = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 30 * DEG);
    for (let i = 0; i < 300; i++) {
      upper.quaternion.copy(animated); // what the MMDAnimationHelper mixer would do
      rig.update(1 / 60, cameraAt(0, 1.8, 8));
      expect(upper.quaternion.angleTo(animated)).toBeLessThan(6 * DEG);
    }
  });
});

describe('blinking', () => {
  it('drives the model blink morphs', () => {
    const { mesh } = makeModel();
    mesh.morphTargetDictionary = { まばたき: 0, ウィンク: 1 };
    mesh.morphTargetInfluences = [0, 0];
    const rig = new LifelikeRig(mesh, 5);
    Object.assign(rig.options, quiet, { blink: true, blinkInterval: 1, winkChance: 0 });

    let peak = 0;
    for (let i = 0; i < 60 * 4; i++) {
      rig.update(1 / 60, cameraAt(0, 1.8, 8));
      peak = Math.max(peak, mesh.morphTargetInfluences![0]);
    }
    expect(peak).toBeGreaterThan(0.99);
    expect(mesh.morphTargetInfluences![1]).toBe(0);
  });

  it('opens the eye again after every blink (regression: eyes stayed shut)', () => {
    const { mesh } = makeModel();
    mesh.morphTargetDictionary = { まばたき: 0 };
    mesh.morphTargetInfluences = [0];
    const rig = new LifelikeRig(mesh, 5);
    Object.assign(rig.options, quiet, { blink: true, blinkInterval: 1 });

    let peak = 0;
    for (let i = 0; i < 60 * 12; i++) {
      rig.update(1 / 60, cameraAt(0, 1.8, 8));
      peak = Math.max(peak, mesh.morphTargetInfluences![0]);
    }
    expect(peak).toBeGreaterThan(0.99);
    expect(mesh.morphTargetInfluences![0]).toBe(0);
  });

  it('releases a blink that is in progress when blinking is switched off', () => {
    const { mesh } = makeModel();
    mesh.morphTargetDictionary = { まばたき: 0 };
    mesh.morphTargetInfluences = [0];
    const rig = new LifelikeRig(mesh, 9);
    Object.assign(rig.options, quiet, { blink: true, blinkInterval: 0.4 });

    rig.triggerBlink();
    for (let i = 0; i < 10 && mesh.morphTargetInfluences![0] < 0.5; i++) {
      rig.update(1 / 60, cameraAt(0, 1.8, 8));
    }
    expect(mesh.morphTargetInfluences![0]).toBeGreaterThan(0.5);

    rig.options.blink = false;
    rig.update(1 / 60, cameraAt(0, 1.8, 8));
    expect(mesh.morphTargetInfluences![0]).toBe(0);
  });

  it('never cancels a blink written by the motion data', () => {
    const { mesh } = makeModel();
    mesh.morphTargetDictionary = { まばたき: 0 };
    mesh.morphTargetInfluences = [0];
    const rig = new LifelikeRig(mesh, 4);
    Object.assign(rig.options, quiet, { blink: true, blinkInterval: 1 });

    for (let i = 0; i < 60 * 6; i++) {
      // What the animation mixer does for a morph that has a VMD track.
      mesh.morphTargetInfluences![0] = 0.6;
      rig.update(1 / 60, cameraAt(0, 1.8, 8));
      expect(mesh.morphTargetInfluences![0]).toBeGreaterThanOrEqual(0.6);
    }
  });

  it('disables blinking when asked', () => {
    const { mesh } = makeModel();
    mesh.morphTargetDictionary = { まばたき: 0 };
    mesh.morphTargetInfluences = [0];
    const rig = new LifelikeRig(mesh, 5);
    Object.assign(rig.options, quiet, { blink: false });

    for (let i = 0; i < 60 * 6; i++) rig.update(1 / 60, cameraAt(0, 1.8, 8));
    expect(mesh.morphTargetInfluences![0]).toBe(0);
  });
});

describe('resetPose', () => {
  it('restores the bind pose', () => {
    const { mesh, upper } = makeModel();
    const rig = new LifelikeRig(mesh, 1);
    Object.assign(rig.options, quiet, { breathe: true });
    for (let i = 0; i < 60; i++) rig.update(1 / 60, cameraAt(0, 1.8, 8));
    expect(upper.quaternion.angleTo(new Quaternion())).toBeGreaterThan(0);

    rig.resetPose();
    expect(upper.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-9);
  });

  it('keeps idling correctly after a reset', () => {
    const { mesh, upper } = makeModel();
    const rig = new LifelikeRig(mesh, 1);
    Object.assign(rig.options, quiet, { breathe: true, breathDepth: 3 });
    for (let i = 0; i < 120; i++) rig.update(1 / 60, cameraAt(0, 1.8, 8));
    rig.resetPose();
    for (let i = 0; i < 120; i++) rig.update(1 / 60, cameraAt(0, 1.8, 8));
    expect(upper.quaternion.angleTo(new Quaternion())).toBeLessThan(10 * (Math.PI / 180));
  });
});
