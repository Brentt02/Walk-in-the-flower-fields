import * as THREE from "three";

// Solar equations follow the established SunCalc-style approximation.
// Coordinates are geographic degrees; azimuth is south-origin, west-positive.
const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;
const TRANSIT_OFFSET = 0.0009;

const toJulian = date => date.valueOf() / DAY_MS - 0.5 + J1970;
const fromJulian = value => new Date((value + 0.5 - J1970) * DAY_MS);
const toDays = date => toJulian(date) - J2000;

function solarCoordinates(days) {
  const meanAnomaly = RAD * (357.5291 + 0.98560028 * days);
  const equation =
    RAD * (
      1.9148 * Math.sin(meanAnomaly) +
      0.02 * Math.sin(2 * meanAnomaly) +
      0.0003 * Math.sin(3 * meanAnomaly)
    );

  const longitude = meanAnomaly + equation + RAD * 102.9372 + Math.PI;

  return {
    meanAnomaly,
    longitude,
    declination: Math.asin(Math.sin(longitude) * Math.sin(OBLIQUITY)),
    rightAscension: Math.atan2(
      Math.sin(longitude) * Math.cos(OBLIQUITY),
      Math.cos(longitude)
    )
  };
}

export function solarPosition(date, latitude, longitude) {
  const days = toDays(date);
  const phi = latitude * RAD;
  const westLongitude = -longitude * RAD;
  const coordinates = solarCoordinates(days);
  const sidereal = RAD * (280.16 + 360.9856235 * days) - westLongitude;
  const hourAngle = sidereal - coordinates.rightAscension;

  return {
    altitude: Math.asin(
      Math.sin(phi) * Math.sin(coordinates.declination) +
      Math.cos(phi) * Math.cos(coordinates.declination) *
      Math.cos(hourAngle)
    ),
    azimuth: Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(phi) -
      Math.tan(coordinates.declination) * Math.cos(phi)
    )
  };
}

export function solarTimes(date, latitude, longitude) {
  const westLongitude = -longitude * RAD;
  const phi = latitude * RAD;
  const days = toDays(date);

  const cycle = Math.round(
    days - TRANSIT_OFFSET - westLongitude / (2 * Math.PI)
  );

  const approximateTransit =
    TRANSIT_OFFSET + westLongitude / (2 * Math.PI) + cycle;

  const coordinates = solarCoordinates(approximateTransit);

  const transit = ds =>
    J2000 + ds +
    0.0053 * Math.sin(coordinates.meanAnomaly) -
    0.0069 * Math.sin(2 * coordinates.longitude);

  const noon = transit(approximateTransit);
  const horizon = -0.833 * RAD;

  const cosine =
    (Math.sin(horizon) -
      Math.sin(phi) * Math.sin(coordinates.declination)) /
    (Math.cos(phi) * Math.cos(coordinates.declination));

  if (cosine > 1 || cosine < -1) {
    return {
      sunrise: null,
      sunset: null,
      solarNoon: fromJulian(noon),
      polar: cosine > 1 ? "night" : "day"
    };
  }

  const hourAngle = Math.acos(cosine);
  const sunset = transit(
    TRANSIT_OFFSET +
    (hourAngle + westLongitude) / (2 * Math.PI) +
    cycle
  );

  return {
    sunrise: fromJulian(noon - (sunset - noon)),
    sunset: fromJulian(sunset),
    solarNoon: fromJulian(noon),
    polar: null
  };
}

const skyVertex = `
  varying vec3 vDirection;

  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = `
  precision highp float;

  varying vec3 vDirection;
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uCloud;
  uniform vec3 uSun;
  uniform float uDay;
  uniform float uTime;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x),
      f.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      value += noise(p) * amplitude;
      p = mat2(1.6, -1.2, 1.2, 1.6) * p + 7.3;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec3 direction = normalize(vDirection);
    float height = max(direction.y, 0.0);
    vec3 color = mix(uHorizon, uTop, smoothstep(0.0, 0.85, height));

    float sunDot = max(dot(direction, uSun), 0.0);
    float sunVisibility = smoothstep(-0.06, 0.02, uSun.y);
    vec3 sunColor = mix(vec3(1.0, 0.43, 0.22), vec3(1.0, 0.9, 0.66), uDay);

    color += sunColor * pow(sunDot, 18.0) * 0.16 * sunVisibility;
    color += sunColor * pow(sunDot, 180.0) * 0.25 * sunVisibility;
    color += vec3(1.0, 0.88, 0.61) *
      smoothstep(0.99955, 0.99988, sunDot) * 2.2 * sunVisibility;

    // Stylized atmospheric sunbeams: faint radial streaks around the sun.
    // These are shader-based light rays, not hardware ray tracing.
    float rayAngle = atan(direction.z, direction.x);
    float raySpokes = pow(max(0.0,
      sin(rayAngle * 13.0 + sin(rayAngle * 3.0) * 0.65)), 18.0);
    float sunRays = pow(sunDot, 5.5) * raySpokes * 0.24 * sunVisibility * uDay;
    color += sunColor * sunRays;

    // Softer, cooler moon rays at night, with much lower intensity.
    float moonDot = max(dot(direction, -uSun), 0.0);
    float moonRays = pow(moonDot, 4.0) *
      (0.10 + 0.14 * raySpokes) * (1.0 - uDay);
    color += vec3(0.48, 0.62, 1.0) * moonRays;

    if (direction.y > 0.025) {
      vec2 p = direction.xz / (direction.y + 0.30);
      p = p * 2.5 + vec2(uTime * 0.004, uTime * 0.0015);

      float lower = fbm(p);
      float upper = fbm(p * 0.72 + vec2(5.4, -2.1));
      float cloud = smoothstep(0.47, 0.69, lower * 0.7 + upper * 0.3);
      float edge = smoothstep(0.025, 0.19, direction.y);
      float shade = fbm(p + vec2(0.12, 0.05));

      vec3 cloudColor = uCloud * (0.76 + shade * 0.38);
      cloudColor += sunColor * pow(sunDot, 8.0) * 0.13 * uDay;
      color = mix(color, cloudColor, cloud * edge * 0.94);

      vec2 starCell = floor(direction.xz / (direction.y + 0.2) * 550.0);
      float star = step(0.9988, hash(starCell));
      float twinkle = 0.7 + 0.3 * sin(uTime * 0.6 + hash(starCell) * 90.0);

      color += star * twinkle * (1.0 - uDay) *
        smoothstep(0.04, 0.3, direction.y) * (1.0 - cloud) * 0.65;
    }

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Lighting {
  constructor(scene, renderer, mobile) {
    this.scene = scene;
    this.renderer = renderer;
    this.mobile = mobile;
    this.elapsed = 0;
    this.lastDateKey = "";
    this.times = null;
    this.locationSource = "clock fallback";
    this.locationPending = false;

    const params = new URLSearchParams(location.search);
    const latitude = Number(params.get("lat"));
    const longitude = Number(params.get("lon"));

    this.location =
      params.has("lat") && params.has("lon") &&
      Number.isFinite(latitude) && Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
        ? { latitude, longitude }
        : null;

    if (this.location) this.locationSource = "URL coordinates";

    const hour = Number(params.get("hour"));
    this.previewHour =
      params.has("hour") && Number.isFinite(hour) && hour >= 0 && hour < 24
        ? hour
        : null;

    this.sunDirection = new THREE.Vector3();
    this.horizon = new THREE.Color();
    this.top = new THREE.Color();
    this.cloud = new THREE.Color();
    this.temp = new THREE.Color();

    this.hemisphere = new THREE.HemisphereLight("#dce8ed", "#485637", 1);
    scene.add(this.hemisphere);

    this.sun = new THREE.DirectionalLight("#ffe2b0", 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(mobile ? 512 : 1024);
    this.sun.shadow.camera.left = -23;
    this.sun.shadow.camera.right = 23;
    this.sun.shadow.camera.top = 23;
    this.sun.shadow.camera.bottom = -23;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 170;
    this.sun.shadow.normalBias = 0.06;
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.radius = 3;
    scene.add(this.sun, this.sun.target);

    this.uniforms = {
      uTop: { value: this.top },
      uHorizon: { value: this.horizon },
      uCloud: { value: this.cloud },
      uSun: { value: this.sunDirection },
      uDay: { value: 1 },
      uTime: { value: 0 }
    };

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(950, 32, 18),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false
      })
    );
    this.sky.renderOrder = -20;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    // A visible moon disk with a soft, local pool of cool moonlight.
    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 24, 16),
      new THREE.MeshBasicMaterial({
        color: "#e6edff",
        transparent: true,
        opacity: 0.0,
        fog: false,
        depthWrite: false
      })
    );
    this.moonGlow = new THREE.PointLight("#a9c8ff", 0, 115, 1.65);
    this.moonGlow.castShadow = false;
    scene.add(this.moon, this.moonGlow);

    scene.fog = new THREE.Fog(
      "#b8c5bc",
      mobile ? 16 : 38,
      mobile ? 34 : 71
    );

    this.onLocationRequest = () => this.requestLocation();
    window.addEventListener("evermeadow-location", this.onLocationRequest);

    // An explicit URL opt-in is useful on mobile, which has no L key.
    if (params.get("location") === "ask") this.requestLocation();
  }

  requestLocation() {
    if (!navigator.geolocation || this.locationPending) return;
    this.locationPending = true;

    navigator.geolocation.getCurrentPosition(
      position => {
        this.locationPending = false;
        this.location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };
        this.locationSource = "browser permission";
        this.lastDateKey = "";
      },
      () => {
        this.locationPending = false;
        // Existing coordinates, or the local-clock fallback, keep working.
        console.info("Evermeadow: location unavailable; keeping fallback.");
      },
      {
        enableHighAccuracy: false,
        maximumAge: 3600000,
        timeout: 10000
      }
    );
  }

  getDate() {
    const date = new Date();

    if (this.previewHour !== null) {
      const hours = Math.floor(this.previewHour);
      const minutes = Math.floor((this.previewHour - hours) * 60);
      date.setHours(hours, minutes, 0, 0);
    }

    return date;
  }

  update(dt, player, animationTime) {
    this.sky.position.copy(player);
    this.uniforms.uTime.value = animationTime;
    this.elapsed += dt;

    // Solar movement is slow; calculate it four times per second.
    if (this.elapsed >= 0.25 || this.times === null) {
      this.elapsed = 0;
      const date = this.getDate();
      let altitude;
      let azimuth;

      if (this.location) {
        const position = solarPosition(
          date, this.location.latitude, this.location.longitude
        );

        altitude = position.altitude;
        azimuth = position.azimuth;

        const key =
          `${date.toDateString()}:${this.location.latitude}:${this.location.longitude}`;

        if (key !== this.lastDateKey) {
          this.times = solarTimes(
            date, this.location.latitude, this.location.longitude
          );
          this.lastDateKey = key;
        }
      } else {
        // Explicit approximation, not a geographic sunrise calculation.
        const hour =
          date.getHours() +
          date.getMinutes() / 60 +
          date.getSeconds() / 3600;

        altitude = Math.sin((hour - 6) / 24 * Math.PI * 2) * 1.05;
        azimuth = (hour - 12) / 24 * Math.PI * 2;
        this.times = { sunrise: null, sunset: null, polar: null };
      }

      this.sunDirection.set(
        -Math.sin(azimuth) * Math.cos(altitude),
        Math.sin(altitude),
        Math.cos(azimuth) * Math.cos(altitude)
      ).normalize();

      this.daylight = THREE.MathUtils.smoothstep(altitude, -0.16, 0.3);
      const warm =
        Math.exp(-Math.pow((altitude - 0.045) / 0.23, 2));
      const day = this.daylight;

      this.top.set("#111c3a").lerp(this.temp.set("#7fbbd7"), day);
      this.horizon.set("#29354e").lerp(this.temp.set("#c7d4c5"), day);
      this.horizon.lerp(this.temp.set("#e9b2a4"), warm * 0.7);

      this.cloud.set("#3a405d").lerp(this.temp.set("#f1e7d6"), day);
      this.cloud.lerp(this.temp.set("#efb7ae"), warm * 0.8);

      this.scene.fog.color.copy(this.horizon);
      this.uniforms.uDay.value = day;

      this.sun.color.set("#ffbb86").lerp(this.temp.set("#fff0d1"), day);
      this.sun.intensity =
        2.7 * THREE.MathUtils.smoothstep(altitude, -0.04, 0.42);

      this.hemisphere.color.set("#5b709f")
        .lerp(this.temp.set("#d5e7e9"), day);
      this.hemisphere.groundColor.set("#252b3d")
        .lerp(this.temp.set("#677749"), day);
      this.hemisphere.intensity = 0.62 + day * 1.1;

      this.renderer.toneMappingExposure = 1.08 + day * 0.10;
    }

    this.sun.position.copy(player).addScaledVector(this.sunDirection, 80);
    this.sun.target.position.copy(player);
    this.sun.target.updateMatrixWorld();

    // The moon sits opposite the sun, remaining visible in the night sky.
    const night = 1 - THREE.MathUtils.smoothstep(this.daylight ?? 1, 0.02, 0.42);
    const moonDirection = this.sunDirection.clone().negate();
    this.moon.position.copy(player).addScaledVector(moonDirection, 205);
    this.moon.quaternion.copy(this.sky.quaternion);
    this.moon.material.opacity = 0.88 * night;
    this.moonGlow.position.copy(player).addScaledVector(moonDirection, 32);
    this.moonGlow.intensity = 1.15 * night;
    this.hemisphere.intensity = 0.42 + (this.daylight ?? 1) * 1.1;
    this.renderer.toneMappingExposure = 1.08 - night * 0.03;
  }

  dispose() {
    window.removeEventListener("evermeadow-location", this.onLocationRequest);
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.sun.shadow.dispose();
    this.scene.remove(this.sky, this.sun, this.sun.target, this.hemisphere, this.moon, this.moonGlow);
    this.moon.geometry.dispose();
    this.moon.material.dispose();
  }
}
