/**
 * SoundFX — WebAudioでその場で合成する、やさしい効果音。
 * 子どもの声の高さに合わせてペンタトニックの音が鳴る（声とゲームの合奏感）。
 */

const PENTA = [0, 2, 4, 7, 9]; // メジャーペンタトニック

export class SoundFX {
  constructor(audioContext) {
    this.ctx = audioContext;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;

    // ふんわり残響
    this.verb = this.ctx.createConvolver();
    this.verb.buffer = this._impulse(1.8, 2.5);
    const verbGain = this.ctx.createGain();
    verbGain.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    this.master.connect(this.verb);
    this.verb.connect(verbGain);
    verbGain.connect(this.ctx.destination);

    this.muted = false;
    this._lastShimmer = 0;
    this._padNodes = null;
  }

  setMuted(m) {
    this.muted = m;
    this.master.gain.linearRampToValueAtTime(m ? 0 : 0.5, this.ctx.currentTime + 0.15);
  }

  _impulse(sec, decay) {
    const rate = this.ctx.sampleRate;
    const len = rate * sec;
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  /** 0..1 の pitchNorm を ペンタトニックの周波数へ */
  _quantize(pitchNorm, baseMidi = 64) {
    const span = 14; // 約2オクターブ+
    const idxF = pitchNorm * span;
    const oct = Math.floor(idxF / PENTA.length);
    const step = PENTA[Math.floor(idxF) % PENTA.length];
    const midi = baseMidi + oct * 12 + step;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  _tone({ freq = 440, type = 'sine', dur = 0.3, gain = 0.2, when = 0, glide = 0, pan = 0 }) {
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * glide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g);
    if (p) { p.pan.value = pan; g.connect(p); p.connect(this.master); }
    else g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  _noise({ dur = 0.3, gain = 0.1, when = 0, filterFreq = 3000, q = 1, type = 'bandpass' }) {
    const t = this.ctx.currentTime + when;
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = filterFreq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }

  /* ============ ゲーム用のおと ============ */

  /** 声を出して塗っている間、母音ごとの音色でキラキラ鳴る（間引きあり） */
  paintShimmer(vowel, pitchNorm) {
    const now = performance.now();
    if (now - this._lastShimmer < 130) return;
    this._lastShimmer = now;
    const freq = this._quantize(pitchNorm);
    switch (vowel) {
      case 'a': this._tone({ freq, type: 'triangle', dur: 0.35, gain: 0.12 }); break;
      case 'i': this._tone({ freq: freq * 2, type: 'sine', dur: 0.18, gain: 0.1 });
                this._tone({ freq: freq * 3, type: 'sine', dur: 0.12, gain: 0.05, when: 0.05 }); break;
      case 'u': this._tone({ freq: freq * 0.5, type: 'sine', dur: 0.4, gain: 0.12, glide: 1.3 }); break;
      case 'e': this._tone({ freq, type: 'square', dur: 0.12, gain: 0.045 });
                this._tone({ freq: freq * 1.5, type: 'sine', dur: 0.25, gain: 0.08, when: 0.04 }); break;
      case 'o': this._tone({ freq: freq * 0.5, type: 'triangle', dur: 0.6, gain: 0.13 });
                this._tone({ freq, type: 'sine', dur: 0.5, gain: 0.06, when: 0.08 }); break;
      default:  this._tone({ freq, type: 'sine', dur: 0.2, gain: 0.08 });
    }
  }

  /** 息（ふー）: 風のさらさら音 */
  breath() {
    const now = performance.now();
    if (now - this._lastShimmer < 200) return;
    this._lastShimmer = now;
    this._noise({ dur: 0.5, gain: 0.05, filterFreq: 4500, q: 0.6, type: 'highpass' });
  }

  /** ぱっ！のスタンプ音 */
  pop(pitchNorm = 0.5) {
    this._tone({ freq: this._quantize(pitchNorm) * 2, type: 'sine', dur: 0.12, gain: 0.22, glide: 0.5 });
    this._noise({ dur: 0.08, gain: 0.12, filterFreq: 2000, q: 1.5 });
  }

  /** あわがはじける */
  bubblePop() {
    this._tone({ freq: 600 + Math.random() * 700, type: 'sine', dur: 0.09, gain: 0.09, glide: 1.8 });
  }

  /** オブジェクトが色づき完了「ポロン♪」 */
  objectDone(i = 0) {
    const base = this._quantize(0.4 + (i % 5) * 0.12);
    this._tone({ freq: base, type: 'triangle', dur: 0.3, gain: 0.16 });
    this._tone({ freq: base * 1.5, type: 'sine', dur: 0.4, gain: 0.1, when: 0.09 });
  }

  /** ボタン押した */
  tap() { this._tone({ freq: 520, type: 'sine', dur: 0.1, gain: 0.12, glide: 1.4 }); }

  /** 画面遷移 しゅわん */
  whoosh() { this._noise({ dur: 0.4, gain: 0.07, filterFreq: 900, q: 0.8 }); }

  /** おいわいファンファーレ */
  fanfare() {
    const seq = [0, 4, 7, 12, 7, 12, 16];
    seq.forEach((st, i) => {
      const f = 440 * Math.pow(2, (st - 9 + 12) / 12) / 2 * 2;
      this._tone({ freq: f, type: 'triangle', dur: 0.35, gain: 0.16, when: i * 0.14 });
      this._tone({ freq: f * 2, type: 'sine', dur: 0.3, gain: 0.07, when: i * 0.14 + 0.02 });
    });
    for (let i = 0; i < 10; i++) {
      this._tone({ freq: 1200 + Math.random() * 2200, type: 'sine', dur: 0.2, gain: 0.05, when: 1.1 + i * 0.07, pan: Math.random() * 2 - 1 });
    }
  }

  /** 花火 ひゅ〜…ぱん */
  firework(when = 0) {
    this._tone({ freq: 300, type: 'sine', dur: 0.7, gain: 0.06, glide: 3.2, when });
    this._noise({ dur: 0.5, gain: 0.14, filterFreq: 1600, q: 0.7, when: when + 0.65 });
    for (let i = 0; i < 5; i++) {
      this._tone({ freq: 900 + Math.random() * 1800, type: 'sine', dur: 0.3, gain: 0.05, when: when + 0.7 + i * 0.05, pan: Math.random() * 2 - 1 });
    }
  }
}
