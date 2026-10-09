import './style.css';
import { Viewer, type MotionEntry } from './viewer';
import { AssetBundle, formatSize, type SourceEntry } from './lib/assets';
import { filesFromDataTransfer } from './lib/drop';
import { GROUP_LABEL, MORPH_GROUPS, type MorphGroup } from './lib/morphs';
import { loadAmmo } from './mmd/ammo';
import { loadModelFromBundle, loadModelFromUrl, loadMotionFromBundle, loadMotionFromUrl } from './mmd/loader';

const DEMO_BASE = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r171/examples/models/mmd/';

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}

const canvas = $<HTMLCanvasElement>('stage');
const viewer = new Viewer(canvas);
const bundle = new AssetBundle();

let selectedModel: string | null = null;
let activeGroup: MorphGroup | 'all' = 'all';
let morphSearch = '';
let seeking = false;
let overlayDepth = 0;
let motionCounter = 0;

// ---------------------------------------------------------------- status ui

function setStatus(text: string, kind: 'info' | 'error' = 'info'): void {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', kind === 'error');
  if (kind === 'error') console.error('[mmd]', text);
  else console.info('[mmd]', text);
}

function showOverlay(text: string): void {
  overlayDepth++;
  $('overlay-text').textContent = text;
  $('overlay').hidden = false;
}

function hideOverlay(): void {
  overlayDepth = Math.max(0, overlayDepth - 1);
  if (overlayDepth === 0) $('overlay').hidden = true;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

// ------------------------------------------------------------- model picker

function refreshModelList(): void {
  const list = $('model-list');
  list.innerHTML = '';

  if (bundle.models.length === 0) {
    list.innerHTML = '<em class="muted">No .pmx / .pmd found in the picked folder.</em>';
  } else {
    const folderNote = document.createElement('div');
    folderNote.className = 'muted tiny';
    folderNote.textContent = `${bundle.models.length} model file(s) · ${bundle.fileCount} files in folder`;
    list.append(folderNote);

    for (const entry of bundle.models) {
      const row = document.createElement('div');
      row.className = 'item' + (selectedModel === entry.path ? ' sel' : '');

      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'model-choice';
      radio.checked = selectedModel === entry.path;
      radio.addEventListener('change', () => {
        selectedModel = entry.path;
        refreshModelList();
      });

      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = entry.name;

      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `${entry.path.endsWith('.pmx') ? 'PMX' : 'PMD'} · ${formatSize(entry.size)}`;

      label.append(radio, name, meta);
      row.append(label);
      list.append(row);
    }
  }

  ($('btn-load-model') as HTMLButtonElement).disabled = !selectedModel;
}

async function loadSelectedModel(): Promise<void> {
  const entry = bundle.models.find((m) => m.path === selectedModel) ?? bundle.models[0];
  if (!entry) {
    setStatus('Pick a folder that contains a .pmx or .pmd model first', 'error');
    return;
  }

  $('model-info').textContent = `Loading ${entry.name}…`;
  showOverlay(`Loading ${entry.name}…`);
  try {
    const mesh = await loadModelFromBundle(bundle, entry, (url) => {
      setStatus(`missing texture: ${url.split('/').pop()}`, 'error');
    });
    adoptModel(mesh, `${entry.name} · ${bundle.modelFolderName || 'folder'}`);
  } catch (err) {
    $('model-info').textContent = `Failed to load ${entry.name}`;
    setStatus(`Failed to load ${entry.name}: ${describeError(err)}`, 'error');
  } finally {
    hideOverlay();
  }
}

async function loadDemo(): Promise<void> {
  showOverlay('Loading demo model (three.js sample)…');
  try {
    const mesh = await loadModelFromUrl(`${DEMO_BASE}miku/miku_v2.pmd`, `${DEMO_BASE}miku/`, (url) =>
      setStatus(`missing texture: ${url.split('/').pop()}`, 'error'),
    );
    adoptModel(mesh, 'miku_v2.pmd · demo');

    showOverlay('Loading demo motion…');
    const clip = await loadMotionFromUrl(`${DEMO_BASE}vmds/wavefile_v2.vmd`, mesh);
    addClip('wavefile_v2.vmd · demo', clip);
    setStatus('Demo loaded — try the Lifelike and Morphs panels');
  } catch (err) {
    setStatus(`Demo failed (needs internet): ${describeError(err)}`, 'error');
  } finally {
    hideOverlay();
  }
}

function adoptModel(mesh: Parameters<Viewer['useModel']>[0], label: string): void {
  const rig = viewer.useModel(mesh);
  const mmd = (mesh.geometry.userData as { MMD?: { format?: string; rigidBodies?: unknown[] } }).MMD;
  const materials = Array.isArray(mesh.material) ? mesh.material.length : 1;

  $('model-info').innerHTML =
    `<b>${label}</b><br>` +
    `${(mmd?.format ?? 'pmx').toUpperCase()} · ${mesh.geometry.attributes.position.count.toLocaleString()} verts · ` +
    `${mesh.skeleton.bones.length} bones · ${viewer.morphs.length} morphs · ${materials} materials · ` +
    `${mmd?.rigidBodies?.length ?? 0} physics bodies`;

  buildMorphList();
  refreshMotionList();

  const missing: string[] = [];
  if (rig.blinkMorphs.blink.length === 0 && rig.blinkMorphs.winkL.length === 0 && rig.blinkMorphs.winkR.length === 0) {
    missing.push('no まばたき/blink morph');
    $<HTMLInputElement>('chk-blink').checked = false;
    viewer.setLifelike({ blink: false });
  }
  if (!rig.hasGaze) {
    missing.push('no head/eye bones for look-at');
    $<HTMLInputElement>('chk-look').checked = false;
    viewer.setLifelike({ lookAt: false });
  }
  setStatus(missing.length ? `Model ready — ${missing.join(', ')}` : 'Model ready', missing.length ? 'error' : 'info');
  ($('btn-motion') as HTMLButtonElement).disabled = false;
  ($('btn-tpose') as HTMLButtonElement).disabled = false;
}

// -------------------------------------------------------------- motion list

function addClip(label: string, clip: Parameters<Viewer['addMotion']>[0]['clip']): void {
  const entry: MotionEntry = {
    id: `motion-${++motionCounter}`,
    name: label,
    detail: `${clip.duration.toFixed(2)} s · ${clip.tracks.length} tracks`,
    clip,
    enabled: true,
  };
  viewer.addMotion(entry);
  refreshMotionList();
}

async function loadMotionFiles(entries: SourceEntry[]): Promise<void> {
  if (!viewer.mesh) {
    setStatus('Load a model before adding motion', 'error');
    return;
  }
  for (const entry of entries) {
    showOverlay(`Loading ${entry.name}…`);
    try {
      const clip = await loadMotionFromBundle(entry, bundle, viewer.mesh);
      addClip(entry.name, clip);
      setStatus(`Motion ${entry.name} loaded (${clip.tracks.length} tracks) — press Play`);
    } catch (err) {
      setStatus(`Failed to load ${entry.name}: ${describeError(err)}`, 'error');
    } finally {
      hideOverlay();
    }
  }
}

function refreshMotionList(): void {
  const list = $('motion-list');
  list.innerHTML = '';

  if (viewer.motions.length === 0) {
    list.innerHTML = '<em class="muted">No motion loaded</em>';
  } else {
    for (const motion of viewer.motions) {
      const row = document.createElement('div');
      row.className = 'item';

      const label = document.createElement('label');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = motion.enabled;
      check.addEventListener('change', () => {
        viewer.setMotionEnabled(motion.id, check.checked);
        refreshMotionList();
      });

      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = motion.name;

      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = motion.detail;

      label.append(check, name, meta);
      row.append(label);
      list.append(row);
    }
  }

  const has = viewer.motions.length > 0;
  ($('btn-play') as HTMLButtonElement).disabled = !has;
  ($('btn-clear-motion') as HTMLButtonElement).disabled = !has;
  ($('rng-speed') as HTMLInputElement).disabled = !has;
  ($('rng-time') as HTMLInputElement).disabled = !has;
  updatePlayButton();
}

function updatePlayButton(): void {
  const button = $('btn-play') as HTMLButtonElement;
  button.textContent = viewer.playing ? 'Pause' : 'Play';
  button.disabled = viewer.motions.length === 0;
  button.title = viewer.playing ? 'Pause the motion (Space)' : 'Play the motion (Space)';
}

// --------------------------------------------------------------- morph list

function buildMorphList(): void {
  const list = $('morph-list');
  list.innerHTML = '';
  $('out-morph-count').textContent = String(viewer.morphs.length);

  if (viewer.morphs.length === 0) {
    list.innerHTML = '<em class="muted">This model has no morphs.</em>';
    return;
  }

  const needle = morphSearch.trim().toLowerCase();
  const shown = viewer.morphs.filter((morph) => {
    if (activeGroup !== 'all' && morph.group !== activeGroup) return false;
    if (!needle) return true;
    return morph.name.toLowerCase().includes(needle) || morph.hint.toLowerCase().includes(needle);
  });

  if (shown.length === 0) {
    list.innerHTML = '<em class="muted">No morph matches the filter.</em>';
    return;
  }

  for (const morph of shown) {
    const row = document.createElement('div');
    row.className = 'morph';

    const nameWrap = document.createElement('div');
    nameWrap.className = 'nm';
    nameWrap.textContent = morph.name;
    if (morph.hint) {
      const hint = document.createElement('span');
      hint.className = 'en';
      hint.textContent = morph.hint;
      nameWrap.append(hint);
    }

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.01';
    slider.value = String(viewer.mesh?.morphTargetInfluences?.[morph.index] ?? 0);

    const lock = document.createElement('div');
    lock.className = 'lock';
    const lockedNow = viewer.isPinned(morph.name);
    lock.textContent = lockedNow ? 'perm' : 'temp';
    lock.title = lockedNow
      ? 'Permanent — re-applied every frame on top of the motion.'
      : 'Temporary — motion can override it. Click to make it permanent.';
    row.classList.toggle('locked', lockedNow);

    const sync = (value: number, locked: boolean) => {
      viewer.setMorph(morph.name, value, locked);
      row.classList.toggle('locked', locked);
      lock.textContent = locked ? 'perm' : 'temp';
      lock.title = locked
        ? 'Permanent — re-applied every frame on top of the motion.'
        : 'Temporary — motion can override it. Click to make it permanent.';
    };

    slider.addEventListener('input', () => sync(Number(slider.value), viewer.isPinned(morph.name)));
    lock.addEventListener('click', () => sync(Number(slider.value), !viewer.isPinned(morph.name)));

    row.append(nameWrap, slider, lock);
    list.append(row);
  }
}

function refreshMorphSliders(): void {
  buildMorphList();
}

// ------------------------------------------------------------- lifelike ui

function wireLifelikeControls(): void {
  const check = (id: string, key: 'lookAt' | 'breathe' | 'blink' | 'sway', extra?: () => void) => {
    const input = $<HTMLInputElement>(id);
    input.addEventListener('change', () => {
      viewer.setLifelike({ [key]: input.checked } as never);
      extra?.();
    });
  };

  const range = (
    id: string,
    outId: string,
    key: 'lookStrength' | 'breathRate' | 'breathDepth' | 'blinkInterval' | 'winkChance' | 'swayAmount',
    format: (v: number) => string,
  ) => {
    const input = $<HTMLInputElement>(id);
    const out = $(outId);
    const apply = () => {
      const value = Number(input.value);
      viewer.setLifelike({ [key]: value } as never);
      out.textContent = format(value);
    };
    input.addEventListener('input', apply);
    apply();
  };

  check('chk-look', 'lookAt');
  check('chk-breathe', 'breathe');
  check('chk-blink', 'blink');
  check('chk-sway', 'sway');

  range('rng-look', 'out-look', 'lookStrength', (v) => `${Math.round(v * 100)}%`);
  range('rng-breath-rate', 'out-breath-rate', 'breathRate', (v) => `${v.toFixed(0)} /min`);
  range('rng-breath-depth', 'out-breath-depth', 'breathDepth', (v) => `${v.toFixed(1)}°`);
  range('rng-blink', 'out-blink', 'blinkInterval', (v) => `${v.toFixed(1)} s`);
  range('rng-wink', 'out-wink', 'winkChance', (v) => `${Math.round(v * 100)}%`);
  range('rng-sway', 'out-sway', 'swayAmount', (v) => `${v.toFixed(1)}°`);

  const physics = $<HTMLInputElement>('chk-physics');
  physics.addEventListener('change', async () => {
    if (!physics.checked) {
      viewer.setPhysics(false);
      setStatus('Physics off');
      return;
    }
    showOverlay('Loading Ammo.js (physics)…');
    try {
      await loadAmmo();
      viewer.setPhysics(true);
      setStatus('Physics on — hair / skirt rigid bodies are simulated');
    } catch (err) {
      physics.checked = false;
      setStatus(`Physics unavailable: ${describeError(err)}`, 'error');
    } finally {
      hideOverlay();
    }
  });
}

// ------------------------------------------------------------------- events

function wireEvents(): void {
  const modelInput = $<HTMLInputElement>('pick-model');
  $('btn-model').addEventListener('click', () => modelInput.click());
  modelInput.addEventListener('change', () => {
    void handleFiles(Array.from(modelInput.files ?? []), folderPickerSupported() ? 'folder' : 'selection');
    modelInput.value = '';
  });

  const motionInput = $<HTMLInputElement>('pick-motion');
  $('btn-motion').addEventListener('click', () => motionInput.click());
  motionInput.addEventListener('change', () => {
    const files = Array.from(motionInput.files ?? []);
    motionInput.value = '';
    void handleMotionFiles(files);
  });

  ($('btn-load-model') as HTMLButtonElement).addEventListener('click', () => void loadSelectedModel());
  $('btn-demo').addEventListener('click', () => void loadDemo());

  $('btn-tpose').addEventListener('click', () => {
    viewer.restPose();
    refreshMorphSliders();
    updatePlayButton();
    setStatus('Rest pose restored');
  });

  $('btn-play').addEventListener('click', () => {
    if (viewer.motions.length === 0) return;
    if (viewer.playing) viewer.pause();
    else if (!viewer.play()) setStatus('Nothing to play — enable a motion first', 'error');
    updatePlayButton();
  });

  $('btn-clear-motion').addEventListener('click', () => {
    viewer.clearMotions();
    refreshMotionList();
    setStatus('Motions cleared');
  });

  $<HTMLInputElement>('chk-loop').addEventListener('change', (event) => {
    viewer.setLoop((event.target as HTMLInputElement).checked);
  });

  const speed = $<HTMLInputElement>('rng-speed');
  speed.addEventListener('input', () => {
    viewer.speed = Number(speed.value);
    $('out-speed').textContent = `${viewer.speed.toFixed(2)}×`;
  });

  const time = $<HTMLInputElement>('rng-time');
  time.addEventListener('pointerdown', () => {
    seeking = true;
  });
  time.addEventListener('pointerup', () => {
    seeking = false;
  });
  time.addEventListener('change', () => {
    seeking = false;
  });
  time.addEventListener('input', () => {
    viewer.seek(Number(time.value));
    $('out-time').textContent = `${(Number(time.value) * viewer.duration).toFixed(2)} s`;
  });

  $<HTMLInputElement>('txt-search').addEventListener('input', (event) => {
    morphSearch = (event.target as HTMLInputElement).value;
    buildMorphList();
  });

  const filters = $('morph-filters');
  const buttons: HTMLButtonElement[] = [];
  const options: Array<MorphGroup | 'all'> = ['all', ...MORPH_GROUPS];
  for (const group of options) {
    const button = document.createElement('button');
    button.className = 'tab' + (group === 'all' ? ' on' : '');
    button.textContent = group === 'all' ? 'All' : GROUP_LABEL[group];
    button.addEventListener('click', () => {
      activeGroup = group;
      for (const other of buttons) other.classList.toggle('on', other === button);
      buildMorphList();
    });
    buttons.push(button);
    filters.append(button);
  }

  $('btn-clear-temp').addEventListener('click', () => {
    viewer.clearTemporaryMorphs();
    refreshMorphSliders();
    setStatus('Temporary morphs reset');
  });

  $('btn-unlock').addEventListener('click', () => {
    viewer.unlockAll();
    refreshMorphSliders();
    setStatus('All morphs unlocked');
  });

  wireDropZone();
  wireLifelikeControls();
}

async function handleFiles(files: File[], source: string): Promise<void> {
  if (files.length === 0) return;
  bundle.addAll(files);
  refreshModelList();
  setStatus(`Added ${files.length} file(s) from ${source}`);

  if (!viewer.mesh && bundle.models.length > 0) {
    if (bundle.models.length === 1) selectedModel = bundle.models[0].path;
    refreshModelList();
    await loadSelectedModel();
  }
}

async function handleMotionFiles(files: File[]): Promise<void> {
  const vmd = files.filter((file) => file.name.toLowerCase().endsWith('.vmd'));
  if (vmd.length === 0) {
    setStatus('No .vmd file in that selection', 'error');
    return;
  }
  bundle.addAll(files);
  refreshModelList();
  await loadMotionFiles(bundle.motions.slice(-vmd.length));
}

function wireDropZone(): void {
  const hint = $('drophint');
  const stop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  window.addEventListener('dragenter', (event) => {
    stop(event);
    hint.hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    stop(event);
    hint.hidden = false;
  });
  window.addEventListener('dragleave', (event) => {
    stop(event);
    if (event.relatedTarget === null) hint.hidden = true;
  });
  window.addEventListener('drop', (event) => {
    stop(event);
    hint.hidden = true;
    const dt = event.dataTransfer;
    if (!dt) return;
    void (async () => {
      const files = await filesFromDataTransfer(dt);
      const hasModel = files.some((file) => /\.(pmx|pmd)$/i.test(file.name));
      await handleFiles(files, 'drop');
      if (!hasModel) await handleMotionFiles(files);
    })();
  });
}

// ---------------------------------------------------------------- chrome ui

const panelTab = $<HTMLButtonElement>('panel-tab');
const narrowQuery = window.matchMedia('(max-width: 860px)');

function isNarrow(): boolean {
  return narrowQuery.matches;
}

function refreshChrome(): void {
  const collapsed = document.body.classList.contains('panel-collapsed');
  panelTab.textContent = isNarrow() ? (collapsed ? 'Panel ▴' : 'Panel ▾') : 'Panel';
  panelTab.title = collapsed ? 'Show the side panel (P)' : 'Hide the side panel (P)';
}

function setPanelCollapsed(collapsed: boolean): void {
  document.body.classList.toggle('panel-collapsed', collapsed);
  refreshChrome();
}

function togglePanel(): void {
  setPanelCollapsed(!document.body.classList.contains('panel-collapsed'));
}

function setUiHidden(hidden: boolean): void {
  document.body.classList.toggle('ui-hidden', hidden);
  refreshChrome();
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

function wireChrome(): void {
  panelTab.addEventListener('click', togglePanel);
  $('btn-panel').addEventListener('click', togglePanel);
  $('btn-ui').addEventListener('click', () => setUiHidden(true));
  $('btn-show-ui').addEventListener('click', () => setUiHidden(false));

  window.addEventListener('keydown', (event) => {
    if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'h') {
      setUiHidden(!document.body.classList.contains('ui-hidden'));
      event.preventDefault();
    } else if (key === 'p') {
      togglePanel();
      event.preventDefault();
    } else if (key === ' ' && viewer.motions.length > 0) {
      if (viewer.playing) viewer.pause();
      else viewer.play();
      updatePlayButton();
      event.preventDefault();
    }
  });

  if (typeof narrowQuery.addEventListener === 'function') {
    narrowQuery.addEventListener('change', refreshChrome);
  }
  if (isNarrow()) setPanelCollapsed(true); // phones: show the model, not the sheet
  refreshChrome();
}

/** Phones cannot pick a folder: fall back to selecting model + textures at once. */
function folderPickerSupported(): boolean {
  return 'webkitdirectory' in HTMLInputElement.prototype;
}

function configurePickers(): void {
  if (folderPickerSupported()) return;
  const modelInput = $<HTMLInputElement>('pick-model');
  modelInput.removeAttribute('webkitdirectory');
  modelInput.setAttribute('accept', '.pmx,.pmd,.bmp,.png,.jpg,.jpeg,.tga,.sph,.spa');
  $('btn-model').title = 'Pick the .pmx/.pmd model together with its texture files';
  $('model-info').innerHTML =
    'This browser cannot pick folders — select the <b>.pmx</b> and its texture files in one go.';
  setStatus('Folder picking unavailable here — select the .pmx plus its textures', 'info');
}

// -------------------------------------------------------------- frame hooks

let hudTimer = 0;
viewer.onAfterFrame = (dt: number) => {
  hudTimer += dt;
  if (hudTimer < 0.15) return;
  hudTimer = 0;

  const bones = viewer.mesh?.skeleton.bones.length ?? 0;
  $('stats').textContent = `${viewer.fpsValue} fps · ${bones} bones · ${viewer.morphs.length} morphs`;

  if (viewer.duration > 0 && !seeking) {
    const value = viewer.time / viewer.duration;
    const slider = $<HTMLInputElement>('rng-time');
    slider.value = String(Math.min(1, Math.max(0, value)));
    $('out-time').textContent = `${viewer.time.toFixed(2)} s`;
  }
};

// -------------------------------------------------------------------- start

configurePickers();
wireChrome();
refreshModelList();
refreshMotionList();
buildMorphList();
wireEvents();
setStatus('Ready — pick a model folder, drop one on the stage, or try the demo');
