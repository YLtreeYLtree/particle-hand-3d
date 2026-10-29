/* =========================================================
   3D 粒子手势交互
   Three.js 粒子系统 + MediaPipe Hands 手部骨骼识别
   ---------------------------------------------------------
   手势映射：
     移动手掌          → 旋转粒子云（带惯性）
     张开 / 握拳       → 粒子爆散 / 聚合
     拇指+食指捏合     → 镜头远近（捏得越紧越靠近）
     快速左右挥手      → 切换粒子形态
     双手开合          → 镜头远近（双手模式优先）
     指尖位置          → 推开附近粒子（局部力场）
   ========================================================= */

import * as THREE from './lib/three.module.js';
import { EffectComposer }  from './lib/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from './lib/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './lib/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }      from './lib/addons/postprocessing/OutputPass.js';

/* ---------------- 常量 ---------------- */
const COUNT = 80000;          // 粒子数量
const RADIUS = 6.2;           // 形态基准半径
const MORPH_TIME = 1.15;      // 形态切换动画时长(秒)

/* ---------------- DOM ---------------- */
const canvas   = document.getElementById('scene');
const video    = document.getElementById('video');
const overlay  = document.getElementById('overlay');
const octx     = overlay.getContext('2d');
const camBox   = document.getElementById('camBox');
const camDot   = document.getElementById('camDot');
const camText  = document.getElementById('camText');
const gate     = document.getElementById('gate');
const startBtn = document.getElementById('startBtn');
const tip      = document.getElementById('tip');

const ui = {
  vOpen:  document.getElementById('vOpen'),
  bOpen:  document.getElementById('bOpen'),
  vPinch: document.getElementById('vPinch'),
  bPinch: document.getElementById('bPinch'),
  vZoom:  document.getElementById('vZoom'),
  bZoom:  document.getElementById('bZoom'),
  vFps:   document.getElementById('vFps'),
  bFps:   document.getElementById('bFps'),
  vShape: document.getElementById('vShape'),
  vGest:  document.getElementById('vGest')
};

const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const lerp  = (a, b, t) => a + (b - a) * t;
const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const gauss = () => {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/* =========================================================
   一、粒子形态生成
   ========================================================= */
function buildSphere(n) {
  const out = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    // 主体是体积球，少量粒子飘到壳外形成“星尘”外晕
    const rr = RADIUS * (0.10 + 0.90 * Math.cbrt(Math.random())) * (Math.random() < 0.10 ? 1.16 : 1.0);
    out[i * 3]     = Math.cos(th) * r * rr;
    out[i * 3 + 1] = y * rr;
    out[i * 3 + 2] = Math.sin(th) * r * rr;
  }
  return out;
}

function buildHeart(n) {
  const out = new Float32Array(n * 3);
  const S = 3.95;                        // 心形隐函数范围(±1.35) → 世界坐标
  const inside = (x, y) => {
    const a = x * x + y * y - 1;
    return a * a * a - x * x * y * y * y;   // ≤0 为心形内部
  };

  let i = 0, guard = 0;
  while (i < n && guard < n * 60) {
    guard++;
    const x = (Math.random() * 2 - 1) * 1.36;
    const y = (Math.random() * 2 - 1) * 1.32;
    if (inside(x, y) > 0) continue;
    // 越靠近边缘越密一点点，让轮廓更清晰
    const rho = Math.min(1, Math.hypot(x / 1.36, y / 1.32));
    if (rho < 0.92 && Math.random() < 0.22) continue;

    const pz = gauss() * 0.72 * (1 - rho * 0.55);
    out[i * 3]     = x * S;
    out[i * 3 + 1] = (y - 0.06) * S;
    out[i * 3 + 2] = pz * S;
    i++;
  }
  // 兜底：极端情况下补点
  while (i < n) {
    out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = 0;
    i++;
  }
  return out;
}

function buildGalaxy(n) {
  const out = new Float32Array(n * 3);
  const arms = 3;
  const R = RADIUS * 1.45;
  // 盘面朝向镜头，再整体前倾一点，既有旋臂又看得出厚度
  const tilt = 0.42, ct = Math.cos(tilt), st = Math.sin(tilt);

  for (let i = 0; i < n; i++) {
    if (Math.random() < 0.14) {           // 核球
      const rr = Math.pow(Math.random(), 2.2) * R * 0.24;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      out[i * 3]     = Math.sin(ph) * Math.cos(th) * rr;
      out[i * 3 + 1] = Math.cos(ph) * rr;
      out[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * rr;
      continue;
    }
    const r = Math.pow(Math.random(), 0.62) * R;
    const arm = Math.floor(Math.random() * arms) * (Math.PI * 2 / arms);
    const ang = arm + r * 0.55 + gauss() * 0.17;

    const spread = 0.26 + r * 0.045;
    const px = Math.cos(ang) * r + gauss() * spread;
    const py = Math.sin(ang) * r * 0.92 + gauss() * spread * 0.85;
    const pz = gauss() * (0.55 * (1 - r / R) + 0.16);

    out[i * 3]     = px;
    out[i * 3 + 1] = py * ct - pz * st;
    out[i * 3 + 2] = py * st + pz * ct;
  }
  return out;
}

function buildKnot(n) {
  const out = new Float32Array(n * 3);
  const p = 2, q = 3, S = 1.55;
  for (let i = 0; i < n; i++) {
    const t = Math.random() * Math.PI * 2;
    const rr = 2 + Math.cos(q * t);
    const px = rr * Math.cos(p * t);
    const py = rr * Math.sin(p * t);
    const pz = -Math.sin(q * t) * 1.4;
    // 管状抖动
    const tube = 0.22;
    out[i * 3]     = px * S + gauss() * tube;
    out[i * 3 + 1] = py * S + gauss() * tube;
    out[i * 3 + 2] = pz * S + gauss() * tube;
  }
  return out;
}

/* 花朵：多层花瓣 + 花蕊，这里给出的是“满开”时的目标位置。
   绽放过程不在这里算 —— 由顶点着色器按 uBloom 从花心螺旋展开。 */
function buildFlower(n) {
  const out = new Float32Array(n * 3);
  const frac = x => x - Math.floor(x);

  // 三层花瓣 + 花蕊，靠 z 方向做出“碗”的纵深：
  //   zBase 内层整体朝镜头抬升；curl 让瓣尖向后收（碗壁）；twist 每瓣带一点拧转；tilt 每瓣绕自身径轴微侧翻
  const layers = [
    { share: 0.50, petals: 5, R: 5.30, rot: 0.00,        ang: 0.42, zBase: 0.00, curl: -0.58, thick: 0.30, twist:  0.24, tilt: 0.05 },
    { share: 0.38, petals: 5, R: 4.00, rot: Math.PI / 5, ang: 0.38, zBase: 0.40, curl: -0.42, thick: 0.26, twist: -0.20, tilt: 0.06 },
    { share: 0.10, petals: 0, R: 1.85, rot: 0.00,        ang: 0,    zBase: 0.70, curl: 0,     thick: 0.34, twist: 0,    tilt: 0    }
  ];
  let i = 0;
  for (const L of layers) {
    const cnt = Math.min(n - i, Math.floor(n * L.share));
    for (let k = 0; k < cnt; k++, i++) {
      const i3 = i * 3;
      if (L.petals === 0) {              // —— 花蕊：朝镜头鼓起的半球，不是贴在平面上的饼 ——
        const u = Math.random() * 2 - 1;
        const th = Math.random() * Math.PI * 2;
        const s = Math.sqrt(Math.max(0, 1 - u * u));
        const rr = L.R * Math.cbrt(Math.random());
        const dome = Math.sqrt(Math.max(0, 1 - (rr / L.R) ** 2));
        out[i3]     = Math.cos(th) * s * rr;
        out[i3 + 1] = u * rr * 0.95;
        out[i3 + 2] = L.zBase + dome * 0.58 + gauss() * L.thick * 0.55;
        continue;
      }
      const pj = (Math.random() * L.petals) | 0;
      const a = L.rot + pj * (Math.PI * 2 / L.petals) + (Math.random() - 0.5) * 0.04;
      const sN = Math.sqrt(Math.random());                      // 面积加权：外圈多、花心不挤
      const rad = L.R * (0.22 + 0.78 * sN) * (1 + gauss() * 0.012);
      // 半角：根部略窄、中段最宽、瓣尖收圆 —— 这样才是“花瓣”不是“尖刺”
      const half = L.ang * (0.34 + 0.66 * Math.sin(Math.PI * Math.pow(sN, 0.9)));
      const uRaw = Math.random() * 2 - 1;
      const t = Math.sign(uRaw) * Math.pow(Math.abs(uRaw), 0.58);   // 往两侧边缘偏一点 → 花瓣轮廓更清晰
      const ang = a + t * half;
      const rr = rad * (1 - 0.05 * t * t);

      const v = t * half * rad;                                  // 横向偏移（弧长近似）
      const jr = frac(Math.abs(Math.sin(pj * 127.1 + L.R * 3.1) * 43758.5453)); // 每瓣固定的随机侧翻
      const tiltV = (jr - 0.5) * 2 * L.tilt;
      const zCup   = L.curl * Math.pow(sN, 1.7);                 // 碗壁：越到瓣尖越往后收
      const zTwist = L.twist * t * Math.sin(Math.PI * sN);       // 拧转
      const zTilt  = tiltV * v;                                  // 每瓣自己的侧翻
      const zThick = gauss() * L.thick * (1 - 0.45 * sN);        // 根部厚、瓣尖薄

      out[i3]     = Math.cos(ang) * rr;
      out[i3 + 1] = Math.sin(ang) * rr * 0.97;
      out[i3 + 2] = L.zBase + zCup + zTwist + zTilt + zThick;
    }
  }
  for (; i < n; i++) {                   // 兜底补到花蕊
    const i3 = i * 3;
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - u * u)), rr = 1.4 * Math.cbrt(Math.random());
    out[i3]     = Math.cos(th) * s * rr;
    out[i3 + 1] = u * rr * 0.95;
    out[i3 + 2] = 0.70 + Math.sqrt(Math.max(0, 1 - (rr / 1.85) ** 2)) * 0.55;
  }
  return out;
}

const SHAPES = [
  { name: '球体', c1: [0.10, 0.72, 1.00], c2: [0.42, 0.20, 1.00], build: buildSphere },
  { name: '心形', c1: [0.92, 0.08, 0.32], c2: [0.88, 0.30, 0.62], build: buildHeart  },
  { name: '银河', c1: [1.00, 0.62, 0.22], c2: [0.42, 0.16, 1.00], build: buildGalaxy },
  { name: '环结', c1: [0.05, 1.00, 0.55], c2: [0.00, 0.55, 1.00], build: buildKnot   },
  { name: '花朵', c1: [1.00, 0.78, 0.28], c2: [1.00, 0.16, 0.50], build: buildFlower, flower: true, alphaMul: 0.56 }
];

/* =========================================================
   二、Three.js 场景
   ========================================================= */
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, alpha: false, powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.setClearColor(0x05060d, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;   // 高光滚降：密集处不会烧成死白
renderer.toneMappingExposure = 1.0;

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 0, 24);

const group = new THREE.Group();
scene.add(group);

/* ------ 后期处理：泛光（“高级感”的关键一步） ------ */
const composer = new EffectComposer(renderer);
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.35,   // 强度
  0.40,   // 半径
  0.80    // 阈值：只有最亮的部分才溢光
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ------ 几何 & 属性 ------ */
const posA  = new Float32Array(COUNT * 3);   // 当前形态
const posB  = new Float32Array(COUNT * 3);   // 目标形态
const dirs  = new Float32Array(COUNT * 3);
const rnds  = new Float32Array(COUNT);

posA.set(buildSphere(COUNT));
posB.set(posA);

for (let i = 0; i < COUNT; i++) {
  // 均匀球面方向
  const u = Math.random() * 2 - 1;
  const th = Math.random() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  dirs[i * 3]     = Math.cos(th) * s;
  dirs[i * 3 + 1] = u;
  dirs[i * 3 + 2] = Math.sin(th) * s;
  rnds[i] = Math.random();
}

const geo = new THREE.BufferGeometry();
const attrPos    = new THREE.BufferAttribute(posA, 3);
const attrTarget = new THREE.BufferAttribute(posB, 3);
geo.setAttribute('position', attrPos);
geo.setAttribute('aTarget', attrTarget);
geo.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
geo.setAttribute('aRand', new THREE.BufferAttribute(rnds, 1));
geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), RADIUS * 8);

const uniforms = {
  uMix:      { value: 1 },
  uBurst:    { value: 0 },
  uTime:     { value: 0 },
  uSize:     { value: 2.35 * Math.min(window.devicePixelRatio || 1, 2) },
  uInA:      { value: new THREE.Color(...SHAPES[0].c1) },
  uInB:      { value: new THREE.Color(...SHAPES[0].c1) },
  uOutA:     { value: new THREE.Color(...SHAPES[0].c2) },
  uOutB:     { value: new THREE.Color(...SHAPES[0].c2) },
  uRadius:   { value: RADIUS },
  uPointer:  { value: new THREE.Vector3(0, 0, 0) },
  uPtrForce: { value: 0 },
  uFlowerW:  { value: 0 },      // 花朵形态权重
  uBloom:    { value: 1 },      // 绽放进度：0=花苞 1=满开
  uAlphaMul: { value: 1 }       // 每种形态的整体亮度系数
};

const vertexShader = /* glsl */`
  attribute vec3 aTarget;
  attribute vec3 aDir;
  attribute float aRand;

  uniform float uMix;
  uniform float uBurst;
  uniform float uTime;
  uniform float uSize;
  uniform float uPtrForce;
  uniform float uRadius;
  uniform vec3  uPointer;
  uniform vec3  uInA;
  uniform vec3  uInB;
  uniform vec3  uOutA;
  uniform vec3  uOutB;
  uniform float uFlowerW;
  uniform float uBloom;
  uniform float uAlphaMul;

  varying vec3  vColor;
  varying float vAlpha;
  varying float vCore;

  void main() {
    // 1. 形态插值
    vec3 p = mix(position, aTarget, uMix);

    // 1.5 花朵绽放：花苞合拢在花心，随 uBloom 沿螺旋展开到花瓣
    float flowerShade = 1.0;
    if (uFlowerW > 0.001) {
      // 每个粒子错峰绽放（aRand 当延时用）
      float pB = clamp(uBloom * 1.35 - aRand * 0.45, 0.0, 1.0);
      pB = pB * pB * (3.0 - 2.0 * pB);
      // 注意：花瓣长在 XY 平面（正对镜头），z 是花瓣的碗形纵深 + 厚度
      float r0 = length(aTarget.xy);
      float a0 = atan(aTarget.y, aTarget.x);
      float ang = a0 + (1.0 - pB) * 0.7;                 // 未开时整体旋紧
      float rr = r0 * (0.46 + 0.54 * pB);                // 从花心往外
      float zz = aTarget.z * (0.38 + 0.62 * pB);
      vec3 pf = vec3(cos(ang) * rr, sin(ang) * rr, zz);
      p = mix(p, pf, uFlowerW * uMix);
      // 纵深明暗：瓣尖后收处压暗、花蕊朝镜头处提亮 → 正对镜头也有立体感
      flowerShade = mix(0.42, 1.00, clamp((aTarget.z + 0.75) / 1.50, 0.0, 1.0));
      flowerShade = mix(1.0, flowerShade, uFlowerW * uMix);
    }

    // 2. 爆散：沿随机方向外扩
    p *= 1.0 + uBurst * (0.30 + aRand * 1.10);
    p += aDir * uBurst * 1.5;

    // 3. 呼吸抖动
    float t = uTime * (0.30 + aRand * 0.55) + aRand * 40.0;
    p += aDir * sin(t) * 0.10;

    // 4. 指尖/鼠标的排斥力场
    vec3 d = p - uPointer;
    float dist2 = dot(d, d);
    float infl = uPtrForce * exp(-dist2 / 9.0);
    p += normalize(d + 0.0001) * infl * 2.1;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float depth = -mv.z;

    // 5. 大小：近大远小 + 少数“主角粒子”更大，制造颗粒层次
    float sz = 0.55 + aRand * 1.15;
    sz *= aRand > 0.985 ? 1.9 : 1.0;
    gl_PointSize = uSize * sz * (34.0 / max(depth, 0.8));

    // 6. 按半径双色渐变：内核暖亮，外缘冷柔
    float rad = clamp(length(p) / (uRadius * 1.55), 0.0, 1.0);
    float g = smoothstep(0.05, 1.0, rad * 0.92 + aRand * 0.10);
    vec3 col = mix(mix(uInA, uInB, uMix), mix(uOutA, uOutB, uMix), g);

    // 7. 深度雾：远处压暗并偏向背景色 → 画面有纵深
    float fogK = clamp((depth - 24.0) / 70.0, 0.0, 1.0);
    col = mix(col, vec3(0.02, 0.03, 0.07), fogK * 0.55);

    vColor = col * (0.45 + aRand * 0.55) * flowerShade;
    vCore  = 1.0 - g * 0.55;
    vAlpha = (0.13 + aRand * 0.30) * (1.0 - fogK * 0.70) * uAlphaMul * mix(1.0, flowerShade, 0.55);
  }
`;

const fragmentShader = /* glsl */`
  precision mediump float;
  varying vec3  vColor;
  varying float vAlpha;
  varying float vCore;

  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c) * 2.0;             // 0 = 圆心, 1 = 边缘
    if (d > 1.0) discard;

    // 实心内核 + 柔和外晕，配合泛光就是“发光粒子”，而不是“圆点”
    float core = exp(-d * d * 6.5);
    float halo = exp(-d * d * 2.0);
    float a = core * 0.92 + halo * 0.16;

    gl_FragColor = vec4(vColor * (0.80 + 0.55 * core * vCore), a * vAlpha);
  }
`;

const pointsMat = new THREE.ShaderMaterial({
  uniforms,
  vertexShader,
  fragmentShader,
  transparent: true,
  depthWrite: false,
  depthTest: true,
  blending: THREE.AdditiveBlending
});

const points = new THREE.Points(geo, pointsMat);
points.frustumCulled = false;
group.add(points);

/* =========================================================
   三、形态切换
   ========================================================= */
let shapeIndex = 0;
let morphT = 1;               // 0→1 动画进度
let burstKick = 0;            // 切换形态时的爆散余韵
let pendingPitch = 0;         // 切到花朵时给一个 3/4 视角（S 尚未初始化，延后到 frame 里消费）
let bloomVal = 1;             // 花朵绽放度（0=花苞 1=满开）
let dimVal = 1;               // 花苞很密，压暗一点避免叠加烧白（离开花朵后缓慢恢复）
let exitBurst = 0;            // 离开花苞时给一次爆散，把挤在一起的粒子吹开

// 离开花朵时，把“当前绽放程度”结算成真实坐标写进 posA，避免瞬移
function freezeFlowerIntoPosA(minBloom = 0) {
  const b = Math.max(uniforms.uBloom.value, minBloom);
  for (let i = 0; i < COUNT; i++) {
    const i3 = i * 3;
    let pB = clamp(b * 1.35 - rnds[i] * 0.45);
    pB = pB * pB * (3 - 2 * pB);
    const bx = posB[i3], by = posB[i3 + 1], bz = posB[i3 + 2];
    const r0 = Math.hypot(bx, by);
    const a0 = Math.atan2(by, bx);
    const ang = a0 + (1 - pB) * 0.7;
    const rr = r0 * (0.46 + 0.54 * pB);
    posA[i3]     = Math.cos(ang) * rr;
    posA[i3 + 1] = Math.sin(ang) * rr;
    posA[i3 + 2] = bz * (0.38 + 0.62 * pB);
  }
}

function gotoShape(next, instant = false) {
  next = (next + SHAPES.length) % SHAPES.length;
  if (!instant && next === shapeIndex && morphT >= 1) return;

  const wasFlower = !!(SHAPES[shapeIndex] && SHAPES[shapeIndex].flower);

  if (!instant) {
    // 把当前插值结果固化到 posA，再从它出发过渡
    const m = easeInOut(clamp(morphT));
    for (let i = 0; i < COUNT * 3; i++) posA[i] += (posB[i] - posA[i]) * m;
    // 颜色同样固化到当前混合色（内外两层各一份）
    uniforms.uInA.value.lerp(uniforms.uInB.value, m);
    uniforms.uOutA.value.lerp(uniforms.uOutB.value, m);
    // 从花朵切走：用当前绽放度结算起点，否则粒子会跳回“满开”位置
    if (wasFlower) freezeFlowerIntoPosA(0.85);   // 从花苞切走时先“开花”再过渡，避免粒子挤成一团烧白
  }

  const shape = SHAPES[next];
  posB.set(shape.build(COUNT));
  attrPos.needsUpdate = true;
  attrTarget.needsUpdate = true;

  uniforms.uInB.value.setRGB(shape.c1[0], shape.c1[1], shape.c1[2]);
  uniforms.uOutB.value.setRGB(shape.c2[0], shape.c2[1], shape.c2[2]);

  morphT = instant ? 1 : 0;
  shapeIndex = next;
  uniforms.uFlowerW.value = shape.flower ? 1 : 0;
  // 从花苞状态切走时粒子还挤在一起，瞬间压暗，避免一片死白
  if (wasFlower && !shape.flower) { dimVal = Math.min(dimVal, 0.45); exitBurst = 0.25; }
  ui.vShape.textContent = shape.name;
  // 花朵的纵深只有偏过一点角度才看得出来；用户没手动调视角时给个默认俯仰
  if (shape.flower) pendingPitch = 0.14;

  // 切换时给一点“炸开”的余韵
  burstKick = Math.min(1, burstKick + 0.22);
}

gotoShape(0, true);
ui.vShape.textContent = SHAPES[0].name;

/* =========================================================
   四、交互状态
   ========================================================= */
const state = {
  yaw: 0, pitch: 0,
  yawT: 0, pitchT: 0,
  zoom: 24, zoomT: 24,
  open: 0, openS: 0,
  pinch: 0, pinchS: 0,
  burst: 0,
  hands: 0,
  pointer: new THREE.Vector3(0, 0, 60),
  ptrForce: 0, ptrForceS: 0,
  label: '等待手势',
  mode: 'idle'            // 'hand' | 'mouse' | 'idle'
};

const S = state;          // 简写

/* =========================================================
   五、摄像头 + MediaPipe
   ========================================================= */
let landmarker = null;
let stream = null;
let videoAR = 4 / 3;
let lastVideoTime = -1;
let lastDetect = 0;
let detecting = false;

const CONN = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17]
];

async function initHands() {
  camText.textContent = '加载识别模型…';
  camBox.style.opacity = '1';

  const { HandLandmarker, FilesetResolver } = await import('./lib/vision_bundle.mjs');
  const fileset = await FilesetResolver.forVisionTasks(
    new URL('./lib/wasm', location.href).href
  );

  const opts = {
    baseOptions: {
      modelAssetPath: new URL('./lib/hand_landmarker.task', location.href).href,
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.55
  };

  try {
    landmarker = await HandLandmarker.createFromOptions(fileset, opts);
  } catch (e) {
    console.warn('GPU delegate 创建失败，回退 CPU：', e);
    opts.baseOptions.delegate = 'CPU';
    landmarker = await HandLandmarker.createFromOptions(fileset, opts);
  }
  camText.textContent = '识别中';
  return landmarker;
}

async function initCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false
  });
  video.srcObject = stream;
  await video.play();
  await new Promise(res => {
    if (video.videoWidth) return res();
    video.onloadedmetadata = () => res();
  });
  videoAR = (video.videoWidth || 640) / (video.videoHeight || 480);
  camDot.classList.remove('off');
  camText.textContent = '识别中';
}

/* ---------- 手部度量 ---------- */
function measure(lm, AR) {
  const d = (a, b) => Math.hypot((a.x - b.x) * AR, a.y - b.y);
  const scale = Math.max(d(lm[0], lm[9]), 1e-3);   // 手掌基准长度
  const tips = [8, 12, 16, 20];
  let sum = 0;
  for (const t of tips) sum += d(lm[t], lm[0]) / scale;
  const openRaw = sum / tips.length;               // 张开≈2.0~2.4，握拳≈1.1~1.35
  // 归一化区间收到 1.15~1.73：自然张手就到 1，不必把手撑到极限
  const open = clamp((openRaw - 1.15) / 0.58);

  const pinchRaw = d(lm[4], lm[8]) / scale;        // 贴合≈0.20~0.35，张开≈1.0~1.6
  const pinch = 1 - clamp((pinchRaw - 0.30) / (1.15 - 0.30));

  return {
    open,
    pinch,
    palm: { x: 1 - lm[9].x, y: lm[9].y },          // 镜像后与屏幕同向
    idx:  { x: 1 - lm[8].x, y: lm[8].y, z: lm[8].z }
  };
}

/* ---------- 逐帧手势处理 ---------- */
let prevPalm = null;
let prevHandT = 0;
let palmVX = 0;
let swipeStreak = 0;
let swipeCool = 0;
const tmpV = new THREE.Vector3();

function applyHands(hands, now, dt) {
  const k = f => 1 - Math.exp(-f * dt);

  if (hands.length === 0) {
    S.hands = 0;
    S.open  += (0 - S.open) * k(4);
    S.pinch += (0 - S.pinch) * k(4);
    S.ptrForce += (0 - S.ptrForce) * k(6);
    prevPalm = null;
    S.label = '未检测到手';
    return;
  }

  S.hands = hands.length;
  const m0 = measure(hands[0].landmarks, videoAR);
  S.open  += (m0.open  - S.open)  * k(14);
  S.pinch += (m0.pinch - S.pinch) * k(11);

  // ---- 旋转：跟随掌心位移 ----
  const gap = now - prevHandT;
  prevHandT = now;

  if (prevPalm) {
    const dx = m0.palm.x - prevPalm.x;
    const dy = m0.palm.y - prevPalm.y;
    S.yawT   += dx * 6.4;
    S.pitchT -= dy * 4.6;
    S.pitchT = clamp(S.pitchT, -0.95, 0.95);

    // ---- 挥手切形态：单帧跳变不算，要连续两帧以上都够快 ----
    if (hands.length === 1 && gap < 120) {
      const vx = dx / Math.max(dt, 1 / 120);
      palmVX = lerp(palmVX, vx, k(18));
      swipeStreak = Math.abs(palmVX) > 1.05 ? swipeStreak + 1 : 0;
      if (swipeStreak >= 2 && now > swipeCool) {
        gotoShape(shapeIndex + (palmVX > 0 ? 1 : -1));
        swipeCool = now + 1200;
        palmVX = 0;
        swipeStreak = 0;
        S.label = '挥手 · 换形态';
      }
    } else {
      palmVX = 0;
      swipeStreak = 0;
    }
  }
  prevPalm = { x: m0.palm.x, y: m0.palm.y };

  // ---- 缩放 ----
  if (hands.length >= 2) {
    const m1 = measure(hands[1].landmarks, videoAR);
    const dd = Math.hypot((m0.palm.x - m1.palm.x) * videoAR, m0.palm.y - m1.palm.y);
    S.zoomT = clamp(lerp(30, 10, clamp((dd - 0.12) / 0.60)), 10, 30);
    S.label = '双手开合 · 远近';
  } else {
    S.zoomT = lerp(26, 10.5, S.pinch);
    if (S.pinch > 0.72)      S.label = '捏合 · 拉近';
    else if (SHAPES[shapeIndex].flower && S.open > 0.72) S.label = '张开手 · 绽放';
    else if (SHAPES[shapeIndex].flower && S.open < 0.28) S.label = '握拳 · 花苞';
    else if (S.open > 0.72)  S.label = '张开手 · 爆散';
    else if (S.open < 0.28)  S.label = '握拳 · 聚合';
    else if (Math.abs(palmVX) < 0.2) S.label = '移动手掌 · 旋转';
  }

  // ---- 指尖力场 ----
  const p = m0.idx;
  tmpV.set(p.x * 2 - 1, -(p.y * 2 - 1), 0.5).unproject(camera);
  tmpV.sub(camera.position).normalize();
  const planeZ = 0;
  const tHit = (planeZ - camera.position.z) / (tmpV.z || -1);
  tmpV.multiplyScalar(tHit).add(camera.position);

  group.updateMatrixWorld();
  S.pointer.copy(group.worldToLocal(tmpV.clone()));
  S.ptrForce += ((0.45 + S.pinch * 1.05) - S.ptrForce) * k(9);
}

/* ---------- 摄像头画面叠加骨架 ---------- */
function drawOverlay(hands) {
  const W = overlay.width, H = overlay.height;
  octx.clearRect(0, 0, W, H);
  if (!hands) return;
  for (const h of hands) {
    const lm = h.landmarks;
    octx.lineWidth = 3;
    octx.strokeStyle = 'rgba(120,230,255,.85)';
    octx.beginPath();
    for (const [a, b] of CONN) {
      octx.moveTo(lm[a].x * W, lm[a].y * H);
      octx.lineTo(lm[b].x * W, lm[b].y * H);
    }
    octx.stroke();
    octx.fillStyle = 'rgba(200,245,255,.95)';
    for (const q of lm) {
      octx.beginPath();
      octx.arc(q.x * W, q.y * H, 3.4, 0, Math.PI * 2);
      octx.fill();
    }
    // 食指指尖高亮
    octx.strokeStyle = 'rgba(255,140,190,.9)';
    octx.lineWidth = 3;
    octx.beginPath();
    octx.arc(lm[8].x * W, lm[8].y * H, 11, 0, Math.PI * 2);
    octx.stroke();
  }
}

/* =========================================================
   六、主循环
   ========================================================= */
let lastT = performance.now();
let time = 0;
let fpsAcc = 0, fpsFrames = 0, fpsShown = 60;
let hudTimer = 0;

function frame(now) {
  requestAnimationFrame(frame);

  const dt = Math.min(0.06, Math.max(0.001, (now - lastT) / 1000));
  lastT = now;
  time += dt;

  /* ---- 手势检测（约 30Hz） ---- */
  if (landmarker && video.readyState >= 2 && document.visibilityState === 'visible') {
    if (now - lastDetect > 30 && video.currentTime !== lastVideoTime) {
      lastDetect = now;
      lastVideoTime = video.currentTime;
      try {
        const res = landmarker.detectForVideo(video, now);
        const hands = res && res.landmarks ? res.landmarks.map(l => ({ landmarks: l })) : [];
        applyHands(hands, now, dt);
        drawOverlay(hands);
      } catch (e) {
        // 时间戳异常等，跳过本帧
      }
    }
  } else if (S.mode === 'mouse') {
    S.label = '鼠标模式';
  }

  /* ---- 平滑与运动 ---- */
  const kSlow = 1 - Math.exp(-3.4 * dt);
  const kFast = 1 - Math.exp(-8.0 * dt);

  // 无手时缓慢自转
  if (S.hands === 0 && S.mode !== 'mouse') S.yawT += dt * 0.16;

  // 切到花朵时自动给一个略俯视的 3/4 视角，让碗形纵深一进画面就看得出来
  if (pendingPitch) {
    if (Math.abs(S.pitchT) < 0.12) S.pitchT = pendingPitch;
    pendingPitch = 0;
  }

  S.yaw   += (S.yawT   - S.yaw)   * kFast;
  S.pitch += (S.pitchT - S.pitch) * kFast;
  S.zoom  += (S.zoomT  - S.zoom)  * kSlow;

  group.rotation.y = S.yaw;
  group.rotation.x = S.pitch;

  camera.position.z = S.zoom;
  camera.lookAt(0, 0, 0);

  // 爆散（花朵形态下关掉，把“张开”这个自由度让给绽放）
  burstKick *= Math.exp(-2.6 * dt);
  const isFlowerShape = !!SHAPES[shapeIndex].flower;
  // 从花苞切走：先给一次爆散，把挤在 200px 里的 8 万粒子吹开，否则必然烧白
  if (exitBurst) { S.burst = Math.max(S.burst, exitBurst); exitBurst = 0; }
  const burstTarget = isFlowerShape ? 0 : clamp(S.open * 0.55 + burstKick * 0.35);
  S.burst += (burstTarget - S.burst) * (1 - Math.exp(-6.5 * dt));

  // 绽放度：手势张开度直接驱动；鼠标模式下自动开合，保证演示有动态
  // 去掉前 8% 的死区，张到 78% 左右就是满开，不用把手撑到极限
  const bloomTarget = isFlowerShape
    ? (S.mode === 'hand' ? clamp((S.open - 0.08) / 0.70) : 0.5 + 0.5 * Math.sin(time * 0.55))
    : 1;
  bloomVal += (bloomTarget - bloomVal) * (1 - Math.exp(-5.0 * dt));

  // 花苞阶段粒子挤在一起，整体压暗；切走形状时缓慢恢复，避免白闪
  const dimTarget = isFlowerShape ? 0.55 + 0.45 * bloomVal : 1;
  dimVal += (dimTarget - dimVal) * (1 - Math.exp(-1.0 * dt));
  uniforms.uAlphaMul.value = (SHAPES[shapeIndex].alphaMul || 1) * dimVal;

  // 形态动画
  if (morphT < 1) {
    morphT = Math.min(1, morphT + dt / MORPH_TIME);
    uniforms.uMix.value = easeInOut(morphT);
  } else {
    uniforms.uMix.value = 1;
  }

  uniforms.uBurst.value    = S.burst;
  uniforms.uBloom.value    = bloomVal;
  uniforms.uTime.value     = time;
  uniforms.uPtrForce.value = S.ptrForce;
  uniforms.uPointer.value.copy(S.pointer);

  composer.render();

  /* ---- HUD ---- */
  fpsAcc += dt; fpsFrames++;
  hudTimer += dt;
  if (hudTimer > 0.1) {
    hudTimer = 0;
    if (fpsAcc > 0.001) {
      fpsShown = lerp(fpsShown, fpsFrames / fpsAcc, 0.35);
    }
    fpsAcc = 0; fpsFrames = 0;

    const oPct = Math.round(S.open * 100);
    const pPct = Math.round(S.pinch * 100);
    ui.vOpen.textContent  = oPct + '%';
    ui.bOpen.style.width  = oPct + '%';
    ui.vPinch.textContent = pPct + '%';
    ui.bPinch.style.width = pPct + '%';
    const zx = clamp((30 - S.zoom) / 20);
    ui.vZoom.textContent  = (24 / S.zoom).toFixed(2) + 'x';
    ui.bZoom.style.width  = (zx * 100).toFixed(0) + '%';
    ui.vFps.textContent   = Math.round(fpsShown);
    ui.bFps.style.width   = clamp(fpsShown / 60) * 100 + '%';
    if (ui.vGest) ui.vGest.textContent = S.label;
  }
}

/* =========================================================
   七、鼠标降级模式
   ========================================================= */
let dragging = false, lastX = 0, lastY = 0, moved = 0;

function enableMouseMode() {
  S.mode = 'mouse';
  S.ptrForce = 0.55;
  tip.textContent = '未检测到摄像头权限 · 已切换为鼠标模式：拖拽旋转 / 滚轮缩放 / 单击换形态 / 空格爆散';
  tip.style.opacity = '1';

  canvas.addEventListener('pointerdown', e => {
    dragging = true; moved = 0;
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('pointerup', () => {
    if (dragging && moved < 6) gotoShape(shapeIndex + 1);
    dragging = false;
  });
  window.addEventListener('pointermove', e => {
    if (dragging) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      S.yawT += dx * 0.006;
      S.pitchT = clamp(S.pitchT + dy * 0.005, -0.95, 0.95);
      lastX = e.clientX; lastY = e.clientY;
    }
    // 鼠标当成“指尖”
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = -(e.clientY / window.innerHeight) * 2 + 1;
    tmpV.set(nx, ny, 0.5).unproject(camera);
    tmpV.sub(camera.position).normalize();
    const tHit = (0 - camera.position.z) / (tmpV.z || -1);
    tmpV.multiplyScalar(tHit).add(camera.position);
    group.updateMatrixWorld();
    S.pointer.copy(group.worldToLocal(tmpV.clone()));
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    S.zoomT = clamp(S.zoomT + e.deltaY * 0.02, 10, 34);
  }, { passive: false });
  window.addEventListener('keydown', e => {
    if (e.key >= '1' && e.key <= '5') gotoShape(Number(e.key) - 1);
    if (e.key === 'r' || e.key === 'R') { S.yawT = 0; S.pitchT = 0; S.zoomT = 24; }
    if (e.code === 'Space') { burstKick = 1; S.open = 1; }
  });
}

/* =========================================================
   八、启动
   ========================================================= */
startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  startBtn.textContent = '正在启动…';
  let ok = false;
  try {
    await initCamera();
    ok = true;
  } catch (e) {
    console.warn('摄像头启动失败：', e);
  }

  if (ok) {
    try {
      startBtn.textContent = '加载识别模型…';
      await initHands();
      S.mode = 'hand';
    } catch (e) {
      console.error(e);
      camText.textContent = '识别模型加载失败';
      camDot.classList.add('off');
      enableMouseMode();
    }
  } else {
    camText.textContent = '无摄像头权限';
    camDot.classList.add('off');
    enableMouseMode();
  }

  gate.classList.add('hide');
  setTimeout(() => { gate.style.display = 'none'; }, 600);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloom.setSize(window.innerWidth, window.innerHeight);
});

requestAnimationFrame(frame);

/* 调试出口：控制台可直接查看状态，例如 __app.S.open
   feed() 可注入合成手部骨骼，用于没有摄像头时调参 */
window.__app = {
  S, uniforms, renderer, camera, group,
  get shape() { return SHAPES[shapeIndex].name; },
  get bloom() { return bloomVal; },
  gotoShape,
  get morph() { return morphT; },
  feed(hands, dt = 1 / 60, t = performance.now()) {
    applyHands(hands.map(l => ({ landmarks: l })), t, dt);
  }
};
