import type { MaterialAssets } from '../contracts';
import { importImageFile } from '../textures/import';

/** Local CC0 assets. Only surface structure is used, so the user's print stays uncoloured. */
export async function loadLibraryFabric(): Promise<MaterialAssets> {
  const maps: MaterialAssets['maps'] = {};
  for (const [kind, filename] of [
    ['normal', 'fabric_pattern_07_nor_gl_2k.png'],
    ['roughness', 'fabric_pattern_07_rough_2k.png'],
  ] as const) {
    const response = await fetch(`/materials/polyhaven/${filename}`);
    if (!response.ok) throw new Error('Встроенный материал не найден. Переустановите программу.');
    maps[kind] = await importImageFile(
      new File([await response.blob()], filename, { type: 'image/png' }),
    );
  }
  return { tileMm: 300, normalY: 'opengl', maps };
}
