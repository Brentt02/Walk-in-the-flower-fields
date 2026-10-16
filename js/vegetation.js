import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

function decorate(geometry, color, windWeight) {
  const p = geometry.getAttribute("position");
  const colors = new Float32Array(p.count * 3);
  const wind = new Float32Array(p.count * 2);
  const c = new THREE.Color(color);

  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const weights = windWeight(y, p.getX(i), p.getZ(i));
    const shade = 0.76 + 0.24 * THREE.MathUtils.clamp(y / 0.8, 0, 1);

    colors[i * 3] = c.r * shade;
    colors[i * 3 + 1] = c.g * shade;
    colors[i * 3 + 2] = c.b * shade;
    wind[i * 2] = weights[0];
    wind[i * 2 + 1] = weights[1];
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("windData", new THREE.BufferAttribute(wind, 2));
  return geometry;
}

function join(parts) {
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeFlower(color, petalCount, height, size) {
  const pieces = [];
  const stem = new THREE.CylinderGeometry(0.011, 0.018, height, 4, 4);
  stem.translate(0, height / 2, 0);

  pieces.push(decorate(stem, "#487337", y => [
    Math.pow(THREE.MathUtils.clamp(y / height, 0, 1), 2) * height,
    0
  ]));

  for (let side = -1; side <= 1; side += 2) {
    const leaf = new THREE.SphereGeometry(1, 5, 3);
    leaf.scale(0.12, 0.016, 0.036);
    leaf.rotateZ(side * 0.45);
    leaf.translate(side * 0.075, height * 0.46, 0);

    pieces.push(decorate(leaf, "#648b42", y => [
      Math.pow(y / height, 2) * height, 0.5
    ]));
  }

  for (let i = 0; i < petalCount; i++) {
    const angle = i / petalCount * Math.PI * 2;
    const petal = new THREE.SphereGeometry(1, 5, 3);

    petal.scale(size, size * 0.22, size * 0.46);
    petal.rotateZ(-0.12);
    petal.translate(size * 0.7, 0, 0);
    petal.rotateY(angle);
    petal.translate(0, height, 0);

    pieces.push(decorate(petal, color, () => [height, 1]));
  }

  const center = new THREE.SphereGeometry(size * 0.4, 6, 4);
  center.scale(1, 0.52, 1);
  center.translate(0, height + 0.012, 0);
  pieces.push(decorate(center, "#e8b34f", () => [height, 0]));

  return join(pieces);
}

function makeGrass() {
  const positions = [];
  const indices = [];

  for (let blade = 0; blade < 3; blade++) {
    const angle = blade * 2.399;
    const height = 0.42 + blade * 0.11;
    const base = positions.length / 3;

    for (let row = 0; row <= 4; row++) {
      const t = row / 4;
      const width = 0.027 * (1 - t) + 0.001;
      const curve = t * t * 0.16;
      const x = Math.sin(angle) * curve;
      const z = Math.cos(angle) * curve;
      const dx = Math.cos(angle) * width;
      const dz = -Math.sin(angle) * width;

      positions.push(x - dx, t * height, z - dz);
      positions.push(x + dx, t * height, z + dz);
    }

    for (let row = 0; row < 4; row++) {
      const a = base + row * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return decorate(geometry, "#83a451", y => [y * y * 2.4, y]);
}

export class Vegetation {
  constructor(wind) {
    this.material = wind.material();

    this.flowers = [
      makeFlower("#fff2d7", 6, 0.43, 0.095),
      makeFlower("#ef8eaa", 5, 0.68, 0.145),
      makeFlower("#dc647c", 6, 0.76, 0.13),
      makeFlower("#f5cc62", 7, 0.57, 0.105),
      makeFlower("#9c93d3", 5, 0.63, 0.11)
    ];

    this.grass = makeGrass();

    this.foliage = decorate(
      new THREE.IcosahedronGeometry(1, 1),
      "#6f904c",
      y => [0.18 + (y + 1) * 0.14, 0.35]
    );

    this.rock = new THREE.IcosahedronGeometry(1, 1);
    this.wood = new THREE.BoxGeometry(1, 1, 1);
    this.trunk = new THREE.CylinderGeometry(0.14, 0.23, 1, 6);

    this.rockMaterial = new THREE.MeshStandardMaterial({
      color: "#8c9382",
      roughness: 1
    });

    this.woodMaterial = new THREE.MeshStandardMaterial({
      color: "#514a36",
      roughness: 1
    });

    this.dummy = new THREE.Object3D();
    this.tint = new THREE.Color();
  }

  instances(geometry, material, records, parent, shadow = false) {
    if (records.length === 0) return null;

    const mesh = new THREE.InstancedMesh(
      geometry, material, records.length
    );

    records.forEach((record, i) => {
      this.dummy.position.set(record.x, record.y, record.z);
      this.dummy.rotation.set(
        record.rx || 0,
        record.ry || 0,
        record.rz || 0
      );
      this.dummy.scale.set(
        record.sx ?? 1,
        record.sy ?? 1,
        record.sz ?? 1
      );
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);

      const shade = record.shade ?? 1;
      this.tint.setRGB(shade, shade, shade);
      mesh.setColorAt(i, this.tint);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();

    // Account for vertex-shader displacement during frustum culling.
    mesh.boundingSphere.radius += 1.5;
    parent.add(mesh);
    return mesh;
  }

  dispose() {
    [
      ...this.flowers,
      this.grass,
      this.foliage,
      this.rock,
      this.wood,
      this.trunk
    ].forEach(geometry => geometry.dispose());

    this.material.dispose();
    this.rockMaterial.dispose();
    this.woodMaterial.dispose();
  }
}
