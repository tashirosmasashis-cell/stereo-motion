#!/usr/bin/env node
// 手で試すための入口：node mcp/cli.mjs --out a.webm --motion cw --cycles 2 絵.png   （透明のある絵→透過 WebM／背景つき→MP4・--prores true で .mov も）
//   設定の名前は画面と同じ（motion amount period stereo pivot view cycles width fps）
//   長さ＝1周の秒数×周回数（必ず永久ループ）。--seconds を渡すと近い周回数に丸める
//   --shot 画面.png で画面の写しも撮る
import { makeVideo, close, screenshot } from './core.mjs';

const args = process.argv.slice(2);
const images = [], settings = {};
let out, shot, prores = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') out = args[++i];
  else if (a === '--shot') shot = args[++i];
  else if (a === '--prores') prores = args[++i] === 'true';
  else if (a.startsWith('--')) {
    const k = a.slice(2), v = args[++i];
    settings[k] = v === 'true' ? true : v === 'false' ? false : Number.isFinite(Number(v)) && v !== '' ? Number(v) : v;
  } else images.push(a);
}
try {
  const t = Date.now();
  if (images.length !== 1) throw new Error('絵は1枚だけ渡してください（1枚が1本の素材）');
  const r = await makeVideo({ image: images[0], settings, out, prores, onLog: (s) => console.error(s) });
  if (shot) await screenshot(shot);
  console.log(JSON.stringify({ out: r.out, extra: r.extra, transparent: r.transparent, size: [r.width, r.height], frames: r.frames, via: r.via, sec: (Date.now() - t) / 1000 }, null, 1));
  const errs = r.logs.filter((l) => /error/i.test(l));
  if (errs.length) console.error(errs.join('\n'));
} finally {
  await close();
}
