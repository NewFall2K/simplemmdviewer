import { describe, expect, it } from 'vitest';
import { classifyMorph, findBlinkMorphs, morphHint } from '../src/lib/morphs';

describe('classifyMorph', () => {
  it('groups standard Japanese MMD morphs', () => {
    expect(classifyMorph('まばたき')).toBe('eye');
    expect(classifyMorph('ウィンク')).toBe('eye');
    expect(classifyMorph('ウィンク右')).toBe('eye');
    expect(classifyMorph('じと目')).toBe('eye');
    expect(classifyMorph('瞳小')).toBe('eye');
    expect(classifyMorph('眉_困る')).toBe('eyebrow');
    expect(classifyMorph('あ')).toBe('mouth');
    expect(classifyMorph('にっこり')).toBe('mouth');
    expect(classifyMorph('笑い')).toBe('mouth');
    expect(classifyMorph('hoge')).toBe('other');
  });

  it('understands a few English bone-style names', () => {
    expect(classifyMorph('eye_blink')).toBe('eye');
    expect(classifyMorph('mouth_a')).toBe('mouth');
    expect(classifyMorph('brow_up')).toBe('eyebrow');
  });
});

describe('findBlinkMorphs', () => {
  it('picks the canonical morph over numbered variants', () => {
    const names = ['まばたき2', 'まばたき', 'ウィンク', 'ウィンク右', 'blink'];
    const found = findBlinkMorphs(names);
    expect(found.blink[0]).toBe(1); // index of まばたき
    expect(found.winkL).toEqual([2]);
    expect(found.winkR).toEqual([3]);
  });

  it('returns nothing for a model without blink morphs', () => {
    expect(findBlinkMorphs(['あ', 'い', '怒り'])).toEqual({ blink: [], winkL: [], winkR: [] });
  });

  it('handles English wink names', () => {
    const found = findBlinkMorphs(['eye_blink', 'wink_L', 'wink_R']);
    expect(found.blink).toEqual([0]);
    expect(found.winkL).toEqual([1]);
    expect(found.winkR).toEqual([2]);
  });
});

describe('morphHint', () => {
  it('labels well known morphs', () => {
    expect(morphHint('まばたき')).toBe('blink');
    expect(morphHint('あ')).toBe('mouth “a”');
    expect(morphHint('謎モーフ')).toBe('');
  });
});
