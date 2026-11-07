// 1行で入れる：`npx -y github:tashirosmasashis-cell/stereo-motion add`
// ①取ってきたプログラムを家の置き場所（~/.stereo-motion）へ写す ②この PC にある AI（Claude Code・Codex・Antigravity）に MCP として登録する。
// 登録するのは `node <置き場所>/mcp/server.mjs`＝次からはネットも待ち時間も要らない。新しい版にするときは同じ1行をもう一度。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const NAME = 'stereo-motion';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = os.homedir();
const fwd = (p) => p.replace(/\\/g, '/');
const say = (s) => console.log(s);

// ① 置き場所へ写す（npx の一時の置き場所は消えることがある）
let server = path.join(ROOT, 'mcp', 'server.mjs');
const fromNpx = path.basename(path.dirname(ROOT)) === 'node_modules';
if (fromNpx) {
  const src = path.dirname(ROOT);
  const dst = path.join(HOME, '.stereo-motion', 'app', 'node_modules');
  if (path.resolve(src) !== path.resolve(dst)) {
    fs.rmSync(dst, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.cpSync(src, dst, { recursive: true });
  }
  server = path.join(dst, NAME, 'mcp', 'server.mjs');
}
server = fwd(server);
say(`プログラムの置き場所：${server}`);

// 動かすのに要る物（無くても登録はする）
const chrome = [process.env.STEREO_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => fs.existsSync(p));
const has = (cmd, args = ['--version']) => spawnSync(cmd, args, { shell: process.platform === 'win32', stdio: 'ignore' }).status === 0;
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 12)) say(`Node.js：${process.versions.node} は古いので動きません。22.12 以上に上げてください（https://nodejs.org/）`);
say(chrome ? `Chrome／Edge：あり（${chrome}）` : 'Chrome／Edge：見つかりません。Chrome か Edge を入れてください（別の場所なら STEREO_CHROME に入れる）');
say(has(process.env.STEREO_FFMPEG || 'ffmpeg', ['-version']) ? 'ffmpeg：あり' : 'ffmpeg：ありません。透過の絵と 1枚の絵のまま（view:"single"）には要ります（Windows は winget install ffmpeg、Mac は brew install ffmpeg）');

// ② この PC にある AI に登録する（もう入っている物は触らない）
const done = [];
const q = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
const run = (cmd, args) => spawnSync(process.platform === 'win32' ? [cmd, ...args].map(q).join(' ') : cmd, process.platform === 'win32' ? [] : args, { shell: process.platform === 'win32', encoding: 'utf8' });

// Claude Code（使う人のどのフォルダでも使える登録）
if (has('claude')) {
  if (run('claude', ['mcp', 'get', NAME]).status === 0) done.push('Claude Code：もう入っています');
  else {
    const r = run('claude', ['mcp', 'add', '--scope', 'user', NAME, '--', 'node', server]);
    done.push(r.status === 0 ? 'Claude Code：登録しました' : `Claude Code：登録できませんでした（${(r.stderr || r.stdout || '').trim()}）`);
  }
}

// Codex（設定ファイルの末尾に足す・初回の起動を待てるよう60秒）
const codexDir = path.join(HOME, '.codex');
if (fs.existsSync(codexDir)) {
  const file = path.join(codexDir, 'config.toml');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (/^\[mcp_servers\.(?:"stereo-motion"|stereo-motion)\]/m.test(text)) done.push('Codex：もう入っています');
  else {
    const block = `\n[mcp_servers.${NAME}]\ncommand = "node"\nargs = [${JSON.stringify(server)}]\nstartup_timeout_sec = 60\n`;
    fs.writeFileSync(file, text.replace(/\s*$/, '\n') + block);
    done.push('Codex：登録しました');
  }
}

// Antigravity（MCP の設定ファイルに足す）
const agyFiles = [path.join(HOME, '.gemini', 'config', 'mcp_config.json'), path.join(HOME, '.gemini', 'antigravity', 'mcp_config.json')];
const agyTargets = agyFiles.filter((f) => fs.existsSync(f));
if (!agyTargets.length && fs.existsSync(path.join(HOME, '.gemini', 'config'))) agyTargets.push(agyFiles[0]);
for (const file of agyTargets) {
  let conf = {};
  try { conf = JSON.parse(fs.readFileSync(file, 'utf8') || '{}'); } catch { if (fs.existsSync(file)) { done.push(`Antigravity：設定ファイルが読めないので触りませんでした（${fwd(file)}）`); continue; } }
  conf.mcpServers ||= {};
  if (conf.mcpServers[NAME]) { done.push('Antigravity：もう入っています'); continue; }
  conf.mcpServers[NAME] = { command: 'node', args: [server] };
  fs.writeFileSync(file, JSON.stringify(conf, null, 2) + '\n');
  done.push('Antigravity：登録しました');
}

if (!done.length) {
  say('登録先の AI が見つかりませんでした。使う AI の MCP の設定に、次のコマンドを足してください：');
  say(`  node ${server}`);
} else {
  for (const d of done) say(d);
  say('AI を開き直すと「make_stereo_video」が使えます。新しい版にするときは、同じ1行をもう一度打ってください。');
}
