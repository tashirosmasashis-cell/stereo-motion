# 立体視 の HANDOVER

## ⚡ いま
> ▶ **次の一手（2026-11-23 22:20）**：この本を作った（分類ごとの HANDOVER 段7・現在地の写し から）。次は工程表の「立体視素材を本物の切り抜きで確認」`unhry`（本物の被写体の切り抜きで、ふちのギザつきと Remotion での見え方を確かめる）。

### 経過（会話の終わりに機械が1行・新しい順・古い行は CHANGELOG.md へ）

## 工程表
（DB にあります。PC：npm run todo:book -- 立体視 ／ 雫：select todo_book('zunda','立体視')）

## これは何か
立体視ムービーメーカー＝1枚の絵から、奥行きでカメラだけが動く立体視の動画（左右のペア、または1枚のまま）を作る道具。動画を作る人が素材（透過 WebM）を作る場所で、文字や枠は入れない。オープンソースで公開していて、処理は使う人の PC で動く（原さんのサーバーに負荷をかけない）。

## 設計
- **奥行き**＝Depth Anything V2 Small（版を固定・`src/depth.ts`）→ ガイド付きフィルタ・手前を太らせる・手前を取り除いて背景で埋めた絵 → WebGL で光線をたどる（崖に当たったら背景の絵から引く）。
- **いつも永久ループ**（2026-10-26 原さん「必ず永久ループになるようにしか作成できないように」）：長さ＝1周の秒数（整数のコマに丸める）×周回数。描くのは 0〜N-1 コマ（N コマ目＝0 コマ目は描かない＝最後と最初が同じ絵で2コマになる凡ミスを防ぐ）。
- **動画素材を作る場所**（2026-11-05 作り直し）：残り秒数・下の文・縦の枠・絵の切り替え・回る軸は外した。出す形＝左右のペアをぴったり切った大きさ（横 1080／1920／3840）。透過 PNG は透明のまま立体視（動いても被写体が切れない外側の余白・ふちの縁取りなし）→ 透過 WebM（VP9 アルファ）・`prores:true` で .mov。
- **1枚の絵のまま**（`view:"single"`・2026-11-07）＝ペアにせず1枚の絵で奥行きのカメラの動き（Spotlight のショートリールで使った）。
- **MCP と API は同じ道具**：定義は `mcp/tools.mjs` の1か所 → MCP（`server.mjs`）と HTTP API（`api.mjs`）。
- **1行で入れる**：`npx -y github:tashirosmasashis-cell/stereo-motion add`＝その PC の Claude Code・Codex・Antigravity に登録（2回目は「もう入っています」）。

## 仕様
- **コード**：`C:\dev\personal\stereo-motion`（GitHub 公開 `tashirosmasashis-cell/stereo-motion`・main に push で GitHub Pages へ自動）。使う所＝https://tashirosmasashis-cell.github.io/stereo-motion/ ・個人サイト https://zunda.tsutsumicommunity.org/stereo/ （埋め込み）。
- **AI の口**：MCP `stereo-motion`（`make_stereo_video`・`list_motions`）・HTTP API `127.0.0.1:47232`（`/v1/tools`・`/openapi.json`・Origin 付き・JSON 以外は断る）。説明書＝`docs/`。
- **組み立て**：組み立てた画面 `dist` を倉庫に入れている（画面を直したら `npm run build:page` してから保存）。transformers.js と Mediabunny は devDependencies。
- **要る物**：Node.js 22.12 以上（puppeteer-core の条件）・ffmpeg（無ければコマを作る前に入れ方を返す）。
- **試験**：`npm run check:loop -- 絵.png`（コマ数・N コマ目＝0 コマ目・最後→最初の差）。

## 決まりと落とし穴
- 文字や枠を入れない（素材を作る場所）。
- Chrome の VideoEncoder は `alpha:'keep'` に対応していない＝画面から透過 WebM は作れない（AI の口の ffmpeg で作る）。
- 本物の iPhone で絵の下ごしらえと書き出しが通るかは確かめていない（Windows の WebKit には OffscreenCanvas と録画の部品が無い・本物の Safari は iOS 16.4 から両方ある）。
- 録画で書き出す古いブラウザではコマ数がぴったりにならないことがある。
- ふちの半透明の帯と引き伸ばしの毛は、半透明を閾値で消す＋ふちの奥行きをなだらかにして抑えた。合成の楕円は硬い縁でギザつく＝本物の切り抜きでは未確認。
- 頼むたびにはじめの設定から組み直す（前の依頼の設定が残る不具合を直した）。

## 人と置き場
- 決めるのは原さん。作るのは澪。使うのは動画を作る人（原さんの動画・ほかの AI）。
- コード＝`C:\dev\personal\stereo-motion`。見本の絵＝ざっくりラーニング ep005 の場面5（原さんの TensorArt の絵）。
- 古い経緯＝`.handover/CHANGELOG.md` と git の履歴（元にした現在地の写しは 2026-11-23 の段8 で消した・中身は git の履歴で読める）。
