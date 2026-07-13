// ============================================================
// レシピ — 宝石は「入力ステップの列」そのもの
//
// ステップの形:
//   声     { t:'v', v:'a'|'i'|'u'|'e'|'o', p:'low'|'mid'|'high', d:'short'|'mid'|'long' }
//   ふー   { t:'b', d:'short'|'mid'|'long' }
//   手拍子 { t:'c', n:2|3 }
//
// レシピが同じなら gemBuilder は必ず同じ宝石を組み立てる。
// ============================================================

import { VOWELS, SPECIALS } from '../config.js';

export function makeRecipe() {
  return { steps: [], createdAt: Date.now() };
}

export function stepKey(step, index) {
  if (step.t === 'v') return `v:${step.v}:${step.p}:${step.d}:${index}`;
  if (step.t === 'b') return `b:${step.d}:${index}`;
  return `c:${step.n}:${index}`;
}

// 画面表示用: ステップ → { label, emoji }
export function stepBadge(step) {
  if (step.t === 'v') {
    const v = VOWELS[step.v];
    let label = v.label;
    if (step.d === 'long') label += 'ー';
    return { label, emoji: v.emoji };
  }
  if (step.t === 'b') return { label: SPECIALS.blow.label, emoji: SPECIALS.blow.emoji };
  const s = step.n >= 3 ? SPECIALS.clap3 : SPECIALS.clap2;
  return { label: '👏'.repeat(step.n), emoji: s.emoji };
}

export function serializeRecipe(recipe) {
  return JSON.stringify(recipe);
}

export function deserializeRecipe(json) {
  try {
    const r = JSON.parse(json);
    if (r && Array.isArray(r.steps)) return r;
  } catch (_) { /* 壊れた保存データは捨てる */ }
  return null;
}
