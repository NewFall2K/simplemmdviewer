import { describe, expect, it } from 'vitest';
import { AssetBundle, basename, dirname, normalizePath } from '../src/lib/assets';

function file(name: string, path: string, size = 10): File {
  const f = new File([new Uint8Array(size)], name);
  Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
}

describe('path helpers', () => {
  it('normalizes windows paths', () => {
    expect(normalizePath('Miku\\tex\\body.png')).toBe('miku/tex/body.png');
    expect(basename('Miku\\tex\\body.png')).toBe('body.png');
    expect(dirname('Miku\\Miku.pmx')).toBe('miku/');
  });
});

describe('AssetBundle', () => {
  it('lists pmx/pmd models and vmd motions from a picked folder', () => {
    const bundle = new AssetBundle();
    bundle.addAll([
      file('Miku.pmx', 'Miku/Miku.pmx'),
      file('other.pmd', 'Miku/vendor/other.pmd'),
      file('body.png', 'Miku/tex/body.png'),
      file('wave.vmd', 'Miku/wave.vmd'),
      file('readme.txt', 'Miku/readme.txt'),
    ]);
    expect(bundle.models.map((m) => m.name)).toEqual(['Miku.pmx', 'other.pmd']);
    expect(bundle.motions.map((m) => m.name)).toEqual(['wave.vmd']);
    expect(bundle.fileCount).toBe(5);
  });

  it('resolves PMX texture paths relative to the model folder', () => {
    const bundle = new AssetBundle();
    const model = file('Miku.pmx', 'Miku/Miku.pmx');
    bundle.addAll([model, file('body.png', 'Miku/tex/body.png'), file('eyeM2.bmp', 'Miku/errors/eyeM2.bmp')]);
    bundle.setModelDirFrom(bundle.models[0]);

    // MMDLoader builds `resourcePath + texturePath`, we use "/" as resourcePath.
    const body = bundle.resolve('/tex/body.png');
    expect(body).toMatch(/^blob:/);
    // Backslashes and case differences must still resolve.
    expect(bundle.resolve('/TEX\\BODY.PNG')).toBe(body);
    // Falls back to matching by basename.
    expect(bundle.resolve('/whereever/eyeM2.bmp')).toMatch(/^blob:/);
    // Unknown files keep their original URL.
    expect(bundle.resolve('https://cdn.example.com/toon01.bmp')).toBeNull();
  });

  it('does not mangle blob: URLs handed back to the loader', () => {
    const bundle = new AssetBundle();
    bundle.addAll([file('Miku.pmx', 'Miku/Miku.pmx')]);
    expect(bundle.resolve('blob:http://localhost:5173/1a2b3c')).toBeNull();
  });

  it('reuses one object URL per file', () => {
    const bundle = new AssetBundle();
    const model = file('Miku.pmx', 'Miku/Miku.pmx');
    bundle.addAll([model, file('body.png', 'Miku/body.png')]);
    bundle.setModelDirFrom(bundle.models[0]);
    expect(bundle.resolve('/body.png')).toBe(bundle.resolve('body.png'));
  });
});
