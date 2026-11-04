#!/usr/bin/env node
// 立体視ムービーメーカーの HTTP API（この PC の中だけ・MCP と同じ道具を同じ名前・同じ引数・同じ返事で呼べる）。
//   起動：npm run api   （はじめは http://127.0.0.1:47232 ・番地は STEREO_API_PORT）
//   GET  /v1/tools                  道具の一覧（MCP の tools/list と同じ内容：name・description・inputSchema）
//   POST /v1/tools/{name}           引数の JSON を渡すと、MCP の返事の中身（JSON）がそのまま返る
//   GET  /openapi.json              OpenAPI 3.1（上と同じ定義から作る）
// 安全：127.0.0.1 だけで待つ／Origin 付き（ブラウザのページから）の頼みは断る／JSON 以外は断る＝よそのページが勝手に呼べない。
// インターネットには出しません（出すとあなたのサーバーに負荷がかかる・絵はこの PC から出さない決め）。
import http from 'node:http';
import { z } from 'zod';
import { TOOLS, toolByName } from './tools.mjs';
import { close } from './core.mjs';

const PORT = Number(process.env.STEREO_API_PORT || 47232);
const schemaOf = (t) => z.toJSONSchema(z.object(t.shape), { io: 'input' });

const openapi = () => ({
  openapi: '3.1.0',
  info: {
    title: 'stereo-motion API',
    version: '2.0.0',
    description: 'Local API (127.0.0.1 only). Same tools, names, arguments and results as the MCP server. Makes transparent stereoscopic video material from images. See docs/FOR-AI.md.',
  },
  servers: [{ url: `http://127.0.0.1:${PORT}` }],
  paths: {
    '/v1/tools': { get: { operationId: 'listTools', summary: 'List the tools (same as MCP tools/list)', responses: { 200: { description: 'tools' } } } },
    ...Object.fromEntries(TOOLS.map((t) => [`/v1/tools/${t.name}`, {
      post: {
        operationId: t.name,
        summary: t.description.split('. ')[0],
        description: t.description,
        requestBody: { required: true, content: { 'application/json': { schema: schemaOf(t) } } },
        responses: { 200: { description: 'The tool result (same JSON as the MCP text content)' }, 400: { description: '{ error: string }' } },
      },
    }])),
  },
});

// 1つの見えない Chrome を使い回すので、頼みは1つずつ順番に処理する
let chain = Promise.resolve();
const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 1));
};

const server = http.createServer(async (req, res) => {
  try {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host) || req.headers.origin) return send(res, 403, { error: 'local use only' });
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/openapi.json') return send(res, 200, openapi());
    if (req.method === 'GET' && url.pathname === '/v1/tools') return send(res, 200, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: schemaOf(t) })) });
    const m = url.pathname.match(/^\/v1\/tools\/([a-z_]+)$/);
    if (req.method === 'POST' && m) {
      const tool = toolByName(m[1]);
      if (!tool) return send(res, 404, { error: `unknown tool: ${m[1]}` });
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'Content-Type must be application/json' });
      let raw = '';
      for await (const c of req) { raw += c; if (raw.length > 1e6) return send(res, 413, { error: 'too large' }); }
      const parsed = z.object(tool.shape).safeParse(raw ? JSON.parse(raw) : {});
      if (!parsed.success) return send(res, 400, { error: 'invalid arguments', issues: parsed.error.issues });
      const result = await serial(() => tool.run(parsed.data));
      return send(res, 200, result);
    }
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, { name: 'stereo-motion API', tools: '/v1/tools', openapi: '/openapi.json', docs: 'docs/FOR-AI.md' });
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 400, { error: String(e.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => console.error(`stereo-motion API: http://127.0.0.1:${PORT}  (/v1/tools・/openapi.json)`));
const bye = async () => { await close(); process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
