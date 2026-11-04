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

// 左右のペア全体の横幅の選べる値
export const WIDTHS = [1080, 1920, 3840];

export type Settings = {
  motion: Motion;
  amount: number; // 動きの大きさ（幅に対する％）
  period: number; // 1周の秒数
  stereo: number; // 立体の強さ＝左右のずれ（幅に対する％）
  pivot: number; // 回る軸の深さ（0＝一番奥・1＝一番手前・-1＝絵ごとに自動）
  view: 'parallel' | 'cross'; // 平行法／交差法
  width: number; // 左右のペア全体の横幅（ピクセル）
  cycles: number; // 周回数（長さ＝1周の秒数×周回数＝必ず最初のコマにつながる）
  fps: number;
};

export const DEFAULTS: Settings = {
  motion: 'sway-y',
  amount: 3.5,
  period: 4,
  stereo: 6,
  pivot: -1,
  view: 'parallel',
  width: 1920,
  cycles: 1,
  fps: 30,
};

export function clampSettings(s: Settings): Settings {
  const n = (v: number, lo: number, hi: number, d: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    ...s,
    motion: MOTIONS.some((m) => m.id === s.motion) ? s.motion : DEFAULTS.motion,
    amount: n(s.amount, 0, 10, DEFAULTS.amount),
    // 1周がちょうど整数のコマになるように丸める（最後のコマの次が最初のコマにつながる）
    period: Math.max(1, Math.round(n(s.period, 1, 30, DEFAULTS.period) * n(s.fps, 10, 60, 30)) / n(s.fps, 10, 60, 30)),
    stereo: n(s.stereo, 0, 12, DEFAULTS.stereo),
    pivot: s.pivot < 0 ? -1 : n(s.pivot, 0, 1, 0.5),
    view: s.view === 'cross' ? 'cross' : 'parallel',
    width: WIDTHS.reduce((a, b) => (Math.abs(b - s.width) < Math.abs(a - s.width) ? b : a), DEFAULTS.width),
    cycles: Math.round(n(s.cycles, 1, 60, DEFAULTS.cycles)),
    fps: n(s.fps, 10, 60, 30),
  };
}

// 長さは「1周×周回数」でしか決まらない＝動画はいつも永久ループになる（本人 2026-10-26「最初の画像に戻れば永久ループに」）
export const framesPerCycle = (s: Settings) => Math.max(1, Math.round(s.period * s.fps));
export const totalFrames = (s: Settings) => framesPerCycle(s) * s.cycles;
export const totalSeconds = (s: Settings) => totalFrames(s) / s.fps;

// カメラの位置（幅に対する割合の単位・下が＋）
function cam(s: Settings, t: number): [number, number] {
  const a = s.amount / 100, w = (2 * Math.PI * t) / (framesPerCycle(s) / s.fps);
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

// 一番大きいずれ（幅に対する割合・片側）
function maxShift(s: Settings, layer: Layer): number {
  const p = layer.prep;
  const aspect = p.width / p.height;
  const pm = s.pivot < 0 ? p.focus : s.pivot;
  const a = s.amount / 100, e = s.stereo / 200;
  const mx = e * Math.max(STEREO_PLANE, 1 - STEREO_PLANE) + a * Math.max(pm, 1 - pm);
  const my = a * aspect * Math.max(pm, 1 - pm);
  return Math.max(mx, my);
}

// 背景つきの絵＝端の外が見えないように少し拡大する（<1）／透明のある絵＝被写体が切れないように外側へ余白を足す（>1）
export function zoomFor(s: Settings, layer: Layer): number {
  const m = maxShift(s, layer);
  return layer.prep.hasAlpha ? Math.min(1.6, 1 + 2 * m + 0.004) : Math.max(0.6, 1 - 2 * m - 0.004);
}

export function stepsFor(s: Settings, layer: Layer, eyeW: number): number {
  const a = s.amount / 100, e = s.stereo / 200;
  const px = (a + e) * eyeW * 1.2;
  return Math.max(24, Math.min(160, Math.round(px)));
}

export type Frame = { out: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D };

// 出す大きさ＝左右のペアをぴったり切った形（余白なし）。素材として動画に置くので、周りに何も足さない
export function outputSize(s: Settings, layer?: Layer): [number, number] {
  const p = layer?.prep;
  const eyeW = Math.floor(s.width / 2);
  const eyeH = Math.round((eyeW * (p ? p.height : 1080)) / (p ? p.width : 1920));
  return [eyeW * 2, eyeH + (eyeH % 2)];
}

export function drawFrame(r: Renderer, f: Frame, s: Settings, layer: Layer | undefined, t: number) {
  const [W, H] = outputSize(s, layer);
  if (f.out.width !== W) f.out.width = W;
  if (f.out.height !== H) f.out.height = H;
  const ctx = f.ctx;
  ctx.clearRect(0, 0, W, H);
  if (!layer) return;
  const eyeW = W / 2;
  r.setSize(W, H);
  r.clear();
  const zoom = zoomFor(s, layer), steps = stepsFor(s, layer, eyeW);
  // 平行法＝左に左目・右に右目／交差法＝入れ替える
  const leftEye: -1 | 1 = s.view === 'parallel' ? 1 : -1;
  r.drawEye(layer, [0, 0, eyeW, H], eyeShift(s, layer, t, leftEye), zoom, steps);
  r.drawEye(layer, [eyeW, 0, eyeW, H], eyeShift(s, layer, t, (-leftEye) as -1 | 1), zoom, steps);
  ctx.drawImage(r.canvas, 0, 0);
}
