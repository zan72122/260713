// シミュレーション用シェーダー(スプラット・移流・圧力投影・状態の時間発展)
import { PLATE_MASK, MELT_FLOW } from './common.js';

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
  // 上が丸く盛り上がり、縁は急に落ちるスクープ形
  float dome = smoothstep(0.0, 0.26, t) * (0.75 + 0.25 * t);
  float add = uColorAmt.a * dome;
  vec4 c = texture(uTarget, vUv);
  float na = c.a + add;
  vec3 rgb = na > 1e-4 ? (c.rgb * c.a + uColorAmt.rgb * add) / na : c.rgb;
  frag = vec4(rgb, min(na, 2.2));
}`;

// ---- 状態スプラット(押しつぶし・冷やし混ぜ・置いた時の初期状態) ----
// props / props2 のどちらにも使う汎用パス
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

// ---- 速度の移流(温度・質感で粘度が変わる) ----
export const advectVelocityFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uVelocity;
uniform sampler2D uProps;
uniform sampler2D uProps2;
uniform sampler2D uColor;
uniform float uDt;
uniform vec2 uTilt; // お皿の傾き(流れ落ちる向き)
${PLATE_MASK}
void main(){
  vec2 invA = vec2(1.0 / uAspect, 1.0);
  vec2 vel = texture(uVelocity, vUv).xy;
  vec2 coord = vUv - uDt * vel * invA;
  vec2 v = texture(uVelocity, coord).xy;

  float temp = texture(uProps, vUv).x;
  float amount = texture(uColor, vUv).a;
  vec4 q = texture(uProps2, vUv);

  // お皿の傾き: アイスがある所に重力が働く。
  // どれだけ流れるかは各ピクセルの状態しだい(減衰との釣り合いが終端速度になる):
  // とろとろは川になり、キンキンはほぼ動かず、もち・ぷるは揺れながらゆっくり
  float body = smoothstep(0.02, 0.25, amount);
  float mobility = mix(0.45, 1.5, smoothstep(0.15, 0.9, temp));
  v += uTilt * (uDt * 2.6 * body * mobility);

  // アイスがある所は「ペースト」: 冷たいほど強い減衰(降伏応力っぽく即停止)
  // アイスが無い所も摩擦で減衰
  float damp = mix(9.0, 1.6, smoothstep(0.15, 0.9, temp));
  damp = mix(6.0, damp, smoothstep(0.02, 0.2, amount));
  // もちもちは流れが長く伸び、ぷるぷるは揺れがしばらく残る
  damp *= max(0.25, 1.0 - q.y * 0.50 - q.w * 0.35);
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
uniform sampler2D uProps2;
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

  // もちもちは筋が長くくっきり伸びる(にじみにくい)
  float mochi = texture(uProps2, vUv).y;
  vec4 result = mix(f, corrected, min(0.98, uSharpness + mochi * 0.12));

  // 細かく何度も混ぜると「にじんで」均一な色へ(動いている場所だけ)
  // 溶けている場所は常に少しなじんで、なめらかな液面になる
  float moving = smoothstep(0.02, 0.35, length(vel));
  float melty = smoothstep(0.55, 0.9, texture(uProps, vUv).x);
  float blurAmt = min(0.6, (1.0 - uSharpness) * 0.5 * moving + melty * 0.22);
  blurAmt *= 1.0 - mochi * 0.75;
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

// ---- 状態の時間発展 (props: temp/air/crystal/gloss) ----
export const propsUpdateFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uProps;
uniform sampler2D uProps2;
uniform sampler2D uColor;
uniform float uDt;
uniform float uAmbient;      // 周囲温度の目標 0..1
uniform float uAmbientRate;  // 温度が引っぱられる速さ
void main(){
  vec4 p = texture(uProps, vUv);
  float mochi = texture(uProps2, vUv).y;

  // 温度: 周囲温度へゆっくり緩和
  p.x = mix(p.x, uAmbient, 1.0 - exp(-uDt * uAmbientRate));

  float coldness = smoothstep(0.4, 0.08, p.x);
  float heat = smoothstep(0.55, 0.92, p.x);

  // 氷結晶: 冷えると育ち、熱で溶ける
  p.z = clamp(p.z + uDt * (coldness * 0.17 - heat * 0.40), 0.0, 1.0);
  // ツヤ: 溶けかけで濡れ、時間で乾く。ねっとり(もちもち)領域はツヤが持続する
  p.w = clamp(p.w + uDt * (heat * 0.55 - 0.05 * (1.0 - mochi * 0.75)), 0.0, 1.0);
  // 空気: 熱で泡がつぶれる
  p.y = clamp(p.y - uDt * heat * 0.22, 0.0, 1.0);

  frag = p;
}`;

// ---- 質感の時間発展 (props2: shari/mochi/shell/jelly) ----
// 各質感はフレーバーと一緒に移流して運ばれる「その子の個性」。
// 温度でふるまいが変わり、冷やすと元の質感へ戻ろうとする。
export const props2UpdateFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uProps;
uniform sampler2D uProps2;
uniform float uDt;
void main(){
  vec4 q = texture(uProps2, vUv);
  float temp = texture(uProps, vUv).x;
  float coldness = smoothstep(0.40, 0.08, temp);
  float heat = smoothstep(0.55, 0.92, temp);

  // しゃりしゃり: 冷えると粒が育ち直し、熱でとけてなくなる
  q.x = clamp(q.x + uDt * (coldness * 0.20 * smoothstep(0.03, 0.25, q.x) - heat * 0.45), 0.0, 1.0);
  // もちもち: 熱でだれる(ゆっくり)
  q.y = clamp(q.y - uDt * heat * 0.18, 0.0, 1.0);
  // ぱりぱり殻: 冷やすと固まり直し、熱でとける(割れた殻も冷やせば復活)
  q.z = clamp(q.z + uDt * (coldness * 0.16 * smoothstep(0.02, 0.20, q.z) - heat * 0.50), 0.0, 1.0);
  // ぷるぷる: 熱でとける
  q.w = clamp(q.w - uDt * heat * 0.22, 0.0, 1.0);

  frag = q;
}`;

// ---- 指の位置の質感を1回で読み出すサンプルパス ----
// 2x1 の RGBA8 に props(左) / props2(右) をエンコードして readPixels する
export const sampleFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uProps;
uniform sampler2D uProps2;
uniform vec2 uPoint;
void main(){
  frag = vUv.x < 0.5 ? texture(uProps, uPoint) : texture(uProps2, uPoint);
}`;
