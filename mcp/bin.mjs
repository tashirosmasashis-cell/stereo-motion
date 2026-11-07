#!/usr/bin/env node
// npx の入り口：`npx -y github:tashirosmasashis-cell/stereo-motion add` ＝この PC の AI に登録する／引数なし＝MCP の口を開く
if (process.argv[2] === 'add') await import('./add.mjs');
else await import('./server.mjs');
