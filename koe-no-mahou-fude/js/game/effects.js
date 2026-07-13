/**
 * EffectsSystem — 母音ごとの魔法エフェクト。
 *
 *  あ: 赤・ピンクの丸いにじみが じゅわっ
 *  い: 青・水色の光の線と星が しゅん
 *  う: 紫・深い青の泡が ぷくぷく
 *  え: 緑の葉っぱとツタが ぐんぐん（声の高さ↗︎↘︎で上下）
 *  お: 金色の大きな輪が わーん
 *  息: 風のキラキラ霧 / 破裂音: ぱっとスタンプ / 揺れ声: マーブル波
 */
import * as THREE from 'three';

const MAX_PARTICLES = 1600;

export const VOWEL_COLORS = {
  a: ['#ff6d8d', '#ff9db4', '#ff4f6e', '#ffc7d4'],
  i: ['#57b8ff', '#9fe0ff', '#3d8bff', '#d7f3ff'],
  u: ['#a06dff', '#7d5fff', '#c9a8ff', '#5a4ae0'],
  e: ['#5ed67d', '#8ff0a4', '#3cb864', '#c8f7c8'],
  o: ['#ffc247', '#ffe27a', '#ffab2e', '#fff3c0'],
  breath: ['#e8f8ff', '#ffffff', '#cfeffd'],
};

export const VOWEL_MAIN = { a: '#ff6d8d', i: '#57b8ff', u: '#a06dff', e: '#5ed67d', o: '#ffc247' };

// スプライトatlasの並び
const SPR = { blob: 0, star: 1, bubble: 2, leaf: 3, sparkle: 4, petal: 5, ring: 6, heart: 7 };

export class EffectsSystem {
  constructor(scene) {
    this.scene = scene;
    this._initPoints();
    this._initBlooms();
    this._initRings();
    this.growers = [];   // ツタ
    this.tmpV = new THREE.Vector3();
  }

  /* ---------------- Pointsパーティクル基盤 ---------------- */
  _initPoints() {
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pSize = new Float32Array(MAX_PARTICLES);
    this.pSprite = new Float32Array(MAX_PARTICLES);
    this.pAlpha = new Float32Array(MAX_PARTICLES);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1));
    geo.setAttribute('aSprite', new THREE.BufferAttribute(this.pSprite, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.pAlpha, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: makeAtlasTexture() }, uScaleFactor: { value: 300 } },
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize, aSprite, aAlpha;
        varying vec3 vColor;
        varying float vSprite, vAlpha;
        uniform float uScaleFactor;
        void main() {
          vColor = aColor; vSprite = aSprite; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScaleFactor / max(-mv.z, 0.5);
        }
      `,
      fragmentShader: `
        uniform sampler2D uAtlas;
        varying vec3 vColor;
        varying float vSprite, vAlpha;
        void main() {
          float col = mod(vSprite, 4.0);
          float row = floor(vSprite / 4.0);
          vec2 uv = (vec2(col, row) + gl_PointCoord) / vec2(4.0, 2.0);
          vec4 tex = texture2D(uAtlas, uv);
          gl_FragColor = vec4(vColor, tex.a * vAlpha);
          if (gl_FragColor.a < 0.02) discard;
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.scene.add(this.points);

    this.particles = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3() });
    }
    this._cursor = 0;
  }

  _alloc() {
    for (let n = 0; n < MAX_PARTICLES; n++) {
      this._cursor = (this._cursor + 1) % MAX_PARTICLES;
      if (!this.particles[this._cursor].alive) return this.particles[this._cursor];
    }
    this._cursor = (this._cursor + 1) % MAX_PARTICLES;
    return this.particles[this._cursor]; // 満杯なら上書き
  }

  spawn(o) {
    const p = this._alloc();
    p.alive = true;
    p.pos.copy(o.pos);
    p.vel.copy(o.vel || ZERO);
    p.life = 0;
    p.maxLife = o.life ?? 1;
    p.size0 = o.size0 ?? 0.3;
    p.size1 = o.size1 ?? p.size0;
    p.gravity = o.gravity ?? 0;
    p.drag = o.drag ?? 0;
    p.sprite = o.sprite ?? SPR.blob;
    p.color = o.color ?? '#ffffff';
    p.swayAmp = o.swayAmp ?? 0;
    p.swayFreq = o.swayFreq ?? 3;
    p.phase = Math.random() * Math.PI * 2;
    p.twinkle = o.twinkle ?? 0;
    p.fadeIn = o.fadeIn ?? 0.08;
    p.popAtEnd = o.popAtEnd ?? false;
    return p;
  }

  /* ---------------- にじみ（面に貼りつく円） ---------------- */
  _initBlooms() {
    this.blooms = [];
    const tex = makeRadialTexture();
    for (let i = 0; i < 36; i++) {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(1, 24),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 })
      );
      m.visible = false;
      m.renderOrder = 5;
      this.scene.add(m);
      this.blooms.push({ mesh: m, life: 0, maxLife: 1, size: 1 });
    }
    this._bloomCursor = 0;
  }

  bloom(pos, normal, color, size = 1.2, life = 1.6) {
    const b = this.blooms[this._bloomCursor];
    this._bloomCursor = (this._bloomCursor + 1) % this.blooms.length;
    b.life = 0; b.maxLife = life; b.size = size;
    const m = b.mesh;
    m.visible = true;
    m.material.color.set(color);
    m.position.copy(pos).addScaledVector(normal, 0.03 + Math.random() * 0.03);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    m.rotation.z = Math.random() * Math.PI * 2;
    m.scale.setScalar(0.01);
  }

  /* ---------------- 金の輪 ---------------- */
  _initRings() {
    this.rings = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.82, 1, 48),
        new THREE.MeshBasicMaterial({ color: '#ffc247', transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide })
      );
      m.visible = false;
      m.renderOrder = 6;
      this.scene.add(m);
      this.rings.push({ mesh: m, life: 0, maxLife: 1, size: 1 });
    }
    this._ringCursor = 0;
  }

  ring(pos, normal, color = '#ffc247', size = 3, life = 1.4) {
    const r = this.rings[this._ringCursor];
    this._ringCursor = (this._ringCursor + 1) % this.rings.length;
    r.life = 0; r.maxLife = life; r.size = size;
    const m = r.mesh;
    m.visible = true;
    m.material.color.set(color);
    m.position.copy(pos).addScaledVector(normal, 0.05);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    m.scale.setScalar(0.05);
  }

  /* ================= 母音の魔法（声が続く間、毎フレーム呼ばれる） ================= */
  /**
   * @param pos ワールド座標のペイント位置
   * @param normal 面の法線
   * @param voice VoiceAnalyzerのstate
   * @param dt
   */
  vowelMagic(pos, normal, voice, dt) {
    const vowel = voice.vowel || 'a';
    const colors = VOWEL_COLORS[vowel] || VOWEL_COLORS.a;
    const pick = () => colors[(Math.random() * colors.length) | 0];
    const up = voice.pitchTrend;             // -1..1
    const hi = voice.pitchNorm;              // 0..1
    const wob = voice.wavering;

    switch (vowel) {
      case 'a': { // にじみ + ふわふわ玉
        if (chance(9 * dt)) this.bloom(pos, normal, pick(), 0.9 + Math.random() * 1.3 + Math.min(voice.duration * 0.35, 1.2));
        if (chance(22 * dt)) {
          this.spawn({
            pos: jitter(pos, 0.35), sprite: Math.random() < 0.25 ? SPR.heart : SPR.blob,
            vel: new THREE.Vector3(rnd(0.5), 0.5 + hi * 1.2, rnd(0.5)),
            color: pick(), size0: 0.25, size1: 0.75, life: 1.5, drag: 1.2,
            swayAmp: wob ? 1.2 : 0.25,
          });
        }
        break;
      }
      case 'i': { // 光の線・星が走る
        if (chance(30 * dt)) {
          const dir = new THREE.Vector3(rnd(1), 0.4 + up * 1.6 + hi * 1.2, rnd(1)).normalize();
          this.spawn({
            pos: jitter(pos, 0.15), sprite: SPR.star,
            vel: dir.multiplyScalar(5 + Math.random() * 4),
            color: pick(), size0: 0.5, size1: 0.12, life: 0.8, drag: 2.2, twinkle: 1,
          });
          // 尾のきらきら
          for (let k = 0; k < 2; k++) {
            this.spawn({
              pos: jitter(pos, 0.2), sprite: SPR.sparkle,
              vel: new THREE.Vector3(rnd(1.2), rnd(1.2) + up, rnd(1.2)),
              color: '#ffffff', size0: 0.22, size1: 0.03, life: 0.5, twinkle: 1,
            });
          }
        }
        break;
      }
      case 'u': { // 泡ぷくぷく
        if (chance(20 * dt)) {
          this.spawn({
            pos: jitter(pos, 0.4), sprite: SPR.bubble,
            vel: new THREE.Vector3(rnd(0.3), 0.7 + hi * 1.3, rnd(0.3)),
            color: pick(), size0: 0.15, size1: 0.5 + Math.random() * 0.45,
            life: 1.8 + Math.random(), drag: 0.4, swayAmp: 0.8, swayFreq: 2.2,
            popAtEnd: true,
          });
        }
        break;
      }
      case 'e': { // 葉っぱ・ツタが伸びる
        if (chance(6 * dt) && this.growers.length < 10) {
          this.growers.push({
            pos: pos.clone(), life: 0, maxLife: 2.2,
            dir: new THREE.Vector3(rnd(0.7), 0.9, rnd(0.7)).normalize(),
            speed: 1.6 + Math.random(),
            phase: Math.random() * Math.PI * 2,
            colorFn: pick,
          });
        }
        if (chance(10 * dt)) {
          this.spawn({
            pos: jitter(pos, 0.3), sprite: SPR.leaf,
            vel: new THREE.Vector3(rnd(0.6), 0.4 + up * 1.2, rnd(0.6)),
            color: pick(), size0: 0.2, size1: 0.45, life: 1.4, gravity: -0.35, swayAmp: 0.9,
          });
        }
        break;
      }
      case 'o': { // 金の輪
        if (chance(4.5 * dt)) this.ring(pos, normal, VOWEL_COLORS.o[(Math.random() * 2) | 0], 2.2 + Math.min(voice.duration, 3) * 1.1);
        if (chance(16 * dt)) {
          this.spawn({
            pos: jitter(pos, 0.5), sprite: SPR.sparkle,
            vel: new THREE.Vector3(rnd(0.8), 0.8 + hi, rnd(0.8)),
            color: pick(), size0: 0.35, size1: 0.05, life: 1.1, twinkle: 1,
          });
        }
        break;
      }
    }

    // 揺れ声: マーブル波（どの母音にも重なる）
    if (wob && chance(14 * dt)) {
      this.spawn({
        pos: jitter(pos, 0.3), sprite: SPR.blob,
        vel: new THREE.Vector3(rnd(1.5), 0.2, rnd(1.5)),
        color: pick(), size0: 0.3, size1: 0.55, life: 1.2, swayAmp: 2.4, swayFreq: 5,
      });
    }
  }

  /** 息（ふー）: 広くただようキラキラ霧 */
  breathMist(pos, dt) {
    const colors = VOWEL_COLORS.breath;
    if (chance(40 * dt)) {
      this.spawn({
        pos: jitter(pos, 1.6), sprite: Math.random() < 0.5 ? SPR.sparkle : SPR.blob,
        vel: new THREE.Vector3(1.2 + Math.random() * 1.6, 0.15 + Math.random() * 0.3, rnd(0.8)),
        color: colors[(Math.random() * colors.length) | 0],
        size0: 0.14, size1: 0.4, life: 1.8, drag: 0.5, swayAmp: 0.7, twinkle: 1,
      });
    }
  }

  /** リズム（あ、あ、あ）: 発声のたびに花びらがぱっ */
  onsetBurst(pos, normal, vowel, count) {
    const colors = VOWEL_COLORS[vowel] || VOWEL_COLORS.a;
    const n = Math.min(4 + count * 2, 14);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spawn({
        pos: pos.clone(), sprite: SPR.petal,
        vel: new THREE.Vector3(Math.cos(a) * 2.2, 1.6 + Math.random(), Math.sin(a) * 2.2),
        color: colors[i % colors.length], size0: 0.3, size1: 0.4, life: 1.1,
        gravity: -2.2, drag: 0.8, swayAmp: 0.6,
      });
    }
  }

  /** 破裂音（ぱっ）: スタンプ花火 */
  stampBurst(pos, vowel) {
    const colors = VOWEL_COLORS[vowel] || VOWEL_COLORS.o;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.spawn({
        pos: pos.clone(),
        sprite: i % 2 ? SPR.star : SPR.sparkle,
        vel: new THREE.Vector3(Math.cos(a) * 4, Math.random() * 3 + 1, Math.sin(a) * 4),
        color: colors[i % colors.length], size0: 0.45, size1: 0.06, life: 0.75,
        gravity: -3, drag: 1.4, twinkle: 1,
      });
    }
    this.ring(pos, UP, colors[0], 1.6, 0.8);
  }

  /** オブジェクト完成のおいわいぷちバースト */
  donePuff(pos, color) {
    for (let i = 0; i < 10; i++) {
      this.spawn({
        pos: jitter(pos, 0.2), sprite: SPR.sparkle,
        vel: new THREE.Vector3(rnd(2), 1.5 + Math.random() * 2, rnd(2)),
        color, size0: 0.4, size1: 0.05, life: 0.9, gravity: -2, twinkle: 1,
      });
    }
  }

  /** 花火（おいわい） */
  firework(center, radius = 8) {
    const palettes = Object.values(VOWEL_MAIN);
    const color = palettes[(Math.random() * palettes.length) | 0];
    const pos = center.clone().add(new THREE.Vector3(rnd(radius), 4 + Math.random() * 5, rnd(radius) * 0.5));
    for (let i = 0; i < 42; i++) {
      const v = new THREE.Vector3(rnd(1), rnd(1), rnd(1)).normalize().multiplyScalar(3.5 + Math.random() * 2.5);
      this.spawn({
        pos, sprite: i % 3 === 0 ? SPR.star : SPR.sparkle,
        vel: v, color: Math.random() < 0.8 ? color : '#ffffff',
        size0: 0.5, size1: 0.05, life: 1.4 + Math.random() * 0.5,
        gravity: -2.2, drag: 1.1, twinkle: 1,
      });
    }
    this.ring(pos, new THREE.Vector3(0, 0, 1), color, 3, 1);
  }

  /* ================= 更新 ================= */
  update(dt, time) {
    // --- Points ---
    const posA = this.pPos, colA = this.pCol, sizeA = this.pSize, sprA = this.pSprite, alpA = this.pAlpha;
    const c = new THREE.Color();
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.alive) { sizeA[i] = 0; alpA[i] = 0; continue; }
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.alive = false; sizeA[i] = 0; alpA[i] = 0;
        if (p.popAtEnd && this.onBubblePop) this.onBubblePop(p.pos);
        continue;
      }
      const t = p.life / p.maxLife;
      p.vel.y += p.gravity * dt;
      if (p.drag) p.vel.multiplyScalar(Math.max(1 - p.drag * dt, 0));
      p.pos.addScaledVector(p.vel, dt);
      const sway = p.swayAmp ? Math.sin(time * p.swayFreq + p.phase) * p.swayAmp * dt : 0;
      p.pos.x += sway;
      p.pos.z += p.swayAmp ? Math.cos(time * p.swayFreq * 0.8 + p.phase) * p.swayAmp * dt * 0.6 : 0;

      posA[i * 3] = p.pos.x; posA[i * 3 + 1] = p.pos.y; posA[i * 3 + 2] = p.pos.z;
      c.set(p.color);
      colA[i * 3] = c.r; colA[i * 3 + 1] = c.g; colA[i * 3 + 2] = c.b;
      sizeA[i] = lerp(p.size0, p.size1, t);
      sprA[i] = p.sprite;
      let alpha = t < p.fadeIn ? t / p.fadeIn : 1 - Math.pow((t - p.fadeIn) / (1 - p.fadeIn), 2);
      if (p.twinkle) alpha *= 0.65 + 0.35 * Math.sin(time * 14 + p.phase);
      alpA[i] = Math.max(alpha, 0);
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aSprite.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;

    // --- にじみ ---
    for (const b of this.blooms) {
      if (!b.mesh.visible) continue;
      b.life += dt;
      const t = b.life / b.maxLife;
      if (t >= 1) { b.mesh.visible = false; b.mesh.material.opacity = 0; continue; }
      const grow = 1 - Math.pow(1 - Math.min(t * 1.6, 1), 3); // じゅわっ
      b.mesh.scale.setScalar(b.size * grow + 0.01);
      b.mesh.material.opacity = t < 0.7 ? 0.55 : 0.55 * (1 - (t - 0.7) / 0.3);
    }

    // --- 輪 ---
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.life += dt;
      const t = r.life / r.maxLife;
      if (t >= 1) { r.mesh.visible = false; r.mesh.material.opacity = 0; continue; }
      const grow = 1 - Math.pow(1 - t, 2.4);
      r.mesh.scale.setScalar(r.size * grow + 0.02);
      r.mesh.material.opacity = 0.9 * (1 - t);
    }

    // --- ツタ ---
    for (let gi = this.growers.length - 1; gi >= 0; gi--) {
      const g = this.growers[gi];
      g.life += dt;
      if (g.life >= g.maxLife) { this.growers.splice(gi, 1); continue; }
      // くねくね昇る/垂れる（Gameがdir.yをpitchTrendで更新）
      g.pos.addScaledVector(g.dir, g.speed * dt);
      g.pos.x += Math.sin(g.life * 5 + g.phase) * 0.5 * dt;
      g.pos.z += Math.cos(g.life * 4.4 + g.phase) * 0.5 * dt;
      if (chance(28 * dt)) {
        this.spawn({
          pos: jitter(g.pos, 0.12), sprite: SPR.leaf,
          vel: new THREE.Vector3(rnd(0.2), 0.1, rnd(0.2)),
          color: g.colorFn(), size0: 0.32, size1: 0.16, life: 1.6, swayAmp: 0.5,
        });
      }
      if (chance(3 * dt)) {
        this.spawn({
          pos: g.pos.clone(), sprite: SPR.petal,
          vel: new THREE.Vector3(rnd(0.4), 0.3, rnd(0.4)),
          color: '#ffd9e8', size0: 0.3, size1: 0.4, life: 1.4, gravity: -0.5, swayAmp: 0.8,
        });
      }
    }
  }

  /** ツタの向きを声の高さの動きに合わせる */
  steerGrowers(pitchTrend) {
    for (const g of this.growers) {
      g.dir.y += (pitchTrend * 1.4 - g.dir.y) * 0.1;
      g.dir.normalize();
    }
  }
}

/* ---------------- テクスチャ生成 ---------------- */

function makeAtlasTexture() {
  const S = 128, canvas = document.createElement('canvas');
  canvas.width = S * 4; canvas.height = S * 2;
  const ctx = canvas.getContext('2d');

  const cell = (cx, cy, fn) => {
    ctx.save();
    ctx.translate(cx * S + S / 2, cy * S + S / 2);
    fn();
    ctx.restore();
  };

  // 0: soft blob
  cell(0, 0, () => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-S / 2, -S / 2, S, S);
  });
  // 1: star (4-point)
  cell(1, 0, () => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    const R = S * 0.46, r = S * 0.09;
    for (let i = 0; i < 8; i++) {
      const rad = i % 2 === 0 ? R : r;
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      ctx[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath(); ctx.fill();
  });
  // 2: bubble
  cell(2, 0, () => {
    ctx.strokeStyle = 'rgba(255,255,255,.95)';
    ctx.lineWidth = S * 0.06;
    ctx.beginPath(); ctx.arc(0, 0, S * 0.38, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.beginPath(); ctx.arc(0, 0, S * 0.38, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    ctx.beginPath(); ctx.ellipse(-S * 0.14, -S * 0.16, S * 0.09, S * 0.05, -0.6, 0, Math.PI * 2); ctx.fill();
  });
  // 3: leaf
  cell(3, 0, () => {
    ctx.fillStyle = '#fff';
    ctx.rotate(-0.7);
    ctx.beginPath();
    ctx.moveTo(0, S * 0.4);
    ctx.quadraticCurveTo(S * 0.34, 0, 0, -S * 0.4);
    ctx.quadraticCurveTo(-S * 0.34, 0, 0, S * 0.4);
    ctx.fill();
  });
  // 4: sparkle (thin 4-point)
  cell(0, 1, () => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    const R = S * 0.48, r = S * 0.05;
    for (let i = 0; i < 8; i++) {
      const rad = i % 2 === 0 ? R : r;
      const a = (i / 8) * Math.PI * 2;
      ctx[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath(); ctx.fill();
  });
  // 5: petal
  cell(1, 1, () => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(0, 0, S * 0.2, S * 0.4, 0.5, 0, Math.PI * 2);
    ctx.fill();
  });
  // 6: ring
  cell(2, 1, () => {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = S * 0.09;
    ctx.beginPath(); ctx.arc(0, 0, S * 0.36, 0, Math.PI * 2); ctx.stroke();
  });
  // 7: heart
  cell(3, 1, () => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    const s = S * 0.36;
    ctx.moveTo(0, s * 0.9);
    ctx.bezierCurveTo(-s * 1.4, -s * 0.1, -s * 0.6, -s * 1.1, 0, -s * 0.35);
    ctx.bezierCurveTo(s * 0.6, -s * 1.1, s * 1.4, -s * 0.1, 0, s * 0.9);
    ctx.fill();
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false; // shaderの row0 = canvas上段 に揃える
  return tex;
}

function makeRadialTexture() {
  const S = 256, canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,.95)');
  g.addColorStop(0.6, 'rgba(255,255,255,.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------------- utils ---------------- */
const ZERO = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
function rnd(a) { return (Math.random() * 2 - 1) * a; }
function chance(p) { return Math.random() < p; }
function jitter(v, r) { return new THREE.Vector3(v.x + rnd(r), v.y + rnd(r), v.z + rnd(r)); }
function lerp(a, b, t) { return a + (b - a) * t; }
