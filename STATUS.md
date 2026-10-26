# 立体視ムービーメーカーの現在地

## 2026-10-26 初版を公開
- 本人「1枚の画像から立体視動画（カメラの動きだけ）を作れるなら作ってオープンソースで GIT にあげる・個人のウェブページに公開・処理は自分の PC のスペックで（私のサーバーに負荷はかからない）」。プラン＝`~/.claude/plans/velvety-rolling-leaf.md`（承認済み）。
- 公開：GitHub https://github.com/tashirosmasashis-cell/stereo-motion （main に push で GitHub Pages へ自動）・使う所 https://tashirosmasashis-cell.github.io/stereo-motion/ ・個人サイト https://zunda.tsutsumicommunity.org/stereo/ （埋め込み）。
- 作り：奥行き＝Depth Anything V2 Small（版を固定・`src/depth.ts`）→ ガイド付きフィルタ・手前を太らせる・手前を取り除いて背景で埋めた絵 → WebGL で光線をたどる（崖に当たったら背景の絵から描く・`src/render.ts`）→ 動きと並べ方と文字（`src/scene.ts`）→ WebCodecs＋Mediabunny で MP4（無ければ録画・`src/export.ts`）。AI の口＝`mcp/`（見えない Chrome で dist を開く・番地 47231 固定＝モデルがブラウザに残る）。
- 確かめたこと：PC の Chrome（見えない形）で4つの動き・絵3枚の切り替え・AI の口（MCP のやりとり）・公開版・個人サイトの埋め込みで、絵を入れてから MP4 まで約12秒。iPhone の画面（Windows の WebKit）では、画面の並び・ボタンの反応・個人サイトの埋め込みの表示まで。
- ⚠ 確かめられていない：本物の iPhone で絵の下ごしらえと書き出しが通るか。Windows の WebKit には OffscreenCanvas と録画の部品が無く、そこで止まる（本物の Safari は iOS 16.4 から両方ある）。足りないブラウザでは「PC の Chrome・Edge か iOS 16.4 以降の Safari で」と出す。
- 見本の絵（README の動く絵）＝ざっくりラーニング ep005 の場面5の絵（本人の TensorArt の絵）。

## 2026-10-26 いつも永久ループに
- 本人「動画は必ず永久ループになるようにしか作成できないように」「最後の1フレームと最初の1フレームが同じ画像で2フレームになる凡ミスに気を付けて」。
- 長さの自由な設定（秒・1枚の秒数）を外し、長さ＝1周の秒数（ちょうど整数のコマに丸める）×周回数×絵の枚数だけにした。描くのは 0〜N-1 コマ（N コマ目＝0 コマ目は描かない）。絵は回り終えた所で替わる。
- 検査＝`npm run check:loop -- 絵.png`（コマ数・N コマ目＝0 コマ目・最後→最初の差＝となりのコマどうしと同じ）。4つの動きで通った。
- 残り秒数と下の文は、動画が頭に戻ると最初の表示に戻る（絵の動きのつながりを優先した読み）。録画で書き出す古いブラウザではコマ数がぴったりにならないことがある。
- AI の口：頼むたびにはじめの設定から組み直す（前の依頼の設定が残る不具合を直した）・`seconds` は近い周回数に丸める。
