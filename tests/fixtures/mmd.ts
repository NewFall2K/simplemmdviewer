import {
  AnimationClip,
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three';

export interface TestModel {
  mesh: SkinnedMesh;
  upper: Bone;
  neck: Bone;
  head: Bone;
  eyeL: Bone;
  eyeR: Bone;
  arm: Bone;
  bones: Bone[];
}

const axis = (deg: number, x: number, y: number, z: number): number[] =>
  new Quaternion().setFromAxisAngle(new Vector3(x, y, z).normalize(), (deg * Math.PI) / 180).toArray();

/** Head/eyes/arm skeleton shaped like an MMD model (bone order matters: indices 0..5). */
export function makeTestModel(): TestModel {
  const bone = (name: string, parent: Bone | null, pos: [number, number, number] = [0, 0, 0]): Bone => {
    const b = new Bone();
    b.name = name;
    b.position.set(...pos);
    if (parent) parent.add(b);
    return b;
  };

  const upper = bone('上半身', null);
  const neck = bone('首', upper, [0, 1, 0]);
  const head = bone('頭', neck, [0, 0.5, 0]);
  const eyeL = bone('左目', head, [0.1, 0, 0.2]);
  const eyeR = bone('右目', head, [-0.1, 0, 0.2]);
  const arm = bone('左腕', upper, [0.5, 0.8, 0]);
  const bones = [upper, neck, head, eyeL, eyeR, arm];

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 1, 0, 1, 0, 0], 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(12).fill(0), 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  geometry.userData.MMD = { iks: [], grants: [], format: 'pmd', bones: [] };

  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  mesh.add(upper);
  mesh.bind(new Skeleton(bones));
  mesh.updateMatrixWorld(true);
  return { mesh, upper, neck, head, eyeL, eyeR, arm, bones };
}

export const CLIP_DURATION = 2;

/** A VMD-shaped clip: 上半身 (bones[0]) and 左腕 (bones[5]) are animated, the rest is not. */
export function makeTestClip(): AnimationClip {
  const twist = new QuaternionKeyframeTrack('.bones[0].quaternion', [0, 2], [0, 0, 0, 1, ...axis(40, 0, 1, 0)]);
  const swing = new QuaternionKeyframeTrack('.bones[5].quaternion', [0, 2], [0, 0, 0, 1, ...axis(60, 1, 0, 0)]);
  return new AnimationClip('vmd', CLIP_DURATION, [twist, swing]);
}
