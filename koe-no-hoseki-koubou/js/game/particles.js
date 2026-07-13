// ============================================================
// Particles — キラキラ・光の流れ・花火・霧
//   burst()     結晶が固まった瞬間のキラキラ
//   stream      宝石から立ちのぼる光の粒(育つほど増える)
//   fireworks() 完成のお祝い花火
//   mist()      「ふー」の白い霧
// ============================================================

import * as THREE from '../lib/three.module.min.js';

function makeDotTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.tex = makeDotTexture();
    this.effects = []; // { points, vel, life, maxLife, gravity, update? }
    this._buildStream();
  }

  // ---- ワンショット(キラキラ、花火の一発) ----
  burst(pos, color, { count = 40, speed = 1.6, size = 0.09, life = 1.1, gravity = -1.2, spread = 1 } = {}) {
    const positions = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;
      // ランダム方向(見た目用なので Math.random でよい)
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = speed * (0.4 + Math.random() * 0.6);
      vel[i * 3] = Math.sin(ph) * Math.cos(th) * sp * spread;
      vel[i * 3 + 1] = Math.cos(ph) * sp;
      vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp * spread;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color, size, map: this.tex, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.effects.push({ points, vel, life: 0, maxLife: life, gravity });
  }

  // ---- 白い霧(ふー) ----
  mist(pos) {
    this.burst(pos, new THREE.Color(0xf0f8ff), {
      count: 60, speed: 0.5, size: 0.5, life: 2.2, gravity: 0.08, spread: 1.4,
    });
  }

  // ---- 完成花火 ----
  fireworks(center, colors) {
    const bursts = 8;
    for (let i = 0; i < bursts; i++) {
      const delay = i * 0.28;
      const p = center.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 4.5,
        1.2 + Math.random() * 2.4,
        (Math.random() - 0.5) * 3
      ));
      const color = colors[i % colors.length];
      setTimeout(() => {
        this.burst(p, color, { count: 90, speed: 2.6, size: 0.11, life: 1.6, gravity: -1.6 });
        this.burst(p, new THREE.Color(0xffffff), { count: 24, speed: 1.2, size: 0.07, life: 1.0, gravity: -0.8 });
      }, delay * 1000);
    }
  }

  // ---- 宝石から立ちのぼる光の流れ(常設・rate で量を調整) ----
  _buildStream() {
    const N = 130;
    this.streamN = N;
    this.streamPos = new Float32Array(N * 3);
    this.streamAge = new Float32Array(N).fill(999);
    this.streamMax = new Float32Array(N);
    this.streamVel = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.streamPos, 3));
    this.streamMat = new THREE.PointsMaterial({
      color: 0xaaccff, size: 0.075, map: this.tex, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const points = new THREE.Points(geo, this.streamMat);
    points.frustumCulled = false;
    this.scene.add(points);
    this.streamGeo = geo;
    this.streamRate = 4; // 個/秒
    this.streamAccu = 0;
    this.streamOrigin = new THREE.Vector3(0, 1.1, 0);
  }

  setStreamRate(rate) { this.streamRate = rate; }
  setStreamColor(color) { this.streamMat.color.lerp(color, 0.5); }

  _spawnStreamParticle() {
    for (let i = 0; i < this.streamN; i++) {
      if (this.streamAge[i] > this.streamMax[i]) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.3;
        this.streamPos[i * 3] = this.streamOrigin.x + Math.cos(a) * r;
        this.streamPos[i * 3 + 1] = this.streamOrigin.y + (Math.random() - 0.3) * 0.4;
        this.streamPos[i * 3 + 2] = this.streamOrigin.z + Math.sin(a) * r;
        this.streamVel[i * 3] = (Math.random() - 0.5) * 0.15;
        this.streamVel[i * 3 + 1] = 0.5 + Math.random() * 0.5;
        this.streamVel[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
        this.streamAge[i] = 0;
        this.streamMax[i] = 1.6 + Math.random() * 1.4;
        return;
      }
    }
  }

  update(dt) {
    // ワンショットの更新
    for (let e = this.effects.length - 1; e >= 0; e--) {
      const fx = this.effects[e];
      fx.life += dt;
      const pos = fx.points.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        fx.vel[i * 3 + 1] += fx.gravity * dt;
        pos.array[i * 3] += fx.vel[i * 3] * dt;
        pos.array[i * 3 + 1] += fx.vel[i * 3 + 1] * dt;
        pos.array[i * 3 + 2] += fx.vel[i * 3 + 2] * dt;
      }
      pos.needsUpdate = true;
      fx.points.material.opacity = Math.max(0, 1 - fx.life / fx.maxLife);
      if (fx.life >= fx.maxLife) {
        this.scene.remove(fx.points);
        fx.points.geometry.dispose();
        fx.points.material.dispose();
        this.effects.splice(e, 1);
      }
    }

    // 光の流れ
    this.streamAccu += this.streamRate * dt;
    while (this.streamAccu >= 1) {
      this.streamAccu -= 1;
      this._spawnStreamParticle();
    }
    for (let i = 0; i < this.streamN; i++) {
      if (this.streamAge[i] <= this.streamMax[i]) {
        this.streamAge[i] += dt;
        this.streamPos[i * 3] += (this.streamVel[i * 3] + Math.sin(this.streamAge[i] * 3 + i) * 0.08) * dt;
        this.streamPos[i * 3 + 1] += this.streamVel[i * 3 + 1] * dt;
        this.streamPos[i * 3 + 2] += this.streamVel[i * 3 + 2] * dt;
      } else {
        // 画面外へ(未使用スロット)
        this.streamPos[i * 3 + 1] = -50;
      }
    }
    this.streamGeo.attributes.position.needsUpdate = true;
  }
}
