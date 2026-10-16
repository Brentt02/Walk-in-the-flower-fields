import * as THREE from "three";

export const CHUNK_SIZE = 36;

function hash(x, z, seed = 7341) {
  let n = Math.imul(x | 0, 374761393) ^
          Math.imul(z | 0, 668265263) ^
          seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function randomGenerator(x, z) {
  let state = (hash(x, z) * 4294967296) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = t => t * t * (3 - 2 * t);

export function noise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);

  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(hash(ix, iz), hash(ix + 1, iz), fx),
    THREE.MathUtils.lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), fx),
    fz
  );
}

export function terrainHeight(x, z) {
  return (
    (noise(x * 0.008, z * 0.008) - 0.5) * 25 +
    (noise(x * 0.024 + 40, z * 0.024 - 90) - 0.5) * 8 +
    Math.sin(x * 0.013 + z * 0.008) * 2.2
  );
}

export class World {
  constructor(scene, vegetation, mobile) {
    this.scene = scene;
    this.vegetation = vegetation;
    this.mobile = mobile;
    this.radius = mobile ? 1 : 2;
    this.chunks = new Map();
    this.pending = [];
    this.centerX = Infinity;
    this.centerZ = Infinity;

    this.groundMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0
    });

    this.color = new THREE.Color();
    this.low = new THREE.Color("#536f32");
    this.high = new THREE.Color("#8b9e4a");

    this.mountains = new THREE.Group();
    this.mountainMaterials = [];
    this.makeMountains();
    scene.add(this.mountains);

    this.mistColor = new THREE.Color();
  }

  makeMountains() {
    const random = randomGenerator(917, 224);

    for (let layer = 0; layer < 3; layer++) {
      const count = 96;
      const positions = [];
      const indices = [];
      const radius = 280 + layer * 160;

      for (let i = 0; i <= count; i++) {
        const angle = i / count * Math.PI * 2;
        const ridge =
          28 +
          layer * 15 +
          Math.pow(0.5 + 0.5 * Math.sin(angle * 5 + layer), 2) * 60 +
          random() * 20;

        const x = Math.sin(angle) * radius;
        const z = Math.cos(angle) * radius;

        positions.push(x, -100, z, x, ridge, z);

        if (i < count) {
          const a = i * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }

      // Close the seam exactly, including ridge height.
      const last = count * 6;
      for (let j = 0; j < 6; j++) positions[last + j] = positions[j];

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3)
      );
      geometry.setIndex(indices);
      geometry.computeVertexNormals();

      const material = new THREE.MeshBasicMaterial({
        color: "#8e9faa",
        side: THREE.DoubleSide,
        fog: false,
        depthWrite: true
      });

      const mesh = new THREE.Mesh(geometry, material);
      this.mountains.add(mesh);
      this.mountainMaterials.push(material);
    }
  }

  updateMountains(position, horizon, daylight) {
    // A background skyline rather than reachable gameplay geometry.
    this.mountains.position.set(position.x, 0, position.z);

    this.mountainMaterials.forEach((material, i) => {
      this.mistColor.setRGB(
        0.13 + daylight * 0.19,
        0.16 + daylight * 0.22,
        0.24 + daylight * 0.25
      );
      material.color.copy(this.mistColor).lerp(horizon, 0.32 + i * 0.2);
    });
  }

  key(x, z) {
    return `${x},${z}`;
  }

  plan(position) {
    const cx = Math.floor(position.x / CHUNK_SIZE);
    const cz = Math.floor(position.z / CHUNK_SIZE);

    if (cx === this.centerX && cz === this.centerZ) return;

    this.centerX = cx;
    this.centerZ = cz;

    for (const [key, chunk] of this.chunks) {
      if (
        Math.abs(chunk.cx - cx) > this.radius ||
        Math.abs(chunk.cz - cz) > this.radius
      ) {
        this.removeChunk(key, chunk);
      }
    }

    this.pending.length = 0;

    for (let dz = -this.radius; dz <= this.radius; dz++) {
      for (let dx = -this.radius; dx <= this.radius; dx++) {
        const x = cx + dx;
        const z = cz + dz;

        if (!this.chunks.has(this.key(x, z))) {
          this.pending.push({ x, z, distance: dx * dx + dz * dz });
        }
      }
    }

    this.pending.sort((a, b) => a.distance - b.distance);
  }

  update(position) {
    this.plan(position);

    // Bound generation work: at most one new chunk per frame.
    const next = this.pending.shift();
    if (next) this.createChunk(next.x, next.z);
  }

  createChunk(cx, cz) {
    const group = new THREE.Group();
    const originX = cx * CHUNK_SIZE;
    const originZ = cz * CHUNK_SIZE;

    group.position.set(originX, 0, originZ);

    const segments = this.mobile ? 16 : 24;
    const geometry = new THREE.PlaneGeometry(
      CHUNK_SIZE, CHUNK_SIZE, segments, segments
    );
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(CHUNK_SIZE / 2, 0, CHUNK_SIZE / 2);

    const positions = geometry.getAttribute("position");
    const colors = new Float32Array(positions.count * 3);
    const normals = new Float32Array(positions.count * 3);
    const normal = new THREE.Vector3();

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i) + originX;
      const z = positions.getZ(i) + originZ;
      positions.setY(i, terrainHeight(x, z));

      const variation = noise(x * 0.095, z * 0.095);
      this.color.copy(this.low).lerp(this.high, variation);

      colors[i * 3] = this.color.r;
      colors[i * 3 + 1] = this.color.g;
      colors[i * 3 + 2] = this.color.b;

      // World-space derivatives give matching normals on chunk borders.
      const epsilon = 0.15;
      normal.set(
        terrainHeight(x - epsilon, z) - terrainHeight(x + epsilon, z),
        2 * epsilon,
        terrainHeight(x, z - epsilon) - terrainHeight(x, z + epsilon)
      ).normalize();

      normals[i * 3] = normal.x;
      normals[i * 3 + 1] = normal.y;
      normals[i * 3 + 2] = normal.z;
    }

    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.computeBoundingSphere();

    const ground = new THREE.Mesh(geometry, this.groundMaterial);
    ground.receiveShadow = true;
    group.add(ground);

    this.populate(group, cx, cz);
    this.scene.add(group);

    this.chunks.set(this.key(cx, cz), {
      cx, cz, group, groundGeometry: geometry
    });
  }

  populate(group, cx, cz) {
    const v = this.vegetation;
    const random = randomGenerator(cx, cz);
    const ox = cx * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;

    const flowerRecords = Array.from({ length: 5 }, () => []);
    const grassRecords = [];
    const rocks = [];
    const bushes = [];
    const trunks = [];
    const crowns = [];
    const wood = [];

    // Same candidates at every quality level. Lower quality uses a prefix,
    // preserving flower locations rather than randomly rearranging them.
    const flowerAttempts = this.mobile ? 650 : 1450;

    for (let i = 0; i < flowerAttempts; i++) {
      const x = random() * CHUNK_SIZE;
      const z = random() * CHUNK_SIZE;
      const wx = x + ox;
      const wz = z + oz;
      const patch = noise(wx * 0.075 + 30, wz * 0.075 - 20);

      if (random() > THREE.MathUtils.smoothstep(patch, 0.21, 0.72)) continue;

      const speciesField = noise(wx * 0.052 - 18, wz * 0.052 + 50);
      const mixed = speciesField * 0.76 + random() * 0.24;

      let species =
        mixed < 0.31 ? 0 :
        mixed < 0.49 ? 1 :
        mixed < 0.64 ? 2 :
        mixed < 0.82 ? 3 : 4;

      // Violet is deliberately uncommon.
      if (species === 4 && random() < 0.55) species = 0;

      const scale = 0.7 + random() * 0.65;

      flowerRecords[species].push({
        x, z,
        y: terrainHeight(wx, wz) - 0.018,
        ry: random() * Math.PI * 2,
        sx: scale,
        sy: scale * (0.85 + random() * 0.35),
        sz: scale,
        shade: 0.82 + random() * 0.27
      });
    }

    // A separate seeded stream prevents flower density from moving props.
    const grassRandom = randomGenerator(cx + 40001, cz - 9011);
    const grassCount = this.mobile ? 850 : 2100;

    for (let i = 0; i < grassCount; i++) {
      const x = grassRandom() * CHUNK_SIZE;
      const z = grassRandom() * CHUNK_SIZE;
      const scale = 0.65 + grassRandom() * 0.85;

      grassRecords.push({
        x, z,
        y: terrainHeight(x + ox, z + oz) - 0.025,
        ry: grassRandom() * Math.PI * 2,
        sx: scale,
        sy: scale,
        sz: scale,
        shade: 0.72 + grassRandom() * 0.4
      });
    }

    const propsRandom = randomGenerator(cx - 7211, cz + 33891);

    for (let i = 0; i < 5; i++) {
      const x = 3 + propsRandom() * (CHUNK_SIZE - 6);
      const z = 3 + propsRandom() * (CHUNK_SIZE - 6);
      const y = terrainHeight(x + ox, z + oz);
      const scale = 0.25 + propsRandom() * 0.65;

      rocks.push({
        x, z, y: y + scale * 0.2,
        sx: scale,
        sy: scale * 0.6,
        sz: scale * 0.85,
        ry: propsRandom() * 6.28,
        shade: 0.8 + propsRandom() * 0.25
      });

      if (i < 2) {
        bushes.push({
          x: x + 1.2, z,
          y: terrainHeight(x + ox + 1.2, z + oz) + 0.4,
          sx: 0.8, sy: 0.65, sz: 0.8
        });
      }
    }

    if (propsRandom() < 0.28) {
      const x = 8 + propsRandom() * 20;
      const z = 8 + propsRandom() * 20;
      const y = terrainHeight(x + ox, z + oz);
      const height = 3.4 + propsRandom() * 1.5;

      trunks.push({
        x, z, y: y + height / 2,
        sx: 1, sy: height, sz: 1
      });

      for (let i = 0; i < 5; i++) {
        const angle = i * 2.4;
        crowns.push({
          x: x + Math.sin(angle) * 0.8,
          z: z + Math.cos(angle) * 0.8,
          y: y + height - 0.2 + propsRandom() * 0.9,
          sx: 1.65,
          sy: 1.25,
          sz: 1.65,
          shade: 0.86 + propsRandom() * 0.2
        });
      }
    }

    // Occasional short fence runs, safely within their owning chunk.
    if (propsRandom() < 0.24 || (cx === 0 && cz === 0)) {
      const startX = 5;
      const startZ = 10 + propsRandom() * 12;
      const angle = -0.4 + propsRandom() * 0.8;
      const points = [];

      for (let i = 0; i < 6; i++) {
        const x = startX + Math.cos(angle) * i * 2.7;
        const z = startZ + Math.sin(angle) * i * 2.7;
        const y = terrainHeight(x + ox, z + oz);

        points.push(new THREE.Vector3(x, y, z));

        wood.push({
          x, z, y: y + 0.69,
          sx: 0.17, sy: 1.46, sz: 0.19,
          ry: angle,
          rz: (propsRandom() - 0.5) * 0.06
        });
      }

      const dummy = new THREE.Object3D();
      const direction = new THREE.Vector3();
      const axis = new THREE.Vector3(1, 0, 0);
      const quaternion = new THREE.Quaternion();

      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        direction.subVectors(b, a);
        const length = direction.length();

        quaternion.setFromUnitVectors(axis, direction.normalize());
        dummy.quaternion.copy(quaternion);

        for (const railHeight of [0.48, 1.02]) {
          wood.push({
            x: (a.x + b.x) / 2,
            z: (a.z + b.z) / 2,
            y: (a.y + b.y) / 2 + railHeight,
            sx: length + 0.12,
            sy: 0.13,
            sz: 0.11,
            rx: dummy.rotation.x,
            ry: dummy.rotation.y,
            rz: dummy.rotation.z
          });
        }
      }
    }

    flowerRecords.forEach((records, index) => {
      v.instances(v.flowers[index], v.material, records, group);
    });

    v.instances(v.grass, v.material, grassRecords, group);
    v.instances(v.rock, v.rockMaterial, rocks, group, true);
    v.instances(v.foliage, v.material, bushes, group);
    v.instances(v.trunk, v.woodMaterial, trunks, group, true);
    v.instances(v.foliage, v.material, crowns, group);
    v.instances(v.wood, v.woodMaterial, wood, group, true);
  }

  removeChunk(key, chunk) {
    this.scene.remove(chunk.group);

    chunk.group.traverse(object => {
      // Free per-instance GPU buffers, but retain shared geometry/materials.
      if (object.isInstancedMesh) object.dispose();
    });

    chunk.groundGeometry.dispose();
    chunk.group.clear();
    this.chunks.delete(key);
  }

  dispose() {
    for (const [key, chunk] of this.chunks) this.removeChunk(key, chunk);
    this.pending.length = 0;
    this.groundMaterial.dispose();

    this.mountains.traverse(object => {
      if (object.isMesh) {
        object.geometry.dispose();
        object.material.dispose();
      }
    });

    this.scene.remove(this.mountains);
  }
}
