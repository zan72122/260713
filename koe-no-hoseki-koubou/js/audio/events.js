// ============================================================
// VoiceEngine — マイク特徴量を「あそびのイベント」に変換する状態機械
//
// 発火するイベント:
//   level        毎フレーム { level, hz, vowel, active }
//   voiceStart   声が始まった
//   voiceHold    声が続いている { vowel, winner, hz, elapsed, level }
//   voiceEnd     声が終わった { vowel, medianHz, pitchBucket, durationBucket, duration }
//   blowStart / blowHold { elapsed } / blowEnd { duration }
//   clap         1回の手拍子 { count }(そのときまでの回数)
//   clapPattern  手拍子の組が確定 { count }
// ============================================================

import { AUDIO, PITCH, DURATION } from '../config.js';
import { VowelVote } from './vowel.js';

const now = () => performance.now();

export function pitchBucketOf(hz) {
  if (hz <= 0) return 'mid';
  if (hz < PITCH.lowMax) return 'low';
  if (hz >= PITCH.highMin) return 'high';
  return 'mid';
}

export function durationBucketOf(sec) {
  if (sec < DURATION.shortMax) return 'short';
  if (sec >= DURATION.longMin) return 'long';
  return 'mid';
}

export class VoiceEngine {
  constructor(mic) {
    this.mic = mic;
    this.listeners = {};

    // 声の状態
    this.voicing = false;
    this.voiceCandidateSince = 0; // 有声フレームが始まった時刻
    this.voiceStartAt = 0;
    this.lastVoicedAt = 0;
    this.hzSamples = [];
    this.vote = new VowelVote();

    // 手拍子
    this.rmsEma = 0.005;
    this.clapCount = 0;
    this.lastClapAt = -1e9;

    // 息(ふー)
    this.blowing = false;
    this.blowCandidateSince = 0;
    this.blowStartAt = 0;
    this.lastBlowFrameAt = 0;

    // ボタン入力(マイク無しモード)
    this.synth = null; // { vowel, hz, startAt }
  }

  on(event, cb) {
    (this.listeners[event] ||= []).push(cb);
    return this;
  }
  emit(event, payload) {
    const cbs = this.listeners[event];
    if (cbs) for (const cb of cbs) cb(payload || {});
  }

  // ---- ボタン入力(マイクが使えない/使わないとき) ----
  synthStart(vowel, hz = 300) {
    if (this.synth || this.voicing) return;
    this.synth = { vowel, hz, startAt: now() };
    this._beginVoice(this.synth.startAt);
  }
  synthEnd() {
    if (!this.synth) return;
    const t = now();
    this.vote.add(this.synth.vowel);
    this.hzSamples.push(this.synth.hz);
    this._endVoice(t, (t - this.synth.startAt) / 1000);
    this.synth = null;
  }
  synthClap(count) {
    this.emit('clapPattern', { count });
  }
  synthBlow(durationSec = 1.0) {
    this.emit('blowStart', {});
    this.emit('blowEnd', { duration: durationSec });
  }

  // ---- 毎フレーム呼ぶ ----
  update() {
    const t = now();

    // ボタン入力中はマイクを見ずにホールドを流す
    if (this.synth) {
      const elapsed = (t - this.synth.startAt) / 1000;
      this.vote.add(this.synth.vowel);
      this.hzSamples.push(this.synth.hz);
      this.emit('voiceHold', {
        vowel: this.synth.vowel,
        winner: this.synth.vowel,
        hz: this.synth.hz,
        elapsed,
        level: 0.5,
      });
      this.emit('level', {
        level: 0.5, hz: this.synth.hz, vowel: this.synth.vowel, active: true,
      });
      return;
    }

    const f = this.mic ? this.mic.analyse() : null;
    if (!f) {
      this.emit('level', { level: 0, hz: 0, vowel: null, active: false });
      return;
    }

    const threshold = this.mic.voiceThreshold();
    const loud = f.rms > threshold;
    const voicedFrame =
      loud && f.clarity > 0.6 && f.hz >= AUDIO.minVoiceHz && f.hz <= AUDIO.maxVoiceHz;
    const noisyFrame = loud && f.clarity < 0.5;

    const level = Math.min(1, f.rms / 0.18);
    this.emit('level', {
      level, hz: f.hz, vowel: f.vowel, active: this.voicing || this.blowing,
    });

    // ---------- 声 ----------
    if (voicedFrame) {
      this.lastVoicedAt = t;
      if (!this.voicing) {
        if (this.voiceCandidateSince === 0) this.voiceCandidateSince = t;
        if (t - this.voiceCandidateSince >= AUDIO.voiceStartMs) {
          this._beginVoice(this.voiceCandidateSince);
          // 声が確定したら手拍子・息の誤検出を取り消す
          this.clapCount = 0;
          this._cancelBlow();
        }
      }
      if (this.voicing) {
        this.vote.add(f.vowel);
        if (f.clarity > 0.7) this.hzSamples.push(f.hz);
        this.emit('voiceHold', {
          vowel: f.vowel,
          winner: this.vote.winner(),
          hz: f.hz,
          elapsed: (t - this.voiceStartAt) / 1000,
          level,
        });
      }
    } else {
      this.voiceCandidateSince = 0;
      if (this.voicing && t - this.lastVoicedAt > AUDIO.voiceEndMs) {
        this._endVoice(t, (this.lastVoicedAt - this.voiceStartAt) / 1000);
      }
    }

    // ---------- 息(ふー): 声ではない大きめのノイズが続く ----------
    if (!this.voicing) {
      if (noisyFrame) {
        this.lastBlowFrameAt = t;
        if (this.blowCandidateSince === 0) this.blowCandidateSince = t;
        if (!this.blowing && t - this.blowCandidateSince >= AUDIO.blowMinMs) {
          this.blowing = true;
          this.blowStartAt = this.blowCandidateSince;
          this.clapCount = 0; // 息の立ち上がりを手拍子と誤認した分を消す
          this.emit('blowStart', {});
        }
        if (this.blowing) {
          this.emit('blowHold', { elapsed: (t - this.blowStartAt) / 1000 });
        }
      } else if (this.blowing) {
        if (t - this.lastBlowFrameAt > 300) {
          const duration = (this.lastBlowFrameAt - this.blowStartAt) / 1000;
          this._cancelBlow();
          this.emit('blowEnd', { duration });
        }
      } else if (!noisyFrame && t - this.lastBlowFrameAt > 300) {
        this.blowCandidateSince = 0;
      }
    }

    // ---------- 手拍子: 鋭い立ち上がりの短いノイズ ----------
    if (!this.voicing && !this.blowing) {
      const spike =
        f.rms > Math.max(this.rmsEma * 3.5, threshold * 1.6) &&
        f.clarity < 0.55;
      if (spike && t - this.lastClapAt > AUDIO.clapRefractoryMs) {
        this.lastClapAt = t;
        this.clapCount++;
        this.emit('clap', { count: this.clapCount });
      }
      // 組の確定
      if (
        this.clapCount > 0 &&
        t - this.lastClapAt > AUDIO.clapWindowMs
      ) {
        const count = this.clapCount;
        this.clapCount = 0;
        this.emit('clapPattern', { count });
      }
    }

    // 音量のゆっくり平均(手拍子スパイク検出の基準)
    this.rmsEma += (f.rms - this.rmsEma) * 0.06;
  }

  _beginVoice(t) {
    this.voicing = true;
    this.voiceStartAt = t;
    this.hzSamples = [];
    this.vote.reset();
    this.emit('voiceStart', {});
  }

  _endVoice(t, durationSec) {
    this.voicing = false;
    this.voiceCandidateSince = 0;
    const duration = Math.max(0.15, durationSec);
    const sorted = [...this.hzSamples].sort((a, b) => a - b);
    const medianHz = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    this.emit('voiceEnd', {
      vowel: this.vote.winner(),
      medianHz,
      pitchBucket: pitchBucketOf(medianHz),
      durationBucket: durationBucketOf(duration),
      duration,
    });
  }

  _cancelBlow() {
    this.blowing = false;
    this.blowCandidateSince = 0;
  }
}
