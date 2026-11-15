import { AdditiveBlending, BackSide, BufferGeometry, CanvasTexture, Color, Float32BufferAttribute, Group, LinearFilter, LinearMipmapLinearFilter, Matrix4, Mesh, ShaderMaterial, SRGBColorSpace, Texture, TextureLoader, Vector3 } from 'three';

/**
 * Appearance of Earth and the Sun. Directions and angular sizes are set by the callers from the
 * science module; nothing here moves or resizes a body.
 */
export const EARTH_MAP_URL = 'assets/earth_bmng_200401_4k.jpg';

export type BodyTextureState = 'loading' | 'ready' | 'error';

export interface EarthBody {
  /** Unit sphere; the caller scales and places it. */
  readonly group: Group;
  /** Direction from Earth toward the Sun in the parent (world) frame: sets the day/night phase. */
  setSunDirection(direction: Vector3): void;
  /**
   * Illustrative attitude only: turn longitude 0 toward `toViewer` with north near `north`.
   * The geographic face shown is NOT calculated for the displayed time.
   */
  face(toViewer: Vector3, north: Vector3): void;
  readonly state: BodyTextureState;
}

const LOG_DEPTH_VERTEX_PARS = '#include <common>\n#include <logdepthbuf_pars_vertex>';
const LOG_DEPTH_FRAGMENT_PARS = '#include <common>\n#include <logdepthbuf_pars_fragment>';

/** Unit sphere from geographic coordinates in a right-handed frame: +X longitude 0, +Y north, -Z longitude 90 E. */
function geographicSphere(lonSegments: number, latSegments: number): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let j = 0; j <= latSegments; j += 1) {
    const v = j / latSegments;
    const lat = (v - 0.5) * Math.PI;
    for (let i = 0; i <= lonSegments; i += 1) {
      const u = i / lonSegments;
      const lon = (u - 0.5) * Math.PI * 2; // image left edge is 180 W (checked by scripts/assets/convert_earth.py)
      positions.push(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
      uvs.push(u, v);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < latSegments; j += 1) {
    for (let i = 0; i < lonSegments; i += 1) {
      const a = j * (lonSegments + 1) + i;
      const b = a + lonSegments + 1;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
}

/**
 * Earth with NASA Blue Marble Next Generation colour. Lit only by the given Sun direction:
 * a real day/night phase with a soft terminator, a very dark night side (no self-illumination),
 * and a thin atmospheric rim on the day side.
 */
export function makeEarth(onState?: (state: BodyTextureState) => void): EarthBody {
  const sunDirection = new Vector3(1, 0, 0);
  const surface = new ShaderMaterial({
    uniforms: { map: { value: null as Texture | null }, hasMap: { value: 0 }, sunDirection: { value: sunDirection }, fallbackColor: { value: new Color(0x2f5f9e) } },
    vertexShader: `${LOG_DEPTH_VERTEX_PARS}
      varying vec2 vUv; varying vec3 vNormalWorld; varying vec3 vViewWorld;
      void main() {
        vUv = uv;
        vNormalWorld = normalize(mat3(modelMatrix) * normal);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vViewWorld = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `${LOG_DEPTH_FRAGMENT_PARS}
      uniform sampler2D map; uniform float hasMap; uniform vec3 sunDirection; uniform vec3 fallbackColor;
      varying vec2 vUv; varying vec3 vNormalWorld; varying vec3 vViewWorld;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 n = normalize(vNormalWorld);
        vec3 albedo = mix(fallbackColor, texture2D(map, vUv).rgb, hasMap);
        float sun = dot(n, normalize(sunDirection));
        float day = smoothstep(-0.06, 0.16, sun);            // soft terminator from atmospheric scattering
        float limb = pow(1.0 - max(dot(n, normalize(vViewWorld)), 0.0), 2.5);
        vec3 lit = albedo * (0.012 + 1.55 * day * max(sun, 0.06));
        lit = mix(lit, vec3(0.42, 0.62, 1.0) * day, limb * 0.45); // haze toward the day-side limb
        gl_FragColor = vec4(lit, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const rim = new ShaderMaterial({
    uniforms: { sunDirection: { value: sunDirection } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: BackSide,
    vertexShader: `${LOG_DEPTH_VERTEX_PARS}
      varying vec3 vNormalWorld; varying vec3 vViewWorld;
      void main() {
        vNormalWorld = normalize(mat3(modelMatrix) * normal);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vViewWorld = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `${LOG_DEPTH_FRAGMENT_PARS}
      uniform vec3 sunDirection; varying vec3 vNormalWorld; varying vec3 vViewWorld;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 n = normalize(vNormalWorld);
        float edge = pow(clamp(dot(-n, normalize(vViewWorld)), 0.0, 1.0), 3.0); // back faces of a slightly larger shell
        float day = smoothstep(-0.15, 0.35, dot(n, normalize(sunDirection)));
        gl_FragColor = vec4(vec3(0.30, 0.55, 1.0) * edge * day * 0.55, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const geometry = geographicSphere(96, 48);
  const globe = new Mesh(geometry, surface);
  const shell = new Mesh(geometry, rim);
  shell.scale.setScalar(1.035);
  const group = new Group();
  group.add(globe, shell);
  const earth = {
    group,
    state: 'loading' as BodyTextureState,
    setSunDirection(direction: Vector3): void {
      sunDirection.copy(direction).normalize();
    },
    face(toViewer: Vector3, north: Vector3): void {
      const x = toViewer.clone().normalize();
      const y = north.clone().addScaledVector(x, -north.dot(x));
      if (y.lengthSq() < 1e-8) y.set(0, 1, 0).addScaledVector(x, -x.y);
      y.normalize();
      group.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, y, x.clone().cross(y)));
    },
  };
  new TextureLoader().load(
    `${import.meta.env.BASE_URL}${EARTH_MAP_URL}`,
    (texture) => {
      texture.colorSpace = SRGBColorSpace;
      texture.minFilter = LinearMipmapLinearFilter;
      texture.magFilter = LinearFilter;
      texture.anisotropy = 8;
      surface.uniforms['map']!.value = texture;
      surface.uniforms['hasMap']!.value = 1;
      earth.state = 'ready';
      onState?.('ready');
    },
    undefined,
    () => {
      // A plain blue disc with the same phase; the caller reports that the map did not load.
      earth.state = 'error';
      onState?.('error');
    },
  );
  return earth;
}

/** Solar disc with limb darkening (I = 1 - 0.6 (1 - mu)); the disc fills `fill` of the texture half-width. */
export const SUN_DISC_FILL = 0.9;
export function sunDiscTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const image = context.createImageData(size, size);
    const half = size / 2;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const r = Math.hypot(x + 0.5 - half, y + 0.5 - half) / (half * SUN_DISC_FILL);
        const mu = Math.sqrt(Math.max(0, 1 - r * r));
        const intensity = 1 - 0.6 * (1 - mu);
        const alpha = Math.max(0, Math.min(1, (1 - r) * half * SUN_DISC_FILL)); // one-pixel antialiased limb
        const i = (y * size + x) * 4;
        image.data[i] = 255;
        image.data[i + 1] = Math.round(232 + 20 * intensity);
        image.data[i + 2] = Math.round(190 + 50 * intensity * intensity);
        image.data[i + 3] = Math.round(255 * alpha * (0.55 + 0.45 * intensity));
      }
    }
    context.putImageData(image, 0, 0);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Small soft glare around the disc. Appearance only; it is not a measure of brightness. */
export function sunGlowTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,238,200,0.55)');
    gradient.addColorStop(0.18, 'rgba(255,225,170,0.20)');
    gradient.addColorStop(0.5, 'rgba(255,215,150,0.05)');
    gradient.addColorStop(1, 'rgba(255,210,140,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
