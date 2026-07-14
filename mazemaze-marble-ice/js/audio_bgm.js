// 状態駆動BGM: お皿がオルゴールになる
// 見えない読み取りアームがお皿を一周しながらアイスをスキャンし、
//   色相 → 音高(ペンタトニックに量子化。何を混ぜても心地よく響く)
//   量   → 音量(アイスが無い場所は休符)
//   質感 → 音色(しゃり=ベル / ふわ=ふえ風 / ねっとり=低音レガート /
//               ぷる=ビブラート / 殻=クリック / 溶け=下降グライド)
// つまりマーブル模様そのものが楽譜。混ぜるたびに世界に一つの曲になる。
// やわらかいコードパッドは常に流れていて、空のお皿は静かな曲になる。

const BPM = 76;
const STEP_DUR = 60 / BPM / 2;      // 8分音符
const STEPS_PER_REV = 8;            // アーム1周 = 1小節(8ステップ)
const REV_DUR = STEP_DUR * STEPS_PER_REV;
const LOOKAHEAD = 0.35;             // 先読みスケジュール秒数
const MELODY_RADIUS = 0.55;         // メロディを読む半径(皿半径比)
const BASS_RADIUS = 0.22;           // ベースを読む半径
const SPARKLE_RADIUS = 0.85;        // きらきらを読む半径
const NOTE_GATE = 0.05;             // これ未満のアイス量は休符
const PENTA = [0, 2, 4, 7, 9];      // ペンタトニック(半音)
const BASE_FREQ = 261.63;           // C4

// rgb(0..1) → { hue(0..1), sat, light }
function rgbToHsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const light = (mx + mn) / 2;
  if (mx - mn < 1e-4) return { hue: 0, sat: 0, light };
  const d = mx - mn;
  const sat = d / (1 - Math.abs(2 * light - 1) + 1e-6);
  let hue;
  if (mx === r) hue = ((g - b) / d + 6) % 6;
  else if (mx === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return { hue: hue / 6, sat, light };
}

// 色 → ペンタトニック周波数(2オクターブ10段 + シフト)
function colorToFreq(sample, octaveShift) {
  const { hue, sat, light } = rgbToHsl(sample.r, sample.g, sample.b);
  // バニラ等の無彩色は明るさで音高を決める
  const t = sat > 0.14 ? hue : light;
  const idx = Math.min(9, Math.floor(t * 10));
  let oct = Math.floor(idx / PENTA.length) + octaveShift;
  oct = Math.max(-1, Math.min(2, oct));
  const semitone = PENTA[idx % PENTA.length] + oct * 12;
  return BASE_FREQ * Math.pow(2, semitone / 12);
}

export class MusicBox {
  constructor(ctx, bus, send, noiseBuf) {
    this.ctx = ctx;
    this.bus = bus;
    this.send = send;
    this.noiseBuf = noiseBuf;
    this.sampler = null;         // (ox, oy) => sample(皿中心比の極座標オフセット)
    this._step = 0;
    this._nextStep = ctx.currentTime + 0.5;
    this._t0 = null;             // ステップ0が鳴った時刻(アーム表示の基準)
    this._nextPad = ctx.currentTime + 0.2;
    this._padStep = 0;
  }

  setSampler(fn) { this.sampler = fn; }

  // いま鳴っている場所のアーム角(UV系: 上=π/2 から時計回り)。未開始なら null
  getAngle(now) {
    if (this._t0 == null) return null;
    const stepFloat = (now - this._t0) / STEP_DUR;
    if (stepFloat < 0) return null;
    return Math.PI / 2 - ((stepFloat % STEPS_PER_REV) / STEPS_PER_REV) * Math.PI * 2;
  }

  update(now) {
    // 一時停止明けは追いつき再生せず、ステップ番号ごと進めて現在時刻から再開
    // (アーム角と鳴る場所の対応がずれないように)
    if (this._nextStep < now - 0.2) {
      const skipped = Math.ceil((now - this._nextStep) / STEP_DUR);
      this._step += skipped;
      this._nextStep += skipped * STEP_DUR;
    }
    if (this._nextPad < now - 0.2) this._nextPad = now;

    while (this._nextStep < now + LOOKAHEAD) {
      this.scheduleStep(this._step, this._nextStep);
      this._step++;
      this._nextStep += STEP_DUR;
    }

    // パッド: 8秒ごとにコードがゆっくり移ろう(常に流れる下地)
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

  scheduleStep(step, t) {
    if (this._t0 == null) this._t0 = t - (step % STEPS_PER_REV) * STEP_DUR;
    const pos = step % STEPS_PER_REV;

    // 小節頭に低いルート音(曲の重心。パッドのコードと同じ循環)
    if (pos === 0) {
      const roots = [261.63, 220.0, 174.61, 196.0]; // C A F G
      this.legatoNote(roots[Math.floor(step / STEPS_PER_REV) % 4] * 0.5, t, 0.045, 2.0);
    }

    if (!this.sampler) return;
    const ang = Math.PI / 2 - (pos / STEPS_PER_REV) * Math.PI * 2;
    const ox = Math.cos(ang), oy = Math.sin(ang);

    // メロディ: 中間リングを毎ステップ読む。アイスがある場所だけ鳴る
    const mel = this.sampler(ox * MELODY_RADIUS, oy * MELODY_RADIUS);
    if (mel && mel.amount > NOTE_GATE) this.plateNote(mel, t);

    // ベース: 内側リングを1・5拍目に読む(1オクターブ下)
    if (pos === 0 || pos === 4) {
      const bass = this.sampler(ox * BASS_RADIUS, oy * BASS_RADIUS);
      if (bass && bass.amount > NOTE_GATE) {
        this.legatoNote(colorToFreq(bass, -1) * 0.5, t, 0.05 + bass.amount * 0.03, 1.6);
      }
    }

    // きらきら: 外側リングを裏拍に読む(しゃり・結晶があるときだけ高く短く)
    if (pos === 2 || pos === 6) {
      const sp = this.sampler(ox * SPARKLE_RADIUS, oy * SPARKLE_RADIUS);
      if (sp && sp.amount > NOTE_GATE && sp.shari + sp.crystal > 0.25) {
        this.bellNote(colorToFreq(sp, 1) * 2, t, 0.035 * (sp.shari + sp.crystal));
      }
    }
  }

  // お皿の1点 → 1音。質感が音色になる
  plateNote(s, t) {
    const ctx = this.ctx;
    const sticky = Math.min(1, s.gloss * 0.7 + s.mochi * 0.9);
    const freq = colorToFreq(s, sticky > 0.55 ? -1 : 0);
    const vol = 0.045 + s.amount * 0.045;
    const attack = 0.005 + s.air * 0.10;                       // ふわふわ=やわらかい立ち上がり
    const decay = Math.max(0.2, 0.5 + sticky * 1.1 - s.shari * 0.25); // ねっとり=長く伸びる

    const o = ctx.createOscillator();
    o.type = s.air > 0.6 ? 'sine' : 'triangle';
    o.frequency.setValueAtTime(freq, t);
    // 溶けている音はとろりと下がる
    const melt = Math.max(0, (s.temp - 0.55) / 0.35);
    if (melt > 0.25) o.frequency.exponentialRampToValueAtTime(freq * (1 - 0.05 * melt), t + decay * 0.8);
    // ぷるぷるはビブラート
    let vib = null;
    if (s.jelly > 0.15) {
      vib = ctx.createOscillator();
      vib.frequency.value = 6.5;
      const vg = ctx.createGain();
      vg.gain.value = freq * 0.02 * s.jelly;
      vib.connect(vg); vg.connect(o.frequency);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0004, t + attack + decay);
    o.connect(g); g.connect(this.bus); g.connect(this.send);
    o.start(t); o.stop(t + attack + decay + 0.1);
    if (vib) { vib.start(t); vib.stop(t + attack + decay + 0.1); }

    // しゃり・結晶はオルゴールの倍音キラ
    const kira = s.crystal * 0.6 + s.shari * 0.8;
    if (kira > 0.15) {
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = freq * 4;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0, t);
      g2.gain.linearRampToValueAtTime(vol * 0.22 * kira, t + 0.004);
      g2.gain.exponentialRampToValueAtTime(0.0004, t + 0.4);
      o2.connect(g2); g2.connect(this.bus);
      o2.start(t); o2.stop(t + 0.5);
    }
    // ぱりぱり殻はこつっというクリック
    if (s.shell > 0.25 && this.noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.playbackRate.value = 1.6;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 2900; f.Q.value = 2.5;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(vol * 0.8 * s.shell, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      src.connect(f); f.connect(ng); ng.connect(this.bus);
      src.start(t, Math.random()); src.stop(t + 0.05);
    }
  }

  legatoNote(freq, t, vol, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    o.connect(g); g.connect(this.bus); g.connect(this.send);
    o.start(t); o.stop(t + dur + 0.1);
  }

  bellNote(freq, t, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.35);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(vol * 0.2, t);
    g2.gain.exponentialRampToValueAtTime(0.0004, t + 0.15);
    o.connect(g); o2.connect(g2);
    g.connect(this.bus); g.connect(this.send); g2.connect(this.bus);
    o.start(t); o.stop(t + 0.4);
    o2.start(t); o2.stop(t + 0.2);
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
    o.connect(g); g.connect(this.bus);
    o.start(t); o.stop(t + dur + 0.1);
  }
}
