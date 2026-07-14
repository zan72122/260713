// シェーダー共通部品
// 状態テクスチャの構成:
//   velocity: RG16F  (vx, vy)  正規化y単位/秒
//   color:    RGBA16F (r, g, b, amount) amount=アイスの量(高さの元)
//   props:    RGBA16F (temp, air, crystal, gloss)
//     temp:    0=キンキン 0.5=ふつう 1=とろとろ
//     air:     空気量 1=ふわふわ 0=つぶれた
//     crystal: 氷結晶 1=ざらざら 0=なめらか
//     gloss:   表面ツヤ
//   props2:   RGBA16F (shari, mochi, shell, jelly) — フレーバー固有の質感
//     shari:   しゃりしゃり(シャーベットの粗い氷粒)
//     mochi:   もちもち(のびる粘弾性)
//     shell:   ぱりぱり(チョコ殻コーティング。混ぜると割れる)
//     jelly:   ぷるぷる(ゼリーの揺れ)

export const baseVS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const NOISE = `
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

export const PLATE_MASK = `
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

// 溶けた分の「たれ流れ」速度(高さ勾配を下る)
export const MELT_FLOW = `
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
