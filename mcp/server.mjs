#!/usr/bin/env node
// 立体視ムービーメーカーの MCP サーバー（AI から呼ぶ口）。
// 画面と同じ描き方で、この PC の中だけで動画を作る（絵はどこにも送らない）。
// 登録の例（Claude Code）：claude mcp add stereo-motion -- node <このリポ>/mcp/server.mjs
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { makeVideo, listMotions, close } from './core.mjs';

const server = new McpServer({ name: 'stereo-motion', version: '1.0.0' });

server.tool(
  'list_motions',
  'Lists the camera motions and the default settings of the stereo movie maker.',
  {},
  async () => ({ content: [{ type: 'text', text: JSON.stringify(await listMotions(), null, 1) }] }),
);

server.tool(
  'make_stereo_video',
  'Makes a side-by-side stereoscopic (parallel or cross-eye) video from one or more images. The camera sways or circles around the depth estimated from each image. The video always loops seamlessly (its length is whole motion cycles). Everything runs on this PC; images are never uploaded. Returns the path of the MP4.',
  {
    images: z.array(z.string()).min(1).describe('Absolute paths of the images (PNG/JPEG/WebP). Two or more are shown in order.'),
    out: z.string().optional().describe('Absolute path of the MP4 to write. Defaults to a temp file.'),
    motion: z.enum(['sway-x', 'sway-y', 'cw', 'ccw', 'still']).optional().describe('sway-x: left-right, sway-y: up-down, cw: clockwise circle, ccw: counter-clockwise circle'),
    amount: z.number().min(0).max(10).optional().describe('Camera motion size, percent of the image width (default 3.5)'),
    period: z.number().min(1).max(30).optional().describe('Seconds per motion cycle (default 4). Rounded to a whole number of frames so the video loops seamlessly'),
    stereo: z.number().min(0).max(12).optional().describe('Left/right disparity, percent of the image width (default 6)'),
    pivot: z.number().min(-1).max(1).optional().describe('Depth the camera turns around: 0 = far, 1 = near, -1 = automatic (default)'),
    view: z.enum(['parallel', 'cross']).optional().describe('parallel (default) or cross-eye'),
    layout: z.enum(['portrait', 'sbs']).optional().describe('portrait = 1080x1920 with countdown and caption (default), sbs = plain side by side'),
    cycles: z.number().int().min(1).max(60).optional().describe('Motion cycles per image (default 4). Video length = period x cycles x number of images, so the last frame always leads back into the first (seamless infinite loop)'),
    seconds: z.number().min(1).max(600).optional().describe('Approximate length instead of cycles; rounded to whole cycles so the video still loops seamlessly'),
    countdown: z.boolean().optional().describe('Show remaining seconds at the top (portrait only)'),
    caption: z.string().optional().describe('Caption at the bottom, up to two lines separated by \\n (portrait only)'),
    endText: z.string().optional().describe('Text shown instead of the caption in the last 2 seconds'),
    fps: z.number().min(10).max(60).optional(),
  },
  async ({ images, out, ...settings }) => {
    const clean = Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined));
    const r = await makeVideo({ images, out, settings: clean });
    return { content: [{ type: 'text', text: JSON.stringify({ out: r.out, via: r.via, settings: r.settings }, null, 1) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
const bye = async () => { await close(); process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
process.stdin.on('close', bye);
