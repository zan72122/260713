// 注ぎ: フレーバーボタンを押したままお皿へドラッグすると、たれ落ちる
// 手の速さで太さが変わり(ゆっくり=太い帯、速い=細い糸)、とどまると山になる。
// タップだけなら従来どおり「ぽとん」と1スクープ落ちる。

const POUR_AMT_PER_SEC = 3.6;    // 1秒あたりに落ちるアイス量(スプラット量)
const POUR_SCOOPS_PER_SEC = 0.5; // 予算消費: 2秒注ぐと1スクープぶん
const POUR_TAP_MIN = 0.04;       // これ未満しか注いでいなければ「タップ=ぽとん」扱い
const POUR_RADIUS_MAX = 0.16;    // ゆっくり動かした時の帯の太さ(皿半径比)
const POUR_RADIUS_MIN = 0.08;    // 速く動かした時の糸の細さ(皿半径比)

export class PourController {
  // deps: { sim, audio, plateInfo, uvFromEvent, state, maxScoops }
  constructor(deps) {
    this.d = deps;
    this.active = false;
    this.flavor = null;
    this.pointerId = -1;
    this.x = 0; this.y = 0;
    this.depX = 0; this.depY = 0; // 前回の着地点(線を途切れさせない補間用)
    this.speedSm = 0;
    this.poured = 0;
    this.lastMoveT = 0;
    this.cursorEl = document.getElementById('pourcursor');

    window.addEventListener('pointermove', (e) => {
      if (!this.active || e.pointerId !== this.pointerId) return;
      const [x, y] = this.d.uvFromEvent(e);
      const dt = Math.max(1, e.timeStamp - this.lastMoveT) / 1000;
      const speed = Math.hypot((x - this.x) * this.d.sim.aspect, y - this.y) / dt;
      this.speedSm += (Math.min(speed, 3) - this.speedSm) * Math.min(1, dt * 12);
      this.x = x; this.y = y;
      this.lastMoveT = e.timeStamp;
      this.moveCursor(e);
    });
  }

  begin(flavor, e) {
    if (this.d.state.scoopsOnPlate >= this.d.maxScoops) return false;
    const [x, y] = this.d.uvFromEvent(e);
    this.active = true;
    this.flavor = flavor;
    this.pointerId = e.pointerId;
    this.x = x; this.y = y;
    this.depX = x; this.depY = y;
    this.speedSm = 0;
    this.poured = 0;
    this.lastMoveT = e.timeStamp;
    this.cursorEl.style.background = flavor.body;
    this.cursorEl.classList.add('visible');
    this.moveCursor(e);
    return true;
  }

  moveCursor(e) {
    this.cursorEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  }

  // 戻り値: タップ扱いなら true(呼び出し側が「ぽとん」を落とす)
  end() {
    const tapped = this.active && this.poured < POUR_TAP_MIN;
    this.active = false;
    this.flavor = null;
    this.pointerId = -1;
    this.cursorEl.classList.remove('visible');
    this.d.audio.setPourState(0);
    return tapped;
  }

  step(dt) {
    if (!this.active) return;
    const { sim, audio, state } = this.d;
    if (state.scoopsOnPlate >= this.d.maxScoops) { this.end(); return; }
    const p = this.d.plateInfo();
    const dx = (this.x - p.cx) * p.aspect, dy = this.y - p.cy;
    const onPlate = Math.hypot(dx, dy) < p.r * 1.02;
    audio.setPourState(onPlate ? 1 : 0);
    if (!onPlate) {
      // お皿の外では落とさない。次にお皿へ入った瞬間から線が始まる
      this.depX = this.x; this.depY = this.y;
      return;
    }

    // 速く動かすほど細い糸、ゆっくりだと太い帯。とどまれば同じ場所に積もって山になる
    const thin = Math.min(1, this.speedSm / 1.6);
    const radius = p.r * (POUR_RADIUS_MAX - (POUR_RADIUS_MAX - POUR_RADIUS_MIN) * thin);
    // たれ落ちる先はほんの少しゆらぐ(リボンが有機的になる)
    const t = performance.now() * 0.001;
    const wx = Math.sin(t * 9.2) * 0.006 / p.aspect;
    const wy = Math.cos(t * 7.6) * 0.006;
    const col = this.flavor.color;

    // 前回の着地点から現在位置まで補間して、速い線でも途切れない糸にする
    const segX = (this.x - this.depX) * p.aspect, segY = this.y - this.depY;
    const segLen = Math.hypot(segX, segY);
    const steps = Math.max(1, Math.min(8, Math.ceil(segLen / (radius * 0.5))));
    const amt = POUR_AMT_PER_SEC * dt / steps;
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      const sx = this.depX + (this.x - this.depX) * u + wx;
      const sy = this.depY + (this.y - this.depY) * u + wy;
      sim.splatColor(sx, sy, radius, col[0], col[1], col[2], amt);
      sim.splatProps(sx, sy, radius, this.flavor.props, [0.5, 0.5, 0.5, 0.5], [0, 0, 0, 0]);
      sim.splatProps2(sx, sy, radius, this.flavor.props2, [0.5, 0.5, 0.5, 0.5], [0, 0, 0, 0]);
    }
    this.depX = this.x; this.depY = this.y;
    state.scoopsOnPlate += POUR_SCOOPS_PER_SEC * dt;
    this.poured += POUR_SCOOPS_PER_SEC * dt;
  }
}
