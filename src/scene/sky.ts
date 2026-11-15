import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, LinearFilter, LinearMipmapLinearFilter, Matrix4, Mesh, MeshBasicMaterial, Quaternion, SRGBColorSpace, TextureLoader, Vector3 } from 'three';

/**
 * The sky is one real image: NASA SVS 4851 "Deep Star Maps 2020" (combined stars and Milky Way,
 * Hipparcos-2 / Tycho-2 / Gaia DR2), converted offline by scripts/assets/convert_starmap.py.
 * It is the only source of stars: nothing is generated, so no star is drawn twice.
 *
 * The map is plate carrée in celestial (ICRF/J2000) coordinates, centred on 0h right ascension with
 * right ascension increasing to the LEFT. The sphere below is built from those coordinates in a
 * right-handed frame, so the sky is not mirrored when seen from inside.
 *
 * Orientation is ILLUSTRATIVE. The Moon's spin axis is placed on the ecliptic pole (true to about
 * 1.5 degrees); the rotation about that axis is fixed and is not computed for the displayed UTC.
 * It is a backdrop, not a navigation or timing reference.
 */
export const STAR_MAP_URL = 'assets/starmap_2020_4k.jpg';

export type SkyState = 'loading' | 'ready' | 'error';

export interface StarSky {
  /** Positions are celestial unit vectors (X to RA 0h, Y to RA 6h, Z to the north celestial pole) times the radius. */
  readonly group: Group;
  /** 0 hides the sky (natural exposure beside sunlit ground); 1 is the map as published. */
  setExposure(exposure: number): void;
  readonly state: SkyState;
}

/** Rotation taking celestial vectors into the Moon-fixed frame: ecliptic north pole onto the Moon's +Z. */
const ECLIPTIC_POLE = new Vector3(0, -Math.sin(23.4393 * Math.PI / 180), Math.cos(23.4393 * Math.PI / 180));
const CELESTIAL_TO_MOON = new Quaternion().setFromUnitVectors(ECLIPTIC_POLE, new Vector3(0, 0, 1));

/** Celestial vector rotated into Moon-fixed axes (illustrative; see the note above). */
export function celestialToMoonFixed(celestial: Vector3): Vector3 {
  return celestial.clone().applyQuaternion(CELESTIAL_TO_MOON);
}

/**
 * Matrix for a sky group whose parent frame is reached from Moon-fixed axes by the linear map `fromMoonFixed`
 * (for example bodyToScene, or the local east/up/south rotation at a site).
 */
export function skyMatrix(fromMoonFixed: (x: number, y: number, z: number) => Vector3): Matrix4 {
  const column = (axis: Vector3): Vector3 => { const m = celestialToMoonFixed(axis); return fromMoonFixed(m.x, m.y, m.z); };
  return new Matrix4().makeBasis(column(new Vector3(1, 0, 0)), column(new Vector3(0, 1, 0)), column(new Vector3(0, 0, 1)));
}

export function makeStarSky(radius: number, onState?: (state: SkyState) => void): StarSky {
  const lonSegments = 96;
  const latSegments = 48;
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let j = 0; j <= latSegments; j += 1) {
    const v = j / latSegments;
    const dec = (v - 0.5) * Math.PI;
    for (let i = 0; i <= lonSegments; i += 1) {
      const u = i / lonSegments;
      const ra = (0.5 - u) * Math.PI * 2; // image centre is 0h; right ascension grows toward the left edge
      positions.push(radius * Math.cos(dec) * Math.cos(ra), radius * Math.cos(dec) * Math.sin(ra), radius * Math.sin(dec));
      uvs.push(u, v);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < latSegments; j += 1) {
    for (let i = 0; i < lonSegments; i += 1) {
      const a = j * (lonSegments + 1) + i;
      const b = a + lonSegments + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  const material = new MeshBasicMaterial({ color: 0x000000, side: DoubleSide, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10; // drawn first; everything else is in front of the sky
  const group = new Group();
  group.name = 'NASA SVS 4851 star map (illustrative orientation)';
  group.matrixAutoUpdate = false;
  group.add(mesh);
  let exposure = 1;
  const sky = {
    group,
    state: 'loading' as SkyState,
    setExposure(value: number): void {
      exposure = value;
      material.color.setScalar(material.map ? value : 0);
      mesh.visible = value > 0;
    },
  };
  new TextureLoader().load(
    `${import.meta.env.BASE_URL}${STAR_MAP_URL}`,
    (texture) => {
      texture.colorSpace = SRGBColorSpace;
      texture.minFilter = LinearMipmapLinearFilter;
      texture.magFilter = LinearFilter;
      texture.anisotropy = 4;
      material.map = texture;
      material.needsUpdate = true;
      sky.state = 'ready';
      sky.setExposure(exposure);
      onState?.('ready');
    },
    undefined,
    () => {
      // No substitute stars: the sky stays black and the caller says why.
      sky.state = 'error';
      onState?.('error');
    },
  );
  return sky;
}
