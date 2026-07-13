/**
 * RevealSystem — モノクロの世界に「じゅわっ」と色が染みるシェーダー仕掛け。
 *
 * 各ペイント対象メッシュのマテリアルにパッチを当て、
 * 「塗りスポット（中心+半径）」の内側だけ本来の色、外側はモノクロで描画する。
 * スポットの半径は声を出している間じわじわ育つ（＝染みる途中が見える）。
 * 境界には今の母音の色がふちどりとして光る。
 */
import * as THREE from 'three';

const MAX_SPOTS = 8;

export class RevealSystem {
  constructor() {
    this.paintables = [];           // Paintable[]
    // ふちどり色と時間は全メッシュ共有のuniformオブジェクト
    this.sharedEdgeColor = { value: new THREE.Color('#ffc247') };
    this.sharedTime = { value: 0 };
    this.onObjectDone = null;       // (paintable) => void
  }

  /** world 内の userData.paintable なメッシュを全部登録 */
  collect(root) {
    this.paintables.length = 0;
    root.traverse((obj) => {
      if (obj.isMesh && obj.userData.paintable) {
        this.paintables.push(new Paintable(obj, this));
      }
    });
    return this.paintables;
  }

  meshes() { return this.paintables.map(p => p.mesh); }

  findByMesh(mesh) {
    let m = mesh;
    while (m) {
      const p = this.paintables.find(q => q.mesh === m);
      if (p) return p;
      m = m.parent;
    }
    return null;
  }

  setEdgeColor(color) { this.sharedEdgeColor.value.set(color); }

  /** 全体の進みぐあい 0..1 */
  progress() {
    if (!this.paintables.length) return 0;
    let sum = 0;
    for (const p of this.paintables) sum += p.progress();
    return sum / this.paintables.length;
  }

  update(dt, time) {
    this.sharedTime.value = time;
    for (const p of this.paintables) p.update(dt);
  }

  /** すべてを一気に色づけ（おいわい用） */
  revealAll() {
    for (const p of this.paintables) p.forceReveal(0.6 + Math.random() * 1.2);
  }
}

export class Paintable {
  constructor(mesh, system) {
    this.mesh = mesh;
    this.system = system;
    this.done = false;
    this.spots = []; // {center: Vector3(world), r, target, speed}
    mesh.userData._paintable = this; // アニメ側から進行度を引けるように

    // ワールド境界球
    mesh.geometry.computeBoundingSphere();
    const bs = mesh.geometry.boundingSphere;
    const scale = new THREE.Vector3();
    mesh.updateWorldMatrix(true, false);
    mesh.getWorldScale(scale);
    const maxScale = Math.max(scale.x, scale.y, scale.z);
    this.boundRadius = Math.max(bs.radius * maxScale, 0.35);
    this.center = bs.center.clone().applyMatrix4(mesh.matrixWorld);

    // 地面などの巨大メッシュは半径が大きい → 塗りごたえは自然に増える
    this._patchMaterial();
  }

  _patchMaterial() {
    const mesh = this.mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    this.uniforms = {
      uSpots: { value: Array.from({ length: MAX_SPOTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uEdgeColor: this.system.sharedEdgeColor,
      uTime: this.system.sharedTime,
    };
    const uniforms = this.uniforms;

    this._patchedMats = mats.map((orig) => {
      const mat = orig.clone();
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vRevealPos;')
          .replace('#include <project_vertex>', `
            #include <project_vertex>
            {
              vec4 rwp = vec4( transformed, 1.0 );
              #ifdef USE_INSTANCING
                rwp = instanceMatrix * rwp;
              #endif
              rwp = modelMatrix * rwp;
              vRevealPos = rwp.xyz;
            }
          `);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `
            #include <common>
            varying vec3 vRevealPos;
            uniform vec4 uSpots[${MAX_SPOTS}];
            uniform vec3 uEdgeColor;
            uniform float uTime;
          `)
          .replace('#include <opaque_fragment>', `
            {
              float revealF = 0.0;
              float edgeF = 0.0;
              for (int i = 0; i < ${MAX_SPOTS}; i++) {
                vec4 s = uSpots[i];
                if (s.w <= 0.001) continue;
                float d = distance(vRevealPos, s.xyz);
                // ふちがゆらゆら揺れる、インクのにじみ（大きな染みほどゆったり）
                float wobF = 7.0 / (0.6 + s.w * 0.5);
                float wob = sin(d * wobF - uTime * 2.2) * 0.05 * s.w
                          + sin(vRevealPos.x * 2.1 + vRevealPos.z * 1.7 + uTime * 0.8) * 0.04 * s.w;
                float r = s.w + wob;
                revealF = max(revealF, 1.0 - smoothstep(r * 0.72, r, d));
                float e = smoothstep(r * 0.68, r * 0.92, d) * (1.0 - smoothstep(r * 0.92, r * 1.18, d));
                edgeF = max(edgeF, e * clamp(2.2 / s.w, 0.18, 1.0));
              }
              revealF = clamp(revealF, 0.0, 1.0);
              float gray = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
              vec3 pencil = vec3(gray) * 0.85 + 0.10;
              outgoingLight = mix(pencil, outgoingLight * 1.08, revealF);
              outgoingLight += uEdgeColor * edgeF * (0.55 + 0.25 * sin(uTime * 6.0));
            }
            #include <opaque_fragment>
          `);
      };
      mat.needsUpdate = true;
      return mat;
    });
    mesh.material = Array.isArray(mesh.material) ? this._patchedMats : this._patchedMats[0];
  }

  progress() {
    if (this.done) return 1;
    let maxR = 0;
    for (const s of this.spots) maxR = Math.max(maxR, s.r);
    return Math.min(maxR / (this.boundRadius * 1.05), 1);
  }

  /**
   * point(world) に塗りスポットを作る/育てる。
   * grow は「時間あたりの育ち」— 声の長さで増える。音量は無関係。
   */
  paintAt(point, grow, dt) {
    // 近いスポットがあればそれを育てる
    let spot = null;
    for (const s of this.spots) {
      if (s.center.distanceTo(point) < Math.max(s.r, this.boundRadius * 0.3)) { spot = s; break; }
    }
    if (!spot) {
      if (this.spots.length >= MAX_SPOTS) {
        // いちばん小さいスポットへ合流
        spot = this.spots.reduce((a, b) => (a.target < b.target ? a : b));
        spot.center.copy(point);
      } else {
        spot = { center: point.clone(), r: 0.01, target: 0.08, speed: 3 };
        this.spots.push(spot);
      }
    }
    spot.target = Math.min(spot.target + grow * dt, this.boundRadius * 1.35);
  }

  /** ぱっ！ 一気に色づく（破裂音スタンプ） */
  pop(point) {
    const spot = { center: point ? point.clone() : this.center.clone(), r: 0.01, target: this.boundRadius * 1.35, speed: 7 };
    if (this.spots.length >= MAX_SPOTS) this.spots.shift();
    this.spots.push(spot);
  }

  forceReveal(speed = 1) {
    const spot = { center: this.center.clone(), r: 0.01, target: this.boundRadius * 1.4, speed };
    if (this.spots.length >= MAX_SPOTS) this.spots.shift();
    this.spots.push(spot);
  }

  update(dt) {
    const arr = this.uniforms.uSpots.value;
    for (let i = 0; i < MAX_SPOTS; i++) {
      const s = this.spots[i];
      if (!s) { arr[i].set(0, 0, 0, 0); continue; }
      // じゅわっと育つ（イージング）
      s.r += (s.target - s.r) * Math.min(s.speed * dt, 1);
      arr[i].set(s.center.x, s.center.y, s.center.z, s.r);
    }
    if (!this.done && this.progress() >= 0.98) {
      this.done = true;
      if (this.system.onObjectDone) this.system.onObjectDone(this);
    }
  }
}
