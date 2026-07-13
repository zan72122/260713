// ============================================================
// 母音分類 — FFT スペクトルからフォルマント (F1, F2) を推定し、
// 最近傍で「あ・い・う・え・お」に分類する簡易版。
// 4歳児の遊びなので厳密さより「同じ声なら同じ結果」を重視。
// ============================================================

import { FORMANTS } from '../config.js';

const VOWEL_KEYS = Object.keys(FORMANTS); // ['a','i','u','e','o']

// スペクトル包絡の平滑化(移動平均)
function smooth(spec, radius) {
  const out = new Float32Array(spec.length);
  for (let i = 0; i < spec.length; i++) {
    let sum = 0;
    let cnt = 0;
    for (let j = -radius; j <= radius; j++) {
      const k = i + j;
      if (k >= 0 && k < spec.length) {
        sum += spec[k];
        cnt++;
      }
    }
    out[i] = sum / cnt;
  }
  return out;
}

// 指定 Hz 範囲で最大の山(ピーク)の周波数を返す
function peakInRange(spec, binHz, loHz, hiHz) {
  const lo = Math.max(1, Math.floor(loHz / binHz));
  const hi = Math.min(spec.length - 2, Math.ceil(hiHz / binHz));
  let bestIdx = -1;
  let bestVal = -Infinity;
  for (let i = lo; i <= hi; i++) {
    if (spec[i] > bestVal && spec[i] >= spec[i - 1] && spec[i] >= spec[i + 1]) {
      bestVal = spec[i];
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return { hz: 0, val: -Infinity };
  // 放物線補間
  const y1 = spec[bestIdx - 1];
  const y2 = spec[bestIdx];
  const y3 = spec[bestIdx + 1];
  const denom = y1 - 2 * y2 + y3;
  let idx = bestIdx;
  if (Math.abs(denom) > 1e-9) idx = bestIdx + (0.5 * (y1 - y3)) / denom;
  return { hz: idx * binHz, val: y2 };
}

// freqData: AnalyserNode.getFloatFrequencyData の結果 (dB)
// 戻り値: { vowel: 'a'|'i'|'u'|'e'|'o'|null, f1, f2 }
export function classifyVowel(freqData, sampleRate, fftSize) {
  const binHz = sampleRate / fftSize;

  // dB → 線形パワーへ(弱い成分を持ち上げすぎないよう dB のまま平滑化)
  const env = smooth(freqData, 3);

  // F1: 250〜1150 Hz / F2: 1150〜3400 Hz の最大ピーク
  const p1 = peakInRange(env, binHz, 250, 1150);
  const p2 = peakInRange(env, binHz, 1150, 3400);
  if (p1.hz === 0) return { vowel: null, f1: 0, f2: 0 };

  // F2 のピークが F1 より 30dB 以上弱ければ「F2 が無い」= う/お 寄り
  const f1 = p1.hz;
  const f2 = p2.val > p1.val - 34 ? p2.hz : 0;

  // 対数空間での最近傍分類
  let best = null;
  let bestDist = Infinity;
  for (const key of VOWEL_KEYS) {
    const [cf1, cf2] = FORMANTS[key];
    const d1 = Math.log(f1 / cf1);
    // F2 が拾えなかったときは F2 の低い母音(う・お)に寄せる
    const effF2 = f2 > 0 ? f2 : 900;
    const d2 = Math.log(effF2 / cf2);
    const dist = d1 * d1 + d2 * d2 * 0.8; // F2 はやや緩く
    if (dist < bestDist) {
      bestDist = dist;
      best = key;
    }
  }
  return { vowel: best, f1, f2 };
}

// 声を出している間の「多数決」用カウンタ
export class VowelVote {
  constructor() {
    this.counts = { a: 0, i: 0, u: 0, e: 0, o: 0 };
    this.total = 0;
  }
  add(vowel) {
    if (vowel && vowel in this.counts) {
      this.counts[vowel]++;
      this.total++;
    }
  }
  reset() {
    for (const k in this.counts) this.counts[k] = 0;
    this.total = 0;
  }
  // いちばん多かった母音(票が無ければ 'a')
  winner() {
    let best = 'a';
    let bestCount = -1;
    for (const k in this.counts) {
      if (this.counts[k] > bestCount) {
        bestCount = this.counts[k];
        best = k;
      }
    }
    return best;
  }
}
