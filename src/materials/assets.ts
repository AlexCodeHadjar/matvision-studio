import { NoColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import type { MaterialAssets, MaterialMapKind, MaterialTarget, ProjectState } from '../contracts';
import { validateMaterialAssets } from '../project';
import { decodeSource, type DecodedPrint } from '../textures/import';

export type MaterialTextures = Partial<Record<MaterialMapKind, Texture>>;
export interface DecodedMaterials {
  textures: Record<MaterialTarget, MaterialTextures>;
  approximateBytes: number;
  dispose(): void;
}

/** Decode sequentially to bound temporary memory; nothing is committed on partial failure. */
export async function decodeMaterials(
  materials: ProjectState['materials'],
  maxTextureSize: number,
  anisotropy: number,
): Promise<DecodedMaterials> {
  const owned: DecodedPrint[] = [];
  const textures: DecodedMaterials['textures'] = { fabric: {}, rubber: {} };
  let approximateBytes = 0;
  try {
    for (const target of ['fabric', 'rubber'] as const) {
      const assets = validateMaterialAssets(materials[target]);
      for (const kind of ['color', 'normal', 'roughness', 'height'] as const) {
        const source = assets.maps[kind];
        if (!source) continue;
        const decoded = await decodeSource(source, Math.min(2048, maxTextureSize), 'high');
        owned.push(decoded);
        const texture = decoded.texture;
        texture.colorSpace = kind === 'color' ? SRGBColorSpace : NoColorSpace;
        texture.wrapS = texture.wrapT = RepeatWrapping;
        texture.anisotropy = anisotropy;
        texture.name = `${target}-${kind}`;
        textures[target][kind] = texture;
        approximateBytes += Math.ceil((decoded.widthPx * decoded.heightPx * 4 * 4) / 3);
      }
    }
  } catch (error) {
    owned.forEach((map) => map.dispose());
    throw error;
  }
  let disposed = false;
  return {
    textures,
    approximateBytes,
    dispose() {
      if (disposed) return;
      disposed = true;
      owned.forEach((map) => map.dispose());
    },
  };
}

export function tileTextures(
  textures: MaterialTextures,
  assets: MaterialAssets,
  widthMm: number,
  heightMm: number,
  xMm = 0,
  yMm = 0,
) {
  for (const texture of Object.values(textures)) {
    texture.repeat.set(widthMm / assets.tileMm, heightMm / assets.tileMm);
    texture.offset.set(xMm / assets.tileMm, yMm / assets.tileMm);
    texture.updateMatrix();
  }
}
