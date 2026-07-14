// お皿かたむけ: お皿の縁をつかんでドラッグすると皿が傾き、
// アイス全体が重力で流れ出す。流れ方は各ピクセルの温度・質感しだい
// (とろとろは川、キンキンは崖のまま、ぷるぷるは揺れながら)。
// 離すとばねで水平へ戻り、余韻でゆらゆら揺れる。
// 端末の傾きセンサー(deviceorientation)があれば、本体をかたむけても流れる。

const TILT_GRAB_MIN = 0.86;   // 縁つかみ判定の内側(plateDist)
const TILT_GRAB_MAX = 1.45;   // 縁つかみ判定の外側
const TILT_DRAG_SCALE = 1.4;  // ドラッグ距離(皿半径比)→傾きの倍率
const TILT_MAX = 1.0;         // ポインタ由来の傾き上限
const SPRING_K = 34.0;        // ばね定数(戻る速さ)
const SPRING_DAMP = 5.0;      // 減衰(小さめ=ぷるんと揺れて戻る)
const DEVICE_TILT_SCALE = 1 / 28; // 端末の傾き角(度)→傾き量
const DEVICE_TILT_MAX = 0.85;

export class TiltController {
  // deps: { sim, audio, plateInfo, uvFromEvent }
  constructor(deps) {
    this.d = deps;
    // ポインタ由来の傾き(x, y はUV系: yは上向き)
    this.tx = 0; this.ty = 0;
    this.vx = 0; this.vy = 0;    // ばね戻りの速度
    this.pointerId = -1;
    this.grabX = 0; this.grabY = 0;
    this.targetX = 0; this.targetY = 0;
    // 端末の傾きセンサー由来(基準からの差分)
    this.devX = 0; this.devY = 0;
    this.devBase = null;

    window.addEventListener('deviceorientation', (e) => this.onOrientation(e));
  }

  // iOS 13+ はユーザー操作内での許可が必要。初回タップ時に呼ぶ(失敗は無視)
  requestSensorPermission() {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      DOE.requestPermission().catch(() => { /* 許可なしでも遊べる */ });
    }
  }

  onOrientation(e) {
    if (e.beta == null || e.gamma == null) return;
    // 持ちはじめの角度を基準にして、そこからの差分で傾ける
    if (this.devBase == null) this.devBase = { beta: e.beta, gamma: e.gamma };
    const clampDev = (v) => Math.max(-DEVICE_TILT_MAX, Math.min(DEVICE_TILT_MAX, v));
    this.devX = clampDev((e.gamma - this.devBase.gamma) * DEVICE_TILT_SCALE);
    this.devY = clampDev(-(e.beta - this.devBase.beta) * DEVICE_TILT_SCALE);
  }

  // お皿の縁か?(pointerdown の振り分けに使う)
  isRimGrab(x, y) {
    const p = this.d.plateInfo();
    const dx = (x - p.cx) * p.aspect, dy = y - p.cy;
    const dist = Math.hypot(dx, dy) / p.r;
    return dist > TILT_GRAB_MIN && dist < TILT_GRAB_MAX;
  }

  begin(x, y, pointerId) {
    this.pointerId = pointerId;
    this.grabX = x; this.grabY = y;
    this.targetX = this.tx; this.targetY = this.ty;
    this.d.audio.tiltCreak();
  }

  get active() { return this.pointerId !== -1; }

  move(x, y) {
    const p = this.d.plateInfo();
    // つかんだ点からのドラッグ量がそのまま傾きに(縁を押し下げるイメージ)
    const dx = (x - this.grabX) * p.aspect / (p.r * TILT_DRAG_SCALE);
    const dy = (y - this.grabY) / (p.r * TILT_DRAG_SCALE);
    const clampTilt = (v) => Math.max(-TILT_MAX, Math.min(TILT_MAX, v));
    this.targetX = clampTilt(dx);
    this.targetY = clampTilt(dy);
  }

  end(pointerId) {
    if (pointerId === this.pointerId) this.pointerId = -1;
  }

  step(dt) {
    if (this.active) {
      // 指に追従(なめらかに)
      const follow = Math.min(1, dt * 14);
      this.vx = (this.targetX - this.tx) / Math.max(dt, 1e-3) * 0.5;
      this.vy = (this.targetY - this.ty) / Math.max(dt, 1e-3) * 0.5;
      this.tx += (this.targetX - this.tx) * follow;
      this.ty += (this.targetY - this.ty) * follow;
    } else {
      // ばねで水平へ戻る(少し揺れる)
      this.vx += (-SPRING_K * this.tx - SPRING_DAMP * this.vx) * dt;
      this.vy += (-SPRING_K * this.ty - SPRING_DAMP * this.vy) * dt;
      this.tx += this.vx * dt;
      this.ty += this.vy * dt;
      if (Math.abs(this.tx) < 1e-4 && Math.abs(this.vx) < 1e-3) { this.tx = 0; this.vx = 0; }
      if (Math.abs(this.ty) < 1e-4 && Math.abs(this.vy) < 1e-3) { this.ty = 0; this.vy = 0; }
    }

    // ポインタ+センサーの合成傾きをシミュへ
    let gx = this.tx + this.devX;
    let gy = this.ty + this.devY;
    const mag = Math.hypot(gx, gy);
    const MAG_CAP = 1.2;
    if (mag > MAG_CAP) { gx *= MAG_CAP / mag; gy *= MAG_CAP / mag; }
    this.d.sim.tilt = [gx, gy];
    this.d.audio.setTiltState(Math.min(1, mag));
    return [gx, gy];
  }
}
