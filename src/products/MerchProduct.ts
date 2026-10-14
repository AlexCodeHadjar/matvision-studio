import {
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshPhysicalMaterial,
  TextureLoader,
  RepeatWrapping,
  NoColorSpace,
  type BufferGeometry,
  type Texture,
  type Group,
} from 'three';
import type { ProductDefinition, ProjectState, PrintSide, PrintableArea } from '../contracts';
import { getProduct, productKind, sidePrint, isTextile } from './index';
import { createMugParts, createMugWall } from '../geometry/merch';
import { loadGarment } from '../geometry/garmentAssets';
import { loadCatalogProduct } from '../geometry/catalogAssets';
import { createCatalogFabricMaps } from '../materials/catalogFabric';
import { createJerseyMaps } from '../materials/jersey';
import { markColorTexture } from '../color/ColorPipeline';
import { decodeSource } from '../textures/import';
import { computePrintTransform } from '../print-layout/layout';

type Decoded = Awaited<ReturnType<typeof decodeSource>>;

/** Owned, offline geometry and PBR materials. Model proportions are generic blank approximations. */
export class MerchProduct {
  readonly surfaces: Partial<Record<PrintSide, Mesh>> = {};
  private materials: MeshPhysicalMaterial[] = [];
  private maps: Texture[] = [];
  private canvases: Partial<Record<PrintSide, HTMLCanvasElement>> = {};
  private albedos: Partial<Record<PrintSide, CanvasTexture>> = {};
  private decoded = new Map<string, Promise<Decoded>>();
  private generation = 0;
  private disposed = false;
  private pending: Promise<void> = Promise.resolve();
  private materialReady: Promise<void> = Promise.resolve();

  constructor(
    readonly product: ProductDefinition,
    group: Group,
    private maxTextureSize: number,
    anisotropy: number,
  ) {
    const kind = productKind(product),
      cloth = isTextile(product);
    const material = () => {
      const m = new MeshPhysicalMaterial({
        color: '#ffffff',
        metalness: 0,
        roughness: cloth ? 0.86 : 0.16,
        sheen: cloth ? 0.18 : 0,
        sheenColor: '#deded7',
        sheenRoughness: 0.92,
        clearcoat: cloth ? 0 : 0.28,
        clearcoatRoughness: 0.08,
        ior: cloth ? 1.45 : 1.5,
        specularIntensity: cloth ? 0.3 : 0.8,
      });
      if (cloth) {
        m.userData.scannedCotton = true;
      }
      this.materials.push(m);
      return m;
    };
    const add = (geometry: BufferGeometry, m: MeshPhysicalMaterial, name: string) => {
      const mesh = new Mesh(geometry, m);
      mesh.name = name;
      mesh.castShadow = !name.includes('needle') && !name.includes('inner cotton');
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    const base = material();
    if (kind === 'tshirt') {
      base.userData.colorScale = 0.82;
      this.materialReady = loadGarment(product).then(async (garment) => {
        if (this.disposed) {
          Object.values(garment).forEach((g) => g.dispose());
          return;
        }
        for (const side of ['front', 'back'] as const) {
          const m = material(),
            canvas = document.createElement('canvas');
          canvas.width = 2048;
          canvas.height = 2048;
          const texture = new CanvasTexture(canvas);
          markColorTexture(texture);
          texture.anisotropy = anisotropy;
          this.canvases[side] = canvas;
          this.albedos[side] = texture;
          this.maps.push(texture);
          m.map = texture;
          this.surfaces[side] = add(garment[side], m, `Cotton ${side} / bounded print`);
        }
        add(garment.lining, base, 'Unprinted inner cotton shell / open hem, sleeves and neck');
        const collar = material();
        collar.userData.scannedCotton = false;
        collar.userData.colorScale = 0.96;
        collar.side = DoubleSide;
        const ribs = createJerseyMaps(256, true);
        collar.normalMap = ribs.normal;
        collar.roughnessMap = ribs.roughness;
        this.maps.push(ribs.normal, ribs.roughness);
        collar.normalScale.set(1.8, 0.3);
        collar.normalMap!.repeat.set(64, 2);
        collar.roughnessMap!.repeat.copy(collar.normalMap!.repeat);
        add(garment.collar, collar, 'Continuous rib-knit collar band / open neck');
        add(garment.collarInside, collar, 'Inner folded rib-knit neck band');
        const thread = material();
        thread.userData.scannedCotton = false;
        thread.normalMap = null;
        thread.roughnessMap = null;
        add(garment.hems, thread, 'Folded cuffs, hem and armscye seams');
        add(garment.stitches, thread, 'Double needle stitching');
        await this.loadCottonMaps(anisotropy);
      });
    } else if (cloth) {
      this.materialReady = loadCatalogProduct(product).then(async (parts) => {
        if (this.disposed) {
          Object.values(parts).forEach((g) => g?.dispose());
          return;
        }
        for (const side of ['front', 'back'] as const) {
          const geometry = parts[side];
          if (!geometry) continue;
          if (side === 'back' && !product.backPrintableArea) {
            add(geometry, base, 'Unprinted reverse textile');
            continue;
          }
          const m = material(),
            canvas = document.createElement('canvas');
          canvas.width = 2048;
          canvas.height = 2048;
          const texture = new CanvasTexture(canvas);
          markColorTexture(texture);
          texture.anisotropy = anisotropy;
          this.canvases[side] = canvas;
          this.albedos[side] = texture;
          this.maps.push(texture);
          m.map = texture;
          this.surfaces[side] = add(geometry, m, `Textile ${side} / bounded print`);
        }
        add(parts.details, base, 'Unprinted seams, straps and construction details');
        if (parts.lining) {
          const inner = material();
          inner.userData.colorScale = 0.91;
          add(parts.lining, inner, 'Unprinted inner textile lining');
        }
        if (parts.ribbing) {
          const rib = material();
          rib.userData.scannedCotton = false;
          const maps = createJerseyMaps(128, true);
          rib.normalMap = maps.normal;
          rib.roughnessMap = maps.roughness;
          const traced = ['hoodie', 'sweatshirt', 'longsleeve', 'polo'].includes(kind);
          rib.normalScale.set(traced ? 1.7 : 0.6, traced ? 0.65 : 0.25);
          maps.normal.repeat.set(traced ? 1 : 36, traced ? 1 : 4);
          maps.roughness.repeat.copy(maps.normal.repeat);
          this.maps.push(...Object.values(maps));
          const ribMesh = add(parts.ribbing, rib, 'Unprinted collar and ribbed cuffs');
          // The thin polo collar would cast a hard key-light wedge across the
          // inside back neck; the catalogue photo is lit softly there.
          if (kind === 'polo') ribMesh.castShadow = false;
        }
        if (parts.trim) {
          const tape = material();
          tape.userData.scannedCotton = false;
          tape.userData.fixedColor = true;
          // Polo neck tape is mid grey, hoodie drawcords a light grey tape and
          // the sweatshirt label print dark grey.
          tape.color.set(kind === 'hoodie' ? '#d2d4d7' : kind === 'sweatshirt' ? '#4f5257' : '#80838a');
          tape.side = DoubleSide;
          add(parts.trim, tape, 'Woven tape: neck label or drawcords');
        }
        if (parts.label) {
          const label = material();
          label.userData.scannedCotton = false;
          label.userData.fixedColor = true;
          label.color.set('#3c3f44');
          label.side = DoubleSide;
          add(parts.label, label, 'Dark woven brand label');
        }
        if (['polo', 'cap', 'tote', 'apron'].includes(kind)) {
          const maps = createCatalogFabricMaps(
            kind,
            product.widthMm / 1000,
            product.heightMm / 1000,
          );
          for (const map of Object.values(maps)) map.anisotropy = anisotropy;
          this.maps.push(...Object.values(maps));
          for (const m of this.materials)
            if (m.userData.scannedCotton) {
              m.normalMap = maps.normal;
              m.roughnessMap = maps.roughness;
              // Piqué cells must read at catalogue distance; canvas and twill stay subtle.
              m.normalScale.setScalar(kind === 'polo' ? 1.25 : kind === 'cap' ? 0.9 : 0.8);
            }
        } else await this.loadCottonMaps(anisotropy);
      });
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = 4096;
      canvas.height = 1536;
      const texture = new CanvasTexture(canvas);
      markColorTexture(texture);
      texture.anisotropy = anisotropy;
      this.canvases.front = canvas;
      this.albedos.front = texture;
      this.maps.push(texture);
      const printed = material();
      printed.map = texture;
      this.surfaces.front = add(
        createMugWall(product),
        printed,
        'Sublimation outer wall / handle gap',
      );
      const parts = createMugParts(product);
      add(parts.handle, base, 'Unprinted C handle');
    }
  }
  private async loadCottonMaps(anisotropy: number) {
    const loader = new TextureLoader();
    const maps = await Promise.all(
      ['nor_gl', 'rough', 'ao'].map((name) =>
        loader.loadAsync(`/materials/cotton-jersey/${name}.jpg`),
      ),
    );
    if (this.disposed) {
      maps.forEach((map) => map.dispose());
      return;
    }
    for (const map of maps) {
      map.wrapS = map.wrapT = RepeatWrapping;
      map.colorSpace = NoColorSpace;
      map.anisotropy = anisotropy;
      map.repeat.set(this.product.widthMm / 263.602747, this.product.heightMm / 263.799995);
    }
    this.maps.push(...maps);
    for (const m of this.materials)
      if (m.userData.scannedCotton) {
        const fine = this.product.id.includes('bella');
        m.normalMap = maps[0]!;
        m.roughnessMap = maps[1]!;
        m.aoMap = maps[2]!;
        m.aoMapIntensity = fine ? 0.45 : 0.65;
        m.normalScale.setScalar(fine ? 0.52 : 0.7);
        m.needsUpdate = true;
      }
  }
  sync(state: ProjectState): Promise<void> {
    const generation = ++this.generation;
    const sides: PrintSide[] = this.product.backPrintableArea ? ['front', 'back'] : ['front'];
    const used = new Set<string>();
    for (const side of sides) {
      const src = sidePrint(state, side).source;
      if (src) {
        used.add(src.dataUrl);
        if (!this.decoded.has(src.dataUrl)) {
          const promise = decodeSource(src, this.maxTextureSize, state.quality);
          this.decoded.set(src.dataUrl, promise);
        }
      }
    }
    this.pending = Promise.all(
      sides.map(async (side) => {
        const print = sidePrint(state, side);
        return {
          side,
          print,
          image: print.source ? await this.decoded.get(print.source.dataUrl)! : null,
        };
      }),
    ).then(async (entries) => {
      await this.materialReady;
      if (this.disposed || generation !== this.generation) return;
      for (const entry of entries) {
        const canvas = this.canvases[entry.side]!,
          ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle =
          productKind(this.product) === 'mug' ? '#ffffff' : (state.productColor ?? '#f4f3ee');
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const area =
          entry.side === 'back' ? this.product.backPrintableArea! : this.product.printableArea;
        if (entry.image) {
          const { widthMm, heightMm } = computePrintTransform(
            entry.print.source!,
            area,
            entry.print.layout,
          );
          const sx = canvas.width / this.product.widthMm,
            sy = canvas.height / this.product.heightMm;
          ctx.save();
          ctx.scale(sx, sy);
          ctx.beginPath();
          ctx.rect(area.xMm, area.yMm, area.widthMm, area.heightMm);
          ctx.clip();
          ctx.translate(
            area.xMm + area.widthMm * (0.5 + entry.print.layout.offsetX),
            area.yMm + area.heightMm * (0.5 - entry.print.layout.offsetY),
          );
          ctx.rotate((-entry.print.layout.rotationDeg * Math.PI) / 180);
          ctx.drawImage(
            entry.image.texture.image as CanvasImageSource,
            -widthMm / 2,
            -heightMm / 2,
            widthMm,
            heightMm,
          );
          ctx.restore();
        }
        this.albedos[entry.side]!.needsUpdate = true;
      }
      const cloth = isTextile(this.product);
      for (const m of this.materials) {
        m.roughness = state.roughness;
        m.sheen = cloth ? 0.18 * state.realism.sheen : 0;
        if (!m.map && !m.userData.fixedColor)
          m.color
            .set(cloth ? (state.productColor ?? '#f4f3ee') : '#ffffff')
            .multiplyScalar(m.userData.colorScale ?? 1);
      }
      for (const [key, promise] of this.decoded)
        if (!used.has(key)) {
          this.decoded.delete(key);
          void promise.then(
            (image) => image.dispose(),
            () => {},
          );
        }
    });
    return this.pending;
  }
  ready() {
    return Promise.all([this.pending, this.materialReady]).then(() => {});
  }
  activeSurface(state: ProjectState) {
    return this.surfaces[state.printSide ?? 'front'] ?? this.surfaces.front ?? null;
  }
  printUv(state: ProjectState, u: number, v: number) {
    const p = getProduct(state.productId),
      area: PrintableArea =
        state.printSide === 'back' && p.backPrintableArea ? p.backPrintableArea : p.printableArea;
    return {
      u: (u * p.widthMm - area.xMm) / area.widthMm,
      v: (v * p.heightMm - (p.heightMm - area.yMm - area.heightMm)) / area.heightMm,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    for (const p of this.decoded.values())
      void p.then(
        (image) => image.dispose(),
        () => {},
      );
    this.decoded.clear();
    this.maps.forEach((t) => t.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
