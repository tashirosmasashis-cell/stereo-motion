#!/usr/bin/env node
// 永久ループの検査：node mcp/loop-check.mjs 絵.png [絵2.png …]
//   よくある凡ミス＝「最後のコマと最初のコマが同じ絵」で、くり返すと同じ絵が2コマ続いてカクッと止まる。
//   それが起きていないことを、4つの動きそれぞれで確かめる：
//   ① 書き出した動画のコマ数が、ちょうど 1周×周回数×枚数 のコマ数（N）
//   ② 描かない「N コマ目」が 0 コマ目とまったく同じ（＝ここで1周がぴったり閉じている）
//   ③ 最後のコマ（N-1）は 0 コマ目と違う（＝同じ絵が2コマ続かない）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeVideo, close, session } from './core.mjs';

const images = process.argv.slice(2);
if (!images.length) { console.error('使い方：node mcp/loop-check.mjs 絵.png [絵2.png …]'); process.exit(2); }

let bad = 0;
try {
  for (const motion of ['sway-x', 'sway-y', 'cw', 'ccw']) {
    const out = path.join(os.tmpdir(), `loop-check-${motion}.mp4`);
    // 文字の重ね（残り秒数・最後の文）は動画が頭に戻ると最初に戻るので、絵だけの形で調べる
    const r = await makeVideo({ images, out, settings: { motion, cycles: 1, layout: 'sbs', period: 3.3 } });
    const { page } = await session();
    const res = await page.evaluate(() => {
      const sm = window.stereoMotion;
      const N = sm.frameCount();
      const px = (i) => {
        sm.frame(i, 'image/png');
        const c = document.querySelector('#out');
        return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      };
      const diff = (a, b) => { let d = 0; for (let k = 0; k < a.length; k += 4) d += Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]); return d / (a.length / 4); };
      const f0 = px(0), fN = px(N), fL = px(N - 1), f1 = px(1);
      sm.release();
      return { N, closeN: diff(f0, fN), lastToFirst: diff(fL, f0), firstToSecond: diff(f0, f1) };
    });
    const count = Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', out]).toString().trim());
    const ok1 = count === res.N, ok2 = res.closeN === 0, ok3 = res.lastToFirst > 0 && res.lastToFirst < res.firstToSecond * 3;
    if (!(ok1 && ok2 && ok3)) bad++;
    console.log(`${ok1 && ok2 && ok3 ? '✅' : '❌'} ${motion}: コマ数 ${count}/${res.N}${ok1 ? '' : '（違う）'}・N コマ目＝0 コマ目の差 ${res.closeN.toFixed(3)}${ok2 ? '' : '（閉じていない）'}・最後→最初の差 ${res.lastToFirst.toFixed(2)}（となりのコマどうし ${res.firstToSecond.toFixed(2)}）${res.lastToFirst > 0 ? '' : '＝同じ絵が2コマ続く'}`);
    fs.rmSync(out, { force: true });
  }
} finally {
  await close();
}
process.exit(bad ? 1 : 0);
