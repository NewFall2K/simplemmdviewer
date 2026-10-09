import { describe, expect, it } from 'vitest';
import { AnimationClip, QuaternionKeyframeTrack, NumberKeyframeTrack } from 'three';
import { mergeClips } from '../src/lib/clip';

const bone = (name: string, duration: number, value: number) =>
  new QuaternionKeyframeTrack(name, [0, duration], [0, 0, 0, 1, 0, 0, value, 1]);

describe('mergeClips', () => {
  it('returns null when there is nothing to play', () => {
    expect(mergeClips([])).toBeNull();
    expect(mergeClips([new AnimationClip('empty', 0, [])])).toBeNull();
  });

  it('combines tracks from a dance and a facial motion', () => {
    const dance = new AnimationClip('dance', 4, [bone('.bones[1].quaternion', 4, 0.2)]);
    const face = new AnimationClip('face', 6, [new NumberKeyframeTrack('.morphTargetInfluences[0]', [0, 6], [0, 1])]);
    const merged = mergeClips([dance, face]);
    expect(merged).not.toBeNull();
    expect(merged!.duration).toBe(6);
    expect(merged!.tracks.map((t) => t.name).sort()).toEqual([
      '.bones[1].quaternion',
      '.morphTargetInfluences[0]',
    ]);
  });

  it('lets the later motion win for the same track', () => {
    const a = new AnimationClip('a', 2, [bone('.bones[1].quaternion', 2, 0.1)]);
    const b = new AnimationClip('b', 3, [bone('.bones[1].quaternion', 3, 0.9)]);
    const merged = mergeClips([a, b])!;
    expect(merged.tracks).toHaveLength(1);
    expect(merged.duration).toBe(3);
  });
});
