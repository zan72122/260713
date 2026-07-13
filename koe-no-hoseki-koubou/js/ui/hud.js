// ============================================================
// Hud — DOM まわり(ボタン・吹き出し・たな・お祝い)をまとめて担当
// main.js からはコールバックで疎結合にする
// ============================================================

import { STEPS_TO_COMPLETE } from '../config.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(cb) {
    this.cb = cb;
    this.bubbleTimer = 0;
    this.padPitch = 'mid';

    // ---- タイトル ----
    $('btn-start').addEventListener('click', () => cb.onStart());

    // ---- コーナーボタン ----
    $('btn-gallery').addEventListener('click', () => cb.onOpenGallery());
    $('btn-mute').addEventListener('click', () => cb.onToggleMute());
    $('btn-info').addEventListener('click', () => this.showInfo(true));
    $('btn-pad').addEventListener('click', () => this.togglePad());

    // ---- ギャラリー ----
    $('btn-close-gallery').addEventListener('click', () => this.showGallery(false));
    $('btn-new-gem').addEventListener('click', () => {
      this.showGallery(false);
      $('confirm-new').classList.remove('hidden');
    });
    $('btn-confirm-yes').addEventListener('click', () => {
      $('confirm-new').classList.add('hidden');
      cb.onNewGem();
    });
    $('btn-confirm-no').addEventListener('click', () => {
      $('confirm-new').classList.add('hidden');
    });

    // ---- お祝い ----
    $('btn-next').addEventListener('click', () => cb.onNextGem());

    // ---- ビューア ----
    $('btn-back').addEventListener('click', () => cb.onExitViewer());

    // ---- info ----
    $('btn-close-info').addEventListener('click', () => this.showInfo(false));
    $('btn-clear-data').addEventListener('click', () => {
      if (confirm('保存した作品をすべて消します。よろしいですか?')) cb.onClearData();
    });
    $('btn-speech-toggle').addEventListener('click', () => cb.onToggleSpeech());

    // ---- こえボタン(パッド) ----
    for (const b of document.querySelectorAll('.pad-p')) {
      b.addEventListener('click', () => {
        this.padPitch = b.dataset.pitch;
        for (const x of document.querySelectorAll('.pad-p')) {
          x.classList.toggle('active', x === b);
        }
      });
    }
    for (const b of document.querySelectorAll('.pad-v')) {
      const start = (e) => {
        e.preventDefault();
        b.setPointerCapture?.(e.pointerId);
        cb.onPadVowelStart(b.dataset.v, this.padPitch);
      };
      const end = (e) => {
        e.preventDefault();
        cb.onPadVowelEnd();
      };
      b.addEventListener('pointerdown', start);
      b.addEventListener('pointerup', end);
      b.addEventListener('pointercancel', end);
    }
    $('pad-blow').addEventListener('click', () => cb.onPadBlow());
    $('pad-clap2').addEventListener('click', () => cb.onPadClap(2));
    $('pad-clap3').addEventListener('click', () => cb.onPadClap(3));

    this._buildTrail();
  }

  // ---------- タイトル ----------
  setTitleStatus(text) { $('title-status').textContent = text; }
  hideTitle() { $('title-screen').classList.add('hidden'); }
  showHud() { $('hud').classList.remove('hidden'); }

  // ---------- レシピの足あと ----------
  _buildTrail() {
    const trail = $('trail');
    trail.innerHTML = '';
    for (let i = 0; i < STEPS_TO_COMPLETE; i++) {
      const slot = document.createElement('div');
      slot.className = 'trail-slot';
      slot.textContent = '·';
      trail.appendChild(slot);
    }
  }

  setTrail(badges) {
    const slots = $('trail').children;
    for (let i = 0; i < slots.length; i++) {
      const badge = badges[i];
      if (badge) {
        slots[i].textContent = badge.label.length > 2 ? badge.emoji : badge.label;
        slots[i].classList.add('filled');
      } else {
        slots[i].textContent = '·';
        slots[i].classList.remove('filled');
      }
    }
  }

  // ---------- 吹き出し ----------
  showBubble(text, colorCss) {
    const b = $('bubble');
    const t = $('bubble-text');
    t.textContent = text;
    if (colorCss) t.style.color = colorCss;
    b.classList.remove('hidden');
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => b.classList.add('hidden'), 800);
  }

  // ---------- 手拍子 ----------
  clapFlash(count) {
    const el = $('clap-flash');
    el.textContent = '👏'.repeat(Math.min(count, 3));
    el.classList.remove('hidden');
    // アニメーションをリスタート
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(this._clapTimer);
    this._clapTimer = setTimeout(() => el.classList.add('hidden'), 600);
  }

  // ---------- ヒント ----------
  showHint(show, text) {
    const el = $('mic-hint');
    if (text) el.textContent = text;
    el.classList.toggle('hidden', !show);
  }

  // ---------- お祝い ----------
  showCelebrate(name, thumbUrl) {
    $('cele-name').textContent = name;
    const img = $('cele-thumb');
    if (thumbUrl) {
      img.src = thumbUrl;
      img.style.display = '';
    } else {
      img.style.display = 'none';
    }
    $('celebrate').classList.remove('hidden');
  }
  hideCelebrate() { $('celebrate').classList.add('hidden'); }

  // ---------- ギャラリー ----------
  showGallery(show, items) {
    const panel = $('gallery');
    panel.classList.toggle('hidden', !show);
    if (!show) return;
    const grid = $('gallery-grid');
    grid.innerHTML = '';
    if (!items || items.length === 0) {
      const p = document.createElement('div');
      p.className = 'gallery-empty';
      p.textContent = 'まだ ほうせきが ないよ。こえで そだててね!';
      grid.appendChild(p);
      return;
    }
    items.forEach((item, idx) => {
      const card = document.createElement('button');
      card.className = 'gem-card';
      const img = document.createElement('img');
      if (item.thumb) img.src = item.thumb;
      img.alt = item.name;
      const name = document.createElement('div');
      name.className = 'gem-name';
      name.textContent = item.name;
      const rec = document.createElement('div');
      rec.className = 'gem-recipe';
      rec.textContent = (item.emojis || []).join(' ');
      card.appendChild(img);
      card.appendChild(name);
      card.appendChild(rec);
      card.addEventListener('click', () => this.cb.onViewGem(idx));
      grid.appendChild(card);
    });
  }

  // ---------- ビューア ----------
  showViewer(name) {
    $('viewer-name').textContent = '💎 ' + name;
    $('viewer-bar').classList.remove('hidden');
  }
  hideViewer() { $('viewer-bar').classList.add('hidden'); }

  // ---------- info ----------
  showInfo(show) { $('info').classList.toggle('hidden', !show); }
  setSpeechLabel(on) {
    $('btn-speech-toggle').textContent = 'おしゃべり: ' + (on ? 'ON' : 'OFF');
  }

  // ---------- その他 ----------
  setMuted(m) { $('btn-mute').textContent = m ? '🔇' : '🔊'; }
  togglePad(force) {
    const pad = $('pad');
    if (force === undefined) pad.classList.toggle('hidden');
    else pad.classList.toggle('hidden', !force);
  }
}
