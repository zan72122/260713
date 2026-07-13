// ============================================================
// こえの宝石工房 — 設定と対応表
// 「どの音が、どんな宝石になるか」はすべてここで決まる。
// 同じ入力からは必ず同じ宝石が育つ(決定論)。
// ============================================================

// 母音ごとの見た目の定義
//   shape   : gemBuilder が使う形のキー
//   hues    : 使う色相(HSL の H, 0..1)。ピッチで明暗が変わる
//   label   : 画面に出すひらがな
export const VOWELS = {
  a: {
    label: 'あ',
    shape: 'bulb',      // 丸くふくらむ
    hues: [0.98, 0.02, 0.06], // ピンク・赤・オレンジ
    emoji: '🌸',
  },
  i: {
    label: 'い',
    shape: 'needle',    // 細く鋭い結晶
    hues: [0.55, 0.58, 0.62], // 水色・青・銀
    emoji: '❄️',
  },
  u: {
    label: 'う',
    shape: 'drop',      // ぽってりした雫型
    hues: [0.72, 0.76, 0.68], // 紫・藍
    emoji: '💜',
  },
  e: {
    label: 'え',
    shape: 'branch',    // 枝分かれ
    hues: [0.30, 0.26, 0.36], // 緑・黄緑
    emoji: '🌿',
  },
  o: {
    label: 'お',
    shape: 'ring',      // 大きな輪・金の層
    hues: [0.12, 0.10, 0.14], // 金色・琥珀
    emoji: '⭐',
  },
};

// 特殊入力
export const SPECIALS = {
  blow: { label: 'ふー', shape: 'frost', emoji: '🌨️' },   // 白い霧・雪結晶
  clap2: { label: '👏👏', shape: 'stripes2', emoji: '〰️' }, // 2本の筋
  clap3: { label: '👏👏👏', shape: 'tri', emoji: '🔺' },     // 三角・三つ葉
};

// ピッチのバケツ分け(子どもの声は高めなので高域寄り)
export const PITCH = {
  lowMax: 220,   // これ未満 → ひくい声
  highMin: 340,  // これ以上 → たかい声
};

// 長さのバケツ分け(秒)
export const DURATION = {
  shortMax: 0.45, // これ未満 → みじかい声(星の粒)
  longMin: 1.4,   // これ以上 → ながい声(層が厚くなる)
};

// 宝石が完成するまでの成長ステップ数
export const STEPS_TO_COMPLETE = 7;

// マイク解析パラメータ
export const AUDIO = {
  fftSize: 2048,
  minVoiceHz: 90,
  maxVoiceHz: 900,
  // 有声判定: RMS がノイズ床の何倍か
  voiceRmsFactor: 4.0,
  voiceRmsFloor: 0.012,
  // 声とみなす最短時間(ミリ秒)。誤検出よけ
  voiceStartMs: 140,
  voiceEndMs: 220,
  // 手拍子
  clapRefractoryMs: 260,
  clapWindowMs: 1300,
  // ふー(息)
  blowMinMs: 420,
};

// 子ども(高め)の声を想定した日本語5母音のフォルマント目安 [F1, F2] Hz
// 大人〜子どもの中間くらいに置き、対数距離の最近傍で分類する
export const FORMANTS = {
  a: [950, 1650],
  i: [400, 2900],
  u: [440, 1450],
  e: [600, 2350],
  o: [550, 1000],
};

// ギャラリー保存
export const STORAGE_KEYS = {
  gallery: 'koe-gems-gallery-v1',
  current: 'koe-gems-current-v1',
  settings: 'koe-gems-settings-v1',
};
export const GALLERY_MAX = 24;

// ほめことば(完成時にランダムで1つ・音声合成)
export const PRAISES = [
  'わあ! きれいな ほうせきが できたよ!',
  'すごい! ぴかぴかの ほうせきだね!',
  'やったね! せかいに ひとつだけの ほうせきだよ!',
  'きらきら! とっても すてきだね!',
];

// 育成中の掛け声(ステップごと)
export const CHEERS = [
  'いいこえ!',
  'そだってきたよ!',
  'きらきら ふえたね!',
  'もうすこし!',
  'すごい すごい!',
];
