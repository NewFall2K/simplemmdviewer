import { AnimationClip, LoadingManager, type SkinnedMesh } from 'three';
import { MMDLoader } from 'three/examples/jsm/loaders/MMDLoader.js';
import type { AssetBundle, SourceEntry } from '../lib/assets';

/**
 * LoadingManager that maps every URL three.js asks for onto a picked file
 * (blob: URL) when we have it, and leaves remote/CDN URLs untouched.
 */
export function createAssetsManager(bundle: AssetBundle | null, onMissing?: (url: string) => void): LoadingManager {
  const manager = new LoadingManager();
  if (bundle) {
    manager.setURLModifier((url) => bundle.resolve(url) ?? url);
  }
  if (onMissing) manager.onError = (url) => onMissing(url);
  return manager;
}

/** A PMX/PMD model from a picked folder. */
export function loadModelFromBundle(
  bundle: AssetBundle,
  entry: SourceEntry,
  onMissing?: (url: string) => void,
): Promise<SkinnedMesh> {
  bundle.setModelDirFrom(entry);
  const loader = new MMDLoader(createAssetsManager(bundle, onMissing));
  // PMX texture paths are relative to the model file; the manager rewrites them.
  loader.setResourcePath('/');
  const url = bundle.urlForEntry(entry);

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (mesh) => resolve(mesh),
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
}

/** A model (PMD/PMX) plus its textures from a remote URL (used by the demo). */
export function loadModelFromUrl(url: string, baseUrl: string, onMissing?: (url: string) => void): Promise<SkinnedMesh> {
  const loader = new MMDLoader(createAssetsManager(null, onMissing));
  loader.setResourcePath(baseUrl);
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (mesh) => resolve(mesh),
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
}

/** A VMD motion clip, filtered to the bones/morphs the given model actually has. */
export function loadMotionFromBundle(entry: SourceEntry, bundle: AssetBundle, mesh: SkinnedMesh): Promise<AnimationClip> {
  const loader = new MMDLoader(createAssetsManager(bundle));
  const url = bundle.urlForEntry(entry);
  return loadMotionClip(loader, url, mesh);
}

export function loadMotionFromUrl(url: string, mesh: SkinnedMesh): Promise<AnimationClip> {
  const loader = new MMDLoader();
  return loadMotionClip(loader, url, mesh);
}

function loadMotionClip(loader: MMDLoader, url: string, mesh: SkinnedMesh): Promise<AnimationClip> {
  return new Promise((resolve, reject) => {
    loader.loadAnimation(
      url,
      mesh,
      (clip) => {
        if (clip instanceof AnimationClip) resolve(clip);
        else reject(new Error('VMD file did not produce an animation clip'));
      },
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
}
