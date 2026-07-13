// ============================================================
// マイク入力 — getUserMedia + AnalyserNode で毎フレームの特徴量を返す
//   rms      : 音量 (0..~0.5)
//   hz       : ピッチ (0 = 無声)
//   clarity  : ピッチの確からしさ 0..1
//   zcr      : ゼロ交差率
//   vowel    : 'a'..'o' | null
// ============================================================

import { AUDIO } from '../config.js';
import { detectPitch, zeroCrossingRate } from './pitch.js';
import { classifyVowel } from './vowel.js';

export class Mic {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.timeBuf = null;
    this.freqBuf = null;
    this.ready = false;
    this.error = null;
    this.noiseFloor = 0.004; // 適応ノイズ床(ゆっくり追従)
  }

  async start(audioCtx) {
    this.ctx = audioCtx;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // 自分のスピーカー音(効果音)を拾いにくくする
          echoCancellation: true,
          // 息「ふー」も拾いたいのでノイズ抑制は切る(無視される端末もある)
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
      const src = this.ctx.createMediaStreamSource(stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = AUDIO.fftSize;
      this.analyser.smoothingTimeConstant = 0.5;
      src.connect(this.analyser);
      this.timeBuf = new Float32Array(this.analyser.fftSize);
      this.freqBuf = new Float32Array(this.analyser.frequencyBinCount);
      this.ready = true;
      return true;
    } catch (err) {
      this.error = err;
      this.ready = false;
      return false;
    }
  }

  // 毎フレーム呼ぶ。特徴量オブジェクトを返す(未初期化なら null)
  analyse() {
    if (!this.ready) return null;
    const sr = this.ctx.sampleRate;
    this.analyser.getFloatTimeDomainData(this.timeBuf);

    let rms = 0;
    for (let i = 0; i < this.timeBuf.length; i++) {
      rms += this.timeBuf[i] * this.timeBuf[i];
    }
    rms = Math.sqrt(rms / this.timeBuf.length);

    // ノイズ床: 小さい音にはすばやく、大きい音にはとてもゆっくり追従
    if (rms < this.noiseFloor) {
      this.noiseFloor += (rms - this.noiseFloor) * 0.05;
    } else {
      this.noiseFloor += (rms - this.noiseFloor) * 0.0015;
    }
    this.noiseFloor = Math.max(0.0015, Math.min(0.03, this.noiseFloor));

    const { hz, clarity } = detectPitch(
      this.timeBuf, sr, AUDIO.minVoiceHz, AUDIO.maxVoiceHz
    );
    const zcr = zeroCrossingRate(this.timeBuf);

    let vowel = null;
    const voicedish = clarity > 0.6 && hz > 0 && rms > this.voiceThreshold();
    if (voicedish) {
      this.analyser.getFloatFrequencyData(this.freqBuf);
      vowel = classifyVowel(this.freqBuf, sr, this.analyser.fftSize).vowel;
    }

    return { rms, hz, clarity, zcr, vowel, noiseFloor: this.noiseFloor };
  }

  voiceThreshold() {
    return Math.max(AUDIO.voiceRmsFloor, this.noiseFloor * AUDIO.voiceRmsFactor);
  }
}
