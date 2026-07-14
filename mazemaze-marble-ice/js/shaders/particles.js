// パーティクル用シェーダー(トッピング粒・雪・湯気)
import { NOISE } from './common.js';

// ---- トッピング粒 (ポイントスプライト) ----
export const chunkVS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;    // uv位置
layout(location=1) in vec4 aData;   // size(y単位), type, rot, sink
layout(location=2) in float aSeed;
uniform sampler2D uColor;
uniform float uAspect;
uniform vec2 uResolution;
out float vType;
out float vRot;
out float vSink;
out float vSeed;
out vec3 vIceCol;
out float vIceAmt;
void main(){
  vec2 clip = aPos * 2.0 - 1.0;
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = aData.x * uResolution.y;
  vType = aData.y;
  vRot = aData.z;
  vSink = aData.w;
  vSeed = aSeed;
  vec4 ice = textureLod(uColor, aPos, 0.0);
  vIceCol = ice.rgb;
  vIceAmt = ice.a;
}`;

export const chunkFS = `#version 300 es
precision highp float;
in float vType;
in float vRot;
in float vSink;
in float vSeed;
in vec3 vIceCol;
in float vIceAmt;
out vec4 frag;
${NOISE}
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float cs = cos(vRot), sn = sin(vRot);
  q = mat2(cs, -sn, sn, cs) * q;

  vec3 col;
  float alpha = 0.0;
  float shape = 0.0;

  if (vType < 0.5) {
    // クッキー: きつね色の欠片、ふぞろいな縁 + チョコ斑点
    float edge = 0.72 + 0.22 * fbm(q * 2.6 + vSeed * 17.0);
    shape = smoothstep(edge, edge - 0.16, length(q));
    col = mix(vec3(0.82, 0.62, 0.38), vec3(0.62, 0.42, 0.22), fbm(q * 3.0 + vSeed * 9.0));
    float spot = smoothstep(0.55, 0.9, fbm(q * 5.5 + vSeed * 31.0));
    col = mix(col, vec3(0.25, 0.14, 0.08), spot * 0.85);
    col *= 0.85 + 0.3 * smoothstep(0.5, -0.5, q.y); // 上面ハイライト
  } else if (vType < 1.5) {
    // チョコチップ: 濃い茶のかけら
    vec2 s = q * vec2(1.0, 1.35);
    float edge = 0.68 + 0.14 * fbm(q * 4.0 + vSeed * 23.0);
    shape = smoothstep(edge, edge - 0.2, length(s));
    col = mix(vec3(0.28, 0.16, 0.09), vec3(0.16, 0.08, 0.04), fbm(q * 4.0 + vSeed * 5.0));
    float hl = smoothstep(0.35, 0.0, length(q - vec2(-0.3, 0.35)));
    col += hl * 0.22;
  } else {
    // いちご果肉: 赤に小さなつぶつぶ
    vec2 s = q * vec2(1.0, 1.2);
    float edge = 0.7 + 0.18 * fbm(q * 3.2 + vSeed * 41.0);
    shape = smoothstep(edge, edge - 0.18, length(s));
    col = mix(vec3(0.93, 0.25, 0.35), vec3(0.75, 0.10, 0.22), fbm(q * 3.5 + vSeed * 3.0));
    vec2 g = q * 4.5;
    float seedDot = smoothstep(0.35, 0.15, length(fract(g + vSeed) - 0.5));
    col = mix(col, vec3(1.0, 0.9, 0.65), seedDot * 0.7);
    col *= 0.9 + 0.25 * smoothstep(0.5, -0.5, q.y);
  }

  alpha = shape;
  if (alpha < 0.01) discard;

  // 混ぜられて埋まると、まわりのアイス色をまとって沈む
  float bury = clamp(vSink, 0.0, 1.0) * smoothstep(0.05, 0.4, vIceAmt);
  col = mix(col, vIceCol * 0.92, bury * 0.62);
  alpha *= 1.0 - bury * 0.25;

  frag = vec4(col, alpha);
}`;

// ---- 雪・湯気パーティクル ----
export const flakeVS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
layout(location=1) in vec3 aData; // size, kind(0雪/1湯気), life01
uniform vec2 uResolution;
out float vKind;
out float vLife;
void main(){
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = aData.x * uResolution.y;
  vKind = aData.y;
  vLife = aData.z;
}`;

export const flakeFS = `#version 300 es
precision highp float;
in float vKind;
in float vLife;
out vec4 frag;
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = length(q);
  float fade = sin(vLife * 3.14159);
  if (vKind < 0.5) {
    // 雪: 小さくきらっと
    float a = smoothstep(1.0, 0.2, d) * fade;
    float sparkle = smoothstep(0.45, 0.0, abs(q.x)) + smoothstep(0.45, 0.0, abs(q.y));
    frag = vec4(vec3(1.0), a * 0.85 + sparkle * a * 0.3);
  } else {
    // 湯気: ふわっと薄く
    float a = smoothstep(1.0, 0.0, d) * fade * 0.16;
    frag = vec4(vec3(1.0, 0.98, 0.95), a);
  }
}`;
