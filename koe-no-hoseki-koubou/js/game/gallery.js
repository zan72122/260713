// ============================================================
// ギャラリー — できあがった宝石のコレクション(localStorage)
// レシピ(=入力の列)ごと保存するので、いつでも同じ宝石を
// 3D で組み立て直せる。
// ============================================================

import * as THREE from '../lib/three.module.min.js';
import { STORAGE_KEYS, GALLERY_MAX, VOWELS } from '../config.js';
import { buildGem } from './gemBuilder.js';

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* プライベートモード等では保存できない */ }
  return fallback;
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

export function loadGallery() {
  const items = readJson(STORAGE_KEYS.gallery, []);
  return Array.isArray(items) ? items : [];
}

export function saveToGallery(item) {
  const items = loadGallery();
  items.unshift(item);
  while (items.length > GALLERY_MAX) items.pop();
  // 容量オーバーならサムネイルを間引いて再挑戦
  if (!writeJson(STORAGE_KEYS.gallery, items)) {
    for (const it of items.slice(8)) delete it.thumb;
    writeJson(STORAGE_KEYS.gallery, items);
  }
  return items;
}

export function clearGallery() {
  try { localStorage.removeItem(STORAGE_KEYS.gallery); } catch (_) { /* noop */ }
}

export function saveCurrentRecipe(recipe) {
  writeJson(STORAGE_KEYS.current, recipe);
}
export function loadCurrentRecipe() {
  const r = readJson(STORAGE_KEYS.current, null);
  return r && Array.isArray(r.steps) ? r : null;
}
export function clearCurrentRecipe() {
  try { localStorage.removeItem(STORAGE_KEYS.current); } catch (_) { /* noop */ }
}

export function loadSettings() {
  return readJson(STORAGE_KEYS.settings, { muted: false, speech: true });
}
export function saveSettings(s) {
  writeJson(STORAGE_KEYS.settings, s);
}

// ---- 宝石のなまえを自動でつける ----
const COLOR_WORDS = { a: 'もも', i: 'そら', u: 'ぶどう', e: 'わかば', o: 'こがね' };
const SUFFIXES = ['のたま', 'のほし', 'のはな', 'のひかり', 'のしずく', 'のつぼみ'];

export function nameGem(recipe) {
  const counts = { a: 0, i: 0, u: 0, e: 0, o: 0 };
  let hash = 0;
  for (const s of recipe.steps) {
    if (s.t === 'v') counts[s.v]++;
    hash = (hash * 31 + (s.t === 'v' ? s.v.charCodeAt(0) : s.t.charCodeAt(0))) | 0;
  }
  let top = 'a';
  let best = -1;
  for (const k in counts) {
    if (counts[k] > best) { best = counts[k]; top = k; }
  }
  const suffix = SUFFIXES[Math.abs(hash) % SUFFIXES.length];
  return `${COLOR_WORDS[top]}いろ${suffix}`;
}

// レシピの入力列を絵文字の並びにする(ギャラリー表示用)
export function recipeEmojis(recipe) {
  return recipe.steps.map((s) => {
    if (s.t === 'v') return VOWELS[s.v].label;
    if (s.t === 'b') return '🌬';
    return '👏' + s.n;
  });
}

// ---- サムネイル描画(メインの renderer を借りて RT に描く) ----
export function renderThumbnail(renderer, recipe, envTexture, size = 160) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x181430);
  if (envTexture) scene.environment = envTexture;

  const gem = buildGem(recipe);
  gem.position.y = -0.55;
  scene.add(gem);

  scene.add(new THREE.HemisphereLight(0x8899ff, 0x221133, 1.2));
  const pt = new THREE.PointLight(0xffffff, 2.2, 10);
  pt.position.set(1.5, 1.5, 2);
  scene.add(pt);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
  camera.position.set(0, 0.35, 2.6);
  camera.lookAt(0, 0, 0);

  const rt = new THREE.WebGLRenderTarget(size, size);
  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  const pixels = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels);
  renderer.setRenderTarget(prevTarget);
  rt.dispose();

  // WebGL は上下反転しているので直しつつ 2D キャンバスへ
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4;
    img.data.set(pixels.subarray(src, src + size * 4), y * size * 4);
  }
  ctx.putImageData(img, 0, 0);

  // 後片付け
  gem.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material?.dispose();
    }
  });

  return cv.toDataURL('image/jpeg', 0.82);
}
