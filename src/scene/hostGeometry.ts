import { BufferAttribute, BufferGeometry, Color, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader, Vector3 } from 'three';
import type { MoonHost } from './context';

/** Drawing buffers of the continuous Moon in one scene's own units and axes. Rendering only. */
export interface HostBuffers {
  /** Detailed (scientific) mesh: its own geometry, vertices in the original order, triangles on the same diagonal. */
  detail: BufferGeometry;
  /** Seam plus real 800 m context around the detailed mesh. Null when no context is loaded. */
  context: BufferGeometry | null;
  /** The rest of the Moon. Carries `bodyDirection` for the geographic colour map. */
  globe: BufferGeometry;
  /** Positions around the edge of the detailed mesh (the thin scientific-data boundary), xyz triples. */
  detailEdge: Float32Array;
  /** Texture coordinate of the detailed mesh, for matching its tone to the global map. */
  regionUv: [number, number];
}

/**
 * Convert the host to scene buffers with `toScene` (Moon-fixed metres to scene units).
 * Normals are computed once over the whole surface, so shading is continuous across the part boundaries.
 */
export function buildHostBuffers(host: MoonHost, toScene: (x: number, y: number, z: number, target: Vector3) => Vector3): HostBuffers {
  const count = host.positionsBodyM.length / 3;
  const positions = new Float32Array(count * 3);
  const directions = new Float32Array(count * 3);
  const scratch = new Vector3();
  for (let i = 0; i < count; i += 1) {
    const x = host.positionsBodyM[i * 3]!, y = host.positionsBodyM[i * 3 + 1]!, z = host.positionsBodyM[i * 3 + 2]!;
    if (!Number.isFinite(x)) continue; // unused vertices stay at the origin; no triangle refers to them
    toScene(x, y, z, scratch);
    positions[i * 3] = scratch.x;
    positions[i * 3 + 1] = scratch.y;
    positions[i * 3 + 2] = scratch.z;
    const length = Math.hypot(x, y, z);
    directions[i * 3] = x / length;
    directions[i * 3 + 1] = y / length;
    directions[i * 3 + 2] = z / length;
  }
  const { detail, seam, context, host: globe } = host.parts;
  const all = new Uint32Array(detail.length + seam.length + context.length + globe.length);
  all.set(detail, 0);
  all.set(seam, detail.length);
  all.set(context, detail.length + seam.length);
  all.set(globe, detail.length + seam.length + context.length);
  const whole = new BufferGeometry();
  whole.setAttribute('position', new BufferAttribute(positions, 3));
  whole.setIndex(new BufferAttribute(all, 1));
  whole.computeVertexNormals();
  const normals = whole.getAttribute('normal').array as Float32Array;
  whole.dispose();

  const sharing = (index: Uint32Array, withDirections: boolean): BufferGeometry => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(normals, 3));
    if (withDirections) geometry.setAttribute('bodyDirection', new BufferAttribute(directions, 3));
    geometry.setIndex(new BufferAttribute(index, 1));
    return geometry;
  };
  const n = host.detailVertexCount;
  const detailGeometry = new BufferGeometry();
  detailGeometry.setAttribute('position', new BufferAttribute(positions.slice(0, n * 3), 3));
  detailGeometry.setAttribute('normal', new BufferAttribute(normals.slice(0, n * 3), 3));
  detailGeometry.setIndex(new BufferAttribute(detail, 1));

  let contextGeometry: BufferGeometry | null = null;
  if (seam.length + context.length > 0) {
    const index = new Uint32Array(seam.length + context.length);
    index.set(seam, 0);
    index.set(context, seam.length);
    contextGeometry = sharing(index, false);
  }
  const edge = new Float32Array(host.detailEdge.length * 3);
  host.detailEdge.forEach((vertex, i) => edge.set(positions.subarray(vertex * 3, vertex * 3 + 3), i * 3));
  const any = host.detailEdge[0]!; // the 5 km/pixel global map is uniform across the patch
  return { detail: detailGeometry, context: contextGeometry, globe: sharing(globe, true), detailEdge: edge, regionUv: [host.uvs[any * 2]!, host.uvs[any * 2 + 1]!] };
}

/** `bodyDirection` for an ordinary sphere whose positions were made by `toBody` (scene position to Moon-fixed axes). */
export function addBodyDirections(geometry: BufferGeometry, toBody: (position: Vector3) => [number, number, number]): void {
  const position = geometry.getAttribute('position');
  const directions = new Float32Array(position.count * 3);
  const p = new Vector3();
  for (let i = 0; i < position.count; i += 1) {
    const [x, y, z] = toBody(p.fromBufferAttribute(position, i));
    const length = Math.hypot(x, y, z) || 1;
    directions.set([x / length, y / length, z / length], i * 3);
  }
  geometry.setAttribute('bodyDirection', new BufferAttribute(directions, 3));
}

/**
 * Lit Moon material whose colour map is looked up per pixel from the Moon-fixed direction
 * (equirectangular, left edge 180 W, north up). Sampling by direction instead of by per-vertex
 * texture coordinates means no triangle can stretch across the map's left/right edge and nothing
 * pinches at the poles, whatever the mesh looks like.
 */
export function geographicMoonMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: 0x8a8a8a, roughness: 1, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 bodyDirection;\nvarying vec3 vBodyDirection;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBodyDirection = bodyDirection;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBodyDirection;')
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec3 geoDirection = normalize(vBodyDirection);
          float geoU = atan(geoDirection.y, geoDirection.x) / 6.283185307179586 + 0.5;
          float geoV = asin(clamp(geoDirection.z, -1.0, 1.0)) / 3.141592653589793 + 0.5;
          // Two equivalent longitudes; the one that is continuous across this pixel avoids a mip-map line at 180 degrees.
          float geoAlt = fract(geoU + 0.5) - 0.5;
          vec2 geoUv = vec2(fwidth(geoU) < fwidth(geoAlt) ? geoU : geoAlt, geoV);
          diffuseColor *= texture2D(map, geoUv);
        #endif`);
  };
  // The map define needs a uv varying in the stock shader; the lookup above does not use it.
  material.customProgramCacheKey = () => 'geographic-moon';
  return material;
}

export const MOON_MAP_URL = 'assets/lroc_color_2k.jpg';

/**
 * Load the global Moon colour map. `toneAt` reads its colour at a texture coordinate, so the detailed
 * patch and its context (which the 5 km/pixel map cannot resolve) take the map's own local tone
 * instead of an unrelated grey.
 */
export function loadMoonMap(onReady: (texture: Texture, toneAt: (u: number, v: number) => Color) => void, onError: () => void): void {
  new TextureLoader().load(
    `${import.meta.env.BASE_URL}${MOON_MAP_URL}`,
    (texture) => {
      texture.colorSpace = SRGBColorSpace;
      texture.wrapS = RepeatWrapping;
      const image = texture.image as HTMLImageElement;
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 128;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context?.drawImage(image, 0, 0, canvas.width, canvas.height);
      const toneAt = (u: number, v: number): Color => {
        const x = Math.min(canvas.width - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * canvas.width)));
        const y = Math.min(canvas.height - 1, Math.max(0, Math.floor((1 - v) * canvas.height)));
        const pixel = context?.getImageData(x, y, 1, 1).data;
        return pixel ? new Color().setRGB(pixel[0]! / 255, pixel[1]! / 255, pixel[2]! / 255, SRGBColorSpace) : new Color(0x8a8a8a);
      };
      onReady(texture, toneAt);
    },
    undefined,
    onError,
  );
}
