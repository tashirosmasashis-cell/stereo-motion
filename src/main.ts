import './style.css';
import { prepare, loadModel, type Prepared } from './depth';
import { Renderer, type Layer } from './render';
import { DEFAULTS, MOTIONS, clampSettings, drawFrame, layerAt, type Settings, type Frame } from './scene';
import { encodeVideo } from './export';

// ---- 状態 ----
type Item = { id: number; name: string; file: Blob; thumb: string; status: 'wait' | 'busy' | 'ok' | 'err'; error?: string; layer?: Layer };
const items: Item[] = [];
let nextId = 1;
let settings: Settings = readHash();
let exporting = false;
let stopFlag = false;
let showDepth = false;

const glCanvas = document.createElement('canvas');
const renderer = new Renderer(glCanvas);
const out = document.querySelector<HTMLCanvasElement>('#out')!;
const frame: Frame = { out, ctx: out.getContext('2d')! };
const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;

// ---- 設定を URL に入れる（同じ設定を人や AI に渡せる）----
function readHash(): Settings {
  const q = new URLSearchParams(location.hash.slice(1));
  const s: Record<string, unknown> = { ...DEFAULTS };
  for (const [k, v] of q) {
    if (!(k in DEFAULTS)) continue;
    const d = (DEFAULTS as Record<string, unknown>)[k];
    s[k] = typeof d === 'number' ? Number(v) : typeof d === 'boolean' ? v === '1' : v;
  }
  return clampSettings(s as Settings);
}
function writeHash() {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(settings)) {
    if ((DEFAULTS as Record<string, unknown>)[k] === v) continue;
    q.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  history.replaceState(null, '', q.toString() ? `#${q}` : location.pathname + location.search);
}
function setSettings(p: Partial<Settings>) {
  settings = clampSettings({ ...settings, ...p });
  writeHash();
  syncControls();
}

// ---- 絵 ----
const layers = () => items.filter((i) => i.status === 'ok' && i.layer).map((i) => i.layer!);

async function addFiles(files: Iterable<Blob & { name?: string }>) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    items.push({ id: nextId++, name: f.name || `絵${nextId}`, file: f, thumb: URL.createObjectURL(f), status: 'wait' });
  }
  renderList();
  await processQueue();
}

let busy: Promise<void> | null = null;
function processQueue(): Promise<void> {
  if (busy) return busy;
  busy = (async () => {
    for (;;) {
      const it = items.find((i) => i.status === 'wait');
      if (!it) break;
      it.status = 'busy';
      renderList();
      try {
        const prep: Prepared = await prepare(it.file, it.name, (m) => status(`${it.name}：${m}`));
        it.layer = renderer.upload(prep);
        it.status = 'ok';
        status('');
      } catch (e) {
        it.status = 'err';
        it.error = (e as Error).message;
        status(`${it.name}：うまく読めませんでした（${it.error}）`);
      }
      renderList();
    }
  })().finally(() => { busy = null; });
  return busy;
}

function renderList() {
  const ul = $('#items');
  ul.innerHTML = '';
  items.forEach((it, idx) => {
    const li = document.createElement('li');
    const st = { wait: '待ち', busy: '準備中…', ok: '準備できた', err: '読めない' }[it.status];
    li.innerHTML = `<img alt="" src="${it.thumb}"><span class="nm"></span><span class="st st-${it.status}">${st}</span>
      <button class="icon" data-a="up" aria-label="上へ" ${idx === 0 ? 'disabled' : ''}>↑</button>
      <button class="icon" data-a="down" aria-label="下へ" ${idx === items.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="icon" data-a="del" aria-label="外す">×</button>`;
    li.querySelector('.nm')!.textContent = it.name;
    li.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        const a = b.dataset.a;
        if (a === 'del') {
          if (it.layer) renderer.release(it.layer);
          URL.revokeObjectURL(it.thumb);
          items.splice(idx, 1);
        } else {
          const j = a === 'up' ? idx - 1 : idx + 1;
          [items[idx], items[j]] = [items[j], items[idx]];
        }
        renderList();
      }),
    );
    ul.appendChild(li);
  });
  $('#empty').hidden = items.length > 0;
  $('#per-image-row').hidden = items.length < 2;
}

function status(msg: string) {
  $('#status').textContent = msg;
}

// ---- 設定の画面 ----
function buildControls() {
  const box = $('#motions');
  for (const m of MOTIONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg';
    b.dataset.m = m.id;
    b.title = m.hint;
    b.innerHTML = `${motionIcon(m.id)}<span>${m.label}</span>`;
    b.addEventListener('click', () => setSettings({ motion: m.id }));
    box.appendChild(b);
  }
  const num = (id: keyof Settings, sel: string) => {
    const el = $<HTMLInputElement>(sel);
    el.addEventListener('input', () => setSettings({ [id]: Number(el.value) } as Partial<Settings>));
  };
  num('amount', '#amount');
  num('period', '#period');
  num('stereo', '#stereo');
  num('seconds', '#seconds');
  num('perImage', '#perImage');
  const pivot = $<HTMLInputElement>('#pivot'), pivotAuto = $<HTMLInputElement>('#pivotAuto');
  pivot.addEventListener('input', () => setSettings({ pivot: Number(pivot.value) / 100 }));
  pivotAuto.addEventListener('change', () => setSettings({ pivot: pivotAuto.checked ? -1 : 0.5 }));
  document.querySelectorAll<HTMLInputElement>('input[name=view]').forEach((r) => r.addEventListener('change', () => setSettings({ view: r.value as Settings['view'] })));
  document.querySelectorAll<HTMLInputElement>('input[name=layout]').forEach((r) => r.addEventListener('change', () => setSettings({ layout: r.value as Settings['layout'] })));
  $<HTMLInputElement>('#countdown').addEventListener('change', (e) => setSettings({ countdown: (e.target as HTMLInputElement).checked }));
  $<HTMLTextAreaElement>('#caption').addEventListener('input', (e) => setSettings({ caption: (e.target as HTMLTextAreaElement).value }));
  $<HTMLInputElement>('#endText').addEventListener('input', (e) => setSettings({ endText: (e.target as HTMLInputElement).value }));
  $('#reset').addEventListener('click', () => { settings = { ...DEFAULTS }; writeHash(); syncControls(); });
  syncControls();
}

function syncControls() {
  document.querySelectorAll<HTMLButtonElement>('#motions .seg').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === settings.motion)));
  const set = (sel: string, v: string | number, outSel?: string, fmt?: (v: number) => string) => {
    const el = $<HTMLInputElement>(sel);
    if (document.activeElement !== el) el.value = String(v);
    if (outSel) $(outSel).textContent = fmt ? fmt(Number(v)) : String(v);
  };
  set('#amount', settings.amount, '#amountV', (v) => `${v.toFixed(1)}%`);
  set('#period', settings.period, '#periodV', (v) => `${v}秒`);
  set('#stereo', settings.stereo, '#stereoV', (v) => `${v.toFixed(1)}%`);
  set('#seconds', settings.seconds, '#secondsV', (v) => `${v}秒`);
  set('#perImage', settings.perImage, '#perImageV', (v) => `${v}秒`);
  const auto = settings.pivot < 0;
  $<HTMLInputElement>('#pivotAuto').checked = auto;
  $<HTMLInputElement>('#pivot').disabled = auto;
  if (!auto) set('#pivot', Math.round(settings.pivot * 100), '#pivotV', (v) => `${v}`);
  else $('#pivotV').textContent = '自動';
  document.querySelectorAll<HTMLInputElement>('input[name=view]').forEach((r) => (r.checked = r.value === settings.view));
  document.querySelectorAll<HTMLInputElement>('input[name=layout]').forEach((r) => (r.checked = r.value === settings.layout));
  $<HTMLInputElement>('#countdown').checked = settings.countdown;
  const cap = $<HTMLTextAreaElement>('#caption');
  if (document.activeElement !== cap) cap.value = settings.caption;
  const end = $<HTMLInputElement>('#endText');
  if (document.activeElement !== end) end.value = settings.endText;
  $('#text-rows').hidden = settings.layout !== 'portrait';
}

function motionIcon(m: string): string {
  const p: Record<string, string> = {
    'sway-x': '<path d="M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3"/>',
    'sway-y': '<path d="M12 4v16M9 7l3-3 3 3M9 17l3 3 3-3"/>',
    cw: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M17 3v4.5h-4.5"/>',
    ccw: '<path d="M5 12a7 7 0 1 0 2.05-4.95"/><path d="M7 3v4.5h4.5"/>',
    still: '<circle cx="12" cy="12" r="3"/>',
  };
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p[m]}</svg>`;
}

// ---- その場で見る ----
let t0 = performance.now();
function loop(now: number) {
  if (!exporting) {
    const ls = layers();
    const t = ((now - t0) / 1000) % settings.seconds;
    if (showDepth && ls.length) drawDepth(layerAt(settings, ls, t));
    else drawFrame(renderer, frame, settings, ls, t);
    $('#time').textContent = ls.length ? `${t.toFixed(1)} / ${settings.seconds}秒` : '';
  }
  requestAnimationFrame(loop);
}

function drawDepth(layer: Layer) {
  const p = layer.prep;
  out.width = p.workW;
  out.height = p.workH;
  const img = frame.ctx.createImageData(p.workW, p.workH);
  for (let i = 0; i < p.depth.length; i++) {
    const v = p.depth[i] * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  (frame.ctx as CanvasRenderingContext2D).putImageData(img, 0, 0);
}

// ---- 書き出し ----
async function exportVideo(): Promise<{ blob: Blob; ext: string }> {
  const ls = layers();
  if (!ls.length) throw new Error('先に絵を入れてください');
  const fps = settings.fps;
  const n = Math.round(settings.seconds * fps);
  exporting = true;
  stopFlag = false;
  try {
    drawFrame(renderer, frame, settings, ls, 0);
    const enc = await encodeVideo(out, n, fps, (i) => drawFrame(renderer, frame, settings, ls, i / fps), (d, total) => {
      $<HTMLProgressElement>('#progress').value = d / total;
      status(`書き出し中 ${d} / ${total} コマ`);
    }, () => stopFlag);
    status('');
    return { blob: new Blob([enc.data], { type: enc.mime }), ext: enc.ext };
  } finally {
    exporting = false;
  }
}

function bindButtons() {
  const pick = $<HTMLInputElement>('#file');
  $('#pick').addEventListener('click', () => pick.click());
  pick.addEventListener('change', () => { if (pick.files) addFiles(pick.files); pick.value = ''; });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { const fs = (e as DragEvent).dataTransfer?.files; if (fs) addFiles(fs); });
  window.addEventListener('paste', (e) => { const fs = e.clipboardData?.files; if (fs?.length) addFiles(fs); });

  const go = $<HTMLButtonElement>('#export'), stop = $<HTMLButtonElement>('#stop');
  go.addEventListener('click', async () => {
    go.disabled = true;
    stop.hidden = false;
    $('#result').innerHTML = '';
    try {
      const { blob, ext } = await exportVideo();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stereo-${settings.motion}-${Date.now()}.${ext}`;
      a.className = 'btn btn-main';
      a.textContent = `動画を保存（${(blob.size / 1048576).toFixed(1)}MB）`;
      $('#result').appendChild(a);
      status(ext === 'mp4' ? 'できました' : 'できました（このブラウザでは WebM で作りました）');
    } catch (e) {
      status((e as Error).message);
    } finally {
      go.disabled = false;
      stop.hidden = true;
      $<HTMLProgressElement>('#progress').value = 0;
    }
  });
  stop.addEventListener('click', () => { stopFlag = true; });
  const dep = $<HTMLButtonElement>('#depth');
  dep.addEventListener('click', () => { showDepth = !showDepth; dep.setAttribute('aria-pressed', String(showDepth)); });
}

// ---- AI から呼ぶ口（同じ描き方で作る）----
declare global {
  interface Window { stereoMotion: unknown }
}
window.stereoMotion = {
  version: 1,
  motions: MOTIONS.map((m) => ({ id: m.id, label: m.label, hint: m.hint })),
  defaults: DEFAULTS,
  async loadModel() { await loadModel(); return true; },
  async addImage(dataUrl: string, name = 'image') {
    const blob = await (await fetch(dataUrl)).blob();
    await addFiles([Object.assign(blob, { name })]);
    const it = items[items.length - 1];
    if (it.status !== 'ok') throw new Error(it.error || 'prepare failed');
    return items.length;
  },
  clear() {
    for (const it of items.splice(0)) { if (it.layer) renderer.release(it.layer); URL.revokeObjectURL(it.thumb); }
    renderList();
  },
  setSettings(p: Partial<Settings>) { setSettings(p); return settings; },
  getSettings() { return settings; },
  frameCount() { return Math.round(settings.seconds * settings.fps); },
  frame(i: number, type = 'image/jpeg', quality = 0.95) {
    exporting = true;
    drawFrame(renderer, frame, settings, layers(), i / settings.fps);
    return out.toDataURL(type, quality);
  },
  release() { exporting = false; },
  async exportVideo() {
    const { blob, ext } = await exportVideo();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { ext, mime: blob.type, base64: btoa(s) };
  },
};

// 個人サイトに埋め込まれたとき、枠の高さを中身に合わせてもらう（高さの数字だけを送る）
if (window.parent !== window) {
  const send = () => window.parent.postMessage({ stereoMotionHeight: document.documentElement.scrollHeight }, '*');
  new ResizeObserver(send).observe(document.body);
  window.addEventListener('load', send);
}

buildControls();
bindButtons();
renderList();
requestAnimationFrame(loop);
