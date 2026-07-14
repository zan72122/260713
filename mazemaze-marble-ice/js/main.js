// まぜまぜマーブル・アイス — メイン
import { initGL } from './gl.js';
import { IceSim } from './sim.js';
import { Chunks, Flakes, CHUNK_TYPES } from './particles.js';
import { GameAudio } from './audio.js';
import { UI, FLAVORS, CURSOR_SVGS } from './ui.js';

const canvas = document.getElementById('glcanvas');
const gl = initGL(canvas);
if (!gl) {
  document.getElementById('nogl').hidden = false;
  throw new Error('WebGL2 / float buffer unsupported');
}

// ---- 道具のパラメータ ----
const TOOLS = {
  finger:  { radius: 0.050, force: 1.05, press: 0.22 },
  spoon:   { radius: 0.080, force: 1.35, press: 0.65 },
  spatula: { radius: 0.115, force: 1.20, press: 1.00 },
};

const MAX_SCOOPS = 9;
const SAMPLE_INTERVAL_MS = 90;   // 指の下の質感を読み出す間隔(音のフレーバー連動用)
const SHELL_BREAK_THRESHOLD = 0.18; // これ以上の殻は混ぜると割れる

// 何もさわっていない時の音用フォールバック質感
const DEFAULT_SAMPLE = {
  temp: 0.32, air: 0.75, crystal: 0.2, gloss: 0.1,
  shari: 0, mochi: 0, shell: 0, jelly: 0,
};

const state = {
  tool: 'finger',
  tempHold: null,        // 'cold' | 'warm' | null
  scoopsOnPlate: 0,
  stirEnergy: 0,         // 細かく混ぜた度合い → にじみ(均一化)
  speedSm: 0,            // 音用スムーズ化した混ぜ速度
  sample: null,          // 指の下の質感 (sim.sampleAt の結果)
  lastSampleMs: 0,
  nextShellCrackMs: 0,
  resetUntil: 0,
  lastInteract: performance.now(),
  started: false,
};

const sim = new IceSim(gl, canvas);
const chunks = new Chunks(gl);
const flakes = new Flakes(gl);
const audio = new GameAudio();

// ---- レイアウト: お皿の位置をバーの隙間に合わせる ----
function layout() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    sim.resize();
  }
  const vw = window.innerWidth, vh = window.innerHeight;
  const top = document.getElementById('topbar').getBoundingClientRect();
  const bot = document.getElementById('bottombar').getBoundingClientRect();
  let x0 = 0, x1 = vw, y0 = 0, y1 = vh;
  const landscape = matchMedia('(orientation: landscape) and (max-height: 560px)').matches;
  if (landscape) {
    x0 = top.right; x1 = bot.left;
  } else {
    y0 = top.bottom; y1 = bot.top;
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const r = Math.min(x1 - x0, y1 - y0) * 0.5 * 0.82;
  // UV系(y上向き)に変換。半径はy正規化単位
  sim.setPlate(cx / vw, 1 - cy / vh, Math.max(0.05, r / vh));
}

function plateInfo() {
  return { cx: sim.plateCenter[0], cy: sim.plateCenter[1], r: sim.plateRadius, aspect: sim.aspect };
}

// ---- スクープを置く ----
const dropQueue = []; // { x, y, flavor, t, dur, r }

function dropSpotFor(i) {
  // 置き場所: 中央→まわりに輪状
  if (i === 0) return [0, 0];
  const ring = Math.floor((i - 1) / 6);
  const k = (i - 1) % 6;
  const ang = k * Math.PI / 3 + ring * 0.5 - Math.PI / 2;
  const rr = 0.5 + ring * 0.22;
  return [Math.cos(ang) * rr, Math.sin(ang) * rr];
}

function addScoop(flavor) {
  if (state.scoopsOnPlate >= MAX_SCOOPS) return false;
  const p = plateInfo();
  const [ox, oy] = dropSpotFor(state.scoopsOnPlate);
  const jx = (Math.random() - 0.5) * 0.1, jy = (Math.random() - 0.5) * 0.1;
  const x = p.cx + (ox + jx) * p.r / p.aspect;
  const y = p.cy + (oy + jy) * p.r;
  dropQueue.push({ x, y, flavor, t: 0, dur: 0.34, r: p.r * 0.34 });
  state.scoopsOnPlate++;
  audio.plop();
  return true;
}

function stepDrops(dt) {
  for (const d of dropQueue) {
    const t0 = d.t, t1 = Math.min(d.dur, d.t + dt);
    d.t = t1;
    // ぼよんと着地する量カーブ
    const ease = (t) => {
      const u = t / d.dur;
      return u * u * (3 - 2 * u);
    };
    const dAmt = (ease(t1) - ease(t0)) * 1.35;
    if (dAmt > 0) {
      const wob = 1 + 0.08 * Math.sin(t1 * 34);
      const col = d.flavor.color;
      sim.splatColor(d.x, d.y, d.r * wob, col[0], col[1], col[2], dAmt);
      // フレーバー固有の質感を色と一緒に置く
      sim.splatProps(d.x, d.y, d.r * wob, d.flavor.props, [0.5, 0.5, 0.5, 0.5], [0, 0, 0, 0]);
      sim.splatProps2(d.x, d.y, d.r * wob, d.flavor.props2, [0.5, 0.5, 0.5, 0.5], [0, 0, 0, 0]);
    }
    // 着地の「ぷるん」波
    if (t0 < d.dur * 0.85 && t1 >= d.dur * 0.85) {
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3;
        sim.splatVelocity(d.x, d.y, Math.cos(a) * 0.35, Math.sin(a) * 0.35, d.r * 0.8);
      }
    }
  }
  for (let i = dropQueue.length - 1; i >= 0; i--) {
    if (dropQueue[i].t >= dropQueue[i].dur) dropQueue.splice(i, 1);
  }
}

// ---- ポインタ(かき混ぜ) ----
const pointers = new Map(); // id -> {x, y, t}
const cursorEl = document.getElementById('toolcursor');

function uvFromEvent(e) {
  return [e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight];
}

function onFirstInteract() {
  if (!state.started) {
    state.started = true;
    audio.start();
    audio.setEnabled(ui.soundOn);
  }
  audio.resume();
  document.getElementById('starthint').classList.add('hidden');
  state.lastInteract = performance.now();
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  onFirstInteract();
  const [x, y] = uvFromEvent(e);
  pointers.set(e.pointerId, { x, y, t: e.timeStamp });
  updateCursor(e, 0);
  if (state.tool !== 'finger') cursorEl.classList.add('visible');
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  e.preventDefault();
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events) {
    const [x, y] = uvFromEvent(ev);
    const dt = Math.max(1, ev.timeStamp - p.t) / 1000;
    stirAt(p, x, y, dt, e.pressure || 0.5);
    p.x = x; p.y = y; p.t = ev.timeStamp;
  }
  updateCursor(e, 1);
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) cursorEl.classList.remove('visible');
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

function stirAt(prev, x, y, dt, pressure) {
  const tool = TOOLS[state.tool];
  let vx = (x - prev.x) / dt, vy = (y - prev.y) / dt;
  const speed = Math.hypot(vx * sim.aspect, vy);
  if (speed < 1e-4) return;
  const cap = 3.2;
  if (speed > cap) { vx *= cap / speed; vy *= cap / speed; }
  const spd = Math.min(speed, cap);

  // 指の下の質感を読み出す(音のフレーバー連動・殻割り判定に使用)
  const nowMs = performance.now();
  if (nowMs - state.lastSampleMs > SAMPLE_INTERVAL_MS) {
    state.lastSampleMs = nowMs;
    state.sample = sim.sampleAt(x, y);
  }
  const smp = state.sample;

  // 混ぜる力
  sim.splatVelocity(x, y, vx * tool.force, vy * tool.force, tool.radius);

  // 押しつぶし: 空気が抜けてツヤが出る
  const press = tool.press * (0.4 + pressure);
  const glossAdd = Math.min(0.5, press * spd * 0.10);
  const airCut = Math.min(0.5, press * spd * 0.055);
  // 冷やし混ぜ: 結晶が育つ / 混ぜ摩擦: ほんのり温まる
  const coldness = Math.max(0, 0.45 - sim.ambient) / 0.45;
  const crystalAdd = coldness * spd * 0.09;
  const fricHeat = spd * 0.004;
  sim.splatProps(x, y, tool.radius * 0.9,
    [0, 0, 0, 0], [0, 0, 0, 0],
    [fricHeat, -airCut, crystalAdd, glossAdd]);

  // ぱりぱり殻: 押して混ぜると割れる(ぱきぱき音つき)
  if (smp && smp.shell > SHELL_BREAK_THRESHOLD) {
    const breakAmt = Math.min(0.6, press * spd * 0.30);
    if (breakAmt > 0.02) {
      sim.splatProps2(x, y, tool.radius * 0.8,
        [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, -breakAmt, 0]);
      if (smp.shell > 0.35 && nowMs >= state.nextShellCrackMs) {
        audio.shellCrack(Math.min(1, smp.shell + breakAmt));
        state.nextShellCrackMs = nowMs + 130 + Math.random() * 180;
      }
    }
  }

  // トッピング粒に力を伝える
  const broke = chunks.stir(x, y, vx * tool.force, vy * tool.force, tool.radius * 1.15, sim.aspect, press);
  if (broke > 0) audio.crack();

  // 細かく何度も混ぜるほど「にじんで」均一化へ
  state.stirEnergy = Math.min(1.6, state.stirEnergy + spd * dt * 0.55);
  state.speedSm = Math.max(state.speedSm, spd / cap);
}

function updateCursor(e, moving) {
  if (state.tool === 'finger') return;
  cursorEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
}

// ---- 初期配置: 2〜3個をランダムなフレーバー・位置でぽとん ----
const pendingDropTimers = [];

function clearPendingDrops() {
  for (const timer of pendingDropTimers) clearTimeout(timer);
  pendingDropTimers.length = 0;
}

function randomInitialDrops() {
  const count = Math.random() < 0.45 ? 3 : 2;
  const pool = [...FLAVORS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  // お皿の中心まわりに等間隔+ゆらぎで配置(かならず離れて落ちる)
  const baseAng = Math.random() * Math.PI * 2;
  return pool.slice(0, count).map((flavor, i) => {
    const ang = baseAng + i * (Math.PI * 2 / count) + (Math.random() - 0.5) * 0.55;
    const rad = (count === 2 ? 0.30 : 0.36) + (Math.random() - 0.5) * 0.12;
    return { flavor, ox: Math.cos(ang) * rad, oy: Math.sin(ang) * rad, delay: 500 + i * 400 };
  });
}

function scheduleInitialScene(extraDelay = 0) {
  for (const d of randomInitialDrops()) {
    pendingDropTimers.push(setTimeout(() => {
      const p = plateInfo();
      dropQueue.push({
        x: p.cx + d.ox * p.r / p.aspect,
        y: p.cy + d.oy * p.r,
        flavor: d.flavor, t: 0, dur: 0.34, r: p.r * 0.36,
      });
      state.scoopsOnPlate++;
    }, extraDelay + d.delay));
  }
}

// ---- UI ----
const ui = new UI({
  onAnyPress: () => { onFirstInteract(); audio.pop(); },
  onFlavor: (f) => addScoop(f),
  onTopping: (t) => {
    const p = plateInfo();
    const count = t.id === 'chip' ? 16 : t.id === 'cookie' ? 7 : 9;
    chunks.sprinkle(CHUNK_TYPES[t.id], p, count);
    audio.sprinkle();
    return true;
  },
  onTool: (id) => {
    state.tool = id;
    cursorEl.innerHTML = CURSOR_SVGS[id] || '';
  },
  onTempDown: (kind) => {
    state.tempHold = kind;
    kind === 'cold' ? audio.freeze() : audio.warm();
  },
  onTempUp: () => { state.tempHold = null; },
  onSoundToggle: (on) => audio.setEnabled(on),
  onReset: () => {
    // お皿の上に何も載っていない、まっさらの状態へ戻す(自動の再配置はしない)
    state.resetUntil = performance.now() + 1100;
    state.scoopsOnPlate = 0;
    state.stirEnergy = 0;
    state.sample = null;
    dropQueue.length = 0;
    clearPendingDrops();
    chunks.clear();
    audio.sweep();
  },
});

// ---- メインループ ----
let lastT = performance.now();
let flakeAcc = 0;

function frame(now) {
  const rawDt = (now - lastT) / 1000;
  const dt = Math.min(0.033, rawDt);
  lastT = now;
  layout();

  // 温度ボタン
  if (state.tempHold === 'cold') {
    sim.ambient = Math.max(0.0, sim.ambient - dt * 0.22);
    sim.ambientRate = 1.1;
    flakeAcc += dt * 42;
  } else if (state.tempHold === 'warm') {
    sim.ambient = Math.min(1.0, sim.ambient + dt * 0.22);
    sim.ambientRate = 1.1;
    flakeAcc += dt * 14;
  } else {
    // だんだん常温へ
    sim.ambient += (0.5 - sim.ambient) * dt * 0.018;
    sim.ambientRate = 0.14;
  }
  const p = plateInfo();
  while (flakeAcc >= 1) {
    flakeAcc -= 1;
    flakes.emit(state.tempHold === 'warm' ? 1 : 0, p);
  }

  // 混ぜエネルギー: くっきり⇄にじみ
  state.stirEnergy = Math.max(0, state.stirEnergy - dt * 0.35);
  sim.sharpness = 0.9 - Math.min(0.65, state.stirEnergy * 0.5);

  // リセットのフェード(実経過時間ベース: 低フレームレートでも確実に消える)
  sim.fade = performance.now() < state.resetUntil ? Math.pow(0.002, Math.min(rawDt, 0.5)) : 1.0;

  stepDrops(dt);
  sim.step(dt);
  const landed = chunks.update(dt, p);
  if (landed > 0) audio.crunchTick(0.5, 1, 0);
  flakes.update(dt);

  // 描画
  sim.render();
  chunks.draw(sim.color.read, sim.aspect, gl.drawingBufferWidth, gl.drawingBufferHeight);
  flakes.draw(gl.drawingBufferWidth, gl.drawingBufferHeight);

  // ---- 音の状態更新: 指の下の質感がそのまま音になる ----
  const chunky = Math.min(1, chunks.list.filter(c => !c.falling && c.sink < 0.85).length / 30);
  audio.setStirState(state.speedSm, chunky, state.sample || DEFAULT_SAMPLE);
  audio.update();
  state.speedSm *= Math.exp(-dt * 7);

  requestAnimationFrame(frame);
}

// ---- 各種イベント ----
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 300));
document.addEventListener('visibilitychange', () => {
  document.hidden ? audio.suspend() : audio.resume();
});
// ピンチズーム等の誤操作防止
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

layout();
scheduleInitialScene();
requestAnimationFrame(frame);
