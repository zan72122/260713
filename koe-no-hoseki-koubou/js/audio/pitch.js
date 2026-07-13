// ============================================================
// ピッチ検出 — 正規化自己相関 (McLeod 風の簡易版)
// 戻り値: { hz, clarity } clarity は 0..1 の確からしさ
// ============================================================

export function detectPitch(buf, sampleRate, minHz = 80, maxHz = 1000) {
  const n = buf.length;

  // 無音チェック
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < 0.008) return { hz: 0, clarity: 0 };

  const maxLag = Math.min(Math.floor(sampleRate / minHz), n - 1);
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));

  // 正規化二乗差関数 (NSDF)
  // nsdf[lag] = 2*acf(lag) / (m(0)部分和) — 1 に近いほど周期的
  const nsdf = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acf = 0;
    let m = 0;
    for (let i = 0; i < n - lag; i++) {
      const a = buf[i];
      const b = buf[i + lag];
      acf += a * b;
      m += a * a + b * b;
    }
    nsdf[lag] = m > 0 ? (2 * acf) / m : 0;
  }

  // 最初の主要ピークを拾う(倍音誤りを避けるため、最大値の 0.9 倍を
  // 超える最初のピークを採用する)
  let globalMax = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (nsdf[lag] > globalMax) globalMax = nsdf[lag];
  }
  if (globalMax < 0.45) return { hz: 0, clarity: globalMax };

  const threshold = globalMax * 0.9;
  let bestLag = -1;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (
      nsdf[lag] > threshold &&
      nsdf[lag] >= nsdf[lag - 1] &&
      nsdf[lag] >= nsdf[lag + 1]
    ) {
      bestLag = lag;
      break;
    }
  }
  if (bestLag < 0) return { hz: 0, clarity: globalMax };

  // 放物線補間でラグを微調整
  const y1 = nsdf[bestLag - 1];
  const y2 = nsdf[bestLag];
  const y3 = nsdf[bestLag + 1];
  const denom = y1 - 2 * y2 + y3;
  let lag = bestLag;
  if (Math.abs(denom) > 1e-9) {
    lag = bestLag + (0.5 * (y1 - y3)) / denom;
  }

  return { hz: sampleRate / lag, clarity: nsdf[bestLag] };
}

// ゼロ交差率 — 息(ふー)や手拍子などノイズ性の音の判定に使う
export function zeroCrossingRate(buf) {
  let z = 0;
  for (let i = 1; i < buf.length; i++) {
    if (buf[i - 1] < 0 !== buf[i] < 0) z++;
  }
  return z / buf.length;
}
