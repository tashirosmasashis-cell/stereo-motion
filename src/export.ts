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
  if (typeof VideoEncoder === 'undefined') return recordVideo(canvas as HTMLCanvasElement, frames, fps, draw, onProgress, shouldStop);
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

// 動画の部品（WebCodecs）が無いブラウザ用：画面を録画して書き出す（動画の長さと同じだけ時間がかかる）
async function recordVideo(
  canvas: HTMLCanvasElement,
  frames: number,
  fps: number,
  draw: (i: number) => void | Promise<void>,
  onProgress?: (done: number, total: number) => void,
  shouldStop?: () => boolean,
): Promise<Encoded> {
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) throw new Error('このブラウザは動画の書き出しに対応していません。PC の Chrome か Edge で開いてください');
  const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('このブラウザは動画の書き出しに対応していません。PC の Chrome か Edge で開いてください');
  await draw(0);
  const stream = canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((ok) => (rec.onstop = () => ok()));
  rec.start(1000);
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) {
    if (shouldStop?.()) { rec.stop(); await stopped; throw new Error('止めました'); }
    await draw(i);
    onProgress?.(i + 1, frames);
    const wait = t0 + ((i + 1) * 1000) / fps - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  const mp4 = mime.startsWith('video/mp4');
  return { data: await blob.arrayBuffer(), mime: mp4 ? 'video/mp4' : 'video/webm', ext: mp4 ? 'mp4' : 'webm' };
}
