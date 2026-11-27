// WebGL2 renderer: India as a solid relief model on a plinth, with the forecast printed onto the land.
import { toWorld } from './world.js';

const NX = 433, NZ = 385, BASE = -2.2; // 12 vertices per degree, like the elevation data
export const SUN = [-0.55, 0.55, -0.45]; // from the north-west, so relief reads the right way up from above

const VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in float aWall; layout(location=3) in vec2 aOcc;
uniform mat4 uVP; uniform float uRise; out vec3 vPos; out vec3 vNor; out vec2 vUv; out float vWall; out vec2 vOcc;
void main(){ vec3 p=aPos; if(aWall<1.5&&p.y>-2.19) p.y*=uRise; vPos=p; vNor=aNor; vWall=aWall; vOcc=aOcc; vUv=vec2((p.x+18.0)/36.0,(p.z+16.0)/32.0); gl_Position=uVP*vec4(p,1.0); }`;

const FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNor; in vec2 vUv; in float vWall; in vec2 vOcc;
uniform sampler2D uData; uniform sampler2D uData2; uniform sampler2D uLand; uniform sampler2D uImg;
uniform float uTime; uniform vec3 uEye; uniform float uPulse; uniform vec3 uFog; uniform vec3 uSun; uniform float uDist; uniform float uSplit;
out vec4 outColor;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ return 0.55*noise(p)+0.3*noise(p*2.3)+0.15*noise(p*5.1); }
void main(){
  float wy=fwidth(vPos.y);                       // derivatives stay outside the branches
  float land=texture(uLand,vUv).r, coast=1.0-smoothstep(0.0,1.6,abs(land-0.5)/max(fwidth(land),1e-4));
  float dist=length(uEye-vPos);
  if(vWall>1.5){                                 // soft contact shadow the block casts on the page
    float q=length(max(abs(vPos.xz)-vec2(17.4,15.4),0.0)); outColor=vec4(0.0,0.0,0.0,0.42*exp(-q*q*0.55)); return;
  }
  if(vWall>0.001){                               // the plinth: dark slate with one brass line under the surface
    vec3 w=mix(vec3(0.035,0.045,0.055),vec3(0.13,0.15,0.17),clamp((vPos.y-(-2.2))/2.0,0.0,1.0));
    w=mix(w,vec3(0.80,0.64,0.34),1.0-smoothstep(0.0,1.5,abs(vPos.y+0.16)/max(wy,1e-4)));
    w*=abs(vNor.x)>0.5?0.78:1.0;
    outColor=vec4(w,1.0); return;
  }
  vec3 sun=normalize(uSun), view=normalize(uEye-vPos), c;
  float near=textureLod(uLand,vUv,4.5).r;
  vec3 n=normalize(vNor), img=texture(uImg,vUv).rgb; // satellite imagery: NASA Blue Marble, July
  if(land<0.5){
    vec2 p=vPos.xz*2.1; float t=uTime*0.4;
    float a=noise(p+vec2(t,t*0.6)), b=noise(p*1.9-vec2(t*0.8,-t*0.3));
    n=normalize(mix(vec3((a-0.5)*0.28,1.0,(b-0.5)*0.28),vec3(0.0,1.0,0.0),smoothstep(15.0,60.0,dist)));
    // the sea keeps the shelf and trench shapes of the imagery, deepened towards ink blue
    vec3 deep=mix(vec3(0.045,0.105,0.155), vec3(0.16,0.34,0.38), smoothstep(0.0,0.45,near));
    c=mix(img*1.15, deep, 0.62);
    c+=vec3(1.0,0.88,0.62)*pow(max(dot(reflect(-sun,n),view),0.0),90.0)*0.35;
    c=mix(c,uFog*0.9,0.28*pow(1.0-max(dot(n,view),0.0),4.0));
  } else {
    n=normalize(vec3(n.x*1.35,n.y,n.z*1.35));
    c=pow(img,vec3(0.80))*vec3(1.06,1.02,0.95);
    c=mix(vec3(dot(c,vec3(0.30,0.59,0.11))),c,1.06);
    c*=0.93+0.14*fbm(vPos.xz*17.0);                 // fine grain so close views are not a blur
  }
  float lit=max(dot(n,sun),0.0)*mix(0.45,1.0,vOcc.y);          // baked cast shadow
  vec3 sky=mix(vec3(0.40,0.38,0.34),vec3(0.50,0.60,0.74),n.y*0.5+0.5);
  c*=sky*mix(0.52,1.0,vOcc.x)+vec3(1.16,1.00,0.78)*lit*0.82;     // sky light dimmed in valleys, warm sun
  c=clamp(c,0.0,1.0); c=mix(c,c*c*(3.0-2.0*c),0.22);
  c=mix(c,vec3(0.93,0.89,0.76),coast*0.45);
  // data after grading, so its colours match the legend: the land quietens, a paper wash goes down, then the ink
  bool right=uSplit>=0.0&&gl_FragCoord.x>uSplit;
  vec4 d=right?texture(uData2,vUv):texture(uData,vUv);
  float grey=dot(c,vec3(0.30,0.59,0.11)), quiet=uPulse;
  d.a*=mix(0.45,1.0,smoothstep(6.0,20.0,dist));       // close up, the 110 km cells thin out so the land shows through
  c=mix(c, vec3(grey)*vec3(0.96,0.99,1.04), quiet*(0.3+0.2*smoothstep(0.0,0.2,d.a)));
  c*=1.0-0.2*quiet*(1.0-smoothstep(0.0,0.3,d.a));    // the unchanged land dims, so the change stands out
  c=mix(c, vec3(0.88,0.86,0.78)*(0.74+0.4*grey), smoothstep(0.0,0.3,d.a)*0.62);
  c=mix(c, d.rgb*mix(0.86,1.08,lit), d.a);
  if(right) c*=1.0-0.24*exp(-(gl_FragCoord.x-uSplit)/18.0);          // the right-hand sheet reads as lifted
  c*=1.0+0.05*(noise(vPos.xz*0.22+vec2(uTime*0.05,0.0))-0.5)*(1.0-d.a)*2.0; // drifting cloud shade
  float far=smoothstep(uDist*0.98,uDist*1.8,dist);
  outColor=vec4(mix(c,uFog,far*(0.22+0.4*exp(-max(vPos.y,0.0)*1.6))),1.0);
}`;

function shader(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
  return s;
}

/** How open the sky is above each vertex (0..1) and whether the sun reaches it (0..1), both read from the heights. */
export function occlusion(hs, nx, nz, step) {
  const at = (i, k) => hs[Math.max(0, Math.min(nz - 1, k)) * nx + Math.max(0, Math.min(nx - 1, i))];
  const out = new Float32Array(nx * nz * 2), dirs = Array.from({ length: 8 }, (_, a) => [Math.cos((a * Math.PI) / 4), Math.sin((a * Math.PI) / 4)]);
  const flat = Math.hypot(SUN[0], SUN[2]), sx = SUN[0] / flat, sz = SUN[2] / flat, rise = SUN[1] / flat;
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const h0 = at(i, k); let sum = 0;
    for (const [c, s] of dirs) { let h = 0; for (const r of [1, 2, 4, 7, 11, 16, 24]) h = Math.max(h, (at(i + Math.round(c * r), k + Math.round(s * r)) - h0) / (r * step)); sum += h / Math.hypot(1, h); }
    let over = 0; for (let r = 1; r < 40; r += 1.5) over = Math.max(over, (at(Math.round(i + sx * r), Math.round(k + sz * r)) - h0) / (r * step) - rise * 0.84);
    const o = (k * nx + i) * 2; out[o] = 1 - sum / 8; out[o + 1] = 1 - Math.min(1, over / 0.15);
  }
  return out;
}

/** Surface grid, the four sides of the plinth, and the quad that carries its shadow. height(x, z) is in world units. */
function mesh(height) {
  const pos = [], nor = [], wall = [], idx = [], hs = new Float32Array(NX * NZ), dx = 36 / (NX - 1), dz = 32 / (NZ - 1);
  for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) hs[k * NX + i] = height(-18 + i * dx, -16 + k * dz);
  const occ = Array.from(occlusion(hs, NX, NZ, dx));
  const at = (i, k) => hs[Math.max(0, Math.min(NZ - 1, k)) * NX + Math.max(0, Math.min(NX - 1, i))];
  for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
    pos.push(-18 + i * dx, at(i, k), -16 + k * dz);
    const nx = (at(i - 1, k) - at(i + 1, k)) / (2 * dx), nz = (at(i, k - 1) - at(i, k + 1)) / (2 * dz), len = Math.hypot(nx, 1, nz);
    nor.push(nx / len, 1 / len, nz / len); wall.push(0);
  }
  for (let k = 0; k < NZ - 1; k++) for (let i = 0; i < NX - 1; i++) { const a = k * NX + i; idx.push(a, a + NX, a + 1, a + 1, a + NX, a + NX + 1); }
  const side = (points, nx, nz) => {
    const start = pos.length / 3;
    for (const [i, k] of points) { const x = -18 + i * dx, z = -16 + k * dz; pos.push(x, at(i, k), z, x, BASE, z); nor.push(nx, 0, nz, nx, 0, nz); wall.push(1, 1); occ.push(1, 1, 1, 1); }
    for (let n = 0; n < points.length - 1; n++) { const a = start + n * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  };
  const xs = Array.from({ length: NX }, (_, i) => i), zs = Array.from({ length: NZ }, (_, k) => k);
  side(xs.map((i) => [i, NZ - 1]), 0, 1); side(xs.map((i) => [i, 0]), 0, -1); side(zs.map((k) => [0, k]), -1, 0); side(zs.map((k) => [NX - 1, k]), 1, 0);
  const s = pos.length / 3;
  for (const [x, z] of [[-21, -19], [21, -19], [-21, 19], [21, 19]]) { pos.push(x, BASE - 0.02, z); nor.push(0, 1, 0); wall.push(2); occ.push(1, 1); }
  idx.push(s, s + 2, s + 1, s + 1, s + 2, s + 3); // drawn last, so the block hides the middle of it
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), wall: new Float32Array(wall), occ: new Float32Array(occ), idx: new Uint32Array(idx) };
}

/** landCanvas (white land on black sea) and imagery both cover lon 65..101 (left to right), lat 38..6 (top to bottom). */
export function createTerrain(canvas, height, landCanvas, imagery) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
  if (!gl) throw new Error('WebGL2 is not available');
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl, gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(prog));
  const m = mesh(height), vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  [[m.pos, 3], [m.nor, 3], [m.wall, 1], [m.occ, 2]].forEach(([data, size], loc) => { gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); });
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
  const texture = (unit, source, mips) => {
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    return t;
  };
  texture(1, landCanvas, true);
  texture(2, imagery, true);
  const sharp = gl.getExtension('EXT_texture_filter_anisotropic'); // keeps tilted views crisp
  if (sharp) gl.texParameterf(gl.TEXTURE_2D, sharp.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(sharp.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  const data = texture(0, null, false), data2 = texture(3, null, false); // data2: the right-hand side when comparing
  const u = Object.fromEntries(['uVP', 'uData', 'uData2', 'uLand', 'uImg', 'uTime', 'uEye', 'uPulse', 'uFog', 'uSun', 'uDist', 'uSplit', 'uRise'].map((n) => [n, gl.getUniformLocation(prog, n)]));
  gl.useProgram(prog); gl.uniform1i(u.uData, 0); gl.uniform1i(u.uLand, 1); gl.uniform1i(u.uImg, 2); gl.uniform1i(u.uData2, 3); gl.uniform3fv(u.uSun, SUN);
  gl.enable(gl.DEPTH_TEST);
  return {
    setData(source, unit = 0) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, unit ? data2 : data); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source); },
    /** dist: camera distance (for haze). split: canvas pixel column where the second data texture takes over, or null. */
    draw(cam, { time = 0, pulse = 0, fog = [0.045, 0.064, 0.05], dist = 60, split = null, rise = 1 } = {}) {
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(prog); gl.bindVertexArray(vao);
      gl.uniformMatrix4fv(u.uVP, false, cam.m); gl.uniform3fv(u.uEye, cam.eye); gl.uniform1f(u.uTime, time); gl.uniform1f(u.uPulse, pulse); gl.uniform3fv(u.uFog, fog);
      gl.uniform1f(u.uDist, dist); gl.uniform1f(u.uSplit, split === null ? -1 : split); gl.uniform1f(u.uRise, rise);
      gl.drawElements(gl.TRIANGLES, m.idx.length, gl.UNSIGNED_INT, 0);
    },
  };
}

/** Rasterises the country polygons into a sharp land / sea mask and returns it with a lookup function. */
export function landMask(outlines, w = 1440, h = 1280) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff';
  for (const country of outlines.countries) {
    g.beginPath();
    for (const r of country.rings) { for (let k = 0; k < r.length; k += 2) { const [x, z] = toWorld(r[k], r[k + 1]), px = ((x + 18) / 36) * w, py = ((z + 16) / 32) * h; k ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath(); }
    g.fill('evenodd');
  }
  const d = g.getImageData(0, 0, w, h).data;
  const at = (lo, la) => { const x = Math.max(0, Math.min(w - 1, Math.round(((lo - 65) / 36) * w))), y = Math.max(0, Math.min(h - 1, Math.round(((38 - la) / 32) * h))); return d[(y * w + x) * 4] / 255; };
  return { canvas: c, at };
}
