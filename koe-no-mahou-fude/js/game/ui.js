/**
 * UI — 画面遷移・HUD・ようせいのメッセージ・母音ボタン。
 * 文字が読めなくても遊べるよう、色とアイコンで意味が伝わるようにする。
 */
import { WORLDS } from './worlds.js';
import { VOWEL_MAIN } from './effects.js';

const PRAISE = ['すごい！', 'きれい！', 'いろが ついたね！', 'まほう じょうず！', 'わあ！', 'ぴかぴか！'];
const HINTS = [
  '「あーー」で ピンクの にじみ',
  '「いーー」で ほしが しゅーん',
  '「うーー」で あわ ぷくぷく',
  '「えーー」で はっぱ ぐんぐん',
  '「おーー」で きんの わっか',
  '「ふーー」で かぜが ふくよ',
  '「ぱっ！」で スタンプ',
  'たかい こえと ひくい こえで ちがうよ',
  'ながーく こえを だすと おおきく そまるよ',
  'ちいさな こえでも だいじょうぶ',
];

export class UI {
  constructor() {
    this.$ = (id) => document.getElementById(id);
    this.screens = {
      title: this.$('screen-title'),
      mic: this.$('screen-mic'),
      select: this.$('screen-select'),
      game: this.$('screen-game'),
      celebrate: this.$('screen-celebrate'),
      parent: this.$('screen-parent'),
    };
    this.progressFill = this.$('progress-fill');
    this.progressStar = this.$('progress-star');
    this.fairyBubble = this.$('fairy-bubble');
    this.fairyText = this.$('fairy-text');
    this.micMeter = this.$('mic-meter');
    this.micDot = this.$('mic-meter-dot');
    this.toastEl = this.$('toast');

    this._bubbleTimer = null;
    this._hintTimer = null;
    this._hintIdx = 0;
    this._praiseIdx = 0;

    this.onSelectWorld = null;
    this.onVowelHold = null;    // (vowel|null, pitchNorm) => void
    this.onMuteToggle = null;
    this.onBack = null;
    this.onNext = null;

    this._buildVowelButtons();
    this._bindButtons();
  }

  show(name) {
    for (const key in this.screens) this.screens[key].classList.toggle('visible', key === name);
  }
  isShown(name) { return this.screens[name].classList.contains('visible'); }

  /* ---------- せかいえらび ---------- */
  buildWorldGrid(clearedIds) {
    const grid = this.$('world-grid');
    grid.innerHTML = '';
    WORLDS.forEach((w, i) => {
      const btn = document.createElement('button');
      btn.className = 'world-card' + (clearedIds.includes(w.id) ? ' cleared' : '');
      btn.innerHTML = `<span class="icon">${w.icon}</span><span class="name">${w.name}</span><span class="done-star">⭐</span>`;
      btn.addEventListener('click', () => this.onSelectWorld && this.onSelectWorld(i));
      grid.appendChild(btn);
    });
  }

  /* ---------- HUD ---------- */
  setProgress(p) {
    this.progressFill.style.width = `${Math.round(p * 100)}%`;
  }

  starPulse() {
    this.progressStar.classList.remove('pulse');
    void this.progressStar.offsetWidth;
    this.progressStar.classList.add('pulse');
  }

  praise() {
    this.say(PRAISE[this._praiseIdx++ % PRAISE.length], 2000);
  }

  say(text, ms = 3500) {
    this.fairyText.textContent = `🧚 ${text}`;
    this.fairyBubble.classList.remove('hidden');
    clearTimeout(this._bubbleTimer);
    this._bubbleTimer = setTimeout(() => this.fairyBubble.classList.add('hidden'), ms);
  }

  startHints(firstMsg) {
    this.stopHints();
    if (firstMsg) this.say(firstMsg, 4200);
    this._hintTimer = setInterval(() => {
      if (!this.isShown('game')) return;
      this.say(HINTS[this._hintIdx++ % HINTS.length], 3800);
    }, 16000);
  }
  stopHints() { clearInterval(this._hintTimer); }

  /** マイクの状態表示: 声が届いていれば ピンクにぽわん（大きさは変えない=音量ノーカウント） */
  setMicState(active, level) {
    this.micMeter.classList.toggle('on', active);
    const s = active ? 1.6 : 0.8 + level * 0.5;
    this.micDot.style.transform = `scale(${s})`;
  }

  /** マイクが検出した母音のボタンを光らせる */
  flashVowel(vowel) {
    if (this._lastFlash === vowel) return;
    this._lastFlash = vowel;
    for (const b of this.vowelButtons) {
      b.classList.toggle('detected', b.dataset.vowel === vowel);
    }
    if (!vowel) return;
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => {
      this._lastFlash = null;
      for (const b of this.vowelButtons) b.classList.remove('detected');
    }, 450);
  }

  setMuted(m) {
    const icon = m ? '🔇' : '🔊';
    this.$('btn-mute').textContent = icon;
    this.$('btn-mute2').textContent = icon;
  }

  toast(text, ms = 3200) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.add('hidden'), ms);
  }

  celebrate(worldName) {
    this.$('celebrate-sub').textContent = `${worldName} が いろで いっぱい！`;
    this.show('celebrate');
  }

  /* ---------- 母音ボタン（マイクなしでも遊べる） ---------- */
  _buildVowelButtons() {
    this.vowelButtons = Array.from(document.querySelectorAll('.vowel-btn'));
    for (const btn of this.vowelButtons) {
      const vowel = btn.dataset.vowel;
      btn.style.setProperty('--held-c', VOWEL_MAIN[vowel]);
      const hold = (e) => {
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        btn.classList.add('held');
        // ボタン内の上下で「こえのたかさ」も変えられる
        const rect = btn.getBoundingClientRect();
        const pitch = 1 - Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1);
        if (this.onVowelHold) this.onVowelHold(vowel, pitch);
      };
      const release = () => {
        btn.classList.remove('held');
        if (this.onVowelHold) this.onVowelHold(null, 0.5);
      };
      btn.addEventListener('pointerdown', hold);
      btn.addEventListener('pointermove', (e) => { if (btn.classList.contains('held')) hold(e); });
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
    }
    // デスクトップ用: A I U E O キー
    const keymap = { a: 'a', i: 'i', u: 'u', e: 'e', o: 'o' };
    window.addEventListener('keydown', (e) => {
      const v = keymap[e.key.toLowerCase()];
      if (v && !e.repeat && this.onVowelHold) this.onVowelHold(v, 0.5);
    });
    window.addEventListener('keyup', (e) => {
      const v = keymap[e.key.toLowerCase()];
      if (v && this.onVowelHold) this.onVowelHold(null, 0.5);
    });
  }

  _bindButtons() {
    this.$('btn-mute').addEventListener('click', () => this.onMuteToggle && this.onMuteToggle());
    this.$('btn-mute2').addEventListener('click', () => this.onMuteToggle && this.onMuteToggle());
    this.$('btn-back').addEventListener('click', () => this.onBack && this.onBack());
    this.$('btn-next').addEventListener('click', () => this.onNext && this.onNext());
    this.$('btn-parent').addEventListener('click', () => this.show('parent'));
    this.$('btn-parent-close').addEventListener('click', () => this.show('title'));
  }
}
