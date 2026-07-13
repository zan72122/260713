// 流体シミュレーション本体 (WebGL2)
import { Program, createBlit, createFBO, createDoubleFBO } from './gl.js';
import * as SH from './shaders.js';

const VELOCITY_RES = 256;   // 長辺
const DYE_RES = 1152;       // 長辺(画面が低解像度ならそれ以下に)
const PRESSURE_ITER = 22;

export class IceSim {
  constructor(gl, canvas) {
    this.gl = gl;
    this.canvas = canvas;
    this.blit = createBlit(gl);

    this.progSplatVel = new Program(gl, SH.baseVS, SH.splatVelocityFS);
    this.progSplatColor = new Program(gl, SH.baseVS, SH.splatColorFS);
    this.progSplatProps = new Program(gl, SH.baseVS, SH.splatPropsFS);
    this.progAdvVel = new Program(gl, SH.baseVS, SH.advectVelocityFS);
    this.progDiv = new Program(gl, SH.baseVS, SH.divergenceFS);
    this.progPressure = new Program(gl, SH.baseVS, SH.pressureFS);
    this.progGrad = new Program(gl, SH.baseVS, SH.gradientSubtractFS);
    this.progAdvDye = new Program(gl, SH.baseVS, SH.advectDyeFS);
    this.progMacCormack = new Program(gl, SH.baseVS, SH.macCormackFS);
    this.progPropsUpdate = new Program(gl, SH.baseVS, SH.propsUpdateFS);
    this.progRender = new Program(gl, SH.baseVS, SH.renderFS);

    // お皿(UVでの中心・半径)は main が layout から設定
    this.plateCenter = [0.5, 0.5];
    this.plateRadius = 0.42;
    this.aspect = 1.0;

    this.ambient = 0.5;       // 周囲温度
    this.ambientRate = 0.06;  // 通常時はゆっくり常温へ
    this.sharpness = 0.86;    // マーブルのくっきり度
    this.fade = 1.0;          // リセット中 <1
    this.time = 0;

    this.allocate();
  }

  allocate() {
    const gl = this.gl;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    this.aspect = w / h;
    const velSize = this.resFor(VELOCITY_RES, w, h);
    const dyeSize = this.resFor(Math.min(DYE_RES, Math.max(w, h)), w, h);

    this.velocity = createDoubleFBO(gl, velSize.w, velSize.h, gl.RG16F, gl.RG, gl.HALF_FLOAT, gl.LINEAR);
    this.divergence = createFBO(gl, velSize.w, velSize.h, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST);
    this.pressure = createDoubleFBO(gl, velSize.w, velSize.h, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST);
    this.color = createDoubleFBO(gl, dyeSize.w, dyeSize.h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.props = createDoubleFBO(gl, dyeSize.w, dyeSize.h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    // MacCormack 作業バッファ
    this.dyeTempA = createFBO(gl, dyeSize.w, dyeSize.h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.dyeTempB = createFBO(gl, dyeSize.w, dyeSize.h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
  }

  resFor(base, w, h) {
    const aspect = w / h;
    if (aspect >= 1) return { w: base, h: Math.max(32, Math.round(base / aspect)) };
    return { w: Math.max(32, Math.round(base * aspect)), h: base };
  }

  resize() {
    // 画面サイズが変わったら作り直し(内容は消える: 回転時のみなので許容)
    const gl = this.gl;
    const keepColor = this.color;
    const keepProps = this.props;
    const oldW = keepColor.width, oldH = keepColor.height;
    this.allocate();
    // 旧内容を引き伸ばしコピーして続きを遊べるように
    this.copyInto(keepColor.read, this.color.write); this.color.swap();
    this.copyInto(keepProps.read, this.props.write); this.props.swap();
  }

  copyInto(srcFBO, dstFBO) {
    const gl = this.gl;
    // 単純ブリット(advectDyeを dt=0 で流用)
    const p = this.progAdvDye;
    p.use();
    gl.uniform1i(p.uniforms.uVelocity, this.velocity.read.attach(0));
    gl.uniform1i(p.uniforms.uSource, srcFBO.attach(1));
    gl.uniform1i(p.uniforms.uColor, srcFBO.attach(1));
    gl.uniform1i(p.uniforms.uProps, this.props.read.attach(2));
    gl.uniform1f(p.uniforms.uDt, 0.0);
    gl.uniform1f(p.uniforms.uAspect, this.aspect);
    this.blit(dstFBO);
  }

  setPlate(cx, cy, r) {
    this.plateCenter = [cx, cy];
    this.plateRadius = r;
  }

  bindPlate(prog) {
    const gl = this.gl;
    if (prog.uniforms.uPlateCenter) gl.uniform2f(prog.uniforms.uPlateCenter, this.plateCenter[0], this.plateCenter[1]);
    if (prog.uniforms.uPlateRadius) gl.uniform1f(prog.uniforms.uPlateRadius, this.plateRadius);
    if (prog.uniforms.uAspect) gl.uniform1f(prog.uniforms.uAspect, this.aspect);
  }

  // ---- 入力: かき混ぜ ----
  // point/force はUV系(yは上向き), radiusはy正規化単位
  splatVelocity(x, y, fx, fy, radius) {
    const gl = this.gl;
    const p = this.progSplatVel;
    p.use();
    gl.uniform1i(p.uniforms.uTarget, this.velocity.read.attach(0));
    gl.uniform2f(p.uniforms.uPoint, x, y);
    gl.uniform2f(p.uniforms.uForce, fx, fy);
    gl.uniform1f(p.uniforms.uRadius, radius);
    gl.uniform1f(p.uniforms.uAspect, this.aspect);
    this.blit(this.velocity.write);
    this.velocity.swap();
  }

  splatColor(x, y, radius, r, g, b, amount) {
    const gl = this.gl;
    const p = this.progSplatColor;
    p.use();
    gl.uniform1i(p.uniforms.uTarget, this.color.read.attach(0));
    gl.uniform2f(p.uniforms.uPoint, x, y);
    gl.uniform1f(p.uniforms.uRadius, radius);
    gl.uniform1f(p.uniforms.uAspect, this.aspect);
    gl.uniform4f(p.uniforms.uColorAmt, r, g, b, amount);
    this.blit(this.color.write);
    this.color.swap();
  }

  splatProps(x, y, radius, target, mixAmt, add) {
    const gl = this.gl;
    const p = this.progSplatProps;
    p.use();
    gl.uniform1i(p.uniforms.uTarget, this.props.read.attach(0));
    gl.uniform2f(p.uniforms.uPoint, x, y);
    gl.uniform1f(p.uniforms.uRadius, radius);
    gl.uniform1f(p.uniforms.uAspect, this.aspect);
    gl.uniform4f(p.uniforms.uPropTarget, ...target);
    gl.uniform4f(p.uniforms.uPropMix, ...mixAmt);
    gl.uniform4f(p.uniforms.uPropAdd, ...add);
    this.blit(this.props.write);
    this.props.swap();
  }

  // ---- 1フレーム進める ----
  step(dt) {
    const gl = this.gl;
    this.time += dt;
    gl.disable(gl.BLEND);

    // 速度の移流+減衰
    {
      const p = this.progAdvVel;
      p.use();
      gl.uniform1i(p.uniforms.uVelocity, this.velocity.read.attach(0));
      gl.uniform1i(p.uniforms.uProps, this.props.read.attach(1));
      gl.uniform1i(p.uniforms.uColor, this.color.read.attach(2));
      gl.uniform1f(p.uniforms.uDt, dt);
      this.bindPlate(p);
      this.blit(this.velocity.write);
      this.velocity.swap();
    }

    // 非圧縮化(圧力投影)
    {
      const p = this.progDiv;
      p.use();
      gl.uniform1i(p.uniforms.uVelocity, this.velocity.read.attach(0));
      gl.uniform2f(p.uniforms.uTexel, this.velocity.texelSizeX, this.velocity.texelSizeY);
      this.bindPlate(p);
      this.blit(this.divergence);

      // 圧力初期化(前フレームの0.6倍から開始で収束促進)
      const pc = this.progPressure;
      pc.use();
      gl.uniform2f(pc.uniforms.uTexel, this.velocity.texelSizeX, this.velocity.texelSizeY);
      gl.uniform1i(pc.uniforms.uDivergence, this.divergence.attach(1));
      for (let i = 0; i < PRESSURE_ITER; i++) {
        gl.uniform1i(pc.uniforms.uPressure, this.pressure.read.attach(0));
        this.blit(this.pressure.write);
        this.pressure.swap();
      }

      const pg = this.progGrad;
      pg.use();
      gl.uniform1i(pg.uniforms.uPressure, this.pressure.read.attach(0));
      gl.uniform1i(pg.uniforms.uVelocity, this.velocity.read.attach(1));
      gl.uniform2f(pg.uniforms.uTexel, this.velocity.texelSizeX, this.velocity.texelSizeY);
      this.bindPlate(pg);
      this.blit(this.velocity.write);
      this.velocity.swap();
    }

    // 色: MacCormack 移流 (くっきりマーブル)
    this.advectMacCormack(this.color, dt, this.fade);
    // 状態: 単純移流(なめらかで良い)
    {
      const p = this.progAdvDye;
      p.use();
      gl.uniform1i(p.uniforms.uVelocity, this.velocity.read.attach(0));
      gl.uniform1i(p.uniforms.uSource, this.props.read.attach(1));
      gl.uniform1i(p.uniforms.uColor, this.color.read.attach(2));
      gl.uniform1i(p.uniforms.uProps, this.props.read.attach(3));
      gl.uniform1f(p.uniforms.uDt, dt);
      gl.uniform1f(p.uniforms.uAspect, this.aspect);
      this.blit(this.props.write);
      this.props.swap();
    }

    // 状態の時間発展
    {
      const p = this.progPropsUpdate;
      p.use();
      gl.uniform1i(p.uniforms.uProps, this.props.read.attach(0));
      gl.uniform1i(p.uniforms.uColor, this.color.read.attach(1));
      gl.uniform1f(p.uniforms.uDt, dt);
      gl.uniform1f(p.uniforms.uAmbient, this.ambient);
      gl.uniform1f(p.uniforms.uAmbientRate, this.ambientRate);
      this.blit(this.props.write);
      this.props.swap();
    }
  }

  advectMacCormack(field, dt, fade) {
    const gl = this.gl;
    const adv = this.progAdvDye;

    // 前進 φ1
    adv.use();
    gl.uniform1i(adv.uniforms.uVelocity, this.velocity.read.attach(0));
    gl.uniform1i(adv.uniforms.uSource, field.read.attach(1));
    gl.uniform1i(adv.uniforms.uColor, this.color.read.attach(2));
    gl.uniform1i(adv.uniforms.uProps, this.props.read.attach(3));
    gl.uniform1f(adv.uniforms.uDt, dt);
    gl.uniform1f(adv.uniforms.uAspect, this.aspect);
    this.blit(this.dyeTempA);

    // 後退 φ2
    gl.uniform1i(adv.uniforms.uSource, this.dyeTempA.attach(1));
    gl.uniform1f(adv.uniforms.uDt, -dt);
    this.blit(this.dyeTempB);

    // 合成
    const mc = this.progMacCormack;
    mc.use();
    gl.uniform1i(mc.uniforms.uVelocity, this.velocity.read.attach(0));
    gl.uniform1i(mc.uniforms.uSource, field.read.attach(1));
    gl.uniform1i(mc.uniforms.uForward, this.dyeTempA.attach(2));
    gl.uniform1i(mc.uniforms.uBackward, this.dyeTempB.attach(3));
    gl.uniform1i(mc.uniforms.uColor, this.color.read.attach(4));
    gl.uniform1i(mc.uniforms.uProps, this.props.read.attach(5));
    gl.uniform1f(mc.uniforms.uDt, dt);
    this.bindPlate(mc);
    gl.uniform1f(mc.uniforms.uSharpness, this.sharpness);
    gl.uniform1f(mc.uniforms.uFade, fade);
    this.blit(field.write);
    field.swap();
  }

  render() {
    const gl = this.gl;
    const p = this.progRender;
    p.use();
    gl.uniform1i(p.uniforms.uColor, this.color.read.attach(0));
    gl.uniform1i(p.uniforms.uProps, this.props.read.attach(1));
    gl.uniform1f(p.uniforms.uTime, this.time);
    gl.uniform1f(p.uniforms.uAmbient, this.ambient);
    gl.uniform2f(p.uniforms.uResolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
    this.bindPlate(p);
    this.blit(null);
  }
}
