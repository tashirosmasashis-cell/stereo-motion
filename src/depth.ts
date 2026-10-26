// 1枚の絵の下ごしらえ：奥行きを推し量り、描画で使う4枚（色・奥行き・背景の色・背景の奥行き）を作る。
// 全部ブラウザの中で動く（絵はどこにも送らない）。モデルは Hugging Face から取り、ブラウザに残る。
import { pipeline, env, RawImage } from '@huggingface/transformers';

env.allowLocalModels = false;

// Depth Anything V2 Small（Apache-2.0）。Base・Large は商用不可なので使わない。版を固定する。
const MODEL = 'onnx-community/depth-anything-v2-small';
const REVISION = '4472b7362082ad9968fee890ca0f1e5aca36b93d';

// 下ごしらえの大きさ（長い辺）。描くときの色は元の大きさのまま使う。
const WORK = 1024;

export type Prepared = {
  name: string;
  width: number; // 元の絵
  height: number;
  color: ImageBitmap;
  workW: number;
  workH: number;
  depth: Float32Array; // 0..1・1＝一番手前（ふちを守って大きくし、手前を少し太らせた物）
  bgDepth: Float32Array; // 手前の物を取り除いた奥行き
  bgColor: Uint8ClampedArray; // 手前の物を取り除いて背景で埋めた色（RGBA・下ごしらえの大きさ）
  focus: number; // 真ん中あたりの深さ（回る軸のはじめの値）
};

type Estimator = (img: RawImage) => Promise<{ depth: RawImage }>;
let estimator: Promise<Estimator> | null = null;

export function loadModel(onProgress?: (msg: string) => void): Promise<Estimator> {
  if (estimator) return estimator;
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const make = (device: 'webgpu' | 'wasm') =>
    pipeline('depth-estimation', MODEL, {
      revision: REVISION,
      device,
      dtype: device === 'webgpu' ? 'fp16' : 'q8',
      progress_callback: (p: { status: string; progress?: number; file?: string }) => {
        if (p.status === 'progress' && p.progress != null) onProgress?.(`モデルを読み込み中 ${Math.round(p.progress)}%`);
      },
    }) as unknown as Promise<Estimator>;
  estimator = (webgpu ? make('webgpu').catch(() => make('wasm')) : make('wasm')).catch((e) => {
    estimator = null;
    throw e;
  });
  return estimator;
}

export async function prepare(file: Blob, name: string, onProgress?: (msg: string) => void): Promise<Prepared> {
  const color = await createImageBitmap(file);
  const width = color.width, height = color.height;
  const scale = Math.min(1, WORK / Math.max(width, height));
  const workW = Math.max(16, Math.round(width * scale)), workH = Math.max(16, Math.round(height * scale));

  // OffscreenCanvas が無いブラウザ（古めの Safari など）でも動くように、ふつうの canvas を使う
  const cv = document.createElement('canvas');
  cv.width = workW;
  cv.height = workH;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(color, 0, 0, workW, workH);
  const rgba = ctx.getImageData(0, 0, workW, workH).data;

  const run = await loadModel(onProgress);
  onProgress?.('奥行きを推し量り中');
  const raw = new RawImage(new Uint8ClampedArray(rgba), workW, workH, 4).rgb();
  const { depth: dimg } = await run(raw);
  const d0 = toFloat(dimg, workW, workH);

  onProgress?.('ふちを整え中');
  const gray = new Float32Array(workW * workH);
  for (let i = 0; i < gray.length; i++) gray[i] = (rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114) / 255;
  const r = Math.max(2, Math.round(workW / 160));
  const guided = guidedFilter(gray, d0, workW, workH, r, 1e-4);
  normalize(guided);
  // ふちの線を本体と同じ深さにする（線が背景に置き去りにならない）
  const depth = maxFilter(guided, workW, workH, Math.max(1, Math.round(workW / 220)));

  onProgress?.('背景を作り中');
  // 背景の奥行き＝広めに「一番奥」を取ってから、なめらかにする
  const R = Math.max(4, Math.round(workW * 0.04));
  const bgDepth = boxBlur(minFilter(depth, workW, workH, R), workW, workH, Math.round(R / 2));
  for (let i = 0; i < bgDepth.length; i++) bgDepth[i] = Math.min(bgDepth[i], depth[i]);
  // 手前の物＝背景より一段手前にある所。少し広げてから、そこを周りの背景の色で埋める
  const mask = new Uint8Array(workW * workH);
  for (let i = 0; i < mask.length; i++) mask[i] = depth[i] - bgDepth[i] > 0.04 ? 1 : 0;
  const grown = maxFilterU8(mask, workW, workH, Math.max(2, Math.round(workW / 300)));
  const bgColor = pushPull(rgba, grown, workW, workH);

  return { name, width, height, color, workW, workH, depth, bgDepth, bgColor, focus: centerFocus(depth, workW, workH) };
}

function toFloat(img: RawImage, W: number, H: number): Float32Array {
  const src = img; // 大きさが違えば下で引き伸ばす
  const out = new Float32Array(W * H);
  const sw = src.width, sh = src.height, ch = src.channels;
  for (let y = 0; y < H; y++) {
    const sy = Math.min(sh - 1, (y + 0.5) * (sh / H) - 0.5);
    const y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(sh - 1, y0 + 1), fy = Math.max(0, sy - y0);
    for (let x = 0; x < W; x++) {
      const sx = Math.min(sw - 1, (x + 0.5) * (sw / W) - 0.5);
      const x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(sw - 1, x0 + 1), fx = Math.max(0, sx - x0);
      const p = (xx: number, yy: number) => src.data[(yy * sw + xx) * ch] as number;
      const v = (p(x0, y0) * (1 - fx) + p(x1, y0) * fx) * (1 - fy) + (p(x0, y1) * (1 - fx) + p(x1, y1) * fx) * fy;
      out[y * W + x] = v / 255;
    }
  }
  normalize(out);
  return out;
}

function normalize(a: Float32Array) {
  let lo = Infinity, hi = -Infinity;
  for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const s = hi > lo ? 1 / (hi - lo) : 0;
  for (let i = 0; i < a.length; i++) a[i] = Math.min(1, Math.max(0, (a[i] - lo) * s));
}

// 箱のぼかし（積分像・半径 r）
function boxBlur(a: Float32Array, W: number, H: number, r: number): Float32Array {
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) { row += a[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
      const s = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
      out[y * W + x] = s / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

// 色の絵のふちに沿って奥行きを整える（He らのガイド付きフィルタ・白黒の案内）
function guidedFilter(I: Float32Array, p: Float32Array, W: number, H: number, r: number, eps: number): Float32Array {
  const n = W * H;
  const II = new Float32Array(n), Ip = new Float32Array(n);
  for (let i = 0; i < n; i++) { II[i] = I[i] * I[i]; Ip[i] = I[i] * p[i]; }
  const mI = boxBlur(I, W, H, r), mp = boxBlur(p, W, H, r), mII = boxBlur(II, W, H, r), mIp = boxBlur(Ip, W, H, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = mII[i] - mI[i] * mI[i], c = mIp[i] - mI[i] * mp[i];
    a[i] = c / (v + eps);
    b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = boxBlur(a, W, H, r), mb = boxBlur(b, W, H, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}

function sepFilter(a: Float32Array, W: number, H: number, r: number, pick: (m: number, v: number) => number, init: number) {
  const t = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = init;
    for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) m = pick(m, a[y * W + k]);
    t[y * W + x] = m;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = init;
    for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) m = pick(m, t[k * W + x]);
    out[y * W + x] = m;
  }
  return out;
}
const maxFilter = (a: Float32Array, W: number, H: number, r: number) => sepFilter(a, W, H, r, Math.max, -Infinity);
const minFilter = (a: Float32Array, W: number, H: number, r: number) => sepFilter(a, W, H, r, Math.min, Infinity);
function maxFilterU8(m: Uint8Array, W: number, H: number, r: number): Uint8Array {
  const f = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) f[i] = m[i];
  const g = maxFilter(f, W, H, r);
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = g[i] > 0 ? 1 : 0;
  return out;
}

// 印の付いた所（手前の物）を、周りの色で埋める（ピラミッドで縮めて広げる＝穴の大きさによらず埋まる）
function pushPull(rgba: Uint8ClampedArray, hole: Uint8Array, W: number, H: number): Uint8ClampedArray {
  type L = { w: number; h: number; c: Float32Array; a: Float32Array };
  const lv: L[] = [];
  const c0 = new Float32Array(W * H * 3), a0 = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const k = hole[i] ? 0 : 1;
    a0[i] = k;
    c0[i * 3] = rgba[i * 4] * k; c0[i * 3 + 1] = rgba[i * 4 + 1] * k; c0[i * 3 + 2] = rgba[i * 4 + 2] * k;
  }
  lv.push({ w: W, h: H, c: c0, a: a0 });
  while (lv[lv.length - 1].w > 1 || lv[lv.length - 1].h > 1) {
    const p = lv[lv.length - 1];
    const w = Math.max(1, Math.ceil(p.w / 2)), h = Math.max(1, Math.ceil(p.h / 2));
    const c = new Float32Array(w * h * 3), a = new Float32Array(w * h);
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const s = y * p.w + x, d = (y >> 1) * w + (x >> 1);
      a[d] += p.a[s];
      c[d * 3] += p.c[s * 3]; c[d * 3 + 1] += p.c[s * 3 + 1]; c[d * 3 + 2] += p.c[s * 3 + 2];
    }
    lv.push({ w, h, c, a });
  }
  // 粗い段から細かい段へ：重みが足りない所を粗い段の色で補う
  for (let l = lv.length - 2; l >= 0; l--) {
    const f = lv[l], g = lv[l + 1];
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const s = y * f.w + x, d = (y >> 1) * g.w + (x >> 1);
      const ga = g.a[d] > 0 ? g.a[d] : 1;
      const k = Math.min(1, f.a[s]);
      for (let ch = 0; ch < 3; ch++) {
        const mine = f.a[s] > 0 ? f.c[s * 3 + ch] / f.a[s] : 0;
        const up = g.c[d * 3 + ch] / ga;
        f.c[s * 3 + ch] = (mine * k + up * (1 - k));
      }
      f.a[s] = 1;
    }
  }
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = lv[0].c[i * 3]; out[i * 4 + 1] = lv[0].c[i * 3 + 1]; out[i * 4 + 2] = lv[0].c[i * 3 + 2]; out[i * 4 + 3] = 255;
  }
  return out;
}

// 真ん中あたり（横は中央の4割・縦は中央の6割）の深さの中央値
function centerFocus(d: Float32Array, W: number, H: number): number {
  const v: number[] = [];
  for (let y = Math.round(H * 0.2); y < H * 0.8; y += 2)
    for (let x = Math.round(W * 0.3); x < W * 0.7; x += 2) v.push(d[y * W + x]);
  v.sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length * 0.6)] : 0.5;
}
