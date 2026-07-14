// BGM: オルゴール調ループ + やわらかいパッド (Web Audio 合成)

export class MusicBox {
  constructor(ctx, bus, send) {
    this.ctx = ctx;
    this.bus = bus;
    this.send = send;
    this._nextNote = ctx.currentTime + 0.5;
    this._noteStep = 0;
    this._nextPad = ctx.currentTime + 0.2;
    this._padStep = 0;
  }

  update(now) {
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
        this.note(SCALE[idx], this._nextNote, 0.06 + r * 0.02);
      }
      // 小節頭に低いルート音
      if (pos === 0) {
        const roots = [261.63, 220.0, 174.61, 196.0]; // C A F G
        this.note(roots[bar], this._nextNote, 0.05);
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

  note(freq, t, vol) {
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
    g.connect(this.bus); g2.connect(this.bus);
    g.connect(this.send);
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
    o.connect(g); g.connect(this.bus);
    o.start(t); o.stop(t + dur + 0.1);
  }
}
