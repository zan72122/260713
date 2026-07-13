/**
 * VoiceAnalyzer — 声を「素材」として解析するエンジン。
 *
 * 方針:
 *   音量は「声が出ているかどうか」のゲートにしか使わない。
 *   魔法の強さ・量は 母音 / 高さ / 長さ / リズム / 声質 だけで決まる。
 *
 * 毎フレーム update() を呼ぶと state が更新される:
 *   active      : 声が出ているか（音量ゲート通過・自動キャリブレーション済み）
 *   vowel       : 'a'|'i'|'u'|'e'|'o'|null  … フォルマント(F1/F2)推定による母音
 *   vowelConf   : 0..1
 *   pitch       : Hz（0=不明）
 *   pitchNorm   : 0..1（子どもの声域 120..600Hz を対数正規化）
 *   pitchTrend  : -1..1（下降↘︎〜上昇↗︎、直近0.5秒の傾き）
 *   duration    : 現在の発声の継続秒数（「あーーー」の長さ）
 *   breathy     : 息っぽい音（ふー、しゅー）か
 *   wavering    : 声が揺れているか（あ〜あ〜あ〜 / ビブラート）
 *   onsetCount  : 直近2秒の発声開始回数（リズム: あ、あ、あ）
 *
 * イベント（コールバック登録）:
 *   onVoiceStart(state) / onVoiceEnd(segment) / onOnset(state) / onPlosive(state)
 */

const VOWEL_CENTROIDS = {
  // 幼児〜子どもの声を想定してやや高めのフォルマント中心値 (F1, F2) Hz
  a: [950, 1750],
  i: [420, 3000],
  u: [480, 1500],
  e: [680, 2600],
  o: [600, 1050],
};
const VOWELS = Object.keys(VOWEL_CENTROIDS);

export class VoiceAnalyzer {
  constructor() {
    this.available = false;   // マイクが使えるか
    this.ctx = null;
    this.analyser = null;
    this.sampleRate = 48000;

    this.freqData = null;
    this.timeData = null;

    // 自動キャリブレーション用ノイズフロア
    this.noiseFloor = 0.003;

    // 声の状態
    this.state = {
      active: false,
      vowel: null,
      vowelConf: 0,
      pitch: 0,
      pitchNorm: 0.5,
      pitchTrend: 0,
      duration: 0,
      breathy: false,
      wavering: false,
      onsetCount: 0,
      level: 0, // 表示用のみ。魔法には使わない
    };

    this._voiceStartTime = 0;
    this._onsetTimes = [];
    this._pitchHist = [];   // {t, hz}
    this._vowelVotes = [];
    this._segmentPeakAttack = 0;
    this._prevRms = 0;

    // シミュレーション入力（マイクなし: ボタン/キーボード）
    this._simVowel = null;
    this._simPitch = 0.5;

    // callbacks
    this.onVoiceStart = null;
    this.onVoiceEnd = null;
    this.onOnset = null;
    this.onPlosive = null;
  }

  /** マイク初期化。失敗しても throw せず false を返す（ボタン代替モードで遊べる）。 */
  async init(audioContext) {
    this.ctx = audioContext;
    this.sampleRate = audioContext.sampleRate;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true, // 端末側AGCで小声を持ち上げる（=音量ノーカウント方針と相性◎）
        },
      });
      const src = this.ctx.createMediaStreamSource(stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.55;
      src.connect(this.analyser);
      this.freqData = new Float32Array(this.analyser.frequencyBinCount);
      this.timeData = new Float32Array(this.analyser.fftSize);
      this.available = true;
    } catch (err) {
      console.warn('mic unavailable:', err);
      this.available = false;
    }
    return this.available;
  }

  /** ボタン入力で声の代わりをする（マイクなしモード / 練習用） */
  setSimulatedVoice(vowel, pitchNorm = 0.5) {
    this._simVowel = vowel;
    if (pitchNorm != null) this._simPitch = pitchNorm;
  }

  update() {
    const now = performance.now() / 1000;
    const s = this.state;

    // ---- シミュレーション入力が優先（押している間だけ）----
    if (this._simVowel) {
      this._updateCommon(now, true, this._simVowel, 1, 0, this._simPitch, false);
      s.level = 1;
      return s;
    }

    if (!this.available) {
      this._updateCommon(now, false, null, 0, 0, 0.5, false);
      s.level = 0;
      return s;
    }

    // ---- 実マイク解析 ----
    this.analyser.getFloatTimeDomainData(this.timeData);
    this.analyser.getFloatFrequencyData(this.freqData);

    // RMS（ゲート判定のためだけに使う）
    let sum = 0;
    for (let i = 0; i < this.timeData.length; i++) sum += this.timeData[i] * this.timeData[i];
    const rms = Math.sqrt(sum / this.timeData.length);

    // ノイズフロアをゆっくり学習（静かなときに下げ、常に僅かに上げて追従）
    if (rms < this.noiseFloor) this.noiseFloor += (rms - this.noiseFloor) * 0.05;
    else this.noiseFloor += (rms - this.noiseFloor) * 0.0015;
    this.noiseFloor = Math.min(Math.max(this.noiseFloor, 0.0008), 0.05);

    const gate = this.noiseFloor * 2.8 + 0.004; // ささやきでも越えられる低いゲート
    const voiced = rms > gate;

    // アタックの鋭さ（破裂音判定用）
    const attack = rms - this._prevRms;
    this._prevRms = rms;
    if (voiced) this._segmentPeakAttack = Math.max(this._segmentPeakAttack, attack);

    // ピッチ（自己相関）
    let pitch = 0, periodicity = 0;
    if (voiced) {
      const r = this._autoCorrelatePitch(this.timeData, this.sampleRate);
      pitch = r.pitch; periodicity = r.periodicity;
    }

    // 息っぽさ: ゲートは越えているのに周期性が低い＋高域寄り
    const flatness = this._spectralFlatness();
    const breathy = voiced && periodicity < 0.45 && flatness > 0.25;

    // 母音（有声で周期性があるときだけ）
    let vowel = null, conf = 0;
    if (voiced && !breathy) {
      const v = this._classifyVowel();
      vowel = v.vowel; conf = v.conf;
    }

    const pitchNorm = pitch > 0
      ? clamp((Math.log2(pitch) - Math.log2(120)) / (Math.log2(600) - Math.log2(120)), 0, 1)
      : s.pitchNorm;

    this._updateCommon(now, voiced, vowel, conf, pitch, pitchNorm, breathy);

    // 表示用レベル（ゲート越えで一定。大声でも増えない＝音量ノーカウントの見える化）
    s.level = voiced ? 1 : clamp(rms / gate, 0, 0.9);
    return s;
  }

  /** マイク/シミュレーション共通の状態遷移・時系列特徴 */
  _updateCommon(now, voiced, vowel, conf, pitch, pitchNorm, breathy) {
    const s = this.state;
    const wasActive = s.active;
    s.active = voiced;
    s.breathy = breathy;
    s.pitch = pitch;
    s.pitchNorm = lerp(s.pitchNorm, pitchNorm, 0.25);

    // --- 発声開始/終了、リズム ---
    if (voiced && !wasActive) {
      this._voiceStartTime = now;
      this._segmentPeakAttack = 0;
      this._onsetTimes.push(now);
      this._vowelVotes.length = 0;
      if (this.onOnset) this.onOnset(s);
      if (this.onVoiceStart) this.onVoiceStart(s);
    }
    if (!voiced && wasActive) {
      const dur = now - this._voiceStartTime;
      const seg = { duration: dur, vowel: s.vowel, plosive: dur < 0.22 && this._segmentPeakAttack > 0.02 };
      // 「ぱっ」「ぽん」= 短くて鋭いアタック
      if (seg.plosive && this.onPlosive) this.onPlosive(s);
      if (this.onVoiceEnd) this.onVoiceEnd(seg);
    }
    // シミュレーション入力はアタックが無いので、短い発声を破裂音とみなす
    if (this._simVowel !== null) this._segmentPeakAttack = 0.05;

    s.duration = voiced ? now - this._voiceStartTime : 0;

    while (this._onsetTimes.length && this._onsetTimes[0] < now - 2.0) this._onsetTimes.shift();
    s.onsetCount = this._onsetTimes.length;

    // --- 母音の時間平滑化（多数決）---
    if (voiced && vowel) {
      this._vowelVotes.push(vowel);
      if (this._vowelVotes.length > 10) this._vowelVotes.shift();
      const counts = {};
      for (const v of this._vowelVotes) counts[v] = (counts[v] || 0) + 1;
      let best = vowel, bestN = 0;
      for (const v in counts) if (counts[v] > bestN) { bestN = counts[v]; best = v; }
      s.vowel = best;
      s.vowelConf = conf;
    } else if (!voiced) {
      // 発声が終わっても少しの間は前の母音を覚えておく（切れ目のガタつき防止）
      s.vowelConf = 0;
      if (!voiced) s.vowel = s.vowel; // keep
    }

    // --- ピッチ履歴 → 傾き & 揺れ ---
    if (voiced && (pitch > 0 || this._simVowel)) {
      const hz = this._simVowel ? 200 + this._simPitch * 300 : pitch;
      this._pitchHist.push({ t: now, hz: Math.log2(hz) });
    }
    while (this._pitchHist.length && this._pitchHist[0].t < now - 1.0) this._pitchHist.shift();

    s.pitchTrend = this._pitchSlope(now);
    s.wavering = this._detectWaver();
  }

  /** 直近0.5秒のピッチ傾き → -1..1 */
  _pitchSlope(now) {
    const pts = this._pitchHist.filter(p => p.t > now - 0.5);
    if (pts.length < 6) return 0;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of pts) { sx += p.t; sy += p.hz; sxx += p.t * p.t; sxy += p.t * p.hz; }
    const n = pts.length;
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-9) return 0;
    const slope = (n * sxy - sx * sy) / denom; // octaves per second
    return clamp(slope / 1.2, -1, 1);
  }

  /** 声の揺れ（3〜8Hzのピッチ振動）を検出 */
  _detectWaver() {
    const pts = this._pitchHist;
    if (pts.length < 15) return false;
    const mean = pts.reduce((a, p) => a + p.hz, 0) / pts.length;
    let crossings = 0, amp = 0;
    let prevSign = 0;
    for (const p of pts) {
      const d = p.hz - mean;
      amp = Math.max(amp, Math.abs(d));
      const sign = d > 0 ? 1 : -1;
      if (prevSign && sign !== prevSign) crossings++;
      prevSign = sign;
    }
    const span = pts[pts.length - 1].t - pts[0].t;
    if (span <= 0.3) return false;
    const oscHz = crossings / 2 / span;
    return amp > 0.04 && oscHz >= 2.2 && oscHz <= 9;
  }

  /** 自己相関によるピッチ推定（100〜700Hz） */
  _autoCorrelatePitch(buf, sr) {
    const n = buf.length;
    const minLag = Math.floor(sr / 700);
    const maxLag = Math.floor(sr / 100);
    let bestLag = 0, best = 0;
    let energy = 0;
    for (let i = 0; i < n; i++) energy += buf[i] * buf[i];
    if (energy < 1e-6) return { pitch: 0, periodicity: 0 };
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0;
      for (let i = 0; i < n - lag; i++) c += buf[i] * buf[i + lag];
      c /= energy;
      if (c > best) { best = c; bestLag = lag; }
    }
    if (best < 0.3 || bestLag === 0) return { pitch: 0, periodicity: best };
    return { pitch: sr / bestLag, periodicity: best };
  }

  /** スペクトル平坦度（0=トーン, 1=ノイズ）を 1k〜6kHz で概算 */
  _spectralFlatness() {
    const binHz = this.sampleRate / this.analyser.fftSize;
    const lo = Math.floor(1000 / binHz), hi = Math.min(Math.floor(6000 / binHz), this.freqData.length - 1);
    let logSum = 0, linSum = 0, n = 0;
    for (let i = lo; i <= hi; i++) {
      const mag = Math.pow(10, this.freqData[i] / 20);
      logSum += Math.log(mag + 1e-12);
      linSum += mag;
      n++;
    }
    if (!n || linSum <= 0) return 0;
    return Math.exp(logSum / n) / (linSum / n);
  }

  /** フォルマント(F1/F2)推定 → 母音分類 */
  _classifyVowel() {
    const binHz = this.sampleRate / this.analyser.fftSize;
    // 平滑化スペクトル（dB→線形, 3bin移動平均）
    const lo = Math.floor(150 / binHz);
    const hi = Math.min(Math.floor(3600 / binHz), this.freqData.length - 2);
    const spec = [];
    for (let i = lo; i <= hi; i++) {
      const m = (p) => Math.pow(10, this.freqData[p] / 20);
      spec.push({ hz: i * binHz, mag: (m(i - 1) + m(i) + m(i + 1)) / 3 });
    }
    const peakIn = (fromHz, toHz, exclude = 0, excludeWidth = 0) => {
      let best = null;
      for (const p of spec) {
        if (p.hz < fromHz || p.hz > toHz) continue;
        if (exclude && Math.abs(p.hz - exclude) < excludeWidth) continue;
        // 局所ピークのみ
        if (!best || p.mag > best.mag) best = p;
      }
      return best;
    };
    const f1p = peakIn(200, 1150);
    if (!f1p) return { vowel: null, conf: 0 };
    const f2From = Math.max(f1p.hz + 300, 850);
    const f2p = peakIn(f2From, 3500, f1p.hz, 250);
    if (!f2p) return { vowel: null, conf: 0 };

    const f1 = f1p.hz, f2 = f2p.hz;
    // 対数周波数空間で最近傍
    let best = null, bestD = Infinity, secondD = Infinity;
    for (const v of VOWELS) {
      const [c1, c2] = VOWEL_CENTROIDS[v];
      const d = Math.pow(Math.log2(f1 / c1), 2) * 1.0 + Math.pow(Math.log2(f2 / c2), 2) * 1.4;
      if (d < bestD) { secondD = bestD; bestD = d; best = v; }
      else if (d < secondD) secondD = d;
    }
    const conf = clamp(1 - bestD / (secondD + 1e-6), 0, 1);
    return { vowel: best, conf };
  }
}

function clamp(x, a, b) { return Math.min(Math.max(x, a), b); }
function lerp(a, b, t) { return a + (b - a) * t; }
