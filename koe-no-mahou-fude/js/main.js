/**
 * main.js — こえの魔法筆 エントリーポイント。
 * タイトル → マイク準備 → せかいえらび → ゲーム → おいわい → …
 */
import { VoiceAnalyzer } from './voice/analyzer.js';
import { SoundFX } from './voice/soundfx.js';
import { Game } from './game/game.js';
import { UI } from './game/ui.js';
import { WORLDS } from './game/worlds.js';

const SAVE_KEY = 'koe-mahou-fude-cleared';

const ui = new UI();
const voice = new VoiceAnalyzer();
let sfx = null;
let game = null;
let audioCtx = null;
let muted = false;
let currentWorld = 0;

function clearedIds() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || '[]'); } catch { return []; }
}
function markCleared(id) {
  const ids = clearedIds();
  if (!ids.includes(id)) {
    ids.push(id);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(ids)); } catch { /* プライベートモード等 */ }
  }
}

/* ---------------- はじめる ---------------- */
document.getElementById('btn-start').addEventListener('click', async () => {
  // iOSはユーザー操作の中で AudioContext を作る必要がある
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sfx = new SoundFX(audioCtx);
  }
  await audioCtx.resume();
  sfx.tap();

  ui.show('mic');
  const ok = await voice.init(audioCtx);
  if (!ok) {
    ui.toast('🎤 マイクが つかえないので「あいうえお」ボタンで あそべるよ');
  }

  if (!game) {
    game = new Game(document.getElementById('stage'), voice, sfx);
    wireGame();
    window.__kmf = { game, voice, sfx }; // デバッグ用フック
  }
  sfx.whoosh();
  ui.buildWorldGrid(clearedIds());
  ui.show('select');
});

/* ---------------- 配線 ---------------- */
function wireGame() {
  game.onProgress = (p) => ui.setProgress(p);

  game.onObjectDone = (count) => {
    ui.starPulse();
    if (count % 6 === 0) ui.praise();
  };

  game.onWorldComplete = () => {
    markCleared(WORLDS[currentWorld].id);
    ui.stopHints();
    ui.celebrate(WORLDS[currentWorld].name);
  };

  ui.onSelectWorld = (i) => {
    currentWorld = i;
    sfx.whoosh();
    game.loadWorld(i);
    ui.setProgress(0);
    ui.show('game');
    ui.startHints(game.worldDef.fairyMsg);
  };

  ui.onVowelHold = (vowel, pitch) => {
    voice.setSimulatedVoice(vowel, pitch);
  };

  ui.onMuteToggle = () => {
    muted = !muted;
    sfx.setMuted(muted);
    ui.setMuted(muted);
    if (!muted) sfx.tap();
  };

  ui.onBack = () => {
    sfx.tap();
    ui.stopHints();
    game.stop();
    ui.buildWorldGrid(clearedIds());
    ui.show('select');
  };

  ui.onNext = () => {
    sfx.tap();
    ui.buildWorldGrid(clearedIds());
    ui.show('select');
  };

  document.getElementById('btn-title').addEventListener('click', () => {
    sfx.tap();
    ui.show('title');
  });

  // マイクの状態・母音の見える化（100msごと）
  setInterval(() => {
    if (!ui.isShown('game')) return;
    const s = voice.state;
    ui.setMicState(s.active, s.level);
    ui.flashVowel(s.active && !s.breathy ? s.vowel : null);
  }, 100);
}

/* ---------------- こまごま ---------------- */
// ダブルタップ拡大などを止める
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
let lastTouch = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouch < 350) e.preventDefault();
  lastTouch = now;
}, { passive: false });

// バックグラウンドで音を止める
document.addEventListener('visibilitychange', () => {
  if (!audioCtx) return;
  if (document.hidden) audioCtx.suspend();
  else audioCtx.resume();
});

// WebGLが使えない端末
try {
  const test = document.createElement('canvas');
  if (!test.getContext('webgl2') && !test.getContext('webgl')) {
    ui.toast('この たんまつでは 3Dが つかえません');
  }
} catch { /* ignore */ }
