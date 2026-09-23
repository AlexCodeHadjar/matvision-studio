import {
  BufferGeometry,
  Color,
  DataTexture,
  EquirectangularReflectionMapping,
  Float32BufferAttribute,
  FloatType,
  InstancedMesh,
  LinearSRGBColorSpace,
  Matrix3,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  RectAreaLight,
  RGBAFormat,
  Scene,
  Texture,
  type Group,
  type MeshPhysicalMaterial,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import type { ProjectState } from '../contracts';
import { generateStudioRadiance, getEnvironmentSettings } from '../scene/environment';
import { bakePrint, bakeRelief } from './bake';
import { displacePhotoGeometry, readHeightPixels } from './displacement';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export interface PhotoSnapshot {
  scene: Scene;
  camera: PerspectiveCamera;
  textureSize: number;
  stats: {
    triangles: number;
    expandedThreads: number;
    bakedPrint: boolean;
    bakedHeightMaps: number;
    displacedTriangles: number;
  };
  dispose(): void;
}
export function checkpoint(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Фоторендер отменён.', 'AbortError');
}
const yieldUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Expand every sewn loop, preserving its current bend and per-instance shade. */
export async function expandThreads(mesh: InstancedMesh, signal: AbortSignal) {
  const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  try {
    const count = source.getAttribute('position').count;
    const positions = new Float32Array(count * mesh.count * 3),
      normals = new Float32Array(positions.length),
      uv = new Float32Array(count * mesh.count * 2),
      colors = new Float32Array(count * mesh.count * 4);
    const matrix = new Matrix4(),
      normalMatrix = new Matrix3(),
      shade = new Color();
    const p = source.getAttribute('position'),
      n = source.getAttribute('normal'),
      tex = source.getAttribute('uv');
    for (let i = 0; i < mesh.count; i++) {
      if (i % 64 === 0) {
        checkpoint(signal);
        await yieldUI();
      }
      mesh.getMatrixAt(i, matrix);
      matrix.premultiply(mesh.matrixWorld);
      normalMatrix.getNormalMatrix(matrix);
      if (mesh.instanceColor) mesh.getColorAt(i, shade);
      else shade.setRGB(1, 1, 1);
      const e = matrix.elements,
        ne = normalMatrix.elements;
      for (let j = 0; j < count; j++) {
        const v = i * count + j,
          a = v * 3,
          b = v * 2,
          x = p.getX(j),
          y = p.getY(j),
          z = p.getZ(j);
        positions[a] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
        positions[a + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
        positions[a + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
        const nx = n.getX(j),
          ny = n.getY(j),
          nz = n.getZ(j);
        const xx = ne[0]! * nx + ne[3]! * ny + ne[6]! * nz,
          yy = ne[1]! * nx + ne[4]! * ny + ne[7]! * nz,
          zz = ne[2]! * nx + ne[5]! * ny + ne[8]! * nz,
          length = Math.hypot(xx, yy, zz);
        normals[a] = xx / length;
        normals[a + 1] = yy / length;
        normals[a + 2] = zz / length;
        uv[b] = tex.getX(j);
        uv[b + 1] = tex.getY(j);
        // Match the tracer's generated RGBA attributes; avoid upstream #785's
        // mixed RGB/RGBA merge path, which zeros the thread colours in 0.0.24.
        colors[v * 4] = shade.r;
        colors[v * 4 + 1] = shade.g;
        colors[v * 4 + 2] = shade.b;
        colors[v * 4 + 3] = 1;
      }
    }
    const result = new BufferGeometry();
    result.setAttribute('position', new Float32BufferAttribute(positions, 3));
    result.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    result.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    result.setAttribute('color', new Float32BufferAttribute(colors, 4));
    return result;
  } finally {
    source.dispose();
  }
}

export async function createPhotoSnapshot(input: {
  renderer: WebGLRenderer;
  mat: Group;
  floor: Mesh;
  camera: PerspectiveCamera;
  state: ProjectState;
  fabric: MeshPhysicalMaterial;
  widthMm: number;
  heightMm: number;
  textureSize: number;
  signal: AbortSignal;
  lighting?: 'studio' | 'hdri';
  displacementMm?: number;
}): Promise<PhotoSnapshot> {
  const { renderer, mat, floor, state, signal, textureSize } = input;
  const scene = new Scene(),
    camera = input.camera.clone();
  const geometries: BufferGeometry[] = [],
    materials: MeshStandardMaterial[] = [],
    textures: Texture[] = [];
  const stats = {
    triangles: 0,
    expandedThreads: 0,
    bakedPrint: false,
    bakedHeightMaps: 0,
    displacedTriangles: 0,
  };
  let disposed = false;
  const snapshot: PhotoSnapshot = {
    scene,
    camera,
    textureSize,
    stats,
    dispose() {
      if (disposed) return;
      disposed = true;
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      scene.clear();
    },
  };
  try {
    checkpoint(signal);
    mat.updateMatrixWorld(true);
    floor.updateMatrixWorld(true);
    const materialCache = new Map<MeshStandardMaterial, MeshStandardMaterial>();
    const cloneMaterial = (original: MeshStandardMaterial) => {
      const cached = materialCache.get(original);
      if (cached) return cached;
      const material = original.clone();
      materials.push(material);
      materialCache.set(original, material);
      for (const key of ['map', 'normalMap', 'roughnessMap', 'bumpMap'] as const) {
        if (material[key]) {
          material[key] = material[key]!.clone();
          textures.push(material[key]!);
        }
      }
      if (original === input.fabric) {
        const aspect = input.widthMm / input.heightMm;
        const baked = bakePrint(
          renderer,
          input.fabric,
          Math.round(textureSize * Math.min(1, aspect)),
          Math.round(textureSize / Math.max(1, aspect)),
        );
        textures.push(baked);
        material.map = baked;
        stats.bakedPrint = true;
      }
      if (material.bumpMap && material.normalMap) {
        const relief = bakeRelief(renderer, material, input.widthMm, input.heightMm, textureSize);
        textures.push(relief);
        material.normalMap = relief;
        material.normalScale.set(1, 1);
        material.bumpMap = null;
        stats.bakedHeightMaps++;
      }
      return material;
    };
    for (const object of [...mat.children, ...(floor.visible ? [floor] : [])]) {
      checkpoint(signal);
      if (!(object instanceof Mesh) || (!object.visible && !(object instanceof InstancedMesh)))
        continue;
      if (!(object.material instanceof MeshStandardMaterial))
        throw new Error('Материал не поддерживается фоторежимом.');
      let geometry: BufferGeometry;
      if (object instanceof InstancedMesh) {
        geometry = await expandThreads(object, signal);
        stats.expandedThreads += object.count;
      } else {
        geometry = object.geometry.clone();
        geometry.applyMatrix4(object.matrixWorld);
      }
      if (object.material === input.fabric && input.displacementMm) {
        const heightMap = input.fabric.bumpMap;
        if (!heightMap) {
          geometry.dispose();
          throw new Error('Для геометрического рельефа нужна карта высоты ткани.');
        }
        try {
          const displaced = await displacePhotoGeometry(
            geometry,
            readHeightPixels(heightMap),
            input.displacementMm,
            signal,
          );
          geometry.dispose();
          geometry = displaced;
          stats.displacedTriangles = geometry.getAttribute('position').count / 3;
        } catch (error) {
          geometry.dispose();
          throw error;
        }
      }
      geometries.push(geometry);
      const material = cloneMaterial(object.material);
      if (object instanceof InstancedMesh) material.vertexColors = true;
      scene.add(new Mesh(geometry, material));
      stats.triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
    }
    const env = getEnvironmentSettings(state.environment);
    let radiance = {
      data: generateStudioRadiance(2048, 1024, state.environment),
      width: 2048,
      height: 1024,
    };
    if (input.lighting === 'hdri') {
      const response = await fetch('/environments/studio_small_09_2k.hdr', { signal });
      if (!response.ok) throw new Error('Не найдена встроенная HDR-панорама.');
      const parsed = new HDRLoader().setDataType(FloatType).parse(await response.arrayBuffer());
      if (!parsed.width || !parsed.height || !parsed.data)
        throw new Error('Повреждена HDR-панорама.');
      radiance = { data: parsed.data as Float32Array, width: parsed.width, height: parsed.height };
    }
    const hdr = new DataTexture(
      radiance.data,
      radiance.width,
      radiance.height,
      RGBAFormat,
      FloatType,
    );
    hdr.mapping = EquirectangularReflectionMapping;
    hdr.colorSpace = LinearSRGBColorSpace;
    hdr.needsUpdate = true;
    textures.push(hdr);
    scene.environment = hdr;
    scene.environmentIntensity = input.lighting === 'hdri' ? 1 : env.environmentIntensity;
    scene.background = new Color(env.backgroundColor);
    const key = new RectAreaLight(env.keyColor, env.keyIntensity * 6, 0.9, 0.65);
    key.position.fromArray(env.keyPosition);
    key.lookAt(0, 0, 0);
    if (input.lighting !== 'hdri') scene.add(key);
    if (!floor.visible) {
      const fill = new RectAreaLight('#f0f2ed', 8, 0.6, 0.5);
      fill.position.set(-0.7, -0.9, 0.6);
      fill.lookAt(0, 0, 0);
      scene.add(fill);
    }
    checkpoint(signal);
    return snapshot;
  } catch (error) {
    snapshot.dispose();
    throw error;
  }
}
