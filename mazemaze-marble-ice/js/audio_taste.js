// 味見スプーンの効果音 (Web Audio 合成)
// 咀嚼音は「その一口の質感配合」から作られる:
// しゃり・結晶→高いクランチ / もち・ツヤ→ねちゃっと / ぷる→びよん / 殻→ぱきっ
// 引数 a は GameAudio インスタンス(ctx, noiseBuf, sfxBus を使う)

// ずずっ(すくい取り開始)
export function scoopSlurp(a) {
  if (!a.ctx || !a.enabled) return;
  const ctx = a.ctx;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = a.noiseBuf;
  src.playbackRate.value = 0.9;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 3;
  f.frequency.setValueAtTime(350, t);
  f.frequency.exponentialRampToValueAtTime(1400, t + 0.3);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.02, t);
  g.gain.linearRampToValueAtTime(0.12, t + 0.22);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
  src.connect(f); f.connect(g); g.connect(a.sfxBus);
  src.start(t, Math.random()); src.stop(t + 0.42);
}

// もぐっ(1回ぶんの咀嚼): 質感配合で音色が変わる
function munch(a, t, tex, strength) {
  const ctx = a.ctx;
  // あご: 低いノイズのふくらみ(共通のベース)
  {
    const src = ctx.createBufferSource();
    src.buffer = a.noiseBuf;
    src.playbackRate.value = 0.5;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(420, t);
    f.frequency.exponentialRampToValueAtTime(140, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.13 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(f); f.connect(g); g.connect(a.sfxBus);
    src.start(t, Math.random()); src.stop(t + 0.22);
  }
  // しゃり・ざく: 明るいクランチの粒
  const crunchy = tex.shari * 0.9 + tex.crystal * 0.6;
  const nCrunch = Math.round(crunchy * 3);
  for (let i = 0; i < nCrunch; i++) {
    const ct = t + 0.015 + i * (0.03 + Math.random() * 0.02);
    const src = ctx.createBufferSource();
    src.buffer = a.noiseBuf;
    src.playbackRate.value = 1.2 + Math.random() * 0.8 + tex.shari * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2200 + Math.random() * 2400;
    f.Q.value = 2.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09 * strength * (0.7 + Math.random() * 0.6), ct);
    g.gain.exponentialRampToValueAtTime(0.001, ct + 0.04);
    src.connect(f); f.connect(g); g.connect(a.sfxBus);
    src.start(ct, Math.random() * 1.5); src.stop(ct + 0.06);
  }
  // ぱき: チョコ殻
  if (tex.shell > 0.2) {
    const ct = t + 0.02;
    const src = ctx.createBufferSource();
    src.buffer = a.noiseBuf;
    src.playbackRate.value = 1.7;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 3300; f.Q.value = 2.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14 * tex.shell * strength, ct);
    g.gain.exponentialRampToValueAtTime(0.001, ct + 0.05);
    src.connect(f); f.connect(g); g.connect(a.sfxBus);
    src.start(ct, Math.random()); src.stop(ct + 0.07);
  }
  // ねちゃ: もち・ツヤの湿った中域
  const sticky = tex.mochi * 0.8 + tex.gloss * 0.5;
  if (sticky > 0.15) {
    const src = ctx.createBufferSource();
    src.buffer = a.noiseBuf;
    src.playbackRate.value = 0.62;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(900, t + 0.03);
    f.frequency.exponentialRampToValueAtTime(420, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.10 * sticky * strength, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    src.connect(f); f.connect(g); g.connect(a.sfxBus);
    src.start(t + 0.03, Math.random()); src.stop(t + 0.28);
  }
  // びよん: ぷるぷるの揺れ
  if (tex.jelly > 0.2) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(300, t + 0.02);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.2);
    const vib = ctx.createOscillator();
    vib.frequency.value = 11;
    const vibG = ctx.createGain();
    vibG.gain.value = 34;
    vib.connect(vibG); vibG.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05 * tex.jelly * strength, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(a.sfxBus);
    o.start(t + 0.02); o.stop(t + 0.26);
    vib.start(t + 0.02); vib.stop(t + 0.26);
  }
}

// ぱくっ→もぐもぐ→ごくん(味見の一連)。戻り値は演出全体の秒数
export function eatBite(a, tex, amount) {
  if (!a.ctx || !a.enabled) return 0.9;
  const ctx = a.ctx;
  const t0 = ctx.currentTime;
  const munches = 2 + Math.round(Math.min(1, amount));
  const MUNCH_GAP = 0.27;
  for (let i = 0; i < munches; i++) {
    munch(a, t0 + 0.06 + i * MUNCH_GAP, tex, 0.6 + 0.4 * (1 - i / munches));
  }
  // ごくん: 下がるサイン + こもったノイズ
  const st = t0 + 0.06 + munches * MUNCH_GAP + 0.05;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(300, st);
  o.frequency.exponentialRampToValueAtTime(85, st + 0.16);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.10, st);
  og.gain.exponentialRampToValueAtTime(0.001, st + 0.2);
  o.connect(og); og.connect(a.sfxBus);
  o.start(st); o.stop(st + 0.24);
  // んまっ: 小さな2音(E→G)
  const NOTE_E = 659.25, NOTE_G = 783.99;
  [[NOTE_E, 0], [NOTE_G, 0.09]].forEach(([freq, dt]) => {
    const no = ctx.createOscillator();
    no.type = 'triangle';
    no.frequency.value = freq;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.05, st + 0.2 + dt);
    ng.gain.exponentialRampToValueAtTime(0.001, st + 0.2 + dt + 0.18);
    no.connect(ng); ng.connect(a.sfxBus);
    no.start(st + 0.2 + dt); no.stop(st + 0.2 + dt + 0.22);
  });
  return (st + 0.4) - t0;
}
