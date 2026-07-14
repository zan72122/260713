// 最終レンダリング: お皿・アイスの質感表現
import { PLATE_MASK, NOISE } from './common.js';

export const renderFS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uColor;
uniform sampler2D uProps;
uniform sampler2D uProps2;
uniform sampler2D uVelocity;
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
  vec4 q = texture(uProps2, uv);
  float a = min(c.a, 1.6);
  float body = pow(a / 1.6, 0.72) * 1.6;
  float coldness = smoothstep(0.42, 0.10, p.x);
  float melt = smoothstep(0.55, 0.90, p.x);
  // 温度で形がはっきり変わる: キンキンだと高く盛り上がり、とろけると平たく広がる
  body *= mix(1.0, 1.32, coldness) * mix(1.0, 0.42, melt);
  vec2 nUv = uv * vec2(uAspect, 1.0);
  // キンキンではゴツゴツした起伏が立つ
  body *= 1.0 + coldness * (fbm(nUv * 24.0) - 0.5) * 0.55;
  // しゃりしゃり: 粗い氷粒の起伏
  body *= 1.0 + q.x * (vnoise(nUv * 110.0) - 0.5) * 0.34 * (1.0 - melt);
  // ぷるぷる: さわると波打つ
  float sway = min(1.0, length(texture(uVelocity, uv).xy) * 2.4);
  body *= 1.0 + q.w * sway * 0.15 * sin(uTime * 21.0 + (nUv.x + nUv.y) * 150.0);
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
  vec4 q = texture(uProps2, vUv);
  float amount = c.a;
  float temp = p.x, air = p.y, crystal = p.z, gloss = p.w;
  float shari = q.x, mochi = q.y, shell = q.z, jelly = q.w;
  float melt = smoothstep(0.55, 0.9, temp);
  float coldness = smoothstep(0.42, 0.1, temp);
  // 冷たいほど輪郭がきりっと立ち、とろけると縁がだらっと広がる
  float coverage = smoothstep(0.045, mix(0.20, 0.085, coldness) + melt * 0.10, amount);

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
    float nScale = 6.5;
    vec3 N = normalize(vec3(-(hR - hL) * nScale, -(hT - hB) * nScale, 1.0));

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
    // もちもち・ぷるぷるはなめらか
    rough *= max(0.0, 1.0 - mochi * 0.65 - jelly * 0.5);
    albedo *= 1.0 + (grain - 0.5) * rough * 0.26;
    N.xy += (vec2(grain, grain2) - 0.5) * rough * 0.34;

    // しゃりしゃり: 結晶より粗い氷粒。青白くきらめく(2スケールを重ねて自然な粒感に)
    float sgrain = hash12(floor(gUv * 0.55) + 57.0) * 0.6 + hash12(floor(gUv * 0.30) + 77.0) * 0.4;
    float shariAmt = shari * (1.0 - melt * 0.8);
    albedo = mix(albedo, albedo * vec3(0.88, 0.97, 1.10) + vec3(0.05, 0.07, 0.10), shariAmt * 0.30);
    albedo *= 1.0 + (sgrain - 0.45) * shariAmt * 0.30;
    N.xy += (vec2(sgrain, hash12(floor(gUv * 0.55) + 91.0)) - 0.5) * shariAmt * 0.38;
    N = normalize(N);

    // ぷるぷる: 色が濃く透きとおる
    albedo = mix(albedo, albedo * albedo * 1.4, jelly * 0.45);

    // ぱりぱり: チョコ殻コーティング。割れかけはヒビから中の色がのぞく
    float coat = smoothstep(0.25, 0.85, shell);
    if (coat > 0.001) {
      float ridge = abs(fbm(vUv * vec2(uAspect, 1.0) * 34.0) - 0.5) * 2.0;
      float crackedness = smoothstep(0.95, 0.30, shell);
      float crackLine = smoothstep(0.20, 0.02, ridge) * crackedness;
      // ミルクチョコ色。中の色がほんのり透けて「その子の殻」に見える
      vec3 coatCol = mix(vec3(0.42, 0.27, 0.16), albedo * 0.55, 0.22) * (0.9 + 0.2 * grain2);
      vec3 coated = mix(albedo, coatCol, 0.72);
      albedo = mix(albedo, coated, coat * (1.0 - crackLine));
    }

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
    float wet = clamp(gloss + melt * 0.7 + jelly * 0.45 + coat * 0.5, 0.0, 1.0);
    float shininess = mix(6.0, 120.0, wet);
    float spec = pow(max(dot(N, H), 0.0), shininess) * (0.05 + 1.1 * wet);
    spec *= 1.0 - air * 0.55;             // ふわふわはマット
    spec *= 1.0 + crystal * grain * 0.8;  // 粒の照りバラつき
    // もちもち: やわらかく伸びる照り
    spec += pow(max(dot(N, H), 0.0), 20.0) * mochi * 0.22;

    // キラキラ: 氷の結晶 + しゃり粒がまたたく
    float tw = hash12(floor(gUv * 0.9) + floor(uTime * 3.0));
    float glint = step(0.985, tw) * crystal * crystal * coverage * (0.4 + 0.6 * grain);
    float tw2 = hash12(floor(gUv * 0.55) + floor(uTime * 2.0) + 17.0);
    glint += step(0.976, tw2) * shariAmt * coverage * 0.8;

    // ふんわり輪郭光(ぷるぷるもほんのり)
    float rimL = pow(1.0 - N.z, 1.8) * (air * 0.35 + jelly * 0.25);

    vec3 ice = albedo * diff + vec3(1.0) * (spec + glint * 0.9) + albedo * rimL;

    // 薄いシロップやぷるぷるは下のお皿が透ける
    float alpha = coverage * mix(1.0, 0.75, max(syrup * thin, jelly * 0.35));
    col = mix(col, ice, alpha);
  }

  // やわらかい全体ビネット
  vec2 vg = (vUv - 0.5) * vec2(uAspect, 1.0);
  col *= 1.0 - dot(vg, vg) * 0.18;

  frag = vec4(col, 1.0);
}`;
