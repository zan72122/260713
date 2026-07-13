// ============================================================
// ルミ — 声を聞いてくれる光のようせい
//   ・声を出すと口が動いて「聞いてるよ」を伝える
//   ・宝石が育つとよろこぶ / 完成すると宝石のまわりを飛び回る
// ============================================================

import * as THREE from '../lib/three.module.min.js';

export class Lumi {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    // からだ(やわらかく光る玉)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xfff6d8,
      emissive: 0xffe9a8,
      emissiveIntensity: 0.85,
      roughness: 0.4,
    });
    this.body = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 16), bodyMat);
    this.group.add(this.body);

    // 後光(スプライト)
    const haloTex = this._makeHaloTexture();
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTex, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.scale.setScalar(0.85);
    this.group.add(halo);

    // 顔(カメラのほうを向くスプライト)
    this.faceCanvas = document.createElement('canvas');
    this.faceCanvas.width = this.faceCanvas.height = 128;
    this.faceTex = new THREE.CanvasTexture(this.faceCanvas);
    this.face = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.faceTex, transparent: true, depthWrite: false, depthTest: false,
    }));
    this.face.scale.setScalar(0.34);
    this.face.position.z = 0.2;
    this.face.renderOrder = 10;
    this.group.add(this.face);

    // はね
    const wingTex = this._makeWingTexture();
    this.wingL = new THREE.Sprite(new THREE.SpriteMaterial({
      map: wingTex, transparent: true, opacity: 0.85, depthWrite: false,
    }));
    this.wingL.scale.set(0.3, 0.42, 1);
    this.wingL.position.set(-0.18, 0.06, -0.06);
    this.group.add(this.wingL);
    this.wingR = this.wingL.clone();
    this.wingR.position.x = 0.18;
    this.group.add(this.wingR);

    this.home = new THREE.Vector3(1.05, 1.75, 0.55);
    this.group.position.copy(this.home);

    this.mood = 'idle'; // idle | listen | happy
    this.mouth = 0;     // 0..1 口の開き
    this._drawnMouth = -1;
    this._drawnMood = '';
    this._blinkT = 0;
    this._blinking = false;
    this.time = 0;
    this.celebrating = false;
    this._drawFace();
  }

  _makeHaloTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(64, 64, 8, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,244,200,0.9)');
    g.addColorStop(0.5, 'rgba(255,230,160,0.25)');
    g.addColorStop(1, 'rgba(255,230,160,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(cv);
  }

  _makeWingTexture() {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 96;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(210,235,255,0.9)';
    c.beginPath();
    c.ellipse(32, 48, 20, 42, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.beginPath();
    c.ellipse(32, 40, 10, 26, 0, 0, Math.PI * 2);
    c.fill();
    return new THREE.CanvasTexture(cv);
  }

  _drawFace() {
    const c = this.faceCanvas.getContext('2d');
    c.clearRect(0, 0, 128, 128);
    c.fillStyle = '#3a2c20';
    const blink = this._blinking;

    if (this.mood === 'happy') {
      // にっこり目 ^ ^
      c.lineWidth = 7;
      c.strokeStyle = '#3a2c20';
      c.lineCap = 'round';
      for (const x of [40, 88]) {
        c.beginPath();
        c.arc(x, 56, 12, Math.PI * 1.15, Math.PI * 1.85);
        c.stroke();
      }
    } else {
      // まるい目(まばたきあり)
      for (const x of [40, 88]) {
        c.beginPath();
        if (blink) {
          c.fillRect(x - 9, 50, 18, 5);
        } else {
          c.ellipse(x, 52, 9, this.mood === 'listen' ? 12 : 10, 0, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = '#ffffff';
          c.beginPath();
          c.arc(x + 3, 48, 3, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = '#3a2c20';
        }
      }
    }

    // ほっぺ
    c.fillStyle = 'rgba(255,150,150,0.55)';
    c.beginPath(); c.arc(22, 74, 8, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(106, 74, 8, 0, Math.PI * 2); c.fill();

    // 口(声の大きさで開く)
    c.fillStyle = '#3a2c20';
    const mh = 4 + this.mouth * 26;
    if (this.mood === 'happy') {
      c.lineWidth = 7;
      c.strokeStyle = '#3a2c20';
      c.beginPath();
      c.arc(64, 78, 18, Math.PI * 0.15, Math.PI * 0.85);
      c.stroke();
    } else {
      c.beginPath();
      c.ellipse(64, 88, 8 + this.mouth * 6, mh / 2, 0, 0, Math.PI * 2);
      c.fill();
    }
    this.faceTex.needsUpdate = true;
  }

  setMood(mood) {
    if (this.mood !== mood) {
      this.mood = mood;
      this._drawFace();
      this._drawnMood = mood;
    }
  }

  setMouth(v) {
    this.mouth = v;
  }

  celebrate(on) {
    this.celebrating = on;
    this.setMood(on ? 'happy' : 'idle');
  }

  // ちいさくうなずく(ステップ確定のとき)
  nod() {
    this._nodT = 0.6;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;

    // まばたき
    this._blinkT -= dt;
    if (this._blinkT <= 0) {
      this._blinking = !this._blinking;
      this._blinkT = this._blinking ? 0.12 : 2.2 + Math.random() * 2.5;
      this._drawFace();
    }

    // 口の描き直し(変化があったときだけ)
    if (Math.abs(this.mouth - this._drawnMouth) > 0.06) {
      this._drawnMouth = this.mouth;
      this._drawFace();
    }

    // はねのぱたぱた
    const flap = Math.sin(t * 14) * 0.16;
    this.wingL.position.y = 0.06 + flap;
    this.wingR.position.y = 0.06 - flap;

    if (this.celebrating) {
      // 宝石のまわりをくるくる飛ぶ
      const a = t * 2.2;
      this.group.position.set(Math.cos(a) * 1.1, 1.5 + Math.sin(t * 3.1) * 0.35, Math.sin(a) * 1.1);
    } else {
      // ふわふわ待機
      this.group.position.set(
        this.home.x + Math.sin(t * 0.8) * 0.08,
        this.home.y + Math.sin(t * 1.3) * 0.1 + (this._nodT > 0 ? -Math.sin(this._nodT * 10) * 0.08 : 0),
        this.home.z + Math.cos(t * 0.6) * 0.06
      );
    }
    if (this._nodT > 0) this._nodT -= dt;

    // 聞いているときは体も少し大きく脈打つ
    const s = this.mood === 'listen' ? 1 + this.mouth * 0.12 : 1;
    this.body.scale.setScalar(s);
  }
}
