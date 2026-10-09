/**
 * MMD morph naming helpers.
 *
 * MMD morphs are named in Japanese and grouped in the editor's face panel
 * (眉 / 目 / 口 / その他). PMX files carry that grouping but three.js' MMDLoader
 * only exposes `morphTargetDictionary`, so we classify by name. Everything in
 * here is pure so it can be unit tested.
 */

export type MorphGroup = 'eyebrow' | 'eye' | 'mouth' | 'other';

export const MORPH_GROUPS: MorphGroup[] = ['eyebrow', 'eye', 'mouth', 'other'];

export const GROUP_LABEL: Record<MorphGroup, string> = {
  eyebrow: '眉 brow',
  eye: '目 eye',
  mouth: '口 mouth',
  other: '他 other',
};

const EYEBROW_RE = /^(眉|まゆ|mayu)|brow/;
const EYE_RE = /(まばたき|瞬き|ウィンク|ウインク|wink|blink|瞳|じと|なごみ|泣き|にっこり目|^目|めだま|eyeball|eye)/;
const MOUTH_RE = /(^あ$|^い$|^う$|^え$|^お$|^ん$|^あ２$|^にこ|^にっこり|^にやり|^笑い|^ワ$|^▲|^△|^▽|^∧|^・$|^口|^くち|mouth|smile|laugh|omega)/;

export function classifyMorph(name: string): MorphGroup {
  const n = name.trim().toLowerCase();
  if (EYEBROW_RE.test(n)) return 'eyebrow';
  if (EYE_RE.test(n)) return 'eye';
  if (MOUTH_RE.test(n)) return 'mouth';
  return 'other';
}

/** Short English hints for the most common standard MMD morphs. */
const HINTS: Array<[RegExp, string]> = [
  [/^まばたき$/, 'blink'],
  [/^ウィンク$|^ウインク$/, 'wink (left)'],
  [/^ウィンク右$|^ウインク右$/, 'wink (right)'],
  [/^笑い$/, 'smile'],
  [/^にっこり$/, 'grin'],
  [/^にやり$/, 'smirk'],
  [/^じと目$/, 'stare'],
  [/^なごみ$/, 'relaxed'],
  [/^はぅ$/, 'baww'],
  [/^怒り$/, 'angry'],
  [/^困る$/, 'troubled'],
  [/^泣き$/, 'cry'],
  [/^あ$/, 'mouth “a”'],
  [/^い$/, 'mouth “i”'],
  [/^う$/, 'mouth “u”'],
  [/^え$/, 'mouth “e”'],
  [/^お$/, 'mouth “o”'],
  [/^ん$/, 'mouth “n”'],
  [/^瞳/, 'pupil'],
];

export function morphHint(name: string): string {
  for (const [re, hint] of HINTS) if (re.test(name.trim())) return hint;
  return '';
}

export interface BlinkMorphs {
  /** canonical blink morph indices, most canonical first */
  blink: number[];
  winkL: number[];
  winkR: number[];
}

/**
 * Find the morphs used for blinking. Japanese MMD models ship まばたき (blink),
 * ウィンク (left wink) and ウィンク右 (right wink); some English models use
 * "blink"/"eye_blink"/"wink_L".
 */
export function findBlinkMorphs(names: string[]): BlinkMorphs {
  const blink: Array<[number, string]> = [];
  const winkL: Array<[number, string]> = [];
  const winkR: Array<[number, string]> = [];

  names.forEach((raw, i) => {
    const n = raw.trim();
    if (/^(まばたき|瞬き|blink|eye_?blink|eyeblink)/i.test(n)) {
      blink.push([i, n]);
    } else if (/ウィンク|ウインク|wink/i.test(n)) {
      if (/(右|right|_r$)/i.test(n)) winkR.push([i, n]);
      else winkL.push([i, n]);
    }
  });

  // Shortest name first: "まばたき" wins over "まばたき2".
  const byLen = (a: [number, string], b: [number, string]) => a[1].length - b[1].length;
  return {
    blink: blink.sort(byLen).map((x) => x[0]),
    winkL: winkL.sort(byLen).map((x) => x[0]),
    winkR: winkR.sort(byLen).map((x) => x[0]),
  };
}
