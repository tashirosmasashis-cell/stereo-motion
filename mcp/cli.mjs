#!/usr/bin/env node
// 手で試すための入口：node mcp/cli.mjs --out a.mp4 --motion cw --seconds 8 絵1.png [絵2.png …]
//   設定の名前は画面と同じ（motion amount period stereo pivot view layout seconds perImage countdown caption endText fps）
//   --shot 画面.png で画面の写しも撮る
import { makeVideo, close, screenshot } from './core.mjs';

const args = process.argv.slice(2);
const images = [], settings = {};
let out, shot;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') out = args[++i];
  else if (a === '--shot') shot = args[++i];
  else if (a.startsWith('--')) {
    const k = a.slice(2), v = args[++i];
    settings[k] = v === 'true' ? true : v === 'false' ? false : Number.isFinite(Number(v)) && v !== '' ? Number(v) : v;
  } else images.push(a);
}
try {
  const t = Date.now();
  const r = await makeVideo({ images, settings, out, onLog: (s) => console.error(s) });
  if (shot) await screenshot(shot);
  console.log(JSON.stringify({ out: r.out, via: r.via, sec: (Date.now() - t) / 1000 }, null, 1));
  const errs = r.logs.filter((l) => /error/i.test(l));
  if (errs.length) console.error(errs.join('\n'));
} finally {
  await close();
}
