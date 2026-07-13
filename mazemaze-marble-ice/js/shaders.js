// シェーダーソース集
// 状態テクスチャの構成:
//   velocity: RG16F  (vx, vy)  正規化y単位/秒
//   color:    RGBA16F (r, g, b, amount) amount=アイスの量(高さの元)
//   props:    RGBA16F (temp, air, crystal, gloss)
//     temp:    0=キンキン 0.5=ふつう 1=とろとろ
//     air:     空気量 1=ふわふわ 0=つぶれた
//     crystal: 氷結晶 1=ざらざら 0=なめらか
//     gloss:   表面ツヤ

export const baseVS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const NOISE = `
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x),
             mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){
  return vnoise(p) * 0.55 + vnoise(p * 2.13) * 0.28 + vnoise(p * 4.41) * 0.17;
}`;

const PLATE_MASK = `
uniform vec2 uPlateCenter;
uniform float uPlateRadius;
uniform float uAspect;
float plateDist(vec2 uv){
  vec2 d = (uv - uPlateCenter) * vec2(uAspect, 1.0);
  return length(d) / uPlateRadius;
}
float plateMask(vec2 uv){
  return 1.0 - smoothstep(0.94, 1.0, plateDist(uv));
}`;

// ---- 速度スプラット(かき混ぜの力) ----
export const splatVelocityFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform vec2 uForce;
uniform float uRadius;
uniform float uAspect;
void main(){
  vec2 d = (vUv - uPoint) * vec2(uAspect, 1.0);
  float g = exp(-dot(d, d) / (uRadius * uRadius));
  vec2 v = texture(uTarget, vUv).xy + uForce * g;
  frag = vec4(v, 0.0, 1.0);
}`;

// ---- 色スプラット(アイスを置く) ----
export const splatColorFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform float uRadius;
uniform float uAspect;
uniform vec4 uColorAmt; // rgb=フレーバー色, a=追加量
void main(){
  vec2 d = (vUv - uPoint) * vec2(uAspect, 1.0);
  float t = clamp(1.0 - length(d) / uRadius, 0.0, 1.0);
  float dome = t * t * (3.0 - 2.0 * t);
  float add = uColorAmt.a * dome;
  vec4 c = texture(uTarget, vUv);
  float na = c.a + add;
  vec3 rgb = na > 1e-4 ? (c.rgb * c.a + uColorAmt.rgb * add) / na : c.rgb;
  frag = vec4(rgb, min(na, 2.2));
}`;

// ---- 状態スプラット(押しつぶし・冷やし混ぜ・置いた時の初期状態) ----
export const splatPropsFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform float uRadius;
uniform float uAspect;
uniform vec4 uPropTarget; // 目標値
uniform vec4 uPropMix;    // 目標へ寄せる強さ (x gauss)
uniform vec4 uPropAdd;    // 加算 (x gauss)
void main(){
  vec2 d = (vUv - uPoint) * vec2(uAspect, 1.0);
  float g = exp(-dot(d, d) / (uRadius * uRadius));
  vec4 p = texture(uTarget, vUv);
  p = mix(p, uPropTarget, clamp(uPropMix * g, 0.0, 1.0));
  p += uPropAdd * g;
  frag = clamp(p, vec4(0.0), vec4(1.0));
}`;

// ---- 速度の移流(温度で粘度が変わる) ----
export const advectVelocityFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uVelocity;
uniform sampler2D uProps;
uniform sampler2D uColor;
uniform float uDt;
${PLATE_MASK}
void main(){
  vec2 invA = vec2(1.0 / uAspect, 1.0);
  vec2 vel = texture(uVelocity, vUv).xy;
  vec2 coord = vUv - uDt * vel * invA;
  vec2 v = texture(uVelocity, coord).xy;

  float temp = texture(uProps, vUv).x;
  float amount = texture(uColor, vUv).a;
  // アイスがある所は「ペースト」: 冷たいほど強い減衰(降伏応力っぽく即停止)
  // アイスが無い所も摩擦で減衰
  float damp = mix(9.0, 1.6, smoothstep(0.15, 0.9, temp));
  damp = mix(6.0, damp, smoothstep(0.02, 0.2, amount));
  v *= exp(-uDt * damp);
  v *= plateMask(vUv);
  frag = vec4(v, 0.0, 1.0);
}`;

// ---- 発散 ----
export const divergenceFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
${PLATE_MASK}
void main(){
  float L = texture(uVelocity, vUv - vec2(uTexel.x, 0.0)).x * plateMask(vUv - vec2(uTexel.x, 0.0));
  float R = texture(uVelocity, vUv + vec2(uTexel.x, 0.0)).x * plateMask(vUv + vec2(uTexel.x, 0.0));
  float B = texture(uVelocity, vUv - vec2(0.0, uTexel.y)).y * plateMask(vUv - vec2(0.0, uTexel.y));
  float T = texture(uVelocity, vUv + vec2(0.0, uTexel.y)).y * plateMask(vUv + vec2(0.0, uTexel.y));
  frag = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;

// ---- 圧力 (ヤコビ反復) ----
export const pressureFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexel;
void main(){
  float L = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  float div = texture(uDivergence, vUv).x;
  frag = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}`;

// ---- 圧力勾配を引く ----
export const gradientSubtractFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
${PLATE_MASK}
void main(){
  float L = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  vec2 v = texture(uVelocity, vUv).xy - vec2(R - L, T - B);
  frag = vec4(v * plateMask(vUv), 0.0, 1.0);
}`;

// ---- 溶けた分の「たれ流れ」速度(高さ勾配を下る) ----
const MELT_FLOW = `
vec2 meltFlow(vec2 uv, vec2 texel){
  float aL = texture(uColor, uv - vec2(texel.x, 0.0)).a;
  float aR = texture(uColor, uv + vec2(texel.x, 0.0)).a;
  float aB = texture(uColor, uv - vec2(0.0, texel.y)).a;
  float aT = texture(uColor, uv + vec2(0.0, texel.y)).a;
  float temp = texture(uProps, uv).x;
  float melt = smoothstep(0.55, 0.9, temp);
  vec2 flow = -vec2(aR - aL, aT - aB) * melt;
  float l = length(flow);
  if (l > 1e-5) flow *= min(l * 1.6, 0.09) / l; // たれ流れはゆっくり
  return flow;
}`;

// ---- 色/状態の移流 (前進パス: MacCormack共用) ----
export const advectDyeFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform sampler2D uColor;
uniform sampler2D uProps;
uniform float uDt;   // 負にすると後退パス
uniform float uAspect;
${MELT_FLOW}
void main(){
  vec2 invA = vec2(1.0 / uAspect, 1.0);
  vec2 texel = vec2(1.0) / vec2(textureSize(uColor, 0));
  vec2 vel = texture(uVelocity, vUv).xy + meltFlow(vUv, texel);
  vec2 coord = vUv - uDt * vel * invA;
  frag = texture(uSource, coord);
}`;

// ---- MacCormack 合成(シャープなマーブル筋を保つ) ----
export const macCormackFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uVelocity;
uniform sampler2D uSource;   // 元 φ0
uniform sampler2D uForward;  // φ1
uniform sampler2D uBackward; // φ2
uniform sampler2D uColor;
uniform sampler2D uProps;
uniform float uDt;
uniform float uSharpness; // 1=くっきり 0=にじむ(細かく混ぜると下がる)
uniform float uFade;      // リセット用
${PLATE_MASK}
${MELT_FLOW}
void main(){
  vec2 invA = vec2(1.0 / uAspect, 1.0);
  vec2 texel = vec2(1.0) / vec2(textureSize(uSource, 0));
  vec2 vel = texture(uVelocity, vUv).xy + meltFlow(vUv, texel);
  vec2 coord = vUv - uDt * vel * invA;

  vec4 f = texture(uForward, vUv);
  vec4 s = texture(uSource, vUv);
  vec4 b = texture(uBackward, vUv);
  vec4 corrected = f + 0.5 * (s - b);

  // 後退追跡点の近傍min/maxでクランプ(振動防止)
  vec2 base = floor(coord / texel - 0.5) * texel + texel * 0.5;
  vec4 s00 = texture(uSource, base);
  vec4 s10 = texture(uSource, base + vec2(texel.x, 0.0));
  vec4 s01 = texture(uSource, base + vec2(0.0, texel.y));
  vec4 s11 = texture(uSource, base + texel);
  vec4 mn = min(min(s00, s10), min(s01, s11));
  vec4 mx = max(max(s00, s10), max(s01, s11));
  corrected = clamp(corrected, mn, mx);

  vec4 result = mix(f, corrected, uSharpness);

  // 細かく何度も混ぜると「にじんで」均一な色へ(動いている場所だけ)
  // 溶けている場所は常に少しなじんで、なめらかな液面になる
  float moving = smoothstep(0.02, 0.35, length(vel));
  float melty = smoothstep(0.55, 0.9, texture(uProps, vUv).x);
  float blurAmt = min(0.6, (1.0 - uSharpness) * 0.5 * moving + melty * 0.22);
  if (blurAmt > 0.001) {
    vec2 o = texel * 1.6;
    vec4 blurred = (texture(uForward, vUv + vec2( o.x,  o.y)) +
                    texture(uForward, vUv + vec2(-o.x,  o.y)) +
                    texture(uForward, vUv + vec2( o.x, -o.y)) +
                    texture(uForward, vUv + vec2(-o.x, -o.y))) * 0.25;
    result = mix(result, blurred, blurAmt);
  }

  // アイスはお皿の上だけ
  result.a *= uFade * plateMask(vUv);
  frag = result;
}`;

// ---- 状態の時間発展 ----
export const propsUpdateFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uProps;
uniform sampler2D uColor;
uniform float uDt;
uniform float uAmbient;      // 周囲温度の目標 0..1
uniform float uAmbientRate;  // 温度が引っぱられる速さ
void main(){
  vec4 p = texture(uProps, vUv);
  float amount = texture(uColor, vUv).a;

  // 温度: 周囲温度へゆっくり緩和
  p.x = mix(p.x, uAmbient, 1.0 - exp(-uDt * uAmbientRate));

  float coldness = smoothstep(0.4, 0.08, p.x);
  float heat = smoothstep(0.55, 0.92, p.x);

  // 氷結晶: 冷えると育ち、熱で溶ける
  p.z = clamp(p.z + uDt * (coldness * 0.17 - heat * 0.40), 0.0, 1.0);
  // ツヤ: 溶けかけで濡れ、時間で乾く
  p.w = clamp(p.w + uDt * (heat * 0.55 - 0.05), 0.0, 1.0);
  // 空気: 熱で泡がつぶれる
  p.y = clamp(p.y - uDt * heat * 0.22, 0.0, 1.0);

  frag = p;
}`;

// ---- 最終レンダリング ----
export const renderFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uColor;
uniform sampler2D uProps;
uniform float uTime;
uniform float uAmbient;
uniform vec2 uResolution;
${PLATE_MASK}
${NOISE}

vec3 bgColor(vec2 uv){
  // やさしいパステル背景 + 水玉
  vec3 a = vec3(1.00, 0.93, 0.96);
  vec3 b = vec3(0.90, 0.95, 1.00);
  vec3 col = mix(a, b, uv.y + 0.15 * fbm(uv * 3.0));
  vec2 g = uv * vec2(uAspect, 1.0) * 9.0;
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  float r = hash12(cell);
  float dot_ = smoothstep(0.16, 0.10, length(f + (vec2(hash12(cell + 7.0), hash12(cell + 13.0)) - 0.5) * 0.4)) * step(0.6, r);
  col = mix(col, vec3(1.0, 0.82, 0.90), dot_ * 0.35);
  return col;
}

float iceHeight(vec2 uv){
  vec4 c = texture(uColor, uv);
  vec4 p = texture(uProps, uv);
  float a = min(c.a, 1.6);
  float body = pow(a / 1.6, 0.72) * 1.6;
  return body * (0.55 + 0.45 * p.y); // 空気が多いほど盛り上がる
}

void main(){
  float pd = plateDist(vUv);
  vec3 col = bgColor(vUv);
  float coldAmb = smoothstep(0.45, 0.1, uAmbient);
  float warmAmb = smoothstep(0.55, 0.9, uAmbient);

  // --- お皿の影 ---
  vec2 shUv = vUv + vec2(0.006, 0.014);
  float shD = plateDist(shUv);
  col *= 1.0 - 0.16 * (1.0 - smoothstep(1.05, 1.22, shD));

  // --- お皿 ---
  float plateEdge = smoothstep(1.16, 1.14, pd);
  if (plateEdge > 0.0) {
    vec3 plate = vec3(0.99, 0.985, 0.99);
    // ふち(リム)の立体感
    float rim = smoothstep(0.97, 1.02, pd) * (1.0 - smoothstep(1.09, 1.16, pd));
    plate += rim * 0.035;
    float rimShadow = smoothstep(1.02, 0.97, pd) * (1.0 - smoothstep(0.97, 0.86, pd));
    plate -= rimShadow * vec3(0.10, 0.08, 0.05);
    // 内側のやわらかい落ち影
    plate -= smoothstep(0.9, 0.2, pd) * vec3(0.03, 0.025, 0.01);
    // 陶器の照り
    vec2 pp = (vUv - uPlateCenter) * vec2(uAspect, 1.0) / uPlateRadius;
    float sheen = pow(max(0.0, 1.0 - length(pp - vec2(-0.35, 0.4))), 2.0);
    plate += sheen * 0.05;
    // ほんのりピンクの縁どり
    float ring = smoothstep(0.015, 0.0, abs(pd - 1.10));
    plate = mix(plate, vec3(1.0, 0.72, 0.84), ring * 0.8);
    // 冷凍・加熱の気配
    float frost = coldAmb * smoothstep(0.55, 0.95, pd) * (1.0 - smoothstep(0.95, 1.0, pd));
    plate = mix(plate, vec3(0.82, 0.92, 1.0), frost * (0.5 + 0.5 * fbm(vUv * vec2(uAspect, 1.0) * 40.0)));
    float glow = warmAmb * smoothstep(0.75, 0.98, pd) * (1.0 - smoothstep(0.98, 1.04, pd));
    plate = mix(plate, vec3(1.0, 0.82, 0.6), glow * 0.5);
    col = mix(col, plate, plateEdge);
  }

  // --- アイス ---
  vec4 c = texture(uColor, vUv);
  vec4 p = texture(uProps, vUv);
  float amount = c.a;
  float coverage = smoothstep(0.030, 0.14, amount);

  // アイスの接地影(すこし下にオフセット)
  float aSh = texture(uColor, vUv + vec2(-0.004, 0.010)).a;
  float contact = smoothstep(0.03, 0.35, aSh) * (1.0 - coverage);
  col *= 1.0 - contact * 0.13;

  if (coverage > 0.001) {
    vec2 texel = vec2(1.0) / vec2(textureSize(uColor, 0));
    float scale = 1.4;
    float hC = iceHeight(vUv);
    float hL = iceHeight(vUv - vec2(texel.x * scale, 0.0));
    float hR = iceHeight(vUv + vec2(texel.x * scale, 0.0));
    float hB = iceHeight(vUv - vec2(0.0, texel.y * scale));
    float hT = iceHeight(vUv + vec2(0.0, texel.y * scale));
    float nScale = 5.2;
    vec3 N = normalize(vec3(-(hR - hL) * nScale, -(hT - hB) * nScale, 1.0));

    float temp = p.x, air = p.y, crystal = p.z, gloss = p.w;
    float melt = smoothstep(0.55, 0.9, temp);
    float coldness = smoothstep(0.42, 0.1, temp);

    // --- アルベド ---
    vec3 albedo = c.rgb;
    // ふわふわ: 空気で白っぽく、軽く
    albedo = mix(albedo, vec3(1.0), air * 0.16 + 0.04);
    // ひんやり: 少し青白く
    albedo = mix(albedo, albedo * vec3(0.9, 0.97, 1.08) + vec3(0.04, 0.05, 0.08), coldness * 0.35);

    // ざらざら: 氷結晶の粒 (アルベドのスペックル + 法線の凹凸)
    vec2 gUv = vUv * uResolution * 0.5;
    float grain = hash12(floor(gUv));
    float grain2 = hash12(floor(gUv * 0.47) + 31.0);
    float rough = crystal * (0.55 + 0.45 * (1.0 - melt));
    albedo *= 1.0 + (grain - 0.5) * rough * 0.26;
    N.xy += (vec2(grain, grain2) - 0.5) * rough * 0.34;
    N = normalize(N);

    // とろとろ: シロップ化(薄い所は濃く透けた色)
    float thin = 1.0 - smoothstep(0.06, 0.55, amount);
    float syrup = melt * (0.4 + 0.6 * thin);
    vec3 syrupCol = albedo * albedo * 1.25;
    albedo = mix(albedo, syrupCol, syrup * 0.75);

    // --- ライティング ---
    vec3 L = normalize(vec3(-0.35, 0.55, 0.75));
    float diff = 0.62 + 0.42 * max(dot(N, L), 0.0);
    // ふわふわのサブサーフェスっぽい持ち上げ
    diff = mix(diff, diff * 0.5 + 0.62, air * 0.45);

    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 H = normalize(L + V);
    float wet = clamp(gloss + melt * 0.7, 0.0, 1.0);
    float shininess = mix(6.0, 120.0, wet);
    float spec = pow(max(dot(N, H), 0.0), shininess) * (0.05 + 1.1 * wet);
    spec *= 1.0 - air * 0.55;             // ふわふわはマット
    spec *= 1.0 + crystal * grain * 0.8;  // 粒の照りバラつき

    // キラキラ: 氷の結晶がまたたく
    float tw = hash12(floor(gUv * 0.9) + floor(uTime * 3.0));
    float glint = step(0.985, tw) * crystal * crystal * coverage * (0.4 + 0.6 * grain);

    // ふんわり輪郭光
    float rimL = pow(1.0 - N.z, 1.8) * air * 0.35;

    vec3 ice = albedo * diff + vec3(1.0) * (spec + glint * 0.9) + albedo * rimL;

    // 薄いシロップは下のお皿が透ける
    float alpha = coverage * mix(1.0, 0.75, syrup * thin);
    col = mix(col, ice, alpha);
  }

  // やわらかい全体ビネット
  vec2 vg = (vUv - 0.5) * vec2(uAspect, 1.0);
  col *= 1.0 - dot(vg, vg) * 0.18;

  frag = vec4(col, 1.0);
}`;

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
