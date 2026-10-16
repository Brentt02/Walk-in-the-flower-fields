import * as THREE from "three";

export class Wind {
  constructor() {
    this.uniforms = {
      uWindTime: { value: 0 },
      uWindDirection: { value: new THREE.Vector2(0.85, 0.52) },
      uWindStrength: { value: 0.24 },
      uViewer: { value: new THREE.Vector3() }
    };

    this.directionTarget = new THREE.Vector2();
  }

  update(time, dt, viewer) {
    const angle =
      0.5 +
      Math.sin(time * 0.027) * 0.48 +
      Math.sin(time * 0.011 + 2.0) * 0.22;

    this.directionTarget.set(Math.cos(angle), Math.sin(angle));

    this.uniforms.uWindDirection.value
      .lerp(this.directionTarget, 1 - Math.exp(-dt * 0.3))
      .normalize();

    // Smooth gust envelope, separate from the traveling spatial waves.
    const target =
      0.19 +
      0.1 * (0.5 + 0.5 * Math.sin(time * 0.19)) +
      0.11 * Math.pow(0.5 + 0.5 * Math.sin(time * 0.071 + 1.3), 3);

    this.uniforms.uWindStrength.value = THREE.MathUtils.damp(
      this.uniforms.uWindStrength.value,
      target,
      0.7,
      dt
    );

    this.uniforms.uWindTime.value = time;
    this.uniforms.uViewer.value.copy(viewer);
  }

  material(options = {}) {
    const material = new THREE.MeshStandardMaterial({
      roughness: 1,
      metalness: 0,
      vertexColors: true,
      side: THREE.DoubleSide,
      ...options
    });

    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms);

      shader.vertexShader = `
        attribute vec2 windData;
        uniform float uWindTime;
        uniform vec2 uWindDirection;
        uniform float uWindStrength;
        uniform vec3 uViewer;
        ${shader.vertexShader}
      `;

      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `
        #include <begin_vertex>

        vec4 root = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          root = instanceMatrix * root;
        #endif
        vec3 rootWorld = (modelMatrix * root).xyz;

        float spatial =
          dot(rootWorld.xz, uWindDirection) * 0.20;
        float localPhase =
          sin(rootWorld.x * 1.79 + rootWorld.z * 2.31) * 2.7;

        float wave =
          sin(spatial - uWindTime * 1.25) * 0.64 +
          sin(spatial * 0.47 - uWindTime * 0.66 + 1.7) * 0.36;

        float fine =
          sin(uWindTime * 3.3 + localPhase + position.y * 2.8);

        float distanceFade = mix(
          1.0, 0.42,
          smoothstep(12.0, 95.0, distance(rootWorld, uViewer))
        );

        float bend =
          uWindStrength *
          (0.38 + wave * 0.62 + fine * 0.09) *
          windData.x *
          distanceFade;

        // Transform world-space wind back into the instance's local XZ axes.
        // Instance X and Z scales are kept equal by the vegetation builder.
        vec2 localDirection = uWindDirection;
        #ifdef USE_INSTANCING
          vec2 axisX = normalize(instanceMatrix[0].xz);
          vec2 axisZ = normalize(instanceMatrix[2].xz);
          localDirection = vec2(
            dot(uWindDirection, axisX),
            dot(uWindDirection, axisZ)
          );
        #endif

        transformed.xz += localDirection * bend;

        // Petals/leaves have a separate flutter weight. Flower centers do not.
        float flutter =
          sin(uWindTime * 5.1 + localPhase + position.x * 8.0) *
          0.018 * windData.y * distanceFade;

        transformed.y += flutter;
        transformed.xz += vec2(-localDirection.y, localDirection.x) *
          sin(uWindTime * 2.6 + localPhase - 0.65) *
          0.028 * windData.y * distanceFade;
        `
      );
    };

    material.customProgramCacheKey = () => "evermeadow-wind-v1";
    return material;
  }
}
