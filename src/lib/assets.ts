/**
 * Everything the user picked (a folder, some files, or a drag & drop) is kept
 * here so three.js can load it without a server: PMX/PMD models, their sibling
 * textures and VMD motions are all handed out as `blob:` object URLs.
 *
 * PMX texture paths are stored relative to the model file (often with Windows
 * backslashes, e.g. `tex\\body.png`), so resolution tries the path relative to
 * the model folder first and falls back to a case-insensitive basename match.
 */

export interface SourceEntry {
  kind: 'model' | 'motion';
  /** basename, used for display */
  name: string;
  /** normalized (posix, lower case) path inside the picked folder */
  path: string;
  file: File;
  size: number;
}

const MODEL_RE = /\.(pmx|pmd)$/i;
const MOTION_RE = /\.vmd$/i;

export function normalizePath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\//, '')
    .toLowerCase();
}

export function basename(p: string): string {
  const n = normalizePath(p);
  const i = n.lastIndexOf('/');
  return i < 0 ? n : n.slice(i + 1);
}

/** Original (un-lowercased) last path segment, for display. */
export function displayName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export function dirname(p: string): string {
  const n = normalizePath(p);
  const i = n.lastIndexOf('/');
  return i < 0 ? '' : n.slice(0, i + 1);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export class AssetBundle {
  readonly models: SourceEntry[] = [];
  readonly motions: SourceEntry[] = [];
  /** number of files added in total (for the "N files" hint) */
  fileCount = 0;

  private byPath = new Map<string, File>();
  private byName = new Map<string, File>();
  private urls = new Map<File, string>();
  /** normalized folder of the model currently being loaded, e.g. `miku/` */
  private modelDir = '';

  get isEmpty(): boolean {
    return this.fileCount === 0;
  }

  add(file: File, pathOverride?: string): void {
    const raw = pathOverride ?? (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
    const path = normalizePath(raw || file.name);
    if (path) {
      if (!this.byPath.has(path)) this.byPath.set(path, file);
      const name = basename(path);
      if (!this.byName.has(name)) this.byName.set(name, file);
    }
    this.fileCount++;

    const label = displayName(raw || file.name) || file.name;
    if (MODEL_RE.test(path)) {
      this.models.push({ kind: 'model', name: label, path, file, size: file.size });
    } else if (MOTION_RE.test(path)) {
      this.motions.push({ kind: 'motion', name: label, path, file, size: file.size });
    }
  }

  addAll(files: Iterable<File>): void {
    for (const f of files) this.add(f);
  }

  addFileList(files: FileList | null | undefined): void {
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const f = files.item(i);
      if (f) this.add(f);
    }
  }

  /** Object URL for a file, created once and reused. */
  urlFor(file: File): string {
    let url = this.urls.get(file);
    if (!url) {
      url = URL.createObjectURL(file);
      this.urls.set(file, url);
    }
    return url;
  }

  urlForEntry(entry: SourceEntry): string {
    return this.urlFor(entry.file);
  }

  /** Called before loading a model so relative texture paths resolve inside its folder. */
  setModelDirFrom(entry: SourceEntry): void {
    this.modelDir = dirname(entry.path);
  }

  /** Last segment of the current model folder, e.g. `miku` for `miku/miku.pmx`. */
  get modelFolderName(): string {
    const d = this.modelDir.replace(/\/$/, '');
    const i = d.lastIndexOf('/');
    return i < 0 ? d : d.slice(i + 1);
  }

  hasPath(p: string): boolean {
    return this.byPath.has(normalizePath(p));
  }

  fileAtPath(p: string): File | undefined {
    return this.byPath.get(normalizePath(p));
  }

  /**
   * Map a URL requested by MMDLoader (its `resourcePath + texturePath`) onto a
   * picked file. Returns an object URL, or null when we do not have the file
   * (e.g. remote/CDN models keep their original URL).
   */
  resolve(url: string): string | null {
    let clean = url;
    try {
      clean = decodeURIComponent(url);
    } catch {
      /* keep raw */
    }
    // MMDLoader prepends a resourcePath; reduce whatever we get to a plain
    // relative path ("blob:http://host/dir/tex/b.png" -> "dir/tex/b.png").
    clean = normalizePath(clean).replace(/^blob:/, '');
    const scheme = /^[a-z][a-z0-9+.\-]*:\/\//.exec(clean);
    if (scheme) clean = clean.slice(scheme[0].length).replace(/^[^/]*\//, '');
    if (!clean) return null;

    const direct = this.byPath.get(clean);
    if (direct) return this.urlFor(direct);

    if (this.modelDir) {
      const inFolder = this.byPath.get(this.modelDir + clean);
      if (inFolder) return this.urlFor(inFolder);
      // texture path may be absolute-ish ("C:/foo/tex/body.png")
      const tail = clean.replace(/^.*?\/(?=[^/]+\/?$)/, '');
      const inFolderTail = tail ? this.byPath.get(this.modelDir + tail) : undefined;
      if (inFolderTail) return this.urlFor(inFolderTail);
    }

    const byName = this.byName.get(basename(clean));
    return byName ? this.urlFor(byName) : null;
  }

  dispose(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.byPath.clear();
    this.byName.clear();
    this.models.length = 0;
    this.motions.length = 0;
    this.fileCount = 0;
    this.modelDir = '';
  }
}
