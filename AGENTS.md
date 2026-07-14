# AGENTS.md

このリポジトリは、4歳児向けのブラウザゲーム3本を集めたモノレポです。各ゲームは独立した静的サイトで、バックエンド・DB・ビルド手順・パッケージマネージャはありません。

| ゲーム | ディレクトリ | 概要 | 入力 |
| --- | --- | --- | --- |
| まぜまぜマーブル・アイス | `mazemaze-marble-ice/` | WebGL2流体シミュのアイス混ぜ | タッチ/マウスのみ |
| こえの魔法筆 | `koe-no-mahou-fude/` | 声＋なぞりで3D世界に色を塗る (Three.js) | マイク＋タッチ（母音ボタン/キーで代替可） |
| こえの宝石工房 | `koe-no-hoseki-koubou/` | 声で3D宝石を育てる (Three.js) | マイク（画面ボイスパッドで代替可） |

各ゲームの詳細・遊び方は各ディレクトリの `README.md` を参照してください。

## Cursor Cloud specific instructions

- 依存インストールもビルドも不要。ES modules を使うため `file://` では動かず、必ず静的HTTPサーバ経由で開くこと。
- リポジトリルートから配信するのが最も簡単:
  - `python3 -m http.server 8000`
  - まぜまぜマーブル・アイス: `http://localhost:8000/mazemaze-marble-ice/`
  - こえの魔法筆: `http://localhost:8000/koe-no-mahou-fude/`
  - こえの宝石工房: `http://localhost:8000/koe-no-hoseki-koubou/`
- 3本ともWebGLが必要。特に **まぜまぜマーブル・アイス** はWebGL2 + `EXT_color_buffer_float` が無いと起動時に中断する。
- 声ゲーム2本はマイク無しでもテスト可能: こえの魔法筆は画面の母音ボタンまたはキーボード `A/I/U/E/O`、こえの宝石工房は画面のボイスパッドで代替入力できる（`getUserMedia` は `localhost` かHTTPS等のセキュアコンテキストでのみ動作）。
- **こえの宝石工房のマイク不要な自動デモ**: `http://localhost:8000/koe-no-hoseki-koubou/?test=1` を開いてスタートしてから、DevToolsコンソールで `window.__game.demo()` を実行すると完成まで自動進行する（`koe-no-hoseki-koubou/js/main.js` のテストフック）。ゲーム初期化前に呼ぶとエラーになるので、必ずスタート後に実行する。
- 進捗・ギャラリー等は `localStorage` に保存される（サーバ永続化は無い）。
- リント設定・自動テスト・CIは存在しない。検証は基本的にブラウザでの手動確認となる。
