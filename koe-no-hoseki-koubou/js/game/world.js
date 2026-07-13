// ============================================================
// World — 宝石を「世界変化の中心」にする洞窟のシーン
//   ・宝石が育つと壁の結晶が同じ色で光る
//   ・宝石の色が足もとの水に溶けていく
//   ・成長のたびに水面に波紋、まわりに花が咲く
//   ・天井の星、ただよう光の粒(ほたる)
// ============================================================

import * as THREE from '../lib/three.module.min.js';
import { Rng } from './rng.js';

export class World {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0b0a1a, 0.045);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 60);
    this.camera.position.set(0, 1.7, 4.0);
    this.camera.lookAt(0, 1.0, 0);

    this.time = 0;
    this.liveLevel = 0;
    this.liveColor = new THREE.Color(0xffffff);
    this.waterTarget = new THREE.Color(0x1c2c5a);
    this.growth = 0;
    this.ripples = [];
    this.flowers = [];
    this.litCount = 0;

    this._buildEnvironment();
    this._buildLights();
    this._buildCave();
    this._buildIslandAndWater();
    this._buildWallCrystals();
    this._buildStarsAndFireflies();

    // 宝石を置く場所(台座の上)
    this.gemAnchor = new THREE.Group();
    this.gemAnchor.position.set(0, 0.62, 0);
    this.scene.add(this.gemAnchor);
  }

  // ---- 空気感のある環境マップ(グラデーションの equirect テクスチャ) ----
  _buildEnvironment() {
    const w = 64, h = 32;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const t = y / (h - 1); // 0=下, 1=上
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // 下: 深い藍 / 中: 紫がかった光 / 上: 淡い光
        const r = 20 + 90 * t + 40 * Math.pow(t, 3);
        const g = 16 + 70 * t + 60 * Math.pow(t, 3);
        const b = 46 + 110 * t + 60 * Math.pow(t, 2);
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, w, h);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.scene.environment = tex;
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0x4a5aa8, 0x0c0a16, 0.75);
    this.scene.add(this.hemi);

    const dir = new THREE.DirectionalLight(0xcfd8ff, 0.5);
    dir.position.set(2.5, 6, 3.5);
    this.scene.add(dir);

    // 宝石の中の光 — 声に反応して強く・その色に光る
    this.gemLight = new THREE.PointLight(0x99aaff, 0.9, 12, 1.6);
    this.gemLight.position.set(0, 1.3, 0);
    this.scene.add(this.gemLight);
  }

  _buildCave() {
    const rng = new Rng(20260713);
    const geo = new THREE.IcosahedronGeometry(15, 3);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n =
        1 +
        0.10 * Math.sin(v.x * 0.9 + v.y * 1.3) +
        0.08 * Math.sin(v.z * 1.4 - v.x * 0.6) +
        0.05 * Math.sin(v.y * 2.6 + v.z * 1.1);
      v.multiplyScalar(n);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x191632,
      roughness: 0.95,
      metalness: 0.05,
      flatShading: true,
      side: THREE.BackSide,
    });
    const cave = new THREE.Mesh(geo, mat);
    cave.position.y = 4;
    this.scene.add(cave);

    // 岩のでこぼこ(床にいくつか)
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x232043, roughness: 0.9, flatShading: true,
    });
    for (let i = 0; i < 10; i++) {
      const a = rng.float(0, Math.PI * 2);
      const r = rng.float(4.2, 8);
      const rock = new THREE.Mesh(
        new THREE.IcosahedronGeometry(rng.float(0.3, 1.1), 0), rockMat
      );
      rock.position.set(Math.cos(a) * r, rng.float(-0.1, 0.1), Math.sin(a) * r);
      rock.rotation.set(rng.float(0, 3), rng.float(0, 3), rng.float(0, 3));
      this.scene.add(rock);
    }
  }

  _buildIslandAndWater() {
    // 水面(宝石の色が溶けていく)
    this.waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x1c2c5a,
      roughness: 0.08,
      metalness: 0.35,
      transparent: true,
      opacity: 0.62,
      envMapIntensity: 1.6,
    });
    const water = new THREE.Mesh(new THREE.CircleGeometry(9, 48), this.waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.045;
    this.scene.add(water);

    // 小島
    const island = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.5, 0.3, 9),
      new THREE.MeshStandardMaterial({ color: 0x2c2850, roughness: 0.9, flatShading: true })
    );
    island.position.y = 0.05;
    this.scene.add(island);

    // 台座(石のいす)
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.55, 0.42, 7),
      new THREE.MeshStandardMaterial({ color: 0x3d3768, roughness: 0.7, flatShading: true })
    );
    pedestal.position.y = 0.41;
    this.scene.add(pedestal);
  }

  _buildWallCrystals() {
    this.wallCrystals = [];
    const rng = new Rng(777);
    for (let i = 0; i < 26; i++) {
      const theta = rng.float(0, Math.PI * 2);
      const phi = rng.float(0.95, 1.5); // カメラから見える壁の帯
      const r = 13.2;
      const p = new THREE.Vector3(
        Math.cos(theta) * Math.sin(phi) * r,
        Math.cos(phi) * r * 0.85 + 3.2,
        Math.sin(theta) * Math.sin(phi) * r
      );
      const mat = new THREE.MeshStandardMaterial({
        color: 0x2a2a55,
        roughness: 0.3,
        flatShading: true,
        emissive: 0x000000,
        emissiveIntensity: 1,
      });
      const cluster = new THREE.Group();
      const n = rng.int(2, 4);
      for (let k = 0; k < n; k++) {
        const h = rng.float(0.5, 1.6);
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0, rng.float(0.12, 0.28), h, 5), mat);
        c.position.set(rng.float(-0.3, 0.3), 0, rng.float(-0.3, 0.3));
        c.rotation.set(rng.float(-0.4, 0.4), rng.float(0, 3), rng.float(-0.4, 0.4));
        cluster.add(c);
      }
      cluster.position.copy(p);
      // 中心を向ける
      cluster.lookAt(0, 1, 0);
      cluster.rotateX(-Math.PI / 2);
      this.scene.add(cluster);
      this.wallCrystals.push({
        group: cluster,
        mat,
        lit: false,
        targetColor: new THREE.Color(0x000000),
        phase: rng.float(0, Math.PI * 2),
      });
    }
    // 点灯順(決定論的シャッフル)
    const order = [...this.wallCrystals.keys()];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.lightOrder = order;
  }

  _buildStarsAndFireflies() {
    // 丸いスプライトテクスチャ
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c2 = cv.getContext('2d');
    const grad = c2.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    c2.fillStyle = grad;
    c2.fillRect(0, 0, 64, 64);
    this.dotTexture = new THREE.CanvasTexture(cv);

    // 天井の星
    const rng = new Rng(4242);
    const starPos = [];
    for (let i = 0; i < 260; i++) {
      const theta = rng.float(0, Math.PI * 2);
      const phi = rng.float(0.05, 0.9);
      const r = 12.6;
      starPos.push(
        Math.cos(theta) * Math.sin(phi) * r,
        Math.cos(phi) * r * 0.85 + 3.2,
        Math.sin(theta) * Math.sin(phi) * r
      );
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({
      size: 0.14, map: this.dotTexture, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false, color: 0xbfd0ff,
    });
    this.scene.add(new THREE.Points(starGeo, this.starMat));

    // ほたる(ただよう光)
    this.fireflyData = [];
    const fpos = [];
    for (let i = 0; i < 42; i++) {
      const p = new THREE.Vector3(rng.float(-5, 5), rng.float(0.4, 3.6), rng.float(-5, 5));
      this.fireflyData.push({
        base: p.clone(),
        sp: rng.float(0.4, 1.2),
        ph: rng.float(0, 6.28),
        amp: rng.float(0.3, 0.9),
      });
      fpos.push(p.x, p.y, p.z);
    }
    this.fireflyGeo = new THREE.BufferGeometry();
    this.fireflyGeo.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
    this.fireflyMat = new THREE.PointsMaterial({
      size: 0.1, map: this.dotTexture, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false, color: 0xaaffdd,
    });
    this.scene.add(new THREE.Points(this.fireflyGeo, this.fireflyMat));
  }

  // ============ 世界のリアクション ============

  // 成長ステップ確定: 壁の結晶が同じ色で点灯 + 波紋 + 水に色が溶ける
  reactToStep(color, growthRatio) {
    this.growth = growthRatio;
    for (let i = 0; i < 3; i++) {
      const idx = this.lightOrder[(this.litCount + i) % this.lightOrder.length];
      const c = this.wallCrystals[idx];
      c.lit = true;
      c.targetColor.copy(color);
    }
    this.litCount += 3;
    this.addRipple(color);
    // 水の色: これまでの色と混ぜる
    this.waterTarget.lerp(color, 0.4);
  }

  addRipple(color) {
    const geo = new THREE.RingGeometry(0.96, 1.0, 48);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.75, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    ring.scale.setScalar(1.2);
    this.scene.add(ring);
    this.ripples.push({ mesh: ring, age: 0 });
  }

  // 花・小さな結晶が宝石のまわりに広がる
  addFlower(color, rngSeed) {
    const rng = new Rng(rngSeed);
    const g = new THREE.Group();
    const onIsland = rng.next() < 0.5;
    const a = rng.float(0, Math.PI * 2);
    const r = onIsland ? rng.float(0.62, 1.0) : rng.float(1.4, 3.2);
    g.position.set(Math.cos(a) * r, onIsland ? 0.2 : 0.07, Math.sin(a) * r);

    if (rng.next() < 0.5) {
      // 花: くき + はなびら
      const stemMat = new THREE.MeshStandardMaterial({ color: 0x3f9950, roughness: 0.8 });
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.18, 5), stemMat);
      stem.position.y = 0.09;
      g.add(stem);
      const petalMat = new THREE.MeshStandardMaterial({
        color: color.clone().lerp(new THREE.Color(0xffffff), 0.25),
        roughness: 0.5,
        emissive: color.clone().multiplyScalar(0.25),
        flatShading: true,
      });
      for (let i = 0; i < 5; i++) {
        const pa = (i / 5) * Math.PI * 2;
        const petal = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), petalMat);
        petal.scale.set(1, 0.45, 0.7);
        petal.position.set(Math.cos(pa) * 0.05, 0.19, Math.sin(pa) * 0.05);
        petal.rotation.y = -pa;
        g.add(petal);
      }
      const center = new THREE.Mesh(
        new THREE.SphereGeometry(0.032, 6, 5),
        new THREE.MeshStandardMaterial({ color: 0xffdd66, emissive: 0x664411 })
      );
      center.position.y = 0.2;
      g.add(center);
    } else {
      // ちいさな結晶
      const mat = new THREE.MeshPhysicalMaterial({
        color, flatShading: true, roughness: 0.2, transparent: true, opacity: 0.85,
        emissive: color.clone().multiplyScalar(0.3), clearcoat: 0.5,
      });
      const n = rng.int(2, 3);
      for (let i = 0; i < n; i++) {
        const c = new THREE.Mesh(
          new THREE.CylinderGeometry(0, rng.float(0.035, 0.06), rng.float(0.12, 0.26), 5), mat
        );
        c.position.set(rng.float(-0.06, 0.06), 0.07, rng.float(-0.06, 0.06));
        c.rotation.set(rng.float(-0.3, 0.3), rng.float(0, 3), rng.float(-0.3, 0.3));
        g.add(c);
      }
    }
    g.scale.setScalar(0.001);
    this.scene.add(g);
    this.flowers.push({ group: g, age: 0 });
    // 増えすぎたら古いものから消す
    if (this.flowers.length > 34) {
      const old = this.flowers.shift();
      this.scene.remove(old.group);
    }
    return g.position.clone();
  }

  // 声を出している間のライブ反応
  setLive(level, color) {
    this.liveLevel = level;
    if (color) this.liveColor.set(color);
  }

  // ============ 毎フレーム ============

  update(dt) {
    this.time += dt;
    const t = this.time;

    // カメラをゆっくり漂わせる(酔わない程度に)
    this.camera.position.x = Math.sin(t * 0.12) * 0.35;
    this.camera.position.y = 1.7 + Math.sin(t * 0.2) * 0.08;
    this.camera.lookAt(0, 1.05, 0);

    // 宝石の光: 声に反応
    const targetI = 0.8 + this.liveLevel * 3.2 + this.growth * 0.6;
    this.gemLight.intensity += (targetI - this.gemLight.intensity) * Math.min(1, dt * 8);
    this.gemLight.color.lerp(this.liveColor, Math.min(1, dt * 3));

    // 洞窟全体: 成長するほど明るく
    this.hemi.intensity = 0.75 + this.growth * 0.55;
    this.starMat.opacity = 0.35 + this.growth * 0.45 + this.liveLevel * 0.2;

    // 壁の結晶(点灯したものは息づくように明滅)
    for (const c of this.wallCrystals) {
      if (c.lit) {
        const pulse = 0.85 + 0.35 * Math.sin(t * 1.7 + c.phase);
        const target = c.targetColor.clone().multiplyScalar(pulse);
        c.mat.emissive.lerp(target, Math.min(1, dt * 2.5));
        c.mat.color.lerp(c.targetColor, Math.min(1, dt * 1.2));
        // 点灯したらぐっと大きくなる
        const s = c.group.scale.x + (1.45 - c.group.scale.x) * Math.min(1, dt * 1.8);
        c.group.scale.setScalar(s);
      }
    }

    // 水の色がにじむ
    this.waterMat.color.lerp(this.waterTarget, Math.min(1, dt * 0.8));

    // 波紋
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i];
      rp.age += dt;
      const k = rp.age / 1.6;
      rp.mesh.scale.setScalar(1.2 + k * 6);
      rp.mesh.material.opacity = Math.max(0, 0.75 * (1 - k));
      if (k >= 1) {
        this.scene.remove(rp.mesh);
        rp.mesh.geometry.dispose();
        rp.mesh.material.dispose();
        this.ripples.splice(i, 1);
      }
    }

    // 花がポンと咲く
    for (const f of this.flowers) {
      f.age += dt;
      const k = Math.min(1, f.age / 0.5);
      // ちょっと弾む
      const s = k < 1 ? 1.15 * Math.sin(k * Math.PI * 0.6) / Math.sin(Math.PI * 0.6) : 1;
      f.group.scale.setScalar(Math.max(0.001, s));
    }

    // ほたる
    const pos = this.fireflyGeo.attributes.position;
    for (let i = 0; i < this.fireflyData.length; i++) {
      const d = this.fireflyData[i];
      pos.setXYZ(
        i,
        d.base.x + Math.sin(t * d.sp + d.ph) * d.amp,
        d.base.y + Math.sin(t * d.sp * 0.7 + d.ph * 2) * d.amp * 0.5,
        d.base.z + Math.cos(t * d.sp * 0.9 + d.ph) * d.amp
      );
    }
    pos.needsUpdate = true;
    this.fireflyMat.opacity = 0.5 + 0.3 * Math.sin(t * 1.3) + this.liveLevel * 0.2;
  }

  resize(w, h) {
    const aspect = w / h;
    this.camera.aspect = aspect;
    // 縦画面では視野を広げて宝石を大きく見せる
    this.camera.fov = aspect < 0.75 ? 56 : 46;
    this.camera.updateProjectionMatrix();
  }

  // 新しい宝石を始めるときのリセット(壁は少し暗く戻す)
  softReset() {
    this.growth = 0;
    this.litCount = 0;
    for (const c of this.wallCrystals) {
      c.lit = false;
      c.targetColor.setRGB(0, 0, 0);
      c.mat.emissive.setRGB(0, 0, 0);
      c.mat.color.set(0x2a2a55);
      c.group.scale.setScalar(1);
    }
    this.waterTarget.set(0x1c2c5a);
  }
}
