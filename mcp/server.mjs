#!/usr/bin/env node
// 立体視ムービーメーカーの MCP サーバー（AI から呼ぶ口）。
// 動画に貼る立体視の素材を、画面と同じ描き方でこの PC の中だけで作る（絵はどこにも送らない）。透過PNG→透過 WebM。
// 登録の例（Claude Code）：claude mcp add stereo-motion -- node <このリポ>/mcp/server.mjs
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import path from 'node:path';
import { makeVideo, listMotions, close } from './core.mjs';

const server = new McpServer({ name: 'stereo-motion', version: '2.0.0' });

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
    images: z.array(z.string()).min(1).describe('Absolute paths of the images (PNG/JPEG/WebP). One material file is made per image. A PNG with transparency becomes a transparent WebM (VP9 alpha, ready for Remotion OffthreadVideo transparent); an opaque image becomes an MP4.'),
    out_dir: z.string().optional().describe('Absolute folder for the output files (named <image>-<motion>.webm|mp4). Defaults to a temp folder.'),
    prores: z.boolean().optional().describe('Also write a ProRes 4444 .mov next to each transparent WebM (for video editors that cannot read WebM alpha)'),
    motion: z.enum(['sway-x', 'sway-y', 'cw', 'ccw', 'still']).optional().describe('sway-x: left-right, sway-y: up-down, cw: clockwise circle, ccw: counter-clockwise circle'),
    amount: z.number().min(0).max(10).optional().describe('Camera motion size, percent of the image width (default 3.5)'),
    period: z.number().min(1).max(30).optional().describe('Seconds per motion cycle (default 4). Rounded to a whole number of frames so the video loops seamlessly'),
    stereo: z.number().min(0).max(12).optional().describe('Left/right disparity, percent of the image width (default 6)'),
    pivot: z.number().min(-1).max(1).optional().describe('Depth the camera turns around: 0 = far, 1 = near, -1 = automatic (default)'),
    view: z.enum(['parallel', 'cross']).optional().describe('parallel (default) or cross-eye'),
    width: z.number().optional().describe('Total width of the left+right pair in pixels: 1080, 1920 (default) or 3840. Height follows the image aspect.'),
    cycles: z.number().int().min(1).max(60).optional().describe('Motion cycles (default 1). Length = period x cycles, so the last frame always leads back into the first (seamless infinite loop). Make one cycle and loop it in the editor.'),
    seconds: z.number().min(1).max(600).optional().describe('Approximate length instead of cycles; rounded to whole cycles so the video still loops seamlessly'),
    fps: z.number().min(10).max(60).optional(),
  },
  async ({ images, out_dir, prores, ...settings }) => {
    const clean = Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined));
    const files = [];
    for (const image of images) {
      const stem = path.basename(image).replace(/\.[^.]+$/, '');
      const r = await makeVideo({ image, prores, settings: clean, out: out_dir ? path.join(out_dir, `${stem}-${clean.motion ?? 'sway-y'}.${/\.(png|webp)$/i.test(image) ? 'webm' : 'mp4'}`) : undefined });
      files.push({ image, out: r.out, extra: r.extra, transparent: r.transparent, width: r.width, height: r.height, frames: r.frames, seconds: r.seconds, via: r.via });
    }
    return { content: [{ type: 'text', text: JSON.stringify({ files }, null, 1) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
const bye = async () => { await close(); process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
process.stdin.on('close', bye);
