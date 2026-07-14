// トッピング粒(クッキー/チョコチップ/いちご) と 雪・湯気パーティクル
import { Program } from './gl.js';
import * as SH from './shaders/particles.js';

const MAX_CHUNKS = 260;
const MAX_FLAKES = 90;

export const CHUNK_TYPES = {
  cookie: 0,
  chip: 1,
  berry: 2,
};

export class Chunks {
  constructor(gl) {
    this.gl = gl;
    this.list = [];
    this.prog = new Program(gl, SH.chunkVS, SH.chunkFS);
    this.vao = gl.createVertexArray();
    this.bufPos = gl.createBuffer();
    this.bufData = gl.createBuffer();
    this.bufSeed = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_CHUNKS * 2 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufData);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_CHUNKS * 4 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSeed);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_CHUNKS * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.posArr = new Float32Array(MAX_CHUNKS * 2);
    this.dataArr = new Float32Array(MAX_CHUNKS * 4);
    this.seedArr = new Float32Array(MAX_CHUNKS);
  }

  // ふりかける: 皿の上にばらまく(落下アニメ付き)
  sprinkle(type, plate, count) {
    for (let i = 0; i < count; i++) {
      if (this.list.length >= MAX_CHUNKS) this.list.shift();
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * plate.r * 0.8;
      const tx = plate.cx + Math.cos(ang) * rad / plate.aspect;
      const ty = plate.cy + Math.sin(ang) * rad;
      const size = type === CHUNK_TYPES.cookie
        ? 0.028 + Math.random() * 0.03
        : type === CHUNK_TYPES.chip
          ? 0.014 + Math.random() * 0.012
          : 0.02 + Math.random() * 0.018;
      this.list.push({
        x: tx, y: ty + 0.35 + Math.random() * 0.25, // 上から落ちてくる
        tx, ty,
        vx: 0, vy: 0,
        falling: true,
        fallV: 0,
        type, size,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 2,
        sink: 0,
        seed: Math.random() * 100,
        stress: 0,
      });
    }
  }

  clear() { this.list = []; }

  // かき混ぜの力を受ける
  stir(x, y, fx, fy, radius, aspect, press) {
    for (const c of this.list) {
      if (c.falling) continue;
      const dx = (c.x - x) * aspect, dy = c.y - y;
      const d2 = dx * dx + dy * dy;
      const g = Math.exp(-d2 / (radius * radius));
      if (g < 0.02) continue;
      c.vx += fx * g * 0.9;
      c.vy += fy * g * 0.9;
      c.rotV += (Math.random() - 0.5) * 14 * g;
      c.sink = Math.min(1, c.sink + g * 0.045 + press * g * 0.05);
      c.stress += g * Math.hypot(fx, fy) * 0.016;
    }
    // クッキーはこわれて小さくなる(断面が汚くかわいい)
    const born = [];
    for (const c of this.list) {
      if (c.type === CHUNK_TYPES.cookie && c.stress > 1.4 && c.size > 0.02) {
        c.stress = 0;
        c.size *= 0.62;
        if (this.list.length + born.length < MAX_CHUNKS) {
          born.push({
            ...c,
            x: c.x + (Math.random() - 0.5) * 0.02,
            y: c.y + (Math.random() - 0.5) * 0.02,
            rot: Math.random() * Math.PI * 2,
            seed: Math.random() * 100,
            size: c.size * (0.7 + Math.random() * 0.4),
          });
        }
      }
    }
    this.list.push(...born);
    return born.length; // われた数(音用)
  }

  update(dt, plate) {
    let landed = 0;
    for (const c of this.list) {
      if (c.falling) {
        c.fallV += dt * 3.2;
        c.y -= c.fallV * dt * 3.0;
        c.rot += c.rotV * dt * 3;
        if (c.y <= c.ty) {
          c.y = c.ty;
          c.falling = false;
          landed++;
        }
        continue;
      }
      c.x += c.vx * dt / plate.aspect;
      c.y += c.vy * dt;
      c.rot += c.rotV * dt;
      const damp = Math.exp(-dt * 6.5);
      c.vx *= damp; c.vy *= damp;
      c.rotV *= damp;
      // お皿の外に出ない
      const dx = (c.x - plate.cx) * plate.aspect, dy = c.y - plate.cy;
      const d = Math.hypot(dx, dy);
      const maxR = plate.r * 0.93;
      if (d > maxR) {
        const s = maxR / d;
        c.x = plate.cx + dx * s / plate.aspect;
        c.y = plate.cy + dy * s;
        c.vx *= 0.5; c.vy *= 0.5;
      }
    }
    return landed;
  }

  draw(colorTex, aspect, resW, resH) {
    const n = this.list.length;
    if (n === 0) return;
    const gl = this.gl;
    // 埋まった粒から先に描く(浮いてる粒が上)
    const sorted = [...this.list].sort((a, b) => b.sink - a.sink);
    for (let i = 0; i < n; i++) {
      const c = sorted[i];
      this.posArr[i * 2] = c.x;
      this.posArr[i * 2 + 1] = c.y;
      this.dataArr[i * 4] = c.size * (c.falling ? 1.15 : 1.0);
      this.dataArr[i * 4 + 1] = c.type;
      this.dataArr[i * 4 + 2] = c.rot;
      this.dataArr[i * 4 + 3] = c.falling ? 0 : c.sink;
      this.seedArr[i] = c.seed;
    }
    const p = this.prog;
    p.use();
    gl.uniform1i(p.uniforms.uColor, colorTex.attach(0));
    gl.uniform1f(p.uniforms.uAspect, aspect);
    gl.uniform2f(p.uniforms.uResolution, resW, resH);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.posArr, 0, n * 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufData);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.dataArr, 0, n * 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSeed);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.seedArr, 0, n);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}

// 雪(冷やし中) と 湯気(あたため中)
export class Flakes {
  constructor(gl) {
    this.gl = gl;
    this.list = [];
    this.prog = new Program(gl, SH.flakeVS, SH.flakeFS);
    this.vao = gl.createVertexArray();
    this.bufPos = gl.createBuffer();
    this.bufData = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_FLAKES * 2 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufData);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_FLAKES * 3 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.posArr = new Float32Array(MAX_FLAKES * 2);
    this.dataArr = new Float32Array(MAX_FLAKES * 3);
  }

  emit(kind, plate) {
    if (this.list.length >= MAX_FLAKES) return;
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(Math.random()) * plate.r * 1.05;
    const x = plate.cx + Math.cos(ang) * rad / plate.aspect;
    const y = plate.cy + Math.sin(ang) * rad;
    if (kind === 0) {
      // 雪: 上から舞い落ちる
      this.list.push({
        x, y: y + 0.25 + Math.random() * 0.2, kind,
        vx: (Math.random() - 0.5) * 0.05, vy: -(0.12 + Math.random() * 0.1),
        size: 0.006 + Math.random() * 0.007,
        life: 0, maxLife: 1.6 + Math.random() * 1.2,
        wob: Math.random() * 10,
      });
    } else {
      // 湯気: ふわっと上る
      this.list.push({
        x, y, kind,
        vx: (Math.random() - 0.5) * 0.03, vy: 0.10 + Math.random() * 0.08,
        size: 0.05 + Math.random() * 0.06,
        life: 0, maxLife: 1.8 + Math.random() * 1.0,
        wob: Math.random() * 10,
      });
    }
  }

  update(dt) {
    for (const f of this.list) {
      f.life += dt;
      f.wob += dt * 3;
      f.x += (f.vx + Math.sin(f.wob) * 0.02) * dt;
      f.y += f.vy * dt;
      if (f.kind === 1) f.size += dt * 0.03;
    }
    this.list = this.list.filter(f => f.life < f.maxLife);
  }

  draw(resW, resH) {
    const n = this.list.length;
    if (n === 0) return;
    const gl = this.gl;
    for (let i = 0; i < n; i++) {
      const f = this.list[i];
      this.posArr[i * 2] = f.x;
      this.posArr[i * 2 + 1] = f.y;
      this.dataArr[i * 3] = f.size;
      this.dataArr[i * 3 + 1] = f.kind;
      this.dataArr[i * 3 + 2] = f.life / f.maxLife;
    }
    const p = this.prog;
    p.use();
    gl.uniform2f(p.uniforms.uResolution, resW, resH);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.posArr, 0, n * 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufData);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.dataArr, 0, n * 3);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}
