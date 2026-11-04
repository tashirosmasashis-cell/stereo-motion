#!/usr/bin/env node
// 立体視ムービーメーカーの MCP サーバー（AI から呼ぶ口）。
// 動画に貼る立体視の素材を、画面と同じ描き方でこの PC の中だけで作る（絵はどこにも送らない）。透過PNG→透過 WebM。
// 登録の例（Claude Code）：claude mcp add stereo-motion -- node <このリポ>/mcp/server.mjs
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TOOLS } from './tools.mjs';
import { close } from './core.mjs';

const server = new McpServer({ name: 'stereo-motion', version: '2.0.0' });

// 道具の定義は tools.mjs に1か所（HTTP の API と共通）
for (const t of TOOLS) {
  server.tool(t.name, t.description, t.shape, async (args) => ({ content: [{ type: 'text', text: JSON.stringify(await t.run(args), null, 1) }] }));
}

const transport = new StdioServerTransport();
await server.connect(transport);
const bye = async () => { await close(); process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
process.stdin.on('close', bye);
