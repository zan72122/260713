/**
 * Game — 3Dシーン・入力・声・魔法をつなぐ本体。
 *
 * 遊びのループ:
 *   指でなぞる（またはようせいの筆にまかせる）× 声を出す
 *   → 声が続いている間、その場所に色が染みてゆく
 *   → ぜんぶ色づいたら おいわいの花火
 */
import * as THREE from 'three';
import { RevealSystem } from './reveal.js';
import { EffectsSystem, VOWEL_MAIN } from './effects.js';
import { WORLDS } from './worlds.js';

export class Game {
  constructor(canvas, voice, sfx) {
    this.canvas = canvas;
    this.voice = voice;
    this.sfx = sfx;

    this.onProgress = null;      // (0..1) => void
    this.onWorldComplete = null; // () => void
    this.onObjectDone = null;    // (count) => void

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);

    // ライト
    this.scene.add(new THREE.AmbientLight('#ffffff', 0.75));
    this.hemi = new THREE.HemisphereLight('#ffffff', '#c8b89a', 0.5);
    this.scene.add(this.hemi);
    this.dir = new THREE.DirectionalLight('#fff5e0', 1.4);
    this.dir.position.set(6, 12, 8);
    this.scene.add(this.dir);

    this.reveal = new RevealSystem();
    this.reveal.onObjectDone = (p) => this._objectDone(p);

    this.raycaster = new THREE.Raycaster();
    this.pointers = new Map(); // pointerId -> {x, y, down}
    this.state = 'idle';       // idle | playing | celebrating
    this.worldDef = null;
    this.worldGroup = null;
    this.animatables = [];
    this.doneCount = 0;
    this.clock = new THREE.Clock();
    this.time = 0;
    this._progressTimer = 0;
    this._lastProgress = 0;
    this._celebrateT = 0;
    this._fireworkT = 0;
    this._paintWorld = new THREE.Vector3();
    this._paintNormal = new THREE.Vector3(0, 1, 0);
    this._hasPaintPos = false;

    // ようせいの筆（指を離しているとき、声に合わせて代わりに塗る）
    this._fairyPos = new THREE.Vector3(0, 2, 0);
    this._fairyTarget = new THREE.Vector3(0, 2, 0);
    this._fairyTimer = 0;
    this._makeFairy();

    this._bindInput();
    window.addEventListener('resize', () => this._resize());
    this._resize();

    // 声のイベント
    voice.onOnset = () => this._onVoiceOnset();
    voice.onPlosive = () => this._onPlosive();

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  /* ---------------- ワールド ---------------- */
  loadWorld(index) {
    if (this.worldGroup) {
      this.scene.remove(this.worldGroup);
      this.worldGroup.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
        }
      });
    }
    if (this.effects) this.effects.dispose?.();

    this.worldIndex = index;
    this.worldDef = WORLDS[index].build();
    this.worldGroup = this.worldDef.group;
    this.scene.add(this.worldGroup);
    this.worldGroup.updateMatrixWorld(true);

    this.reveal.collect(this.worldGroup);
    this._collectAnimatables();
    this.doneCount = 0;
    this._lastProgress = 0;
    this._celebrateT = 0;

    if (!this.effects) this.effects = new EffectsSystem(this.scene);
    this.effects.onBubblePop = () => this.sfx.bubblePop();

    // 空: モノクロから始まる
    this._skyGray = new THREE.Color(this.worldDef.sky.gray);
    this._skyColored = new THREE.Color(this.worldDef.sky.colored);
    this.scene.background = this._skyGray.clone();
    this.scene.fog = new THREE.Fog(this._skyGray.clone(), 26, 60);

    this._fitCamera();
    this._fairyPos.copy(this.worldDef.camera.target).add(new THREE.Vector3(0, 1, 2));
    this.state = 'playing';
    if (this.onProgress) this.onProgress(0);
  }

  stop() { this.state = 'idle'; }

  _collectAnimatables() {
    this.animatables = [];
    this.worldGroup.traverse((obj) => {
      if (!obj.userData.anim) return;
      const paintables = [];
      obj.traverse((m) => { if (m.userData._paintable) paintables.push(m.userData._paintable); });
      this.animatables.push({
        obj,
        anim: obj.userData.anim,
        paintables,
        basePos: obj.position.clone(),
        baseRot: obj.rotation.clone(),
        baseScale: obj.scale.clone(),
      });
    });
  }

  _fitCamera() {
    const spec = this.worldDef.camera;
    const aspect = this.camera.aspect;
    // 縦画面は広角ぎみにして、すこし上から見下ろす
    this.camera.fov = aspect < 1 ? 58 : 50;
    this.camera.updateProjectionMatrix();
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    if (aspect >= 1) {
      const fitDist = spec.fitRadius / Math.tan(Math.min(vHalf, hHalf));
      this._camDist = Math.max(spec.dist, fitDist);
      this._camHeight = spec.height;
    } else {
      // 中央を優先し、はしは切れてよい（カメラがゆっくり漂うので見えてくる）
      const fitDist = (spec.fitRadius * 0.6) / Math.tan(hHalf);
      this._camDist = Math.max(spec.dist, Math.min(fitDist, 28));
      this._camHeight = this._camDist * 0.62;
    }
    this._camTarget = spec.target;
  }

  _resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.worldDef) this._fitCamera();
  }

  /* ---------------- ようせい ---------------- */
  _makeFairy() {
    const S = 64;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,240,190,.9)');
    grad.addColorStop(1, 'rgba(255,220,140,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);
    const tex = new THREE.CanvasTexture(c);
    this.fairy = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    this.fairy.scale.setScalar(0.9);
    this.fairy.renderOrder = 20;
    this.scene.add(this.fairy);
  }

  /* ---------------- 入力 ---------------- */
  _bindInput() {
    const el = this.canvas;
    const norm = (e) => ({
      x: (e.clientX / window.innerWidth) * 2 - 1,
      y: -(e.clientY / window.innerHeight) * 2 + 1,
    });
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, norm(e));
    });
    el.addEventListener('pointermove', (e) => {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, norm(e));
    });
    const up = (e) => this.pointers.delete(e.pointerId);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  /* ---------------- 声イベント ---------------- */
  _onVoiceOnset() {
    if (this.state !== 'playing' || !this._hasPaintPos) return;
    const v = this.voice.state;
    // リズム（あ、あ、あ）: 回数ぶん花びらが増える
    if (v.onsetCount >= 2) {
      this.effects.onsetBurst(this._paintWorld, this._paintNormal, v.vowel || 'a', v.onsetCount);
    }
  }

  _onPlosive() {
    if (this.state !== 'playing' || !this._hasPaintPos) return;
    // ぱっ！ → いちばん近くのものが 一気に色づく
    const v = this.voice.state;
    let nearest = null, nd = Infinity;
    for (const p of this.reveal.paintables) {
      if (p.done || p.boundRadius > 6) continue; // 地面や壁はスタンプ対象外
      const d = p.center.distanceTo(this._paintWorld);
      if (d < nd) { nd = d; nearest = p; }
    }
    if (nearest && nd < 4) {
      nearest.pop(this._paintWorld);
      this.effects.stampBurst(nearest.center, v.vowel || 'o');
      this.sfx.pop(v.pitchNorm);
    } else {
      this.effects.stampBurst(this._paintWorld, v.vowel || 'o');
      this.sfx.pop(v.pitchNorm);
    }
  }

  _objectDone(paintable) {
    this.doneCount++;
    this.sfx.objectDone(this.doneCount);
    const color = VOWEL_MAIN[this.voice.state.vowel || 'o'];
    this.effects.donePuff(paintable.center, color);
    if (this.onObjectDone) this.onObjectDone(this.doneCount);
  }

  /* ---------------- メインループ ---------------- */
  _loop() {
    requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    if (this.state === 'idle' || !this.worldDef) return;

    const voice = this.voice.update();

    if (this.state === 'playing') this._updatePaint(voice, dt);
    this._updateFairy(voice, dt);
    this._updateAnimatables(dt);
    this.reveal.update(dt, this.time);
    this.effects.update(dt, this.time);
    this.effects.steerGrowers(voice.pitchTrend);

    // 空の色: 進みぐあいで色づく
    const prog = this._lastProgress;
    this.scene.background.copy(this._skyGray).lerp(this._skyColored, prog);
    if (this.scene.fog) this.scene.fog.color.copy(this.scene.background);

    // 進捗（0.4秒ごと）
    this._progressTimer += dt;
    if (this._progressTimer > 0.4 && this.state === 'playing') {
      this._progressTimer = 0;
      const p = this.reveal.progress();
      this._lastProgress = p;
      if (this.onProgress) this.onProgress(p);
      if (p >= 0.85) this._startCelebration();
    }

    if (this.state === 'celebrating') this._updateCelebration(dt);

    // カメラ: ゆっくり漂う
    const sway = Math.sin(this.time * 0.22) * 0.1;
    const t = this._camTarget;
    this.camera.position.set(
      t.x + Math.sin(sway) * this._camDist,
      t.y + this._camHeight + Math.sin(this.time * 0.3) * 0.25,
      t.z + Math.cos(sway) * this._camDist
    );
    this.camera.lookAt(t.x, t.y, t.z);

    this.renderer.render(this.scene, this.camera);
  }

  /* ---------------- 塗り ---------------- */
  _updatePaint(voice, dt) {
    const meshes = this.reveal.meshes();
    const touching = this.pointers.size > 0;

    // 塗り位置の決定: 指 > ようせい
    const paintPoints = [];
    if (touching) {
      let count = 0;
      for (const [, ptr] of this.pointers) {
        if (count++ >= 2) break; // 2本まで（きょうだいで一緒に遊べる）
        const hit = this._raycast(ptr.x, ptr.y, meshes);
        if (hit) paintPoints.push(hit);
      }
    } else if (voice.active) {
      // 声だけ出ている → ようせいの筆が代わりに塗る
      const hit = this._raycastFromWorldPoint(this._fairyPos, meshes);
      if (hit) paintPoints.push(hit);
    }

    if (paintPoints.length) {
      const last = paintPoints[paintPoints.length - 1];
      this._paintWorld.copy(last.point);
      this._paintNormal.copy(last.normal);
      this._hasPaintPos = true;
    }

    if (!voice.active || !paintPoints.length) return;

    // ふちどりの色 = いまの母音
    this.reveal.setEdgeColor(VOWEL_MAIN[voice.vowel || 'a']);

    for (const hit of paintPoints) {
      if (voice.breathy) {
        // ふー → 風: 広い範囲にうっすら
        for (const p of this.reveal.paintables) {
          const d = p.center.distanceTo(hit.point);
          if (d < 4.5) p.paintAt(hit.point.clone().lerp(p.center, 0.6), 0.55, dt);
        }
        this.effects.breathMist(hit.point, dt);
        this.sfx.breath();
        continue;
      }

      // 声の長さで染みる速さが育つ（音量は無関係！）
      const grow = 1.5 + Math.min(voice.duration, 4) * 0.6;
      const target = this.reveal.findByMesh(hit.mesh);
      if (target) target.paintAt(hit.point, grow, dt);

      // まわりのものにも すこし染みる（おおらかな筆）
      for (const p of this.reveal.paintables) {
        if (p === target) continue;
        const d = p.center.distanceTo(hit.point);
        if (d < 1.6) p.paintAt(hit.point, grow * 0.4, dt);
      }

      this.effects.vowelMagic(hit.point, hit.normal, voice, dt);
      this.sfx.paintShimmer(voice.vowel || 'a', voice.pitchNorm);
    }
  }

  _raycast(nx, ny, meshes) {
    this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length) {
      const h = hits[0];
      const normal = h.face
        ? h.face.normal.clone().transformDirection(h.object.matrixWorld)
        : new THREE.Vector3(0, 1, 0);
      return { point: h.point, normal, mesh: h.object };
    }
    // なにも当たらない（空）→ カメラから12先の空中に魔法だけ出す
    const point = this.raycaster.ray.at(12, new THREE.Vector3());
    return { point, normal: new THREE.Vector3(0, 1, 0), mesh: null };
  }

  /** ようせいの位置の真下/近くのものを塗る */
  _raycastFromWorldPoint(worldPos, meshes) {
    // ようせいから下向きに
    this.raycaster.set(worldPos.clone().add(new THREE.Vector3(0, 0.5, 0)), new THREE.Vector3(0, -1, 0));
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length) {
      const h = hits[0];
      const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      return { point: h.point, normal, mesh: h.object };
    }
    return { point: worldPos.clone(), normal: new THREE.Vector3(0, 1, 0), mesh: null };
  }

  /* ---------------- ようせいの筆 ---------------- */
  _updateFairy(voice, dt) {
    // 指があるならそこへ、なければ「まだ塗れていないもの」の近くをうろうろ
    if (this.pointers.size > 0) {
      this._fairyTarget.copy(this._paintWorld).add(new THREE.Vector3(0, 0.7, 0));
    } else {
      this._fairyTimer -= dt;
      if (this._fairyTimer <= 0) {
        this._fairyTimer = 2.2 + Math.random() * 1.6;
        const undone = this.reveal.paintables.filter(p => !p.done && p.boundRadius < 6);
        const pick = undone.length
          ? undone[(Math.random() * undone.length) | 0].center
          : this._camTarget;
        this._fairyTarget.set(pick.x, Math.max(pick.y, 0.5) + 0.8, pick.z);
      }
    }
    this._fairyPos.lerp(this._fairyTarget, Math.min(dt * 2.2, 1));
    const bob = Math.sin(this.time * 3.2) * 0.12;
    this.fairy.position.set(this._fairyPos.x, this._fairyPos.y + bob, this._fairyPos.z);
    const pulse = voice.active ? 1.25 + Math.sin(this.time * 10) * 0.2 : 0.9;
    this.fairy.scale.setScalar(pulse);
    // 声を出しているあいだ、ようせいがキラキラをこぼす
    if (voice.active && Math.random() < 8 * dt) {
      this.effects.spawn({
        pos: this.fairy.position.clone(), sprite: 4,
        vel: new THREE.Vector3((Math.random() - 0.5), -0.4, (Math.random() - 0.5)),
        color: '#fff3c0', size0: 0.25, size1: 0.03, life: 0.8, twinkle: 1,
      });
    }
  }

  /* ---------------- 生き物・物のアニメ ---------------- */
  _updateAnimatables(dt) {
    for (const a of this.animatables) {
      let prog = 1;
      if (a.paintables.length) {
        prog = 0;
        for (const p of a.paintables) prog += p.progress();
        prog /= a.paintables.length;
      }
      // 色がつくほど元気になる
      const energy = 0.15 + 0.85 * prog;
      const an = a.anim;
      const t = this.time * (an.speed || 1) + (an.phase || 0);
      const obj = a.obj;

      switch (an.type) {
        case 'sway':
          obj.rotation.z = a.baseRot.z + Math.sin(t * 2) * an.amp * energy;
          break;
        case 'drift':
          obj.position.x = a.basePos.x + Math.sin(t) * an.amp;
          obj.position.y = a.basePos.y + Math.sin(t * 1.7) * 0.3;
          break;
        case 'spin':
          obj.rotation.z += dt * (an.speed || 1) * energy;
          break;
        case 'boing': {
          const s = 1 + Math.max(Math.sin(t * 2.4), 0) * an.amp * energy;
          obj.scale.set(a.baseScale.x * (2 - s), a.baseScale.y * s, a.baseScale.z * (2 - s));
          break;
        }
        case 'tilt':
          obj.rotation.z = a.baseRot.z + Math.sin(t) * an.amp * energy;
          break;
        case 'wave':
          obj.rotation.y = a.baseRot.y + Math.sin(t) * an.amp * energy;
          obj.scale.x = a.baseScale.x * (1 + Math.sin(t * 1.3) * 0.15 * energy);
          break;
        case 'hop': {
          const hop = Math.abs(Math.sin(t)) * an.amp * energy;
          obj.position.y = a.basePos.y + hop;
          break;
        }
        case 'flutter': {
          obj.position.x = a.basePos.x + Math.sin(t * 0.7) * an.amp * energy;
          obj.position.y = a.basePos.y + Math.sin(t * 1.3) * 0.5 * an.amp * energy;
          obj.position.z = a.basePos.z + Math.cos(t * 0.9) * 0.7 * an.amp * energy;
          obj.rotation.y = Math.cos(t * 0.7) * 0.8;
          const wings = obj.userData.wings;
          if (wings) {
            const flap = Math.sin(this.time * (8 + energy * 14)) * 0.7;
            wings[0].rotation.z = flap;
            wings[1].rotation.z = -flap;
          }
          break;
        }
        case 'swim': {
          const sp = (an.speed || 0.5) * (0.3 + 0.7 * energy);
          const ang = this.time * sp * (an.dir || 1) + (an.phase || 0);
          const R = an.amp;
          obj.position.set(Math.cos(ang) * R, (an.baseY || 2) + Math.sin(this.time * 1.7 + (an.phase || 0)) * 0.3, Math.sin(ang) * R * 0.65);
          obj.rotation.y = -ang + ((an.dir || 1) > 0 ? Math.PI : 0);
          break;
        }
        case 'jelly': {
          obj.position.y = (an.baseY || 3) + Math.sin(t) * an.amp * energy;
          const pulse = 1 + Math.sin(t * 2.3) * 0.12 * energy;
          obj.scale.set(pulse, 2 - pulse, pulse);
          break;
        }
        case 'drive': {
          obj.position.x = a.basePos.x + Math.sin(t) * an.amp * energy;
          obj.rotation.y = a.baseRot.y + (Math.cos(t) >= 0 ? 0 : Math.PI);
          break;
        }
        case 'roll': {
          obj.position.x = a.basePos.x + Math.sin(t) * an.amp * energy;
          obj.rotation.z = -obj.position.x * 1.5;
          break;
        }
      }
    }
  }

  /* ---------------- おいわい ---------------- */
  _startCelebration() {
    if (this.state !== 'playing') return;
    this.state = 'celebrating';
    this._celebrateT = 0;
    this._fireworkT = 0;
    this.reveal.revealAll();
    this.sfx.fanfare();
  }

  _updateCelebration(dt) {
    this._celebrateT += dt;
    this._fireworkT -= dt;
    if (this._fireworkT <= 0 && this._celebrateT < 5.2) {
      this._fireworkT = 0.5 + Math.random() * 0.35;
      this.effects.firework(this._camTarget, 7);
      this.sfx.firework();
    }
    this._lastProgress = Math.min(this._lastProgress + dt * 0.3, 1);
    if (this._celebrateT > 6 && this.onWorldComplete) {
      const cb = this.onWorldComplete;
      this.state = 'idle';
      cb();
    }
  }
}
