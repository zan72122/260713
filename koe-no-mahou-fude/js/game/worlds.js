/**
 * worlds.js — 6つのモノクロ世界をプリミティブから手づくりする。
 *
 * 各メッシュは userData.paintable = true で「塗れる」対象になる。
 * userData.anim = {...} を持つオブジェクトは、色がつくと元気に動き出す。
 */
import * as THREE from 'three';

let _gradientMap = null;
function gradientMap() {
  if (_gradientMap) return _gradientMap;
  const data = new Uint8Array([80, 170, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  _gradientMap = tex;
  return tex;
}

function M(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...opts });
}

/** 塗れるメッシュにする */
function P(mesh, anim = null) {
  mesh.userData.paintable = true;
  if (anim) mesh.userData.anim = anim;
  return mesh;
}

/** グループ全体にアニメを付ける（進行度は子の塗り具合から） */
function A(obj, anim) {
  obj.userData.anim = anim;
  return obj;
}

export const WORLDS = [
  { id: 'garden', name: 'おはなの にわ', icon: '🌷', build: buildGarden },
  { id: 'aquarium', name: 'うみの すいそう', icon: '🐠', build: buildAquarium },
  { id: 'forest', name: 'もりの おく', icon: '🍄', build: buildForest },
  { id: 'castle', name: 'そらの おしろ', icon: '🏰', build: buildCastle },
  { id: 'town', name: 'ことりの まち', icon: '🏘️', build: buildTown },
  { id: 'room', name: 'おもちゃの へや', icon: '🧸', build: buildRoom },
];

/* ======================================================
 * 部品
 * ====================================================== */

function ground(radius, color) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), M(color));
  m.rotation.x = -Math.PI / 2;
  return P(m);
}

function tree(scale = 1, leafColor = '#57c161', trunkColor = '#9a6a43') {
  const g = new THREE.Group();
  const trunk = P(new THREE.Mesh(new THREE.CylinderGeometry(0.16 * scale, 0.24 * scale, 1.2 * scale, 8), M(trunkColor)));
  trunk.position.y = 0.6 * scale;
  g.add(trunk);
  const tones = [leafColor, shade(leafColor, 1.15), shade(leafColor, 0.85)];
  for (let i = 0; i < 3; i++) {
    const s = (1 - i * 0.24) * 0.75 * scale;
    const leaf = P(new THREE.Mesh(new THREE.SphereGeometry(s, 14, 12), M(tones[i])));
    leaf.position.set((i % 2 ? 0.18 : -0.14) * scale, (1.15 + i * 0.5) * scale, 0);
    g.add(leaf);
  }
  return A(g, { type: 'sway', speed: 1.2, amp: 0.05 });
}

function flower(color) {
  const g = new THREE.Group();
  const stem = P(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.6, 6), M('#6cbf5a')));
  stem.position.y = 0.3;
  g.add(stem);
  const core = P(new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), M('#ffd95e')));
  core.position.y = 0.66;
  g.add(core);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const petal = P(new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), M(color)));
    petal.scale.set(1, 0.5, 0.7);
    petal.position.set(Math.cos(a) * 0.19, 0.66, Math.sin(a) * 0.19);
    petal.rotation.y = -a;
    g.add(petal);
  }
  return A(g, { type: 'sway', speed: 2.2, amp: 0.12 });
}

function cloud(scale = 1) {
  const g = new THREE.Group();
  const col = '#ffffff';
  [[0, 0, 0, 0.62], [0.6, -0.06, 0.1, 0.45], [-0.62, -0.08, -0.05, 0.5], [0.15, 0.3, 0, 0.42]].forEach(([x, y, z, r]) => {
    const s = P(new THREE.Mesh(new THREE.SphereGeometry(r * scale, 12, 10), M(col)));
    s.position.set(x * scale, y * scale, z * scale);
    g.add(s);
  });
  return A(g, { type: 'drift', speed: 0.25, amp: 1.6 });
}

function sun() {
  const g = new THREE.Group();
  const core = P(new THREE.Mesh(new THREE.SphereGeometry(0.9, 18, 14), M('#ffd23e', { emissive: '#ff9d00', emissiveIntensity: 0.35 })));
  g.add(core);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const ray = P(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.6, 6), M('#ffb52e')));
    ray.position.set(Math.cos(a) * 1.35, Math.sin(a) * 1.35, 0);
    ray.rotation.z = a - Math.PI / 2;
    g.add(ray);
  }
  return A(g, { type: 'spin', speed: 0.3, amp: 1 });
}

function butterfly(color = '#ff8ac2') {
  const g = new THREE.Group();
  const body = P(new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.25, 4, 6), M('#5d4a66')));
  g.add(body);
  const wingGeo = new THREE.SphereGeometry(0.2, 8, 6);
  const wl = P(new THREE.Mesh(wingGeo, M(color)));
  wl.scale.set(1.3, 0.15, 0.9);
  wl.position.x = -0.22;
  const wr = wl.clone();
  wr.material = wl.material;
  P(wr);
  wr.position.x = 0.22;
  g.add(wl, wr);
  g.userData.wings = [wl, wr];
  return A(g, { type: 'flutter', speed: 1.6, amp: 1.4 });
}

function bird(color = '#ffb03a') {
  const g = new THREE.Group();
  const body = P(new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), M(color)));
  body.scale.set(1.15, 1, 1);
  g.add(body);
  const head = P(new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), M(shade(color, 1.1))));
  head.position.set(0.28, 0.22, 0);
  g.add(head);
  const beak = P(new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 6), M('#ff7043')));
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.48, 0.2, 0);
  g.add(beak);
  const wing = P(new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), M(shade(color, 0.85))));
  wing.scale.set(1.4, 0.4, 1);
  wing.position.set(-0.05, 0.14, 0.18);
  g.add(wing);
  return A(g, { type: 'hop', speed: 3, amp: 0.14 });
}

function fish(color = '#ff8a50', scale = 1) {
  const g = new THREE.Group();
  const body = P(new THREE.Mesh(new THREE.SphereGeometry(0.4 * scale, 12, 10), M(color)));
  body.scale.set(1.5, 1, 0.7);
  g.add(body);
  const tail = P(new THREE.Mesh(new THREE.ConeGeometry(0.28 * scale, 0.5 * scale, 4), M(shade(color, 0.85))));
  tail.rotation.z = Math.PI / 2;
  tail.scale.z = 0.4;
  tail.position.x = -0.72 * scale;
  g.add(tail);
  const eye = P(new THREE.Mesh(new THREE.SphereGeometry(0.07 * scale, 8, 6), M('#333344')));
  eye.position.set(0.4 * scale, 0.1 * scale, 0.25 * scale);
  g.add(eye);
  return g; // アニメは呼び出し側で（泳ぐ半径が違う）
}

function house(w, h, bodyColor, roofColor) {
  const g = new THREE.Group();
  const body = P(new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.9), M(bodyColor)));
  body.position.y = h / 2;
  g.add(body);
  const roof = P(new THREE.Mesh(new THREE.ConeGeometry(w * 0.85, h * 0.7, 4), M(roofColor)));
  roof.position.y = h + h * 0.34;
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  const door = P(new THREE.Mesh(new THREE.BoxGeometry(w * 0.28, h * 0.5, 0.06), M('#8a5a35')));
  door.position.set(0, h * 0.25, w * 0.45 + 0.03);
  g.add(door);
  const win = P(new THREE.Mesh(new THREE.BoxGeometry(w * 0.24, w * 0.24, 0.06), M('#ffe9a3', { emissive: '#ffca4a', emissiveIntensity: 0.25 })));
  win.position.set(w * 0.26, h * 0.62, w * 0.45 + 0.03);
  g.add(win);
  return g;
}

function mushroom(capColor = '#ff5d5d', scale = 1) {
  const g = new THREE.Group();
  const stem = P(new THREE.Mesh(new THREE.CylinderGeometry(0.12 * scale, 0.17 * scale, 0.4 * scale, 8), M('#fff3e0')));
  stem.position.y = 0.2 * scale;
  g.add(stem);
  const cap = P(new THREE.Mesh(new THREE.SphereGeometry(0.32 * scale, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M(capColor)));
  cap.position.y = 0.38 * scale;
  cap.scale.y = 0.8;
  g.add(cap);
  for (let i = 0; i < 3; i++) {
    const dot = P(new THREE.Mesh(new THREE.SphereGeometry(0.05 * scale, 6, 5), M('#ffffff')));
    const a = i * 2.1 + 0.5;
    dot.position.set(Math.cos(a) * 0.18 * scale, (0.5 + (i % 2) * 0.08) * scale, Math.sin(a) * 0.18 * scale);
    g.add(dot);
  }
  return A(g, { type: 'boing', speed: 2.5, amp: 0.08 });
}

function star3d(color = '#ffd95e', scale = 1) {
  const shape = new THREE.Shape();
  const R = 0.4 * scale, r = 0.17 * scale;
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    if (i === 0) shape.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
    else shape.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12 * scale, bevelEnabled: false });
  const m = P(new THREE.Mesh(geo, M(color, { emissive: color, emissiveIntensity: 0.2 })));
  return A(m, { type: 'spin', speed: 0.8, amp: 1 });
}

function shade(hex, mult) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(mult);
  return `#${c.getHexString()}`;
}

function place(obj, x, z, ry = 0, y = 0) {
  obj.position.set(x, y, z);
  obj.rotation.y = ry;
  return obj;
}

/* ======================================================
 * 1. おはなの にわ
 * ====================================================== */
function buildGarden() {
  const g = new THREE.Group();
  g.add(ground(16, '#8fd06e'));

  const flowerColors = ['#ff6d8d', '#ffa22e', '#ba7bff', '#57b8ff', '#ff5d5d', '#ff9db4'];
  const spots = [[-3, 2], [-1.6, 3.4], [0.4, 2.6], [2.2, 3.2], [3.6, 1.8], [-4.2, 0.2], [4.4, -0.4], [-2.6, -1.2], [1.4, -1.6], [3, -2.6], [-1, -3], [-4, -3], [0.2, 4.4], [-5.2, 2.8], [5.2, 2.4]];
  spots.forEach(([x, z], i) => g.add(place(flower(flowerColors[i % flowerColors.length]), x, z, Math.random() * 6)));

  g.add(place(tree(1.5, '#57c161'), -6.5, -2));
  g.add(place(tree(1.1, '#7ed957'), 6.3, -3.5));
  g.add(place(tree(0.9, '#4db07f'), 5.8, 3.8));

  // いけ
  const pond = P(new THREE.Mesh(new THREE.CircleGeometry(2.2, 26), M('#6cc7e8')));
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(-2.8, 0.02, -4.2);
  g.add(pond);

  // フェンス
  for (let i = 0; i < 7; i++) {
    const p = P(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.14), M('#e8e0d0')));
    p.position.set(-7 + i * 0.9, 0.45, 6.2);
    g.add(p);
  }

  g.add(place(butterfly('#ff8ac2'), -1, 0.8, 0, 1.6));
  g.add(place(butterfly('#8ad0ff'), 2.5, -0.5, 0, 2.0));
  g.add(place(bird('#ffb03a'), 4.2, 0.8, -0.6, 0));

  const s = sun(); s.position.set(-6, 8.5, -8); g.add(s);
  const c1 = cloud(1.4); c1.position.set(5, 8, -9); g.add(c1);
  const c2 = cloud(1); c2.position.set(-1, 9.4, -10); g.add(c2);

  return {
    group: g,
    sky: { gray: '#8e8e96', colored: '#8fd7ff' },
    camera: { target: new THREE.Vector3(0, 1.6, 0), dist: 13, height: 6.5, fitRadius: 9 },
    fairyMsg: 'おはなに こえを かけてみて！',
  };
}

/* ======================================================
 * 2. うみの すいそう
 * ====================================================== */
function buildAquarium() {
  const g = new THREE.Group();
  const sand = P(new THREE.Mesh(new THREE.CircleGeometry(16, 40), M('#f2d9a0')));
  sand.rotation.x = -Math.PI / 2;
  g.add(sand);

  // さかなたち（泳ぐ）
  const fishes = [
    ['#ff8a50', 1.2, 3.2, 2.2, 1], ['#ffd23e', 0.9, 4.5, 3.4, -1], ['#57b8ff', 1.0, 2.4, 1.5, 1],
    ['#ff6d8d', 0.8, 5.5, 4.2, -1], ['#5ed67d', 0.7, 3.6, 2.8, 1], ['#a06dff', 1.1, 4.8, 1.9, -1],
  ];
  fishes.forEach(([col, sc, rad, y, dir], i) => {
    const f = fish(col, sc);
    A(f, { type: 'swim', speed: 0.4 + Math.random() * 0.3, amp: rad, dir, phase: i * 1.3, baseY: y });
    g.add(f);
  });

  // かいそう
  const weedSpots = [[-4, -2], [-3.2, -2.6], [4, -1], [4.6, -1.8], [0.5, -4], [-5.5, 1], [5.5, 2]];
  weedSpots.forEach(([x, z], i) => {
    const w = new THREE.Group();
    for (let s = 0; s < 3; s++) {
      const blade = P(new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 1.4 + s * 0.5, 4, 6), M(s % 2 ? '#3cb864' : '#5ed67d')));
      blade.position.set((s - 1) * 0.28, (1.4 + s * 0.5) / 2 + 0.1, 0);
      blade.rotation.z = (s - 1) * 0.18;
      w.add(blade);
    }
    A(w, { type: 'sway', speed: 1.4, amp: 0.14, phase: i });
    g.add(place(w, x, z));
  });

  // たからばこ
  const chest = new THREE.Group();
  const base = P(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 1), M('#a3703f')));
  base.position.y = 0.4;
  const lid = P(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 12, 1, false, 0, Math.PI), M('#8a5a35')));
  lid.rotation.z = Math.PI / 2;
  lid.position.y = 0.8;
  const jewel = P(new THREE.Mesh(new THREE.OctahedronGeometry(0.22), M('#ff5da2', { emissive: '#ff5da2', emissiveIntensity: 0.3 })));
  jewel.position.y = 1.0;
  chest.add(base, lid, jewel);
  A(chest, { type: 'boing', speed: 2, amp: 0.05 });
  g.add(place(chest, 2.8, -3.4, -0.5));

  // ヒトデ・かい・いわ
  const starfish = star3d('#ff8a50', 1);
  starfish.rotation.x = -Math.PI / 2;
  starfish.position.set(-2, 0.08, -4.5);
  g.add(starfish);
  [[-5, -4, '#b8b2c8'], [5.8, -3.5, '#c8beb2'], [-6.2, 2.5, '#a8b8c0']].forEach(([x, z, col]) => {
    const rock = P(new THREE.Mesh(new THREE.DodecahedronGeometry(0.7), M(col)));
    rock.position.set(x, 0.4, z);
    rock.scale.y = 0.65;
    g.add(rock);
  });

  // くらげ
  for (let i = 0; i < 3; i++) {
    const jelly = new THREE.Group();
    const dome = P(new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M('#ffb3d9', { transparent: true, opacity: 0.85 })));
    jelly.add(dome);
    for (let t = 0; t < 4; t++) {
      const tent = P(new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.6, 3, 5), M('#ff8ac2')));
      tent.position.set((t - 1.5) * 0.18, -0.35, 0);
      jelly.add(tent);
    }
    A(jelly, { type: 'jelly', speed: 1 + i * 0.3, amp: 0.5, baseY: 3 + i * 1.2, phase: i * 2 });
    g.add(place(jelly, -3 + i * 2.4, 1 - i, 0, 3 + i * 1.2));
  }

  return {
    group: g,
    sky: { gray: '#7d7d88', colored: '#2e7fc4' },
    camera: { target: new THREE.Vector3(0, 2.4, 0), dist: 13.5, height: 4.5, fitRadius: 9 },
    fairyMsg: '「うーー」で あわが でるよ！',
    underwater: true,
  };
}

/* ======================================================
 * 3. もりの おく
 * ====================================================== */
function buildForest() {
  const g = new THREE.Group();
  g.add(ground(17, '#7cae62'));

  const treeSpots = [[-6, -4, 1.9], [-4.5, 1, 1.4], [-7, 2.5, 1.6], [6, -3, 1.8], [4.8, 1.5, 1.3], [7, 3, 1.5], [-2, -6, 1.5], [2.5, -5.5, 1.7], [0, 6, 1.4], [-4.5, 5, 1.2], [4, 5.5, 1.3]];
  const leafCols = ['#4db07f', '#57c161', '#7ed957', '#3f9d6b'];
  treeSpots.forEach(([x, z, s], i) => g.add(place(tree(s, leafCols[i % leafCols.length]), x, z, Math.random() * 6)));

  const mushSpots = [[-2.5, 0.5, '#ff5d5d', 1.2], [-1.8, 1.3, '#ffa22e', 0.8], [1.5, 0.2, '#ba7bff', 1], [2.4, 1.5, '#ff5d5d', 0.7], [0, -2, '#57b8ff', 0.9], [-3.5, -2.5, '#ff8a50', 1.1]];
  mushSpots.forEach(([x, z, c, s]) => g.add(place(mushroom(c, s), x, z, Math.random() * 6)));

  // うさぎ
  const bunny = new THREE.Group();
  const bb = P(new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), M('#f5efe8')));
  bb.position.y = 0.4; bb.scale.set(1, 1.1, 1.3);
  const bh = P(new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), M('#fbf7f2')));
  bh.position.set(0, 0.95, 0.3);
  bunny.add(bb, bh);
  for (let e = 0; e < 2; e++) {
    const ear = P(new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.4, 3, 6), M('#ffd0dd')));
    ear.position.set(e ? 0.12 : -0.12, 1.35, 0.25);
    ear.rotation.z = e ? -0.15 : 0.15;
    bunny.add(ear);
  }
  const tail = P(new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), M('#ffffff')));
  tail.position.set(0, 0.45, -0.5);
  bunny.add(tail);
  A(bunny, { type: 'hop', speed: 2.4, amp: 0.35 });
  g.add(place(bunny, 0.5, 3, 2.8));

  // ふくろう
  const owl = new THREE.Group();
  const ob = P(new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), M('#b08556')));
  ob.scale.set(1, 1.25, 1);
  const belly = P(new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), M('#f0dbb8')));
  belly.position.set(0, -0.05, 0.2);
  belly.scale.set(1, 1.2, 0.7);
  owl.add(ob, belly);
  for (let e = 0; e < 2; e++) {
    const eye = P(new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), M('#fff8e8')));
    eye.position.set(e ? 0.13 : -0.13, 0.28, 0.26);
    owl.add(eye);
    const pupil = P(new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), M('#40342c')));
    pupil.position.set(e ? 0.13 : -0.13, 0.28, 0.35);
    owl.add(pupil);
  }
  A(owl, { type: 'tilt', speed: 1.2, amp: 0.22 });
  owl.position.set(-6, 3.6, -3.9);
  g.add(owl);

  // こかげの光る石
  [[3.8, -2, '#8ad0ff'], [-1.2, -3.8, '#ffb3d9'], [5.5, 3.8, '#c9a8ff']].forEach(([x, z, c]) => {
    const gem = P(new THREE.Mesh(new THREE.IcosahedronGeometry(0.3), M(c, { emissive: c, emissiveIntensity: 0.35 })));
    gem.position.set(x, 0.25, z);
    g.add(A(gem, { type: 'boing', speed: 1.6, amp: 0.12 }));
  });

  const c1 = cloud(1.2); c1.position.set(0, 9, -9); g.add(c1);

  return {
    group: g,
    sky: { gray: '#84848c', colored: '#a8e6a0' },
    camera: { target: new THREE.Vector3(0, 1.8, 0), dist: 14, height: 6.5, fitRadius: 10 },
    fairyMsg: '「えーー」で ツタが のびるよ！',
  };
}

/* ======================================================
 * 4. そらの おしろ
 * ====================================================== */
function buildCastle() {
  const g = new THREE.Group();
  // 浮島
  const isle = P(new THREE.Mesh(new THREE.CylinderGeometry(8, 5.5, 2.4, 24), M('#9dd97e')));
  isle.position.y = -1.2;
  g.add(isle);

  const towerCols = ['#f2e8f7', '#ffe9f0', '#e8f4ff'];
  const roofCols = ['#ff6d8d', '#57b8ff', '#a06dff', '#ffc247'];
  const towerAt = (x, z, h, r, i) => {
    const t = new THREE.Group();
    const body = P(new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, h, 14), M(towerCols[i % towerCols.length])));
    body.position.y = h / 2;
    t.add(body);
    const roof = P(new THREE.Mesh(new THREE.ConeGeometry(r * 1.35, h * 0.55, 14), M(roofCols[i % roofCols.length])));
    roof.position.y = h + h * 0.27;
    t.add(roof);
    // はた
    const pole = P(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 5), M('#c8b8a0')));
    pole.position.y = h + h * 0.55 + 0.35;
    t.add(pole);
    const flag = P(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.04), M(roofCols[(i + 1) % roofCols.length])));
    flag.position.set(0.3, h + h * 0.55 + 0.55, 0);
    t.add(A(flag, { type: 'wave', speed: 5, amp: 0.2 }));
    const win = P(new THREE.Mesh(new THREE.SphereGeometry(r * 0.3, 8, 6), M('#ffe9a3', { emissive: '#ffca4a', emissiveIntensity: 0.3 })));
    win.position.set(0, h * 0.7, r * 0.95);
    t.add(win);
    t.position.set(x, 0, z);
    return t;
  };

  g.add(towerAt(0, -1, 4.6, 1.1, 0));
  g.add(towerAt(-2.6, 0.5, 3.2, 0.8, 1));
  g.add(towerAt(2.6, 0.5, 3.4, 0.85, 2));
  g.add(towerAt(-1.5, 2.2, 2.4, 0.65, 3));
  g.add(towerAt(1.5, 2.2, 2.5, 0.7, 0));

  // もん
  const gate = P(new THREE.Mesh(new THREE.BoxGeometry(1.6, 2, 0.5), M('#e8dff0')));
  gate.position.set(0, 1, 3.4);
  g.add(gate);
  const arch = P(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.52, 14, 1, false, 0, Math.PI), M('#8a5a35')));
  arch.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  arch.position.set(0, 1.0, 3.42);
  g.add(arch);

  // にじの橋（半トーラス）
  const bridgeCols = ['#ff6d8d', '#ffc247', '#5ed67d', '#57b8ff', '#a06dff'];
  bridgeCols.forEach((col, i) => {
    const tor = P(new THREE.Mesh(new THREE.TorusGeometry(3.4 + i * 0.22, 0.1, 8, 40, Math.PI), M(col)));
    tor.position.set(0, 0, 5.4);
    g.add(tor);
  });

  // まわりの星と雲
  const starPos = [[-5, 5, -3], [5.5, 6, -2], [-6, 3, 2], [6.5, 3.5, 3], [0, 8, -5]];
  starPos.forEach(([x, y, z], i) => {
    const st = star3d(['#ffd95e', '#8ad0ff', '#ffb3d9'][i % 3], 1.2);
    st.position.set(x, y, z);
    g.add(st);
  });
  const c1 = cloud(1.3); c1.position.set(-7, 0.5, 4); g.add(c1);
  const c2 = cloud(1); c2.position.set(7.5, 1.5, 2); g.add(c2);
  const moon = P(new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 12), M('#fff3c0', { emissive: '#ffe27a', emissiveIntensity: 0.3 })));
  moon.position.set(6.5, 8.5, -6);
  g.add(A(moon, { type: 'boing', speed: 0.8, amp: 0.1 }));

  return {
    group: g,
    sky: { gray: '#6f6f7c', colored: '#7f9fe8' },
    camera: { target: new THREE.Vector3(0, 2.4, 0), dist: 15, height: 5.5, fitRadius: 10.5 },
    fairyMsg: '「おーー」で きんの わっか！',
  };
}

/* ======================================================
 * 5. ことりの まち
 * ====================================================== */
function buildTown() {
  const g = new THREE.Group();
  g.add(ground(17, '#b8d998'));

  // どうろ
  const road = P(new THREE.Mesh(new THREE.PlaneGeometry(26, 3), M('#9a9aa8')));
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.02;
  g.add(road);
  for (let i = 0; i < 8; i++) {
    const line = P(new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.22), M('#fff8e8')));
    line.rotation.x = -Math.PI / 2;
    line.position.set(-11 + i * 3.2, 0.03, 0);
    g.add(line);
  }

  // いえ
  const houseData = [
    [-5.5, -3.5, 1.8, 1.6, '#ffd9b0', '#ff6d8d'], [-2, -4, 2.2, 2, '#d0eaff', '#57b8ff'],
    [2, -3.6, 1.9, 1.7, '#ffe9f0', '#a06dff'], [5.5, -4, 2.1, 1.9, '#fff3c0', '#5ed67d'],
    [-4, 3.5, 2, 1.8, '#e8ffe0', '#ffa22e'], [0.5, 4, 2.4, 2.1, '#f2e8f7', '#ff5d5d'],
    [4.5, 3.6, 1.8, 1.6, '#d9fff5', '#ffc247'],
  ];
  houseData.forEach(([x, z, w, h, bc, rc]) => g.add(place(house(w, h, bc, rc), x, z, z > 0 ? Math.PI : 0)));

  // くるま（いったりきたり）
  const car = new THREE.Group();
  const cb = P(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.8), M('#ff5d5d')));
  cb.position.y = 0.45;
  const ct = P(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 0.7), M('#ffb0b0')));
  ct.position.set(-0.05, 0.85, 0);
  car.add(cb, ct);
  for (const [wx, wz] of [[-0.45, 0.42], [0.45, 0.42], [-0.45, -0.42], [0.45, -0.42]]) {
    const wheel = P(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 10), M('#4a4a55')));
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(wx, 0.2, wz);
    car.add(wheel);
  }
  A(car, { type: 'drive', speed: 0.28, amp: 9 });
  car.position.set(0, 0, 0.7);
  g.add(car);

  // しんごう
  const signal = new THREE.Group();
  const pole = P(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8), M('#8a8a96')));
  pole.position.y = 1.2;
  signal.add(pole);
  const box = P(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.36, 0.25), M('#5a5a66')));
  box.position.y = 2.5;
  signal.add(box);
  ['#ff5d5d', '#ffd23e', '#5ed67d'].forEach((c, i) => {
    const lamp = P(new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), M(c, { emissive: c, emissiveIntensity: 0.4 })));
    lamp.position.set(-0.26 + i * 0.26, 2.5, 0.14);
    signal.add(lamp);
  });
  g.add(place(signal, -7.5, 1.9));

  // 木、ことり
  g.add(place(tree(1.2, '#57c161'), 7.5, -1.8));
  g.add(place(tree(1.0, '#7ed957'), -7.8, -2));
  g.add(place(bird('#ffb03a'), -1.5, 2.2, 0.7));
  g.add(place(bird('#8ad0ff'), 2.8, 2.0, -2.2));
  g.add(place(bird('#ff8ac2'), 6.8, 1.5, 2.6));

  const s = sun(); s.position.set(7, 9, -8); g.add(s);
  const c1 = cloud(1.2); c1.position.set(-4, 8.4, -9); g.add(c1);

  return {
    group: g,
    sky: { gray: '#8a8a92', colored: '#9fd8ff' },
    camera: { target: new THREE.Vector3(0, 1.6, 0), dist: 15, height: 7, fitRadius: 10.5 },
    fairyMsg: '「ぱっ！」で スタンプが でるよ',
  };
}

/* ======================================================
 * 6. おもちゃの へや
 * ====================================================== */
function buildRoom() {
  const g = new THREE.Group();
  // ゆか・かべ
  const floor = P(new THREE.Mesh(new THREE.BoxGeometry(16, 0.3, 12), M('#e8c89a')));
  floor.position.y = -0.15;
  g.add(floor);
  const wallB = P(new THREE.Mesh(new THREE.BoxGeometry(16, 8, 0.3), M('#fdeff2')));
  wallB.position.set(0, 4, -6);
  g.add(wallB);
  const wallL = P(new THREE.Mesh(new THREE.BoxGeometry(0.3, 8, 12), M('#eff5fd')));
  wallL.position.set(-8, 4, 0);
  g.add(wallL);

  // まど（そとに ほし）
  const winFrame = P(new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.2), M('#fff8e8')));
  winFrame.position.set(2.5, 4, -5.85);
  g.add(winFrame);
  const winGlass = P(new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 0.1), M('#a8d8f0', { emissive: '#7fc4e8', emissiveIntensity: 0.2 })));
  winGlass.position.set(2.5, 4, -5.75);
  g.add(winGlass);

  // ベッド
  const bed = new THREE.Group();
  const bedBase = P(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 4.4), M('#c98a4b')));
  bedBase.position.y = 0.5;
  const mattress = P(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, 4.0), M('#ffffff')));
  mattress.position.y = 0.95;
  const blanket = P(new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.25, 2.6), M('#ff8ac2')));
  blanket.position.set(0, 1.12, 0.6);
  const pillow = P(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 0.8), M('#fff3c0')));
  pillow.position.set(0, 1.2, -1.4);
  bed.add(bedBase, mattress, blanket, pillow);
  g.add(place(bed, -5.8, -3));

  // つみき
  const blockCols = ['#ff5d5d', '#57b8ff', '#5ed67d', '#ffc247', '#a06dff'];
  const blockPos = [[0.5, 0.3, 1.5, 0], [1.2, 0.3, 1.7, 0.4], [0.85, 0.9, 1.6, 0.2], [2.2, 0.3, 0.6, 0.8], [0.85, 1.5, 1.6, 0.1]];
  blockPos.forEach(([x, y, z, ry], i) => {
    const b = P(new THREE.Mesh(i % 2 ? new THREE.BoxGeometry(0.6, 0.6, 0.6) : new THREE.CylinderGeometry(0.3, 0.3, 0.6, 12), M(blockCols[i % blockCols.length])));
    b.position.set(x, y, z);
    b.rotation.y = ry;
    g.add(A(b, { type: 'boing', speed: 2 + i * 0.4, amp: 0.05, phase: i }));
  });

  // くま
  const bear = new THREE.Group();
  const bearCol = '#c98a4b';
  const body = P(new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), M(bearCol)));
  body.position.y = 0.55; body.scale.set(1, 1.15, 0.9);
  const head = P(new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), M(shade(bearCol, 1.08))));
  head.position.y = 1.45;
  const muzzle = P(new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), M('#f0dbb8')));
  muzzle.position.set(0, 1.35, 0.34);
  bear.add(body, head, muzzle);
  for (let e = 0; e < 2; e++) {
    const ear = P(new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), M(shade(bearCol, 0.9))));
    ear.position.set(e ? 0.3 : -0.3, 1.8, 0);
    bear.add(ear);
    const arm = P(new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.4, 3, 6), M(bearCol)));
    arm.position.set(e ? 0.6 : -0.6, 0.7, 0.1);
    arm.rotation.z = e ? -0.8 : 0.8;
    bear.add(arm);
  }
  A(bear, { type: 'tilt', speed: 1.5, amp: 0.16 });
  g.add(place(bear, 4.5, -2.5, -0.7));

  // ボール・でんしゃ
  const ball = P(new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), M('#ff6d8d')));
  ball.position.set(-1.5, 0.5, 2.5);
  g.add(A(ball, { type: 'roll', speed: 1.2, amp: 1.8 }));

  const train = new THREE.Group();
  const engine = P(new THREE.Mesh(new THREE.BoxGeometry(1, 0.7, 0.7), M('#57b8ff')));
  engine.position.y = 0.5;
  const chimney = P(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.4, 8), M('#4a4a55')));
  chimney.position.set(0.3, 1, 0);
  train.add(engine, chimney);
  for (let w = 0; w < 2; w++) {
    const wagon = P(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.65), M(w ? '#5ed67d' : '#ffc247')));
    wagon.position.set(-1.1 - w * 1.0, 0.42, 0);
    train.add(wagon);
  }
  A(train, { type: 'drive', speed: 0.2, amp: 4 });
  g.add(place(train, 0, 3.5));

  // ランプ
  const lampG = new THREE.Group();
  const lpole = P(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 1.6, 8), M('#c8b8a0')));
  lpole.position.y = 0.8;
  const lshade = P(new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.6, 12), M('#ffd95e', { emissive: '#ffca4a', emissiveIntensity: 0.35 })));
  lshade.position.y = 1.85;
  lampG.add(lpole, lshade);
  g.add(place(lampG, 7, -4.5));

  // かべの え
  [['#ff6d8d', -4], ['#57b8ff', -1.5]].forEach(([c, x]) => {
    const frame = P(new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 0.12), M('#fff8e8')));
    frame.position.set(x, 4.4, -5.85);
    g.add(frame);
    const art = P(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 0.14), M(c)));
    art.position.set(x, 4.4, -5.82);
    g.add(art);
  });

  return {
    group: g,
    sky: { gray: '#82828a', colored: '#ffd9c0' },
    camera: { target: new THREE.Vector3(-0.5, 2.2, 0), dist: 13, height: 5, fitRadius: 9.5 },
    fairyMsg: 'くまさんに いろを つけてあげて！',
  };
}
