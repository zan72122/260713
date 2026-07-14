// 味見スプーン: スプーンでお皿を押さえたまま少し待つと「ずずっ」とすくい取り。
// すくった一口はスプーンに載って持ち運べる(マーブル断面の色がそのまま見える)。
// お皿にはすくい跡のくぼみが残り、次の混ぜに影響する。
// - お皿の上で離す → 「ぽとん」とその場所へ戻す(別の場所に置き直せる)
// - お皿の外で離す → 「ぱくっ」と味見。咀嚼音はその一口の質感配合から合成される
import { scoopSlurp, eatBite } from './audio_taste.js';

const HOLD_MS = 240;          // すくい開始までの静止時間
const HOLD_MOVE_CANCEL = 0.022; // これ以上動いたら「かき混ぜ」扱い(UV距離)
const SCOOP_RATE = 1.7;       // 1秒あたりの一口のたまり方
const SCOOP_STRENGTH = 4.2;   // 1秒あたりの削り量
const SCOOP_RADIUS = 0.055;   // すくい口の半径(y正規化)
const BITE_MIN = 0.08;        // これ未満の一口は何もしない
const PLOP_RADIUS = 0.075;    // 戻す時の広がり
const SAMPLE_INTERVAL_MS = 70;

export class TasteController {
  // deps: { sim, audio, plateInfo }
  constructor(deps) {
    this.d = deps;
    this.phase = 'idle'; // idle | pending | scooping
    this.pointerId = -1;
    this.x = 0; this.y = 0;           // UV位置
    this.clientX = 0; this.clientY = 0;
    this.startX = 0; this.startY = 0;
    this.downAt = 0;
    this.bite = null; // { amount, color:[r,g,b], tex:{...} } たまった一口
    this.lastSampleMs = 0;
    this.eating = false;
    this.biteEl = document.getElementById('spoonbite');
  }

  // スプーンでお皿に触れた(pointerdown)。pending として様子を見る
  begin(x, y, e) {
    const p = this.d.plateInfo();
    const dx = (x - p.cx) * p.aspect, dy = y - p.cy;
    if (Math.hypot(dx, dy) > p.r) return; // お皿の外は対象外
    this.phase = 'pending';
    this.pointerId = e.pointerId;
    this.x = x; this.y = y;
    this.startX = x; this.startY = y;
    this.clientX = e.clientX; this.clientY = e.clientY;
    this.downAt = performance.now();
  }

  // pointermove。true を返したら「かき混ぜ」せずに消費する
  filterMove(x, y, e) {
    if (e.pointerId !== this.pointerId || this.phase === 'idle') return false;
    this.x = x; this.y = y;
    this.clientX = e.clientX; this.clientY = e.clientY;
    if (this.phase === 'pending') {
      const p = this.d.plateInfo();
      const dx = (x - this.startX) * p.aspect, dy = y - this.startY;
      if (Math.hypot(dx, dy) > HOLD_MOVE_CANCEL) {
        // すぐ動いた=いつものかき混ぜ
        this.phase = 'idle';
        this.pointerId = -1;
        return false;
      }
      return true; // 静止監視中は混ぜない
    }
    return true; // scooping 中はすくいながら運ぶ
  }

  onUp(e) {
    if (e.pointerId !== this.pointerId || this.phase === 'idle') return;
    const wasScooping = this.phase === 'scooping';
    this.phase = 'idle';
    this.pointerId = -1;
    if (!wasScooping || !this.bite || this.bite.amount < BITE_MIN) {
      this.dropBite();
      return;
    }
    const p = this.d.plateInfo();
    const dx = (this.x - p.cx) * p.aspect, dy = this.y - p.cy;
    if (Math.hypot(dx, dy) < p.r * 0.98) {
      this.plopBack();
    } else {
      this.eat();
    }
  }

  step(dt) {
    const nowMs = performance.now();
    if (this.phase === 'pending' && nowMs - this.downAt >= HOLD_MS) {
      // すくい取りはじめ
      this.phase = 'scooping';
      this.bite = { amount: 0, color: [0.9, 0.9, 0.9], tex: null };
      scoopSlurp(this.d.audio);
    }
    if (this.phase !== 'scooping') {
      if (!this.eating && (!this.bite || this.bite.amount <= 0)) this.hideBite();
      return;
    }

    const p = this.d.plateInfo();
    const dx = (this.x - p.cx) * p.aspect, dy = this.y - p.cy;
    const onPlate = Math.hypot(dx, dy) < p.r;
    if (onPlate && this.bite.amount < 1) {
      // その場所の色・質感を一口へブレンドしながら、お皿を削る
      if (nowMs - this.lastSampleMs > SAMPLE_INTERVAL_MS) {
        this.lastSampleMs = nowMs;
        const s = this.d.sim.sampleAt(this.x, this.y);
        if (s.amount > 0.03) {
          const w = Math.min(1, dt * 6 + (this.bite.tex ? 0 : 1));
          this.blendBite(s, w);
        }
      }
      const hasIce = this.bite.tex != null;
      if (hasIce) {
        this.d.sim.scoopAt(this.x, this.y, SCOOP_RADIUS, Math.min(0.6, SCOOP_STRENGTH * dt));
        this.bite.amount = Math.min(1, this.bite.amount + SCOOP_RATE * dt);
      }
    }
    this.showBite();
  }

  blendBite(s, w) {
    const b = this.bite;
    if (!b.tex) {
      b.tex = { ...s };
      b.color = [s.r, s.g, s.b];
      return;
    }
    for (const k of Object.keys(b.tex)) b.tex[k] += (s[k] - b.tex[k]) * w;
    b.color[0] += (s.r - b.color[0]) * w;
    b.color[1] += (s.g - b.color[1]) * w;
    b.color[2] += (s.b - b.color[2]) * w;
  }

  // お皿の上で離した: その場所へぽとんと戻す
  plopBack() {
    const b = this.bite;
    const t = b.tex;
    const sim = this.d.sim;
    sim.splatColor(this.x, this.y, PLOP_RADIUS * (0.7 + b.amount * 0.5),
      b.color[0], b.color[1], b.color[2], 0.5 + b.amount * 0.7);
    sim.splatProps(this.x, this.y, PLOP_RADIUS,
      [t.temp, t.air, t.crystal, t.gloss], [0.6, 0.6, 0.6, 0.6], [0, 0, 0, 0]);
    sim.splatProps2(this.x, this.y, PLOP_RADIUS,
      [t.shari, t.mochi, t.shell, t.jelly], [0.6, 0.6, 0.6, 0.6], [0, 0, 0, 0]);
    this.d.audio.plop();
    this.dropBite();
  }

  // お皿の外で離した: ぱくっと味見(咀嚼音は一口の質感から合成)
  eat() {
    const dur = eatBite(this.d.audio, this.bite.tex, this.bite.amount);
    // もぐもぐに合わせて一口が段々小さくなる
    this.eating = true;
    const b = this.bite;
    const steps = 3;
    const STEP_MS = (dur * 1000) / (steps + 1);
    for (let i = 1; i <= steps; i++) {
      setTimeout(() => {
        if (!this.eating) return;
        b.amount *= 0.5;
        this.showBite();
      }, STEP_MS * i);
    }
    setTimeout(() => { this.eating = false; this.dropBite(); }, dur * 1000);
  }

  dropBite() {
    this.bite = null;
    this.hideBite();
  }

  // リセット時など、すべて中断
  cancel() {
    this.phase = 'idle';
    this.pointerId = -1;
    this.eating = false;
    this.dropBite();
  }

  // スプーンの上の一口(カーソルのさじ部分に重なるよう少しオフセット)
  showBite() {
    if (!this.bite || !this.bite.tex) return;
    const b = this.bite;
    const scale = 0.35 + b.amount * 0.75;
    const [r, g, bl] = b.color.map((v) => Math.round(v * 255));
    this.biteEl.style.background = `rgb(${r}, ${g}, ${bl})`;
    this.biteEl.style.transform =
      `translate(${this.clientX + 11}px, ${this.clientY - 17}px) scale(${scale})`;
    this.biteEl.classList.add('visible');
  }

  hideBite() {
    this.biteEl.classList.remove('visible');
  }
}
