// AI から使うための中身：組み立てた画面（dist）をこの PC だけで開き、画面と同じ描き方で動画を作る。
// 画面の書き出し（WebCodecs）が使えればそれで MP4 を受け取り、使えなければ毎コマの絵を受け取って ffmpeg でまとめる。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const CHROME_CANDIDATES = [
  process.env.STEREO_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

function serve() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('先に `npm run build` で組み立ててください');
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.join(DIST, u === '/' ? 'index.html' : u);
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  // 毎回同じ番地で開く＝ブラウザに残ったモデルをいつも使える（ふさがっていれば空いている番地で）
  return new Promise((ok) => {
    server.once('error', () => server.listen(0, '127.0.0.1', () => ok(server)));
    server.listen(Number(process.env.STEREO_PORT || 47231), '127.0.0.1', () => ok(server));
  });
}

let shared = null;
export async function session() {
  if (shared) return shared;
  const server = await serve();
  const exe = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('Chrome か Edge が見つかりません（STEREO_CHROME に場所を入れてください）');
  const base = process.env.STEREO_PROFILE || path.join(ROOT, '.cache', 'chrome');
  const launch = (dir) => puppeteer.launch({
    executablePath: exe,
    headless: process.env.STEREO_HEADFUL ? false : true,
    // モデルの読み込みを次回に残す（2回目から速い）
    userDataDir: dir,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default', '--window-size=1280,900'],
  });
  // 別の MCP が同じ置き場所を使っているときは、この処理専用の置き場所で起動する（モデルは取り直しになる）
  const browser = await launch(base).catch((e) => (/already running/.test(String(e.message)) ? launch(`${base}-${process.pid}`) : Promise.reject(e)));
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.stereoMotion, { timeout: 30000 });
  shared = { server, browser, page, logs };
  return shared;
}

export async function close() {
  if (!shared) return;
  await shared.browser.close().catch(() => {});
  shared.server.close();
  shared = null;
}

export async function listMotions() {
  const { page } = await session();
  return page.evaluate(() => ({ motions: window.stereoMotion.motions, defaults: window.stereoMotion.defaults }));
}

const dataUrl = (file) => {
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
};

/**
 * 絵1枚と設定から立体視の素材を作る。透明のある絵＝透過 WebM（ffmpeg・prores:true なら ProRes 4444 の .mov も）／背景つきの絵＝MP4。
 * @param {{ image: string, settings?: object, out?: string, prores?: boolean, onLog?: (s: string) => void }} o
 */
export async function makeVideo(o) {
  const { page, logs } = await session();
  const log = o.onLog || (() => {});
  const f = o.image;
  if (!f || !fs.existsSync(f)) throw new Error(`絵がありません：${f}`);
  await page.evaluate(() => window.stereoMotion.clear());
  log(`下ごしらえ：${path.basename(f)}`);
  await page.evaluate((d, n) => window.stereoMotion.addImage(d, n), dataUrl(f), path.basename(f));
  const alpha = await page.evaluate(() => window.stereoMotion.hasAlpha());
  // 長さは「1周×周回数」でしか決まらない（必ず永久ループ）。秒で頼まれたら、いちばん近い周回数に丸める
  const want = { ...(o.settings || {}) };
  if (want.seconds != null && want.cycles == null) {
    const defs = await page.evaluate(() => window.stereoMotion.defaults);
    const period = Math.round(Number(want.period ?? defs.period) * Number(want.fps ?? defs.fps)) / Number(want.fps ?? defs.fps);
    want.cycles = Math.max(1, Math.round(Number(want.seconds) / period));
  }
  delete want.seconds;
  // 頼むたびに、はじめの設定から組み直す（前の依頼の設定を持ち越さない）
  const settings = await page.evaluate((s) => window.stereoMotion.setSettings({ ...window.stereoMotion.defaults, ...s }), want);
  const stem = `${path.basename(f).replace(/\.[^.]+$/, '')}-${settings.motion}`;
  const out = path.resolve(o.out || path.join(os.tmpdir(), `${stem}-${Date.now()}.${alpha ? 'webm' : 'mp4'}`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const frames = await page.evaluate(() => window.stereoMotion.frameCount());

  let via = alpha ? "ffmpeg" : "page";
  const extra = [];
  if (alpha) {
    log("透明つきのコマを ffmpeg で透過 WebM にまとめます");
    await framesToFfmpeg(page, settings, out, log, "webm");
    if (o.prores) {
      const mov = out.replace(/\.[^.]+$/, '') + '.mov';
      await framesToFfmpeg(page, settings, mov, log, "prores");
      extra.push(mov);
    }
  } else {
    try {
      log("書き出し（画面の部品）");
      const r = await page.evaluate(() => window.stereoMotion.exportVideo());
      if (r.ext !== 'mp4') throw new Error(`MP4 にできない（${r.ext}）`);
      fs.writeFileSync(out, Buffer.from(r.base64, 'base64'));
    } catch (e) {
      via = 'ffmpeg';
      log(`画面の書き出しが使えないので ffmpeg でまとめます（${e.message}）`);
      await framesToFfmpeg(page, settings, out, log, "mp4");
    }
  }
  const size = await page.evaluate(() => { const c = document.querySelector("#out"); return [c.width, c.height]; });
  return { out, extra, via, transparent: alpha, width: size[0], height: size[1], frames, seconds: frames / settings.fps, settings, logs: logs.slice(-20) };
}

async function framesToFfmpeg(page, settings, out, log, kind) {
  const n = await page.evaluate(() => window.stereoMotion.frameCount());
  const enc = {
    webm: ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '24', '-row-mt', '1', '-auto-alt-ref', '0'],
    prores: ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le'],
    mp4: ['-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '18', '-movflags', '+faststart'],
  }[kind];
  const png = kind !== 'mp4';
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-c:v', png ? 'png' : 'mjpeg', '-framerate', String(settings.fps), '-i', '-', ...enc, out]);
  const done = new Promise((ok, ng) => { ff.on('close', (c) => (c === 0 ? ok() : ng(new Error(`ffmpeg ${c}`)))); ff.on('error', ng); });
  try {
    for (let i = 0; i < n; i++) {
      const url = await page.evaluate((k, t) => window.stereoMotion.frame(k, t), i, png ? 'image/png' : 'image/jpeg');
      const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (i % 30 === 0) log(`コマ ${i} / ${n}`);
    }
  } finally {
    ff.stdin.end();
    await page.evaluate(() => window.stereoMotion.release());
  }
  await done;
}

/** 画面の写し（確かめ用） */
export async function screenshot(file, width = 1280, height = 900) {
  const { page } = await session();
  await page.setViewport({ width, height });
  await page.screenshot({ path: file, fullPage: true });
  return file;
}
