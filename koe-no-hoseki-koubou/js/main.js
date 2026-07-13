// ============================================================
// こえの宝石工房 — メイン
// 画面遷移・声イベントと宝石の成長・世界のリアクションを束ねる
// ============================================================

import * as THREE from './lib/three.module.min.js';
import { STEPS_TO_COMPLETE, VOWELS } from './config.js';
import { Mic } from './audio/mic.js';
import { VoiceEngine, pitchBucketOf, durationBucketOf } from './audio/events.js';
import { Sfx } from './audio/sfx.js';
import { World } from './game/world.js';
import { Particles } from './game/particles.js';
import { Lumi } from './game/character.js';
import {
  buildGem, buildStepGroup, buildGhostStep, disposeGroup, colorForStep,
} from './game/gemBuilder.js';
import { makeRecipe, stepBadge } from './game/recipe.js';
import * as store from './game/gallery.js';
import { Hud } from './ui/hud.js';

// ---------------- 基本セットアップ ----------------

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;

const world = new World(renderer);
const particles = new Particles(world.scene);
const lumi = new Lumi(world.scene);

const state = {
  mode: 'title', // title | play | celebrating | viewing
  recipe: store.loadCurrentRecipe() || makeRecipe(),
  gemGroup: null,
  appearing: [],       // 生えてくる途中の結晶
  ghost: null,         // 声を出している間のプレビュー
  ghostKey: '',
  ghostBase: 1,
  settings: store.loadSettings(),
  viewerSaved: null,
  rotVel: 0,
  cooldownUntil: 0,    // 効果音の自己検出よけ
  lastMist: 0,
  celebrated: false,
};

let mic = null;
let engine = null;
let sfx = null;

// ---------------- リサイズ ----------------

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  world.resize(w, h);
  // ようせいルミの定位置を画面の形に合わせる(縦画面では内側の上へ)
  const aspect = w / h;
  if (aspect < 0.75) lumi.home.set(0.52, 2.15, 0.6);
  else if (aspect < 1.1) lumi.home.set(0.8, 1.95, 0.6);
  else lumi.home.set(1.05, 1.75, 0.55);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 300));
resize();

// ---------------- 宝石の管理 ----------------

function mountGem(recipe) {
  if (state.gemGroup) {
    world.gemAnchor.remove(state.gemGroup);
    disposeGroup(state.gemGroup);
  }
  state.gemGroup = buildGem(recipe);
  world.gemAnchor.add(state.gemGroup);
}

function acceptingInput() {
  if (state.mode !== 'play') return false;
  // クールダウンとおしゃべり中ガードは「マイク入力の自己検出よけ」なので
  // マイクが無い(こえボタンだけ)ならスキップする
  const micActive = mic && mic.ready;
  if (micActive && performance.now() < state.cooldownUntil) return false;
  if (micActive && window.speechSynthesis && window.speechSynthesis.speaking) {
    return false;
  }
  return true;
}

function growthRatio() {
  return state.recipe.steps.length / STEPS_TO_COMPLETE;
}

// 成長ステップを確定して結晶を生やす
function addStep(step) {
  if (!acceptingInput()) return;
  removeGhost();

  const index = state.recipe.steps.length;
  state.recipe.steps.push(step);
  store.saveCurrentRecipe(state.recipe);

  const sg = buildStepGroup(step, index);
  const target = sg.scale.x;
  sg.scale.setScalar(0.001);
  state.gemGroup.add(sg);
  state.appearing.push({ group: sg, age: 0, target });

  // ---- 世界のリアクション ----
  const color = sg.userData.color;
  const wp = new THREE.Vector3();
  sg.getWorldPosition(wp);
  particles.burst(wp, color, { count: 46 });
  particles.setStreamColor(color);
  particles.setStreamRate(3 + state.recipe.steps.length * 1.6);
  world.reactToStep(color, growthRatio());
  const flowers = step.t === 'v' ? 2 : 1;
  for (let k = 0; k < flowers; k++) {
    const p = world.addFlower(color, index * 131 + k * 17 + step.t.charCodeAt(0));
    setTimeout(() => sfx && sfx.pop(), 300 + k * 200);
    particles.burst(p, color, { count: 10, speed: 0.7, size: 0.06, life: 0.8 });
  }

  // ---- 音とキャラクター ----
  if (sfx) {
    sfx.growTick(index);
    sfx.crystallize();
    if (step.t === 'b') sfx.frost();
    if (state.recipe.steps.length < STEPS_TO_COMPLETE) sfx.cheer(index);
  }
  lumi.nod();

  hud.setTrail(state.recipe.steps.map(stepBadge));
  hud.showHint(false);
  state.cooldownUntil = performance.now() + 1200;

  if (state.recipe.steps.length >= STEPS_TO_COMPLETE) {
    setTimeout(completeGem, 900);
  }
}

// ---------------- 完成 ----------------

function completeGem() {
  if (state.mode !== 'play') return;
  state.mode = 'celebrating';

  const recipe = state.recipe;
  const name = store.nameGem(recipe);
  let thumb = null;
  try {
    thumb = store.renderThumbnail(renderer, recipe, world.scene.environment);
  } catch (_) { /* サムネイル無しでも続行 */ }
  store.saveToGallery({
    recipe,
    name,
    thumb,
    emojis: store.recipeEmojis(recipe),
    createdAt: Date.now(),
  });
  store.clearCurrentRecipe();

  const colors = recipe.steps.map((s, i) => colorForStep(s, i));
  particles.fireworks(new THREE.Vector3(0, 2.0, 0), colors);
  particles.setStreamRate(26);
  if (sfx) {
    sfx.fanfare();
    setTimeout(() => sfx.praise(), 900);
  }
  lumi.celebrate(true);

  setTimeout(() => hud.showCelebrate(name, thumb), 1500);
}

function startNewGem() {
  hud.hideCelebrate();
  lumi.celebrate(false);
  state.recipe = makeRecipe();
  store.saveCurrentRecipe(state.recipe);
  mountGem(state.recipe);
  world.softReset();
  particles.setStreamRate(3);
  hud.setTrail([]);
  hud.showHint(true, 'こえを きかせてね 🎤');
  state.mode = 'play';
  state.cooldownUntil = performance.now() + 800;
  if (sfx) sfx.speak('あたらしい ほうせきを そだてよう!');
}

// ---------------- ゴースト(声を出している間のプレビュー) ----------------

function updateGhost(params, progress) {
  const index = state.recipe.steps.length;
  const key = `${params.v}:${params.p}:${params.d}:${index}`;
  if (!state.ghost || state.ghostKey !== key) {
    removeGhost();
    state.ghost = buildGhostStep({ t: 'v', ...params }, index);
    state.ghostBase = state.ghost.scale.x;
    state.ghost.scale.setScalar(0.001);
    state.gemGroup.add(state.ghost);
    state.ghostKey = key;
  }
  state.ghost.scale.setScalar(state.ghostBase * (0.25 + 0.75 * progress));
}

function removeGhost() {
  if (state.ghost) {
    state.gemGroup.remove(state.ghost);
    disposeGroup(state.ghost);
    state.ghost = null;
    state.ghostKey = '';
  }
}

// ---------------- 声イベントの配線 ----------------

// 効果音の鳴り始めに「声」と誤認して育たないよう、
// 声の開始時点で受付可だったかを覚えておく
let voiceAcceptedAtStart = false;

function wireEngine(eng) {
  eng.on('voiceStart', () => {
    voiceAcceptedAtStart = acceptingInput();
    if (!voiceAcceptedAtStart) return;
    lumi.setMood('listen');
  });

  eng.on('voiceHold', ({ winner, hz, elapsed, level }) => {
    lumi.setMouth(Math.min(1, level * 1.6));
    if (!voiceAcceptedAtStart || !acceptingInput()) return;
    const v = winner || 'a';
    const p = pitchBucketOf(hz);
    const d = durationBucketOf(elapsed);
    const color = colorForStep({ t: 'v', v, p, d }, state.recipe.steps.length);
    world.setLive(Math.min(1, level * 1.4), color);
    const label = VOWELS[v].label + (elapsed > 0.6 ? 'ー' : '');
    hud.showBubble(label, '#' + color.getHexString());
    updateGhost({ v, p, d }, Math.min(1, elapsed / 1.6));
  });

  eng.on('voiceEnd', ({ vowel, pitchBucket, durationBucket, duration }) => {
    lumi.setMood('idle');
    lumi.setMouth(0);
    world.setLive(0, null);
    removeGhost();
    if (voiceAcceptedAtStart && duration >= 0.22) {
      addStep({ t: 'v', v: vowel, p: pitchBucket, d: durationBucket });
    }
    voiceAcceptedAtStart = false;
  });

  eng.on('clap', ({ count }) => {
    if (!acceptingInput()) return;
    hud.clapFlash(count);
    if (sfx) sfx.clapEcho(1);
  });

  eng.on('clapPattern', ({ count }) => {
    if (!acceptingInput()) return;
    if (count >= 3) addStep({ t: 'c', n: 3 });
    else if (count === 2) addStep({ t: 'c', n: 2 });
    else {
      // 1回だけならキラッと光る(ステップにはしない)
      particles.burst(new THREE.Vector3(0, 1.2, 0), new THREE.Color(0xfff2aa), {
        count: 20, speed: 1.0, size: 0.08, life: 0.8,
      });
      if (sfx) sfx.sparkle();
    }
  });

  eng.on('blowHold', () => {
    if (!acceptingInput()) return;
    const t = performance.now();
    if (t - state.lastMist > 260) {
      state.lastMist = t;
      particles.mist(new THREE.Vector3(0, 1.15, 0));
      lumi.setMood('listen');
    }
  });

  eng.on('blowEnd', ({ duration }) => {
    lumi.setMood('idle');
    if (duration >= 0.4) {
      addStep({ t: 'b', d: durationBucketOf(duration) });
    }
  });

  eng.on('level', ({ level, active }) => {
    if (!active) {
      world.setLive(level * 0.25, null);
      lumi.setMouth(level * 0.4);
    }
  });
}

// ---------------- HUD ----------------

const hud = new Hud({
  onStart: startGame,

  onOpenGallery: () => {
    if (state.mode === 'celebrating') return;
    hud.showGallery(true, store.loadGallery());
  },

  onViewGem: (idx) => {
    const items = store.loadGallery();
    const item = items[idx];
    if (!item || state.mode === 'viewing') return;
    hud.showGallery(false);
    state.viewerSaved = state.gemGroup;
    world.gemAnchor.remove(state.gemGroup);
    state.gemGroup = buildGem(item.recipe);
    world.gemAnchor.add(state.gemGroup);
    state.mode = 'viewing';
    hud.showViewer(item.name);
    if (sfx) sfx.sparkle();
  },

  onExitViewer: () => {
    if (state.mode !== 'viewing') return;
    world.gemAnchor.remove(state.gemGroup);
    disposeGroup(state.gemGroup);
    state.gemGroup = state.viewerSaved;
    state.viewerSaved = null;
    world.gemAnchor.add(state.gemGroup);
    state.mode = 'play';
    hud.hideViewer();
  },

  onNewGem: () => {
    if (state.mode === 'viewing') return;
    startNewGem();
  },

  onNextGem: startNewGem,

  onToggleMute: () => {
    state.settings.muted = !state.settings.muted;
    store.saveSettings(state.settings);
    if (sfx) sfx.setMuted(state.settings.muted);
    hud.setMuted(state.settings.muted);
  },

  onToggleSpeech: () => {
    state.settings.speech = !state.settings.speech;
    store.saveSettings(state.settings);
    if (sfx) sfx.voiceOn = state.settings.speech;
    hud.setSpeechLabel(state.settings.speech);
  },

  onClearData: () => {
    store.clearGallery();
    hud.showGallery(false);
  },

  // ---- こえボタン ----
  onPadVowelStart: (v, pitch) => {
    if (!engine || state.mode !== 'play') return;
    const hz = pitch === 'high' ? 430 : pitch === 'low' ? 160 : 280;
    engine.synthStart(v, hz);
  },
  onPadVowelEnd: () => engine && engine.synthEnd(),
  onPadBlow: () => {
    if (!engine || state.mode !== 'play') return;
    particles.mist(new THREE.Vector3(0, 1.15, 0));
    engine.synthBlow(1.0);
  },
  onPadClap: (n) => {
    if (!engine || state.mode !== 'play') return;
    hud.clapFlash(n);
    engine.synthClap(n);
  },
});

hud.setMuted(state.settings.muted);
hud.setSpeechLabel(state.settings.speech);

// ---------------- ゲーム開始(ユーザー操作から) ----------------

async function startGame() {
  if (state.mode !== 'title') return;
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  await ctx.resume().catch(() => {});
  sfx = new Sfx(ctx);
  sfx.setMuted(state.settings.muted);
  sfx.voiceOn = state.settings.speech;

  hud.setTitleStatus('マイクを つかっても いい? 🎤');
  mic = new Mic();
  const ok = await mic.start(ctx);

  engine = new VoiceEngine(ok ? mic : null);
  wireEngine(engine);

  hud.hideTitle();
  hud.showHud();
  state.mode = 'play';
  state.cooldownUntil = performance.now() + 600;

  if (ok) {
    hud.showHint(true, 'こえを きかせてね 🎤');
    sfx.speak('こえを きかせてね!');
  } else {
    hud.showHint(true, 'したの 🎹 ボタンで あそべるよ');
    hud.togglePad(true);
  }

  hud.setTrail(state.recipe.steps.map(stepBadge));
}

// ---------------- ドラッグで宝石を回す ----------------

let dragging = false;
let lastX = 0;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastX = e.clientX;
});
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  lastX = e.clientX;
  state.rotVel += dx * 0.0022;
});
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointercancel', () => { dragging = false; });

// iOS のダブルタップ拡大よけ
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

// ---------------- メインループ ----------------

function elasticOut(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return Math.pow(2, -9 * x) * Math.sin((x * 8 - 0.75) * (Math.PI / 1.8)) * 0.6 + 1;
}

const clock = new THREE.Clock();
let elapsed = 0;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  if (engine) engine.update();

  // 生えてくる結晶のアニメーション
  for (let i = state.appearing.length - 1; i >= 0; i--) {
    const a = state.appearing[i];
    a.age += dt;
    const k = Math.min(1, a.age / 0.75);
    a.group.scale.setScalar(Math.max(0.001, elasticOut(k) * a.target));
    if (k >= 1) state.appearing.splice(i, 1);
  }

  // 宝石の回転(自動 + ドラッグ)
  const spin = state.mode === 'celebrating' ? 0.9 : 0.14;
  world.gemAnchor.rotation.y += (spin + state.rotVel * 60 * dt) * dt * 4;
  state.rotVel *= Math.pow(0.05, dt);
  world.gemAnchor.position.y = 0.62 + Math.sin(elapsed * 0.9) * 0.02
    + (state.mode === 'celebrating' ? 0.25 + Math.sin(elapsed * 3) * 0.06 : 0);

  lumi.update(dt);
  world.update(dt);
  particles.update(dt);
  renderer.render(world.scene, world.camera);
}

mountGem(state.recipe);
tick();

// ---------------- テスト用フック(?test=1) ----------------

const params = new URLSearchParams(location.search);
if (params.get('test') === '1') {
  window.__game = {
    THREE, state, world, particles, engine: () => engine,
    addStep, startGame, startNewGem, completeGem,
    // 自動デモ: あ→い→う→え→お→ふー→👏👏👏
    async demo(intervalMs = 700) {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const seq = ['a', 'i', 'u', 'e', 'o'];
      for (const v of seq) {
        state.cooldownUntil = 0; // テストでは待たない
        engine.synthStart(v, 280);
        await sleep(600);
        state.cooldownUntil = 0;
        engine.synthEnd();
        await sleep(intervalMs);
      }
      state.cooldownUntil = 0;
      engine.synthBlow(1.0);
      await sleep(intervalMs);
      state.cooldownUntil = 0;
      engine.synthClap(3);
      await sleep(intervalMs);
    },
  };
}
