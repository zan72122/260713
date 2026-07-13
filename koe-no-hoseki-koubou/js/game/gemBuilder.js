// ============================================================
// gemBuilder — レシピ(入力ステップの列)から宝石の3Dモデルを
// 決定論的に組み立てる。同じレシピ → 必ず同じ宝石。
//
// 音と形の対応(config.js の表に対応):
//   あ  → 丸いふくらみ(ピンク・赤・オレンジ)
//   い  → 細く鋭い針結晶(青・水色・銀)
//   う  → ぽってり雫型(紫・藍)
//   え  → 枝分かれ結晶(緑・黄緑)
//   お  → 大きな輪と金の宝玉(金色)
//   高い声 → 上のほうに付く・透明になる
//   低い声 → 下のほうに付く・色が濃い・根が伸びる
//   短い声 → 星の粒が入る
//   長い声 → 層が厚くなる(外側にもう一枚)
//   ふー   → 雪の結晶と白いくもりガラス
//   👏👏   → 2本の光る筋
//   👏👏👏 → 三つ葉の三角もよう
// ============================================================

import * as THREE from '../lib/three.module.min.js';
import { VOWELS } from '../config.js';
import { Rng, hashString } from './rng.js';
import { stepKey } from './recipe.js';

const GOLDEN_ANGLE = 2.399963229728653;

// ---------- 材質 ----------

function gemMaterial(color, opacity = 0.85, emissiveScale = 0.3) {
  return new THREE.MeshPhysicalMaterial({
    color,
    flatShading: true,
    roughness: 0.16,
    metalness: 0.08,
    clearcoat: 0.7,
    clearcoatRoughness: 0.25,
    transparent: true,
    opacity,
    emissive: color.clone().multiplyScalar(emissiveScale),
    envMapIntensity: 1.3,
    depthWrite: true,
  });
}

// 声ステップの色を決める(母音の色相 × ピッチの明暗)
export function colorForStep(step, index) {
  if (step.t === 'b') return new THREE.Color(0xeaf6ff);
  if (step.t === 'c') {
    return step.n >= 3
      ? new THREE.Color().setHSL(0.13, 0.85, 0.62)
      : new THREE.Color().setHSL(0.0, 0.0, 0.85);
  }
  const rng = new Rng(hashString('color:' + stepKey(step, index)));
  const hue = rng.pick(VOWELS[step.v].hues);
  const light = step.p === 'high' ? 0.7 : step.p === 'low' ? 0.38 : 0.55;
  const sat = step.p === 'low' ? 0.85 : 0.75;
  return new THREE.Color().setHSL(hue, sat, light);
}

function opacityForPitch(p) {
  // 高い声ほど透明度が上がる
  return p === 'high' ? 0.6 : p === 'low' ? 0.94 : 0.82;
}

// ---------- 取り付け位置 ----------

function anchorFor(step, index, rng) {
  const angle = index * GOLDEN_ANGLE + rng.float(-0.25, 0.25);
  const p = step.t === 'v' ? step.p : 'mid';
  const ranges = { high: [0.55, 0.95], mid: [0.18, 0.58], low: [-0.06, 0.22] };
  const [h0, h1] = ranges[p];
  const y = rng.float(h0, h1);
  const radial = rng.float(0.22, 0.34);
  const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const pos = dir.clone().multiplyScalar(radial);
  pos.y = y;
  // 外向き+すこし上向きの成長方向
  const out = dir.clone().add(new THREE.Vector3(0, 0.9, 0)).normalize();
  return { pos, dir, out, angle, y };
}

// up ベクトルを dir に向ける回転
function orientTo(obj, dir) {
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.clone().normalize()
  );
  obj.quaternion.copy(q);
}

// ---------- 形の部品 ----------

// あ: 丸いふくらみ
function shapeBulb(g, rng, mat) {
  const n = rng.int(2, 3);
  for (let i = 0; i < n; i++) {
    const r = rng.float(0.14, 0.24);
    const geo = new THREE.IcosahedronGeometry(r, 1);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(rng.float(-0.09, 0.09), rng.float(-0.06, 0.1), rng.float(-0.09, 0.09));
    m.scale.set(1, rng.float(0.9, 1.2), 1);
    m.rotation.y = rng.float(0, Math.PI);
    g.add(m);
  }
}

// い: 細く鋭い針
function shapeNeedle(g, rng, mat, out) {
  const n = rng.int(3, 5);
  for (let i = 0; i < n; i++) {
    const geo = new THREE.OctahedronGeometry(0.065, 0);
    const m = new THREE.Mesh(geo, mat);
    const len = rng.float(3.2, 5.2);
    m.scale.set(0.55, len, 0.55);
    const spread = new THREE.Vector3(
      rng.float(-0.45, 0.45), rng.float(0.55, 1.0), rng.float(-0.45, 0.45)
    ).add(out).normalize();
    orientTo(m, spread);
    m.position.copy(spread).multiplyScalar(0.065 * len * 0.5);
    g.add(m);
  }
}

// う: ぽってり雫型(LatheGeometry)
function shapeDrop(g, rng, mat) {
  const n = rng.int(1, 2);
  for (let i = 0; i < n; i++) {
    const size = rng.float(0.8, 1.15);
    const pts = [];
    const SEG = 10;
    for (let k = 0; k <= SEG; k++) {
      const t = k / SEG;
      // 下がまるく、上がすぼまる雫のプロファイル
      const r = Math.sin(Math.PI * Math.min(1, t * 1.05)) * 0.17 * (1 - t * 0.5) * size;
      pts.push(new THREE.Vector2(Math.max(0.0001, r), t * 0.4 * size));
    }
    pts[0].x = 0.0001;
    const geo = new THREE.LatheGeometry(pts, 12);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.position.set(rng.float(-0.08, 0.08), rng.float(-0.05, 0.02), rng.float(-0.08, 0.08));
    m.rotation.z = rng.float(-0.25, 0.25);
    g.add(m);
  }
}

// え: 枝分かれ結晶(再帰)
function shapeBranch(g, rng, mat) {
  const build = (origin, dir, len, depth) => {
    const radius = 0.02 + depth * 0.012;
    const geo = new THREE.CylinderGeometry(radius * 0.7, radius, len, 6);
    const m = new THREE.Mesh(geo, mat);
    orientTo(m, dir);
    m.position.copy(origin).addScaledVector(dir, len / 2);
    g.add(m);
    const tip = origin.clone().addScaledVector(dir, len);
    // 先端に小さな結晶
    const tipGeo = new THREE.OctahedronGeometry(radius * 2.2, 0);
    const tm = new THREE.Mesh(tipGeo, mat);
    tm.position.copy(tip);
    tm.scale.set(0.7, 1.6, 0.7);
    orientTo(tm, dir);
    g.add(tm);
    if (depth > 0) {
      const kids = 2;
      for (let i = 0; i < kids; i++) {
        const axis = new THREE.Vector3(rng.float(-1, 1), rng.float(-0.2, 0.4), rng.float(-1, 1)).normalize();
        const childDir = dir.clone()
          .applyAxisAngle(axis, rng.float(0.5, 0.9) * rng.sign())
          .normalize();
        if (childDir.y < 0.05) childDir.y = 0.15;
        childDir.normalize();
        build(tip, childDir, len * rng.float(0.55, 0.7), depth - 1);
      }
    }
  };
  build(new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(rng.float(-0.3, 0.3), 1, rng.float(-0.3, 0.3)).normalize(), rng.float(0.2, 0.28), 2);
}

// お: 大きな輪 + 金の宝玉(輪は宝石の軸を中心に)
function shapeRing(g, rng, mat, anchor) {
  const ringR = rng.float(0.42, 0.55);
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(ringR, 0.035, 8, 36),
    mat
  );
  torus.rotation.x = Math.PI / 2;
  torus.rotation.z = rng.float(-0.15, 0.15);
  // 輪は軸中心に置く(グループはアンカーに平行移動されるので打ち消す)
  torus.position.set(-anchor.pos.x, 0, -anchor.pos.z);
  g.add(torus);
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.float(0.11, 0.15), 1), mat);
  orb.position.set(0, rng.float(0.02, 0.1), 0);
  g.add(orb);
}

// ふー: 雪の結晶 + くもりガラスの殻
function shapeFrost(g, rng, mat, out, index) {
  const flake = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.045), mat);
    arm.position.y = 0.14;
    const holder = new THREE.Group();
    holder.add(arm);
    // 枝先の小さな十字
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.09, 0.03), mat);
    tip.position.set(0.03, 0.22, 0);
    tip.rotation.z = -0.9;
    holder.add(tip);
    const tip2 = tip.clone();
    tip2.position.x = -0.03;
    tip2.rotation.z = 0.9;
    holder.add(tip2);
    holder.rotation.z = (i / 6) * Math.PI * 2;
    flake.add(holder);
  }
  const center = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), mat);
  flake.add(center);
  orientTo(flake, out);
  flake.scale.setScalar(rng.float(0.9, 1.25));
  g.add(flake);

  // くもりガラスの殻(核のまわり全体を包む)— グループの平行移動を打ち消して軸中心に
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0,
    transparent: true,
    opacity: 0.16,
    flatShading: true,
    depthWrite: false,
  });
  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.45 + index * 0.02, 1),
    shellMat
  );
  shell.userData.axisCentered = true;
  g.add(shell);
}

// 👏👏: 2本の光る筋(軸中心の細い帯)
function shapeStripes(g, rng, mat, anchor) {
  const ys = [rng.float(0.15, 0.4), rng.float(0.5, 0.8)];
  for (const y of ys) {
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(rng.float(0.4, 0.5), 0.018, 6, 40),
      mat
    );
    band.rotation.x = Math.PI / 2;
    band.position.set(-anchor.pos.x, y - anchor.pos.y, -anchor.pos.z);
    g.add(band);
  }
}

// 👏👏👏: 三つ葉・三角もよう(軸のまわりに 120° ずつ)
function shapeTri(g, rng, mat, anchor) {
  const y = rng.float(0.3, 0.6);
  const r = rng.float(0.32, 0.42);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rng.float(-0.1, 0.1);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.035, 3), mat);
    plate.position.set(
      Math.cos(a) * r - anchor.pos.x,
      y - anchor.pos.y,
      Math.sin(a) * r - anchor.pos.z
    );
    plate.rotation.y = -a;
    plate.rotation.x = rng.float(-0.3, 0.3);
    g.add(plate);
  }
  // まんなかに小さな三角リング
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.75, 0.02, 6, 3), mat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(-anchor.pos.x, y - anchor.pos.y, -anchor.pos.z);
  g.add(ring);
}

// 星の粒(短い声のおまけ)
function addStars(g, rng, color) {
  const mat = new THREE.MeshBasicMaterial({
    color: color.clone().lerp(new THREE.Color(0xffffff), 0.55),
    transparent: true,
    opacity: 0.95,
  });
  const n = rng.int(4, 7);
  for (let i = 0; i < n; i++) {
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.028, 0), mat);
    s.position.set(rng.float(-0.28, 0.28), rng.float(-0.1, 0.34), rng.float(-0.28, 0.28));
    s.scale.y = 1.7;
    g.add(s);
  }
}

// 根(低い声のおまけ)— 台座へ向かって下に伸びる
function addRoots(g, rng, color, anchor) {
  const mat = gemMaterial(color.clone().multiplyScalar(0.55), 0.95, 0.15);
  const n = rng.int(2, 3);
  for (let i = 0; i < n; i++) {
    const geo = new THREE.OctahedronGeometry(0.05, 0);
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(0.5, rng.float(2.2, 3.4), 0.5);
    const dir = new THREE.Vector3(rng.float(-0.4, 0.4), -1, rng.float(-0.4, 0.4)).normalize();
    orientTo(m, dir);
    m.position.copy(dir).multiplyScalar(0.12);
    m.position.y -= anchor.y * 0.5;
    g.add(m);
  }
}

// 長い声: 外側にもう一枚、うすい層を重ねる
function addOuterLayer(g) {
  const shell = new THREE.Group();
  g.traverse((o) => {
    if (o.isMesh && !o.userData.axisCentered) {
      const mat = o.material.clone();
      mat.transparent = true;
      mat.opacity = 0.18;
      mat.depthWrite = false;
      const copy = new THREE.Mesh(o.geometry, mat);
      o.updateMatrix();
      copy.applyMatrix4(o.matrix);
      copy.scale.multiplyScalar(1.26);
      shell.add(copy);
    }
  });
  g.add(shell);
}

// ---------- ステップ 1 つ分の組み立て ----------

export function buildStepGroup(step, index) {
  const key = stepKey(step, index);
  const rng = new Rng(hashString('step:' + key));
  const g = new THREE.Group();
  const anchor = anchorFor(step, index, rng);
  const color = colorForStep(step, index);

  if (step.t === 'v') {
    const mat = gemMaterial(color, opacityForPitch(step.p));
    const scale = step.d === 'long' ? 1.3 : step.d === 'short' ? 0.72 : 1.0;
    switch (VOWELS[step.v].shape) {
      case 'bulb': shapeBulb(g, rng, mat); break;
      case 'needle': shapeNeedle(g, rng, mat, anchor.out); break;
      case 'drop': shapeDrop(g, rng, mat); break;
      case 'branch': shapeBranch(g, rng, mat); break;
      case 'ring': shapeRing(g, rng, mat, anchor); break;
    }
    g.scale.setScalar(scale);
    if (step.d === 'long') addOuterLayer(g);
    if (step.d === 'short') addStars(g, rng, color);
    if (step.p === 'low') addRoots(g, rng, color, anchor);
  } else if (step.t === 'b') {
    const mat = gemMaterial(color, 0.8, 0.35);
    shapeFrost(g, rng, mat, anchor.out, index);
    if (step.d === 'long') g.scale.setScalar(1.2);
  } else {
    const mat = gemMaterial(color, 0.9, 0.8); // 手拍子もようは強く光る
    if (step.n >= 3) shapeTri(g, rng, mat, anchor);
    else shapeStripes(g, rng, mat, anchor);
  }

  g.position.copy(anchor.pos);
  g.userData = { key, color, anchorY: anchor.y, step, index };
  return g;
}

// ---------- 核(たね)の結晶 ----------

export function buildSeedCrystal() {
  const g = new THREE.Group();
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xdfe8ff,
    flatShading: true,
    roughness: 0.1,
    metalness: 0.05,
    clearcoat: 0.8,
    transparent: true,
    opacity: 0.9,
    emissive: 0x2a3560,
    envMapIntensity: 1.4,
  });
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.5, 6), mat);
  core.position.y = 0.25;
  g.add(core);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.16, 0.2, 6), mat);
  tip.position.y = 0.6;
  g.add(tip);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.6;
    const small = new THREE.Mesh(new THREE.CylinderGeometry(0, 0.07, 0.22, 5), mat);
    small.position.set(Math.cos(a) * 0.2, 0.08, Math.sin(a) * 0.2);
    small.rotation.z = Math.cos(a) * 0.5;
    small.rotation.x = -Math.sin(a) * 0.5;
    g.add(small);
  }
  g.userData.isSeed = true;
  return g;
}

// ---------- 宝石全体 ----------

export function buildGem(recipe) {
  const gem = new THREE.Group();
  gem.add(buildSeedCrystal());
  const colors = [];
  recipe.steps.forEach((step, i) => {
    const sg = buildStepGroup(step, i);
    gem.add(sg);
    if (step.t === 'v') colors.push(sg.userData.color);
  });
  const avg = new THREE.Color(0x8899ff);
  if (colors.length) {
    avg.setRGB(0, 0, 0);
    for (const c of colors) avg.add(c);
    avg.multiplyScalar(1 / colors.length);
  }
  gem.userData.avgColor = avg;
  return gem;
}

// ---------- ゴースト(声を出している間のプレビュー) ----------

export function buildGhostStep(step, index) {
  const g = buildStepGroup(step, index);
  const ghostColor = colorForStep(step, index).lerp(new THREE.Color(0xffffff), 0.3);
  g.traverse((o) => {
    if (o.isMesh) {
      o.material = new THREE.MeshBasicMaterial({
        color: ghostColor,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
    }
  });
  return g;
}

// ---------- 後片付け ----------

export function disposeGroup(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material?.dispose();
    }
  });
}
