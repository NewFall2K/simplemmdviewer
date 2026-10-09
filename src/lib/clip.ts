import { AnimationClip, type KeyframeTrack } from 'three';

/**
 * Merge several VMD clips (dance + face + lip) into one clip.
 * Later tracks win when two motions animate the same bone/morph.
 */
export function mergeClips(clips: AnimationClip[], name = 'motion'): AnimationClip | null {
  const usable = clips.filter((c) => c && c.tracks.length > 0);
  if (usable.length === 0) return null;

  const byName = new Map<string, KeyframeTrack>();
  let duration = 0;
  for (const clip of usable) {
    duration = Math.max(duration, clip.duration);
    for (const track of clip.tracks) {
      byName.set(track.name, track);
    }
  }
  return new AnimationClip(name, duration, [...byName.values()]);
}
