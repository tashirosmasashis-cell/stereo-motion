// 設定・動き・並べ方。1コマ（時刻 t）を、出す形の絵（2D の canvas）に描く。
import { Renderer, type Layer, type EyeShift } from './render';

export type Motion = 'sway-x' | 'sway-y' | 'cw' | 'ccw' | 'still';
export const MOTIONS: { id: Motion; label: string; hint: string }[] = [
  { id: 'sway-x', label: '左右の揺れ', hint: '右から見る⇔左から見るを往復' },
  { id: 'sway-y', label: '上下の揺れ', hint: '上から見る⇔下から見るを往復' },
  { id: 'cw', label: '時計回り', hint: 'カメラが右→下→左→上と円を描く' },
  { id: 'ccw', label: '反時計回り', hint: 'カメラが右→上→左→下と円を描く' },
  { id: 'still', label: '止める', hint: '動かさない（立体だけ）' },
];

export type Settings = {
  motion: Motion;
  amount: number; // 動きの大きさ（幅に対する％）
  period: number; // 1周の秒数
  stereo: number; // 立体の強さ＝左右のずれ（幅に対する％）
  pivot: number; // 回る軸の深さ（0＝一番奥・1＝一番手前・-1＝絵ごとに自動）
  view: 'parallel' | 'cross'; // 平行法／交差法
  layout: 'portrait' | 'sbs'; // 縦 1080×1920 のまん中／横並びそのまま
  seconds: number; // 動画の長さ
  perImage: number; // 1枚あたりの秒数（絵が2枚以上のとき）
  countdown: boolean; // 残り秒数を出す
  caption: string; // 下の文（改行で2行まで）
  endText: string; // 最後の2秒に下の文の代わりに出す文
  fps: number;
};

export const DEFAULTS: Settings = {
  motion: 'sway-y',
  amount: 3.5,
  period: 4,
  stereo: 6,
  pivot: -1,
  view: 'parallel',
  layout: 'portrait',
  seconds: 15,
  perImage: 10,
  countdown: true,
  caption: '遠くを見るように目の力をぬいて\n3つに見えたら真ん中を見つめよう',
  endText: 'おつかれさまでした！',
  fps: 30,
};

export function clampSettings(s: Settings): Settings {
  const n = (v: number, lo: number, hi: number, d: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    ...s,
    motion: MOTIONS.some((m) => m.id === s.motion) ? s.motion : DEFAULTS.motion,
    amount: n(s.amount, 0, 10, DEFAULTS.amount),
    period: n(s.period, 1, 30, DEFAULTS.period),
    stereo: n(s.stereo, 0, 12, DEFAULTS.stereo),
    pivot: s.pivot < 0 ? -1 : n(s.pivot, 0, 1, 0.5),
    view: s.view === 'cross' ? 'cross' : 'parallel',
    layout: s.layout === 'sbs' ? 'sbs' : 'portrait',
    seconds: n(s.seconds, 1, 180, DEFAULTS.seconds),
    perImage: n(s.perImage, 1, 180, DEFAULTS.perImage),
    fps: n(s.fps, 10, 60, 30),
    caption: String(s.caption ?? '').slice(0, 120),
    endText: String(s.endText ?? '').slice(0, 60),
  };
}

// カメラの位置（幅に対する割合の単位・下が＋）
function cam(s: Settings, t: number): [number, number] {
  const a = s.amount / 100, w = (2 * Math.PI * t) / s.period;
  switch (s.motion) {
    case 'sway-x': return [a * Math.sin(w), 0];
    case 'sway-y': return [0, a * Math.sin(w)];
    case 'cw': return [a * Math.cos(w), a * Math.sin(w)];
    case 'ccw': return [a * Math.cos(w), -a * Math.sin(w)];
    default: return [0, 0];
  }
}

// 立体の面（この深さの物は左右でずれない）＝一番手前。背景ほど大きくずれる（本人「背景までずらす」）
const STEREO_PLANE = 1;

export function eyeShift(s: Settings, layer: Layer, t: number, eye: -1 | 1): EyeShift {
  const p = layer.prep;
  const aspect = p.width / p.height;
  const pm = s.pivot < 0 ? p.focus : s.pivot;
  const e = (eye * s.stereo) / 200; // 片目ぶん
  const [cx, cy] = cam(s, t);
  // uv = src + (e*(z-Ps) + c*(z-Pm))  →  src = uv - A*z - B
  return {
    ax: e + cx,
    ay: cy * aspect,
    bx: -(e * STEREO_PLANE + cx * pm),
    by: -(cy * aspect * pm),
  };
}

// 一番大きいずれ＝端の外が見えないように拡大する量
export function zoomFor(s: Settings, layer: Layer): number {
  const p = layer.prep;
  const aspect = p.width / p.height;
  const pm = s.pivot < 0 ? p.focus : s.pivot;
  const a = s.amount / 100, e = s.stereo / 200;
  const mx = e * Math.max(STEREO_PLANE, 1 - STEREO_PLANE) + a * Math.max(pm, 1 - pm);
  const my = a * aspect * Math.max(pm, 1 - pm);
  return Math.max(0.6, 1 - 2 * Math.max(mx, my) - 0.004);
}

export function stepsFor(s: Settings, layer: Layer, eyeW: number): number {
  const a = s.amount / 100, e = s.stereo / 200;
  const px = (a + e) * eyeW * 1.2;
  return Math.max(24, Math.min(160, Math.round(px)));
}

export type Frame = { out: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D };

export function outputSize(s: Settings, layers: Layer[]): [number, number] {
  if (s.layout === 'portrait') return [1080, 1920];
  const p = layers[0]?.prep;
  const eyeW = Math.min(960, p ? p.width : 960);
  const eyeH = Math.round((eyeW * (p ? p.height : 540)) / (p ? p.width : 960));
  return [eyeW * 2, eyeH + (eyeH % 2)];
}

export function layerAt(s: Settings, layers: Layer[], t: number): Layer {
  if (layers.length <= 1) return layers[0];
  const i = Math.floor(t / s.perImage) % layers.length;
  return layers[i];
}

const FONT = '"BIZ UDPGothic", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';

export function drawFrame(r: Renderer, f: Frame, s: Settings, layers: Layer[], t: number) {
  const [W, H] = outputSize(s, layers);
  if (f.out.width !== W) f.out.width = W;
  if (f.out.height !== H) f.out.height = H;
  const ctx = f.ctx;
  ctx.fillStyle = '#0f1216';
  ctx.fillRect(0, 0, W, H);
  if (!layers.length) return;
  const layer = layerAt(s, layers, t);
  const p = layer.prep;

  // 左右を並べる枠
  const gap = s.layout === 'portrait' ? 12 : 0;
  const side = s.layout === 'portrait' ? 12 : 0;
  const eyeW = Math.floor((W - side * 2 - gap) / 2);
  let eyeH = Math.round((eyeW * p.height) / p.width);
  const maxH = s.layout === 'portrait' ? 1100 : H;
  if (eyeH > maxH) eyeH = maxH;
  const realW = s.layout === 'portrait' ? Math.round((eyeH * p.width) / p.height) : eyeW;
  r.setSize(realW * 2, eyeH);
  r.clear();
  const zoom = zoomFor(s, layer), steps = stepsFor(s, layer, realW);
  // 平行法＝左に左目・右に右目／交差法＝入れ替える
  const leftEye: -1 | 1 = s.view === 'parallel' ? 1 : -1;
  r.drawEye(layer, [0, 0, realW, eyeH], eyeShift(s, layer, t, leftEye), zoom, steps);
  r.drawEye(layer, [realW, 0, realW, eyeH], eyeShift(s, layer, t, (-leftEye) as -1 | 1), zoom, steps);

  // 縦の形では、数字と文の位置を絵の形によらず固定する（絵は枠の中で上下まん中）
  const boxTop = s.layout === 'portrait' ? Math.round((H - maxH) / 2) - 40 : 0;
  const top = s.layout === 'portrait' ? boxTop + Math.round((maxH - eyeH) / 2) : 0;
  const x0 = Math.round((W - (realW * 2 + gap)) / 2);
  ctx.drawImage(r.canvas, 0, 0, realW, eyeH, x0, top, realW, eyeH);
  ctx.drawImage(r.canvas, realW, 0, realW, eyeH, x0 + realW + gap, top, realW, eyeH);

  if (s.layout !== 'portrait') return;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (s.countdown) {
    const left = Math.max(0, Math.ceil(s.seconds - t - 1e-6));
    ctx.font = `900 260px ${FONT}`;
    ctx.lineWidth = 22;
    ctx.strokeStyle = '#2f8f3a';
    ctx.strokeText(String(left), W / 2, boxTop / 2 + 10);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(left), W / 2, boxTop / 2 + 10);
  }
  const ending = s.endText && s.seconds - t <= 2;
  const lines = (ending ? s.endText : s.caption).split('\n').slice(0, 2).filter(Boolean);
  ctx.font = `700 56px ${FONT}`;
  const below = boxTop + maxH;
  const mid = below + (H - below) / 2;
  lines.forEach((ln, i) => {
    const y = mid + (i - (lines.length - 1) / 2) * 84;
    let size = 56;
    ctx.font = `700 ${size}px ${FONT}`;
    while (ctx.measureText(ln).width > W - 60 && size > 28) { size -= 2; ctx.font = `700 ${size}px ${FONT}`; }
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#d02a7a';
    ctx.strokeText(ln, W / 2, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(ln, W / 2, y);
  });
}
