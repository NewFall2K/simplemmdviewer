/** Recursively collect files from a drag & drop (folders included). */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < dt.items.length; i++) {
    const item = dt.items[i];
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (entry) entries.push(entry);
  }

  if (entries.length === 0) return Array.from(dt.files ?? []);

  const files: File[] = [];
  for (const entry of entries) await walkEntry(entry, files, '');
  return files.length > 0 ? files : Array.from(dt.files ?? []);
}

async function walkEntry(entry: FileSystemEntry, out: File[], prefix: string): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file(
        (file) => {
          // Keep the folder structure so PMX texture paths still resolve.
          out.push(prefix ? renameWithPath(file, path) : file);
          resolve();
        },
        () => resolve(),
      );
    });
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children: FileSystemEntry[] = [];
    // readEntries yields at most 100 entries per call.
    await new Promise<void>((resolve) => {
      const readBatch = () => {
        reader.readEntries(
          (batch) => {
            if (batch.length === 0) resolve();
            else {
              children.push(...batch);
              readBatch();
            }
          },
          () => resolve(),
        );
      };
      readBatch();
    });
    for (const child of children) await walkEntry(child, out, path);
  }
}

/** Wrap a File so it keeps its dropped path (AssetBundle reads webkitRelativePath). */
function renameWithPath(file: File, path: string): File {
  const clone = new File([file], path.split('/').pop() ?? file.name, { type: file.type, lastModified: file.lastModified });
  Object.defineProperty(clone, 'webkitRelativePath', { value: path });
  return clone;
}
