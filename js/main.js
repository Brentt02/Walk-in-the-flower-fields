import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { Wind } from "./wind.js";
import { Vegetation } from "./vegetation.js";
import { World } from "./world.js";
import { Controls } from "./controls.js";
import { Lighting } from "./lighting.js";
import { AudioManager } from "./audio.js";

const canvas = document.getElementById("world");
const params = new URLSearchParams(location.search);
const coarsePointer = matchMedia("(pointer: coarse)").matches;
const lowQuality = params.get("quality") === "low" || coarsePointer;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !lowQuality,
  powerPreference: lowQuality ? "low-power" : "high-performance"
});

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

let pixelRatio = Math.min(devicePixelRatio || 1, lowQuality ? 1.25 : 1.7);
renderer.setPixelRatio(pixelRatio);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 1, 0.06, 1100);

const wind = new Wind();
const vegetation = new Vegetation(wind);
const controls = new Controls(camera, canvas, coarsePointer);
const audio = new AudioManager();
const world = new World(scene, vegetation, lowQuality);
const lighting = new Lighting(scene, renderer, lowQuality);

// Soft cinematic bloom: makes bright fireflies, the moon, and the sun
// spill a little light into nearby pixels without lighting the whole ground.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  lowQuality ? 0.42 : 0.72, // strength
  0.72,                     // radius
  0.68                      // threshold
);
composer.addPass(bloomPass);

// Build the player's chunk before the first rendered frame.
// Remaining chunks are generated incrementally without a loading screen.
world.plan(camera.position);
const first = world.pending.shift();
if (first) world.createChunk(first.x, first.z);

// Low-count drifting pollen: motion and fading run on the GPU.
const particleCount = lowQuality ? 120 : 300;
const particlePositions = new Float32Array(particleCount * 3);
const particleSeeds = new Float32Array(particleCount);

for (let i = 0; i < particleCount; i++) {
  particlePositions[i * 3] = Math.random() * 26 - 13;
  particlePositions[i * 3 + 1] = Math.random() * 7 - 2;
  particlePositions[i * 3 + 2] = Math.random() * 26 - 13;
  particleSeeds[i] = Math.random() * 100;
}

const particleGeometry = new THREE.BufferGeometry();
particleGeometry.setAttribute(
  "position", new THREE.BufferAttribute(particlePositions, 3)
);
particleGeometry.setAttribute(
  "seed", new THREE.BufferAttribute(particleSeeds, 1)
);

const particleMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
    uDay: { value: 1 },
    uPixelRatio: { value: pixelRatio }
  },
  vertexShader: `
    attribute float seed;
    uniform float uTime;
    uniform float uPixelRatio;
    varying float vAlpha;

    void main() {
      vec3 p = position;
      p.x = mod(p.x + uTime * 0.16 + 13.0, 26.0) - 13.0;
      p.z += sin(uTime * 0.14 + seed) * 0.65;
      p.y += sin(uTime * 0.31 + seed) * 0.45;

      float edge = 1.0 - smoothstep(9.0, 13.0, length(p.xz));
      float pulse = 0.62 + 0.38 * (0.5 + 0.5 * sin(uTime * 1.7 + seed * 2.3));
      vAlpha = edge * pulse;

      vec4 view = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * view;
      // Larger sprite footprint gives the bloom pass a brighter, softer halo.
      gl_PointSize = clamp(38.0 / max(-view.z, 1.0), 2.0, 7.0) *
        uPixelRatio;
    }
  `,
  fragmentShader: `
    uniform float uDay;
    varying float vAlpha;

    void main() {
      float radius = length(gl_PointCoord - 0.5);
      float core = 1.0 - smoothstep(0.02, 0.22, radius);
      float halo = 1.0 - smoothstep(0.08, 0.5, radius);
      float nightBoost = 0.25 + (1.0 - uDay) * 1.7;
      float alpha = (halo * 0.42 + core * 0.9) * vAlpha * nightBoost;

      // Additive warm-gold fireflies with a brighter near-white center.
      vec3 fireflyColor = mix(vec3(1.0, 0.56, 0.12), vec3(1.0, 0.94, 0.66), core);
      gl_FragColor = vec4(fireflyColor * (1.0 + core * 1.4), alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `
});

const pollen = new THREE.Points(particleGeometry, particleMaterial);
pollen.frustumCulled = false;
scene.add(pollen);

let stopped = false;
let disposed = false;
let animationFrame = 0;
let previousTime = performance.now();
let animationTime = 0;
let frameAverage = 1 / 60;
let performanceWindow = 0;

function resize() {
  const width = window.innerWidth;
  const height = Math.max(1, window.innerHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  composer.setSize(width, height);
}

window.addEventListener("resize", resize);
resize();

document.addEventListener("visibilitychange", () => {
  previousTime = performance.now();
});

canvas.addEventListener("webglcontextlost", event => {
  event.preventDefault();
  stopped = true;
  cancelAnimationFrame(animationFrame);
  window.showEvermeadowError(
    "The graphics context was interrupted. Reload to return to the meadow."
  );
});

function animate(now) {
  if (stopped || disposed) return;

  animationFrame = requestAnimationFrame(animate);

  const rawDelta = (now - previousTime) / 1000;
  previousTime = now;

  if (document.hidden) return;

  const dt = Math.min(Math.max(rawDelta, 0), 0.05);
  animationTime += dt;

  controls.update(dt);
  audio.update(dt, controls.isMoving, controls.keys.has("shift"));
  world.update(camera.position);
  wind.update(animationTime, dt, camera.position);
  lighting.update(dt, camera.position, animationTime);

  world.updateMountains(
    camera.position,
    lighting.horizon,
    lighting.daylight ?? 1
  );

  pollen.position.copy(camera.position);
  particleMaterial.uniforms.uTime.value = animationTime;
  particleMaterial.uniforms.uDay.value = lighting.daylight ?? 1;

  composer.render();

  // Reduce fill-rate cost when sustained frame times are high.
  // Chunk/geometry budgets stay bounded independently of this adjustment.
  if (rawDelta > 0 && rawDelta < 0.2 && world.pending.length === 0) {
    frameAverage = THREE.MathUtils.lerp(frameAverage, rawDelta, 0.025);
    performanceWindow += dt;

    if (performanceWindow > 8) {
      performanceWindow = 0;

      if (frameAverage > 0.027 && pixelRatio > 0.8) {
        pixelRatio = Math.max(0.8, pixelRatio - 0.15);
        renderer.setPixelRatio(pixelRatio);
        composer.setPixelRatio(pixelRatio);
        particleMaterial.uniforms.uPixelRatio.value = pixelRatio;
        resize();
      }
    }
  }
}

function dispose() {
  if (disposed) return;
  disposed = true;
  cancelAnimationFrame(animationFrame);
  window.removeEventListener("resize", resize);
  controls.dispose();
  audio.dispose();
  world.dispose();
  vegetation.dispose();
  lighting.dispose();
  particleGeometry.dispose();
  particleMaterial.dispose();
  composer.dispose();
  renderer.dispose();
}

// Preserve a valid scene when the browser puts this page into its back cache.
window.addEventListener("pagehide", event => {
  if (!event.persisted) dispose();
});

// Small read-only diagnostic surface for manual acceptance testing.
window.evermeadow = Object.freeze({
  get chunks() {
    return world.chunks.size;
  },
  get queuedChunks() {
    return world.pending.length;
  },
  get locationSource() {
    return lighting.locationSource;
  },
  get solarTimes() {
    return lighting.times;
  },
  get playerPosition() {
    return camera.position.toArray();
  },
  get rendererInfo() {
    return {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      pixelRatio
    };
  }
});

lighting.update(1, camera.position, 0);
animationFrame = requestAnimationFrame(animate);
