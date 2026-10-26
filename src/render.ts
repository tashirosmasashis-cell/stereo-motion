// 左右の目の見え方を WebGL で描く。
// 出す側の点ごとに「手前から奥へ」光線をたどり、最初に当たる所を描く（手前の物が奥を隠す）。
// 当たった所が奥行きの崖（手前の物のふち）なら、そこは動いて見えるようになった「隠れていた所」なので、
// 手前の物を取り除いた背景の絵からもう一度たどって描く（引き伸ばしが出ない）。
import type { Prepared } from './depth';

const VS = `#version 300 es
in vec2 p; out vec2 vUv;
void main(){ vUv = vec2(p.x*0.5+0.5, 0.5-p.y*0.5); gl_Position = vec4(p,0.,1.); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uColor, uDepth, uBg, uBgDepth;
uniform vec2 uA;      // 奥行き1あたりのずれ（uv）
uniform vec2 uB;      // 奥行きによらないずれ（uv）
uniform float uZoom;  // 端の外が見えないように少し拡大
uniform int uSteps;
uniform float uWall;
in vec2 vUv; out vec4 o;
vec2 src(vec2 uv, float z){ return uv - uA*z - uB; }
float march(sampler2D dep, vec2 uv, out vec2 hit){
  float prev = 1.0;
  for (int i = 0; i <= 160; i++) {
    if (i > uSteps) break;
    float z = 1.0 - float(i)/float(uSteps);
    if (texture(dep, src(uv,z)).r >= z) {
      float lo = z, hi = prev;
      for (int k = 0; k < 7; k++) {
        float m = (lo+hi)*0.5;
        if (texture(dep, src(uv,m)).r >= m) lo = m; else hi = m;
      }
      hit = src(uv, lo);
      return lo;
    }
    prev = z;
  }
  hit = src(uv, 0.0);
  return 0.0;
}
void main(){
  vec2 uv = 0.5 + (vUv - 0.5) * uZoom;
  vec2 h;
  float z = march(uDepth, uv, h);
  float d = texture(uDepth, h).r;
  if (d - z > uWall) {
    vec2 hb;
    march(uBgDepth, uv, hb);
    o = vec4(texture(uBg, hb).rgb, 1.0);
  } else {
    o = vec4(texture(uColor, h).rgb, 1.0);
  }
}`;

export type EyeShift = { ax: number; ay: number; bx: number; by: number }; // uv の単位

export type Layer = { tex: { color: WebGLTexture; depth: WebGLTexture; bg: WebGLTexture; bgDepth: WebGLTexture }; prep: Prepared };

export class Renderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('このブラウザでは WebGL2 が使えません');
    this.gl = gl;
    const sh = (type: number, srcText: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, srcText);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    this.prog = p;
    gl.useProgram(p);
    for (const n of ['uColor', 'uDepth', 'uBg', 'uBgDepth', 'uA', 'uB', 'uZoom', 'uSteps', 'uWall']) this.u[n] = gl.getUniformLocation(p, n);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(this.u.uColor, 0);
    gl.uniform1i(this.u.uDepth, 1);
    gl.uniform1i(this.u.uBg, 2);
    gl.uniform1i(this.u.uBgDepth, 3);
    gl.uniform1f(this.u.uWall, 0.03);
  }

  private texture(fill: (gl: WebGL2RenderingContext) => void): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    fill(gl);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  upload(prep: Prepared): Layer {
    const { workW: W, workH: H } = prep;
    const r8 = (a: Float32Array) => {
      const u = new Uint8Array(a.length);
      for (let i = 0; i < a.length; i++) u[i] = Math.round(Math.min(1, Math.max(0, a[i])) * 255);
      return u;
    };
    return {
      prep,
      tex: {
        color: this.texture((gl) => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, prep.color)),
        depth: this.texture((gl) => gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, W, H, 0, gl.RED, gl.UNSIGNED_BYTE, r8(prep.depth))),
        bg: this.texture((gl) => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(prep.bgColor.buffer))),
        bgDepth: this.texture((gl) => gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, W, H, 0, gl.RED, gl.UNSIGNED_BYTE, r8(prep.bgDepth))),
      },
    };
  }

  release(layer: Layer) {
    for (const t of Object.values(layer.tex)) this.gl.deleteTexture(t);
  }

  setSize(w: number, h: number) {
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  /** viewport（x, y, w, h・WebGL の下が0）に、1つの目の見え方を描く */
  drawEye(layer: Layer, vp: [number, number, number, number], s: EyeShift, zoom: number, steps: number) {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    const t = layer.tex;
    [t.color, t.depth, t.bg, t.bgDepth].forEach((tex, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
    });
    gl.uniform2f(this.u.uA, s.ax, s.ay);
    gl.uniform2f(this.u.uB, s.bx, s.by);
    gl.uniform1f(this.u.uZoom, zoom);
    gl.uniform1i(this.u.uSteps, steps);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  clear() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}
