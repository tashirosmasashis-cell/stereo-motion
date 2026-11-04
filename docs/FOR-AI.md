# AI エージェント向けの説明書（stereo-motion）

**何をする道具か**：画像1枚から、動画に貼る「立体視の素材」を作ります。左右のペア（平行法／交差法）を、カメラが揺れる・回る動きで出します。
**透明のある PNG/WebP → 背景が透明の WebM（VP9 アルファ）**、背景つきの画像 → MP4。文字・枠・背景は足しません。1周分でつなぎ目なくループするので、動画の側でくり返して置きます。
すべて**この PC の中**で動き、画像はどこにも送りません。

## 使い方は3通り（道具の名前・引数・返事は同じ）

| 入口 | 起動 | 呼び方 |
| :-- | :-- | :-- |
| MCP | `claude mcp add stereo-motion -- node <repo>/mcp/server.mjs` | 道具 `list_motions`・`make_stereo_video` |
| HTTP API（この PC だけ） | `npm run api`（`http://127.0.0.1:47232`） | `GET /v1/tools`・`POST /v1/tools/{name}`・`GET /openapi.json` |
| コマンド | `node mcp/cli.mjs --out a.webm 絵.png` | 1枚ずつ |

前提：`npm install` と `npm run build` が済んでいること。Chrome（または Edge）と、透明のある絵のときは `ffmpeg` が PATH にあること。

## make_stereo_video

引数（`images` だけ必須。範囲外の値は丸められます）：

| 名前 | 型 | 既定 | 意味 |
| :-- | :-- | :-- | :-- |
| `images` | string[] | — | 絵の**絶対パス**（PNG/JPEG/WebP）。1枚ごとに別ファイル |
| `out_dir` | string | 一時フォルダ | 出力フォルダ（絶対パス）。名前は `<絵>-<motion>.webm` か `.mp4` |
| `motion` | `sway-x`／`sway-y`／`cw`／`ccw`／`still` | `sway-y` | 左右の揺れ・上下の揺れ・時計回り・反時計回り・止める |
| `amount` | 0–10 | 3.5 | 動きの大きさ（絵の幅の％） |
| `period` | 1–30 | 4 | 1周の秒数 |
| `cycles` | 1–60 | 1 | 周回数（長さ＝period×cycles） |
| `seconds` | 1–600 | — | 長さを秒で頼む（近い周回数に丸める） |
| `stereo` | 0–12 | 6 | 左右のずれ（％）。立体の強さ |
| `view` | `parallel`／`cross` | `parallel` | 平行法／交差法 |
| `width` | 1080／1920／3840 | 1920 | 左右の合計の横幅（高さは絵の縦横比） |
| `pivot` | -1〜1 | -1（自動） | 回る軸の深さ（0＝奥・1＝手前） |
| `fps` | 10–60 | 30 | |
| `prores` | boolean | false | 透明のある絵のとき、ProRes 4444 の `.mov` も並べて書く |

返事（JSON）：`{ "files": [ { image, out, extra[], transparent, width, height, frames, seconds, via } ] }`
`out` が素材のパス、`extra` は `prores:true` のときの `.mov`、`transparent` は透明のある絵だったか。

例（HTTP）：

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"images":["C:/work/char.png"],"out_dir":"C:/work/out","motion":"cw"}' \
  http://127.0.0.1:47232/v1/tools/make_stereo_video
```

## list_motions

動きの一覧とはじめの設定を返します（引数なし）。

## 動画に置く（Remotion）

```tsx
<OffthreadVideo src={staticFile('char-cw.webm')} transparent muted loop />
```

編集ソフトが WebM のアルファを読めないときは `prores:true` の `.mov`。

## 守ること・つまずき

- 絵のパスは**絶対パス**。Windows は `C:/dir/file.png` の形（Git Bash の `/c/...` は Node で読めない）。
- 初回は奥行きのモデル（約27MB）を取るので時間がかかる。絵1枚あたり約20〜90秒。頼みは**1つずつ順番**に処理される。
- 透明のある絵は、被写体のふちの外が透明であること（切り抜き済み）。背景を消す機能はない（先に切り抜く）。
- HTTP API は `127.0.0.1` だけで待ち、`Origin` 付き・JSON 以外の頼みは断る。インターネットには出さない。
- エラーは `{ "error": "…" }`（HTTP 400）。引数の誤りは `issues` に理由が入る。
