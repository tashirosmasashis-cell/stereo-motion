// 道具の定義（名前・説明・引数・動き）を1か所に置く。MCP（server.mjs）と HTTP の API（api.mjs）の両方がここを使う
// ＝名前・引数・返事が同じになる（AI エージェントはどちらから来ても同じ頼み方ができる）。
import { z } from 'zod';
import path from 'node:path';
import { makeVideo, listMotions } from './core.mjs';

export const TOOLS = [
  {
    name: 'list_motions',
    description: 'Lists the camera motions and the default settings of the stereo movie maker.',
    shape: {},
    async run() {
      return listMotions();
    },
  },
  {
    name: 'make_stereo_video',
    description:
      'Makes video MATERIAL for your own video: a side-by-side stereoscopic (parallel or cross-eye) pair whose camera sways or circles around the depth estimated from each image. ' +
      'One output file per image. A PNG/WebP WITH transparency becomes a transparent WebM (VP9 alpha; use it in Remotion with <OffthreadVideo transparent>); an opaque image becomes an MP4. ' +
      'The clip always loops seamlessly (length = whole motion cycles); make one cycle and loop it in the editor. No text, frame or background is added. ' +
      'Everything runs on this PC; images are never uploaded. Returns, per image, the output path(s), size, frame count and seconds.',
    shape: {
      images: z.array(z.string()).min(1).describe('Absolute paths of the images (PNG/JPEG/WebP). One material file is made per image.'),
      out_dir: z.string().optional().describe('Absolute folder for the output files (named <image>-<motion>.webm|mp4). Defaults to a temp folder.'),
      prores: z.boolean().optional().describe('Also write a ProRes 4444 .mov next to each transparent WebM (for video editors that cannot read WebM alpha)'),
      motion: z.enum(['sway-x', 'sway-y', 'cw', 'ccw', 'still']).optional().describe('sway-x: left-right, sway-y: up-down (default), cw: clockwise circle, ccw: counter-clockwise circle, still: no camera motion (stereo only)'),
      amount: z.number().min(0).max(10).optional().describe('Camera motion size, percent of the image width (default 3.5)'),
      period: z.number().min(1).max(30).optional().describe('Seconds per motion cycle (default 4). Rounded to a whole number of frames so the video loops seamlessly'),
      stereo: z.number().min(0).max(12).optional().describe('Left/right disparity, percent of the image width (default 6)'),
      pivot: z.number().min(-1).max(1).optional().describe('Depth the camera turns around: 0 = far, 1 = near, -1 = automatic (default)'),
      view: z.enum(['parallel', 'cross']).optional().describe('parallel (default) or cross-eye'),
      width: z.number().optional().describe('Total width of the left+right pair in pixels: 1080, 1920 (default) or 3840. Height follows the image aspect.'),
      cycles: z.number().int().min(1).max(60).optional().describe('Motion cycles (default 1). Length = period x cycles'),
      seconds: z.number().min(1).max(600).optional().describe('Approximate length instead of cycles; rounded to whole cycles so the clip still loops seamlessly'),
      fps: z.number().min(10).max(60).optional().describe('Frames per second (default 30)'),
    },
    async run({ images, out_dir, prores, ...settings }) {
      const clean = Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined));
      const files = [];
      for (const image of images) {
        const r = await makeVideo({ image, prores, settings: clean, outDir: out_dir ? path.resolve(out_dir) : undefined });
        files.push({ image, out: r.out, extra: r.extra, transparent: r.transparent, width: r.width, height: r.height, frames: r.frames, seconds: r.seconds, via: r.via });
      }
      return { files };
    },
  },
];

export const toolByName = (name) => TOOLS.find((t) => t.name === name);
