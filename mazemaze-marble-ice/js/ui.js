// UI: 文字なし・絵アイコンのみのボタン群
// フレーバー / トッピング / 道具 / 温度 / 音 / リセット(長押し)

// フレーバーごとの固有質感:
//   props  = [temp, air, crystal, gloss]  (温度 / ふわふわ / ざらざら / ツヤ)
//   props2 = [shari, mochi, shell, jelly] (しゃりしゃり / もちもち / ぱりぱり / ぷるぷる)
// 質感は色と一緒に運ばれて混ざり合う(=フレーバーの個性が持続する)
export const FLAVORS = [
  { id: 'straw',   color: [0.96, 0.36, 0.47], drip: '#f45c78', body: '#ff8aa0',   // いちご(赤): ぷるぷるゼリー
    props: [0.34, 0.55, 0.10, 0.30], props2: [0.00, 0.05, 0.00, 0.85] },
  { id: 'soda',    color: [0.32, 0.58, 0.95], drip: '#3a7bd5', body: '#6fa8ff',   // ソーダ(青): しゃりしゃりシャーベット
    props: [0.26, 0.45, 0.55, 0.08], props2: [0.90, 0.00, 0.00, 0.00] },
  { id: 'vanilla', color: [0.99, 0.96, 0.87], drip: '#e8ddb8', body: '#fdf6e0',   // バニラ(白): ふわふわ
    props: [0.32, 0.95, 0.12, 0.05], props2: [0.00, 0.05, 0.00, 0.00] },
  { id: 'mango',   color: [1.00, 0.78, 0.25], drip: '#f0a818', body: '#ffcf59',   // マンゴー(黄): もちもち
    props: [0.36, 0.45, 0.08, 0.28], props2: [0.00, 0.90, 0.00, 0.10] },
  { id: 'choco',   color: [0.42, 0.26, 0.16], drip: '#4a2c18', body: '#7a4a2a',   // チョコ(茶): ねっとり
    props: [0.40, 0.28, 0.05, 0.60], props2: [0.00, 0.35, 0.00, 0.00] },
  { id: 'mint',    color: [0.62, 0.89, 0.76], drip: '#59c39a', body: '#a8ecd2',   // チョコミント(緑): ぱりぱり殻
    props: [0.28, 0.55, 0.25, 0.10], props2: [0.15, 0.00, 0.85, 0.00] },
];

function scoopSVG(body, drip) {
  return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="20" cy="19" rx="15" ry="13.5" fill="${body}"/>
    <path d="M6 22 q3 6 6 1 q2 7 6 2 q2 6 6 1 q3 6 6 0 q3 4 4 -4 L6 20 z" fill="${drip}"/>
    <ellipse cx="14" cy="14" rx="4.5" ry="3" fill="#ffffff" opacity="0.55"/>
  </svg>`;
}

const TOOL_SVGS = {
  finger: `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <path d="M17 8 q0 -4 3 -4 q3 0 3 4 v10 q4 -2 8 0 q3 2 2 5 l-3 9 q-1 4 -5 4 h-7 q-4 0 -6 -4 l-4 -8 q-1 -3 2 -4 q3 -1 4 2 l3 3 z" fill="#ffd9b8" stroke="#d89860" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`,
  spoon: `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(40 20 20)">
      <ellipse cx="20" cy="11" rx="7.5" ry="9" fill="#e8ecf2" stroke="#9aa6b8" stroke-width="1.5"/>
      <ellipse cx="18" cy="8.5" rx="2.6" ry="3.4" fill="#ffffff" opacity="0.8"/>
      <rect x="18" y="19" width="4" height="17" rx="2" fill="#cdd6e2" stroke="#9aa6b8" stroke-width="1.2"/>
    </g>
  </svg>`,
  spatula: `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(40 20 20)">
      <path d="M12 4 h16 q1.5 0 1.5 1.5 v9 q0 5 -5 5 h-9 q-5 0 -5 -5 v-9 q0 -1.5 1.5 -1.5 z" fill="#ffb35c" stroke="#d88a2e" stroke-width="1.6"/>
      <line x1="17" y1="6" x2="17" y2="12" stroke="#d88a2e" stroke-width="1.4"/>
      <line x1="23" y1="6" x2="23" y2="12" stroke="#d88a2e" stroke-width="1.4"/>
      <rect x="18" y="19" width="4" height="17" rx="2" fill="#c98a4b" stroke="#a56a30" stroke-width="1.2"/>
    </g>
  </svg>`,
};

// カーソル用の大きい道具(先端=接触点が中央に来るようオフセット描画)
export const CURSOR_SVGS = {
  spoon: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(32 50 50)">
      <rect x="46" y="46" width="9" height="46" rx="4.5" fill="#dbe3ee" stroke="#9aa6b8" stroke-width="2"/>
      <ellipse cx="50.5" cy="32" rx="17" ry="21" fill="#eef1f6" stroke="#9aa6b8" stroke-width="2"/>
      <ellipse cx="45" cy="25" rx="6" ry="8" fill="#ffffff" opacity="0.85"/>
    </g>
  </svg>`,
  spatula: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(32 50 50)">
      <path d="M31 12 h38 q3 0 3 3 v22 q0 12 -12 12 h-20 q-12 0 -12 -12 v-22 q0 -3 3 -3 z" fill="#ffb35c" stroke="#d88a2e" stroke-width="2.4"/>
      <line x1="43" y1="17" x2="43" y2="32" stroke="#d88a2e" stroke-width="2.4"/>
      <line x1="57" y1="17" x2="57" y2="32" stroke="#d88a2e" stroke-width="2.4"/>
      <rect x="45.5" y="49" width="9" height="44" rx="4.5" fill="#c98a4b" stroke="#a56a30" stroke-width="2"/>
    </g>
  </svg>`,
};

export const TOPPINGS = [
  { id: 'cookie', emoji: '🍪' },
  { id: 'chip',   emoji: '🍫' },
  { id: 'berry',  emoji: '🍓' },
];

export class UI {
  // handlers: onFlavor(f), onTopping(t), onTool(t), onTempDown(kind), onTempUp,
  //           onSoundToggle(on), onReset, onAnyPress()
  constructor(handlers) {
    this.h = handlers;
    this.tool = 'finger';
    this.soundOn = true;
    this.buildFlavors();
    this.buildToppings();
    this.buildTools();
    this.buildTemps();
    this.buildMisc();
  }

  mkBtn(parent, html, label) {
    const b = document.createElement('button');
    b.className = 'gamebtn';
    b.innerHTML = html;
    b.setAttribute('aria-label', label);
    parent.appendChild(b);
    return b;
  }

  boing(b) {
    b.classList.remove('boing');
    void b.offsetWidth;
    b.classList.add('boing');
  }

  deny(b) {
    b.classList.remove('deny');
    void b.offsetWidth;
    b.classList.add('deny');
  }

  buildFlavors() {
    const el = document.getElementById('flavors');
    for (const f of FLAVORS) {
      const b = this.mkBtn(el, scoopSVG(f.body, f.drip), f.id);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.h.onAnyPress();
        const ok = this.h.onFlavor(f);
        ok ? this.boing(b) : this.deny(b);
      });
    }
  }

  buildToppings() {
    const el = document.getElementById('toppings');
    for (const t of TOPPINGS) {
      const b = this.mkBtn(el, `<span class="em">${t.emoji}</span>`, t.id);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.h.onAnyPress();
        const ok = this.h.onTopping(t);
        ok ? this.boing(b) : this.deny(b);
      });
    }
  }

  buildTools() {
    const el = document.getElementById('tools');
    this.toolBtns = {};
    for (const id of ['finger', 'spoon', 'spatula']) {
      const b = this.mkBtn(el, TOOL_SVGS[id], id);
      this.toolBtns[id] = b;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.h.onAnyPress();
        this.selectTool(id);
      });
    }
    this.selectTool('finger', true);
  }

  selectTool(id, silent) {
    this.tool = id;
    for (const k in this.toolBtns) this.toolBtns[k].classList.toggle('selected', k === id);
    if (!silent) this.h.onTool(id);
  }

  buildTemps() {
    const el = document.getElementById('temps');
    const mk = (emoji, kind) => {
      const b = this.mkBtn(el, `<span class="em">${emoji}</span>`, kind);
      const down = (e) => {
        e.preventDefault();
        this.h.onAnyPress();
        b.classList.add('holding');
        this.h.onTempDown(kind);
      };
      const up = () => {
        b.classList.remove('holding');
        this.h.onTempUp();
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      return b;
    };
    mk('❄️', 'cold');
    mk('☀️', 'warm');
  }

  buildMisc() {
    const el = document.getElementById('misc');

    // 音トグル
    const sb = this.mkBtn(el, `<span class="em">🔊</span>`, 'sound');
    sb.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.h.onAnyPress();
      this.soundOn = !this.soundOn;
      sb.querySelector('.em').textContent = this.soundOn ? '🔊' : '🔇';
      this.boing(sb);
      this.h.onSoundToggle(this.soundOn);
    });

    // リセット(1秒長押し・リング表示)
    const rb = this.mkBtn(el, `
      <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 7 a13 13 0 1 1 -12.1 8" fill="none" stroke="#e06a9a" stroke-width="4.5" stroke-linecap="round"/>
        <path d="M4 8 l5 8 l7 -6 z" fill="#e06a9a"/>
      </svg>
      <svg id="resetring" viewBox="0 0 70 70">
        <circle cx="35" cy="35" r="32" fill="none" stroke="#ff9ecb" stroke-width="5"
          stroke-dasharray="201" stroke-dashoffset="201" stroke-linecap="round"
          transform="rotate(-90 35 35)"/>
      </svg>`, 'reset');
    const ring = rb.querySelector('#resetring circle');
    const ringEl = rb.querySelector('#resetring');
    let holdStart = 0, raf = 0;
    const HOLD_MS = 900;
    const tick = () => {
      const p = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
      ring.style.strokeDashoffset = String(201 * (1 - p));
      if (p >= 1) {
        cancel();
        this.boing(rb);
        this.h.onReset();
      } else {
        raf = requestAnimationFrame(tick);
      }
    };
    const start = (e) => {
      e.preventDefault();
      this.h.onAnyPress();
      holdStart = performance.now();
      ringEl.classList.add('active');
      raf = requestAnimationFrame(tick);
    };
    const cancel = () => {
      cancelAnimationFrame(raf);
      ringEl.classList.remove('active');
      ring.style.strokeDashoffset = '201';
    };
    rb.addEventListener('pointerdown', start);
    rb.addEventListener('pointerup', cancel);
    rb.addEventListener('pointercancel', cancel);
    rb.addEventListener('pointerleave', cancel);
  }
}
