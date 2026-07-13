// Web Audio API によるその場合成サウンド
// 効果音: ざくざく / ねっとり / とろ〜 / ぽとん / パラパラ / ひんやり / ぽかぽか
// BGM: オルゴール調ループ + やわらかいパッド

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.started = false;
    this.stir = { speed: 0, crystal: 0.3, melt: 0, air: 0.7, chunky: 0 };
    this._nextCrunch = 0;
    this._nextDrip = 0;
    this._nextNote = 0;
    this._noteStep = 0;
    this._nextPad = 0;
    this._padStep = 0;
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
    this.bgmDelay = ctx.createDelay(1.0);
    this.bgmDelay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = 0.4;
    this.bgmDelay.connect(fb); fb.connect(this.bgmDelay);
    this.bgmDelay.connect(wet); wet.connect(this.bgmBus);
    this.bgmSend = this.bgmDelay;

    // ノイズバッファ(共用)
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // ---- ねっとりループ ----
    this.slushSrc = ctx.createBufferSource();
    this.slushSrc.buffer = this.noiseBuf;
    this.slushSrc.loop = true;
    this.slushFilter = ctx.createBiquadFilter();
    this.slushFilter.type = 'lowpass';
    this.slushFilter.frequency.value = 500;
    this.slushFilter.Q.value = 1.2;
    this.slushGain = ctx.createGain();
    this.slushGain.gain.value = 0;
    this.slushSrc.connect(this.slushFilter);
    this.slushFilter.connect(this.slushGain);
    this.slushGain.connect(this.sfxBus);
    this.slushSrc.start();
    // フィルタをゆらすLFO (ねちゃっと感)
    this.slushLFO = ctx.createOscillator();
    this.slushLFO.frequency.value = 5.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    this.slushLFO.connect(lfoGain);
    lfoGain.connect(this.slushFilter.frequency);
    this.slushLFO.start();

    // ---- とろとろループ ----
    this.liquidSrc = ctx.createBufferSource();
    this.liquidSrc.buffer = this.noiseBuf;
    this.liquidSrc.loop = true;
    this.liquidSrc.playbackRate.value = 0.6;
    this.liquidFilter = ctx.createBiquadFilter();
    this.liquidFilter.type = 'bandpass';
    this.liquidFilter.frequency.value = 900;
    this.liquidFilter.Q.value = 4;
    this.liquidGain = ctx.createGain();
    this.liquidGain.gain.value = 0;
    this.liquidSrc.connect(this.liquidFilter);
    this.liquidFilter.connect(this.liquidGain);
    this.liquidGain.connect(this.sfxBus);
    this.liquidSrc.start();

    this._nextNote = ctx.currentTime + 0.5;
    this._nextPad = ctx.currentTime + 0.2;
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
  setStirState(speed, crystal, melt, air, chunky) {
    this.stir = { speed, crystal, melt, air, chunky };
  }

  // 毎フレーム呼ぶ
  update() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const s = this.stir;
    const sp = Math.min(1, s.speed);

    // ねっとり: 中温・空気少なめで強い
    const slushAmt = sp * (1 - s.melt * 0.85) * (0.35 + 0.65 * (1 - s.air)) * (1 - s.crystal * 0.5);
    this.slushGain.gain.setTargetAtTime(slushAmt * 0.30, now, 0.08);
    this.slushFilter.frequency.setTargetAtTime(380 + sp * 480, now, 0.1);

    // とろとろ: 溶けてるほど強い
    const liqAmt = sp * s.melt;
    this.liquidGain.gain.setTargetAtTime(liqAmt * 0.16, now, 0.08);

    // ざくざく: 結晶・粒が多いほど短いクランチ音を連射
    const crunchRate = sp * (s.crystal * 0.75 + s.chunky * 0.6);
    if (crunchRate > 0.04 && now >= this._nextCrunch) {
      this.crunchTick(0.25 + 0.75 * Math.min(1, crunchRate), s.chunky);
      const interval = 0.03 + (1 - Math.min(1, crunchRate)) * 0.13;
      this._nextCrunch = now + interval * (0.6 + Math.random() * 0.8);
    }

    // とろとろの雫音
    if (liqAmt > 0.15 && now >= this._nextDrip) {
      this.drip();
      this._nextDrip = now + 0.25 + Math.random() * 0.7;
    }

    this.updateBGM(now);
  }

  // ---- 個別SFX ----
  crunchTick(strength, chunky) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.9;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400 + Math.random() * 2600 - chunky * 500;
    f.Q.value = 1.6;
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

  // ---- BGM: オルゴール ----
  updateBGM(now) {
    // 一時停止明けは追いつき再生せず現在時刻から再開
    if (this._nextNote < now - 0.2) this._nextNote = now;
    if (this._nextPad < now - 0.2) this._nextPad = now;
    // ペンタトニック + ときどきお休み。2小節ごとに雰囲気が変わる
    const SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.7, 1318.5]; // C D E G A C D E
    const STEP = 60 / 76 / 2; // 76bpm 8分音符
    while (this._nextNote < now + 0.3) {
      const bar = Math.floor(this._noteStep / 8) % 4;
      const pos = this._noteStep % 8;
      // シード付きパターン(小節ごとに揺らぐ)
      const h = Math.sin(this._noteStep * 12.9898 + bar * 78.233) * 43758.5453;
      const r = h - Math.floor(h);
      const rest = (pos === 3 || pos === 7) ? r < 0.65 : r < 0.28;
      if (!rest) {
        const idx = Math.floor(r * 993) % SCALE.length;
        this.musicBoxNote(SCALE[idx], this._nextNote, 0.06 + r * 0.02);
      }
      // 小節頭に低いルート音
      if (pos === 0) {
        const roots = [261.63, 220.0, 174.61, 196.0]; // C A F G
        this.musicBoxNote(roots[bar], this._nextNote, 0.05);
      }
      this._noteStep++;
      this._nextNote += STEP;
    }

    // パッド: 8秒ごとにコードがゆっくり移ろう
    while (this._nextPad < now + 0.5) {
      const CHORDS = [
        [261.63, 329.63, 392.0],  // C
        [220.0, 261.63, 329.63],  // Am
        [174.61, 220.0, 261.63],  // F
        [196.0, 246.94, 293.66],  // G
      ];
      const chord = CHORDS[this._padStep % 4];
      for (const f of chord) this.padNote(f * 0.5, this._nextPad, 8.5);
      this._padStep++;
      this._nextPad += 8.0;
    }
  }

  musicBoxNote(freq, t, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 4; // オルゴールの倍音キラ
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 1.4);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(vol * 0.14, t + 0.004);
    g2.gain.exponentialRampToValueAtTime(0.0004, t + 0.5);
    o.connect(g); o2.connect(g2);
    g.connect(this.bgmBus); g2.connect(this.bgmBus);
    g.connect(this.bgmSend);
    o.start(t); o.stop(t + 1.5);
    o2.start(t); o2.stop(t + 0.6);
  }

  padNote(freq, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    o.detune.value = (Math.random() - 0.5) * 8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.016, t + 2.5);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(this.bgmBus);
    o.start(t); o.stop(t + dur + 0.1);
  }
}
