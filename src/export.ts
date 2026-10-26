// 1コマずつ描いて、ブラウザの動画の部品（WebCodecs）と Mediabunny で MP4（使えなければ WebM）にまとめる。
import { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, QUALITY_HIGH, getFirstEncodableVideoCodec } from 'mediabunny';

export type Encoded = { data: ArrayBuffer; mime: string; ext: 'mp4' | 'webm' };

export async function encodeVideo(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  frames: number,
  fps: number,
  draw: (i: number) => void | Promise<void>,
  onProgress?: (done: number, total: number) => void,
  shouldStop?: () => boolean,
): Promise<Encoded> {
  if (typeof VideoEncoder === 'undefined') throw new Error('このブラウザは動画の書き出しに対応していません。PC の Chrome か Edge で開いてください');
  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'vp8'], { width: canvas.width, height: canvas.height });
  if (!codec) throw new Error('このブラウザでは動画を作れません。PC の Chrome か Edge で開いてください');
  const mp4 = codec === 'avc';
  const output = new Output({
    format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();
  for (let i = 0; i < frames; i++) {
    if (shouldStop?.()) { await output.cancel(); throw new Error('止めました'); }
    await draw(i);
    await source.add(i / fps, 1 / fps);
    onProgress?.(i + 1, frames);
  }
  await output.finalize();
  const data = (output.target as BufferTarget).buffer!;
  return { data, mime: mp4 ? 'video/mp4' : 'video/webm', ext: mp4 ? 'mp4' : 'webm' };
}
