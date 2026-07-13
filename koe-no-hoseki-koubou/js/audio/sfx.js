// ============================================================
// 効果音 — すべて Web Audio で合成(音声ファイル不要)
// ペンタトニックの鐘の音を中心に、やさしい音だけを使う
// ============================================================

import { PRAISES, CHEERS } from '../config.js';

// ドレミソラ(ペンタトニック)を上がっていく周波数ラダー
const PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.7, 1318.5];

export class Sfx {
  constructor(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);
    this.muted = false;
    this.voiceOn = true; // おしゃべり(音声合成)
  }

  setMuted(m) {
    this.muted = m;
    this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  // ベル一発(FM っぽい倍音つき減衰音)
  bell(freq, t0 = 0, dur = 1.2, gain = 0.25) {
    const ctx = this.ctx;
    const t = ctx.currentTime + t0;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2.99; // 非整数倍音で鐘らしく
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
    osc2.connect(g2).connect(g);
    osc.connect(g);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    g.connect(this.master);
    osc.start(t);
    osc2.start(t);
    osc.stop(t + dur + 0.1);
    osc2.stop(t + dur + 0.1);
  }

  // 成長ステップ n(0..)に応じて上がっていく音
  growTick(step) {
    const f = PENTA[Math.min(step, PENTA.length - 1)];
    this.bell(f, 0, 1.0, 0.22);
    this.bell(f * 2, 0.04, 0.6, 0.08);
  }

  // 結晶が固まるときのキラン
  crystallize() {
    this.bell(1318.5, 0, 0.8, 0.16);
    this.bell(1567.98, 0.07, 0.9, 0.13);
    this.bell(2093.0, 0.14, 1.1, 0.1);
  }

  // 小さなキラキラ(星の粒など)
  sparkle() {
    for (let i = 0; i < 3; i++) {
      const f = 1600 + Math.random() * 1800;
      this.bell(f, i * 0.05, 0.35, 0.05);
    }
  }

  // 花がポンと咲く音
  pop() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(750, t + 0.09);
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  // 手拍子を聞き取ったよ、の返事
  clapEcho(count) {
    for (let i = 0; i < count; i++) {
      this.bell(987.77, i * 0.14, 0.25, 0.14);
    }
  }

  // ふー(霜)のときのシャラララ
  frost() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.9);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.setValueAtTime(3000, t);
    filt.frequency.exponentialRampToValueAtTime(8000, t + 0.8);
    const g = ctx.createGain();
    g.gain.value = 0.2;
    src.connect(filt).connect(g).connect(this.master);
    src.start(t);
    // 上に鈴を少し
    this.bell(2637, 0.1, 0.6, 0.06);
    this.bell(3136, 0.3, 0.6, 0.05);
  }

  // 完成ファンファーレ(アルペジオ + シャワー)
  fanfare() {
    const seq = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
    seq.forEach((f, i) => this.bell(f, i * 0.11, 1.3, 0.18));
    for (let i = 0; i < 10; i++) {
      this.bell(1500 + Math.random() * 2200, 0.7 + i * 0.07, 0.5, 0.045);
    }
  }

  // ---- おしゃべり(音声合成・日本語) ----
  speak(text) {
    if (!this.voiceOn || this.muted) return;
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.rate = 0.95;
      u.pitch = 1.35;
      u.volume = 0.9;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (_) { /* 非対応環境では黙る */ }
  }

  praise() {
    this.speak(PRAISES[Math.floor(Math.random() * PRAISES.length)]);
  }

  cheer(step) {
    // 毎回はうるさいので、2ステップに1回だけ
    if (step % 2 === 1) this.speak(CHEERS[step % CHEERS.length]);
  }
}
