// Web Audio API によるその場合成サウンド
// 効果音: ざくざく / しゃりしゃり / ねっとり / もちもち / ぷるぷる / とろ〜 /
//         ぱりぱり(殻割れ) / ぽとん / パラパラ / ひんやり / ぽかぽか
// 指の下の質感(フレーバー固有)がそのまま音色に反映される
import { MusicBox } from './audio_bgm.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.started = false;
    this.stir = { speed: 0, chunky: 0, tex: null };
    this.pour = 0;
    this.tiltMag = 0;
    this._nextCrunch = 0;
    this._nextDrip = 0;
    this._nextPourDrip = 0;
  }

  // 最初のユーザー操作で呼ぶ (iOS対策)
  start() {
    if (this.started) return;
    this.started = true;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 1.0;
    this.sfxBus.connect(this.master);

    this.bgmBus = ctx.createGain();
    this.bgmBus.gain.value = 0.4;
    this.bgmBus.connect(this.master);

    // オルゴール用ディレイ(ふわっと残響)
    const bgmDelay = ctx.createDelay(1.0);
    bgmDelay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = 0.4;
    bgmDelay.connect(fb); fb.connect(bgmDelay);
    bgmDelay.connect(wet); wet.connect(this.bgmBus);
    this.bgm = new MusicBox(ctx, this.bgmBus, bgmDelay);

    // ノイズバッファ(共用)
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // ---- ねっとりループ: ねちゃっとした低域ノイズ ----
    this.slush = this.makeNoiseLoop({ type: 'lowpass', freq: 500, q: 1.2 });
    const slushLFO = ctx.createOscillator();
    slushLFO.frequency.value = 5.5;
    const slushLFOGain = ctx.createGain();
    slushLFOGain.gain.value = 260;
    slushLFO.connect(slushLFOGain);
    slushLFOGain.connect(this.slush.filter.frequency);
    slushLFO.start();

    // ---- とろとろループ: 液体っぽい中域 ----
    this.liquid = this.makeNoiseLoop({ type: 'bandpass', freq: 900, q: 4, rate: 0.6 });

    // ---- 注ぎループ: とろ〜っとたれる音 ----
    this.pourLoop = this.makeNoiseLoop({ type: 'lowpass', freq: 750, q: 1.4, rate: 0.8 });

    // ---- 傾きループ: アイスがずるずる流れる低い音 ----
    this.tiltLoop = this.makeNoiseLoop({ type: 'lowpass', freq: 240, q: 1.6, rate: 0.5 });

    // ---- もちもちループ: ゆっくり深くうねる低域(のびる音) ----
    this.mochiLoop = this.makeNoiseLoop({ type: 'lowpass', freq: 260, q: 2.0, rate: 0.45 });
    const mochiLFO = ctx.createOscillator();
    mochiLFO.frequency.value = 2.2;
    const mochiLFOGain = ctx.createGain();
    mochiLFOGain.gain.value = 190;
    mochiLFO.connect(mochiLFOGain);
    mochiLFOGain.connect(this.mochiLoop.filter.frequency);
    mochiLFO.start();

    // ---- ぷるぷるループ: びよびよ揺れるサイン波 ----
    this.jellyOsc = ctx.createOscillator();
    this.jellyOsc.type = 'sine';
    this.jellyOsc.frequency.value = 150;
    const jellyVib = ctx.createOscillator();
    jellyVib.frequency.value = 9;
    const jellyVibGain = ctx.createGain();
    jellyVibGain.gain.value = 26;
    jellyVib.connect(jellyVibGain);
    jellyVibGain.connect(this.jellyOsc.frequency);
    this.jellyGain = ctx.createGain();
    this.jellyGain.gain.value = 0;
    this.jellyOsc.connect(this.jellyGain);
    this.jellyGain.connect(this.sfxBus);
    this.jellyOsc.start();
    jellyVib.start();
  }

  makeNoiseLoop({ type, freq, q, rate = 1.0 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = rate;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    src.start();
    return { src, filter, gain };
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) {
      this.master.gain.setTargetAtTime(on ? 0.9 : 0.0, this.ctx.currentTime, 0.05);
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  // かき混ぜ状態を毎フレーム反映
  // tex = 指の下の質感 {temp, air, crystal, gloss, shari, mochi, shell, jelly}
  setStirState(speed, chunky, tex) {
    this.stir = { speed, chunky, tex };
  }

  // 注ぎ中の強さ (0..1)
  setPourState(amount) {
    this.pour = amount;
  }

  // お皿の傾きの強さ (0..1)
  setTiltState(mag) {
    this.tiltMag = mag;
  }

  // 毎フレーム呼ぶ
  update() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const s = this.stir;
    const t = s.tex;
    if (!t) return;
    const sp = Math.min(1, s.speed);
    const melt = clamp01((t.temp - 0.55) / 0.35);

    // ねっとり: ツヤ・もちもち領域(チョコなど)を混ぜると強い
    const slushAmt = sp * (1 - melt * 0.85) * (0.3 + 0.7 * (1 - t.air))
      * clamp01(0.35 + t.gloss * 0.8 + t.mochi * 0.4) * (1 - t.crystal * 0.4);
    this.slush.gain.gain.setTargetAtTime(slushAmt * 0.30, now, 0.08);
    this.slush.filter.frequency.setTargetAtTime(380 + sp * 480, now, 0.1);

    // もちもち: マンゴー領域を混ぜるとのびる音
    const mochiAmt = sp * t.mochi * (1 - melt * 0.7);
    this.mochiLoop.gain.gain.setTargetAtTime(mochiAmt * 0.26, now, 0.09);

    // ぷるぷる: いちご領域を混ぜるとびよびよ
    const jellyAmt = sp * t.jelly * (1 - melt * 0.7);
    this.jellyGain.gain.setTargetAtTime(jellyAmt * 0.05, now, 0.07);
    this.jellyOsc.frequency.setTargetAtTime(130 + sp * 70, now, 0.1);

    // とろとろ: 溶けてるほど強い
    const liqAmt = sp * melt;
    this.liquid.gain.gain.setTargetAtTime(liqAmt * 0.16, now, 0.08);

    // ざく/しゃり: 結晶・氷粒・トッピング粒が多いほど短いクランチ音を連射
    // ソーダ(しゃり)領域は高く明るい氷の音になる
    const crunchRate = sp * (t.crystal * 0.6 + t.shari * 0.9 + s.chunky * 0.6);
    if (crunchRate > 0.04 && now >= this._nextCrunch) {
      this.crunchTick(0.25 + 0.75 * Math.min(1, crunchRate), s.chunky, t.shari);
      const interval = 0.03 + (1 - Math.min(1, crunchRate)) * 0.13;
      this._nextCrunch = now + interval * (0.6 + Math.random() * 0.8);
    }

    // とろとろの雫音
    if (liqAmt > 0.15 && now >= this._nextDrip) {
      this.drip();
      this._nextDrip = now + 0.25 + Math.random() * 0.7;
    }

    // 注ぎ: とろ〜っというたれ音 + ときどき雫
    this.pourLoop.gain.gain.setTargetAtTime(this.pour * 0.12, now, 0.06);
    this.pourLoop.filter.frequency.setTargetAtTime(600 + Math.sin(now * 5.0) * 160, now, 0.08);

    // 傾き: 傾けるほどずるずると低い流れ音
    this.tiltLoop.gain.gain.setTargetAtTime(this.tiltMag * this.tiltMag * 0.16, now, 0.1);
    this.tiltLoop.filter.frequency.setTargetAtTime(180 + this.tiltMag * 220, now, 0.12);
    if (this.pour > 0.3 && now >= this._nextPourDrip) {
      this.drip();
      this._nextPourDrip = now + 0.18 + Math.random() * 0.4;
    }

    this.bgm.update(now);
  }

  // ---- 個別SFX ----
  // ざくざく/しゃりしゃり: bright(=shari) が高いほど高く軽い氷の音
  crunchTick(strength, chunky, bright = 0) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.9 + bright * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400 + Math.random() * 2600 - chunky * 500 + bright * 1800;
    f.Q.value = 1.6 + bright * 1.4;
    const g = ctx.createGain();
    const peak = (0.05 + 0.14 * strength) * (0.7 + Math.random() * 0.6);
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.035 + Math.random() * 0.03);
    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.1);
  }

  drip() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = 500 + Math.random() * 500;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.2);
  }

  // ぽとん(アイスを置く)
  plop() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(330, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.25);
    // やわらかい着地ノイズ
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 350;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.16, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    src.connect(f); f.connect(ng); ng.connect(this.sfxBus);
    src.start(t, Math.random()); src.stop(t + 0.2);
  }

  // パラパラ(トッピング)
  sprinkle() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const n = 9 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + 0.05 + Math.random() * 0.5;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.playbackRate.value = 1.2 + Math.random();
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 2500 + Math.random() * 2000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.05 + Math.random() * 0.05, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      src.connect(f); f.connect(g); g.connect(this.sfxBus);
      src.start(t, Math.random() * 1.5);
      src.stop(t + 0.05);
    }
  }

  // ぱきっ(クッキーがわれた)
  crack() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 1.5;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 2800; f.Q.value = 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    src.start(t, Math.random()); src.stop(t + 0.08);
  }

  // ことっ(お皿の縁をつかんだ)
  tiltCreak() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.10, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.15);
  }

  // ぱりぱりっ(チョコ殻がわれる: 2〜3連の高いクラック)
  shellCrack(strength) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + i * (0.03 + Math.random() * 0.03);
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.playbackRate.value = 1.6 + Math.random() * 0.6;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 3200 + Math.random() * 1600 - i * 500;
      f.Q.value = 2.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime((0.12 + 0.14 * strength) * (1 - i * 0.25), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
      src.connect(f); f.connect(g); g.connect(this.sfxBus);
      src.start(t, Math.random() * 1.5); src.stop(t + 0.07);
    }
  }

  // ひんやり(キラキラ〜)
  freeze() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    for (let i = 0; i < 5; i++) {
      const t = ctx.currentTime + i * 0.07;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 2400 + Math.random() * 3200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.045, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g); g.connect(this.sfxBus);
      o.start(t); o.stop(t + 0.4);
    }
  }

  // ぽかぽか(あたたか風)
  warm() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(180, t);
    f.frequency.linearRampToValueAtTime(520, t + 0.4);
    f.frequency.linearRampToValueAtTime(160, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.25);
    g.gain.linearRampToValueAtTime(0.0, t + 0.95);
    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    src.start(t, Math.random()); src.stop(t + 1.0);
  }

  // UIタップ
  pop() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(660, t);
    o.frequency.exponentialRampToValueAtTime(990, t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.15);
  }

  // しゅわ〜ん(リセット)
  sweep() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(3000, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    src.start(t, Math.random()); src.stop(t + 0.8);
  }
}
