import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CameraPreset,
  PreviewResolution,
  PrintLayout,
  PrintSource,
  ProjectState,
  MaterialTarget,
  MaterialMapKind,
} from '../contracts';
import { PRODUCTS, getProduct } from '../products';
import { log, logError } from '../app/log';
import {
  createDefaultLayout,
  createDefaultProject,
  parseProject,
  serializeProject,
  MAX_MATERIAL_BYTES,
  validateMaterialAssets,
} from '../project';
import { importImageFile } from '../textures/import';
import { computeEffectiveDpi } from '../print-layout/layout';
import {
  isTauri,
  openNativeImage,
  openNativeProject,
  saveNativeProject,
  saveNativePng,
} from '../native';
import type { StudioScene } from '../scene/StudioScene';
import { Viewport } from './Viewport';
import { RollControls } from './RollControls';
import { RealismControls } from './RealismControls';
import { PhotoDialog } from './PhotoDialog';
import { loadLibraryFabric } from '../materials/library';
import { Help, MaterialControls, PrintControls, Settings, Slider } from './Controls';
import './styles.css';

const cameras: [CameraPreset, string][] = [
  ['perspective', 'Перспектива'],
  ['top', 'Сверху'],
  ['low-angle', 'Низкий угол'],
  ['close-up', 'Крупный план'],
  ['macro', 'Макро ткани'],
  ['underside', 'Снизу'],
];
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export function App() {
  const [state, setState] = useState(createDefaultProject);
  const [activeCamera, setActiveCamera] = useState<CameraPreset>('perspective');
  const [preview, setPreview] = useState<PreviewResolution | null>(null);
  const [editPrint, setEditPrint] = useState(false);
  const [hiddenUI, setHiddenUI] = useState(false);
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [busy, setBusyState] = useState('');
  const busyRef = useRef('');
  const setBusy = (message: string) => {
    busyRef.current = message;
    setBusyState(message);
  };
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [exportPreset, setExportPreset] = useState<'screen' | 'high'>('screen');
  const projectPath = useRef<string | undefined>(undefined);
  const scene = useRef<StudioScene | null>(null);
  const imageInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null);
  const sourceRequest = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const product = getProduct(state.productId);
  const onScene = useCallback((value: StudioScene | null) => {
    scene.current = value;
  }, []);
  const onPlayShowcase = useCallback((animation: Parameters<StudioScene['playShowcase']>[0]) => {
    setEditPrint(false);
    scene.current?.playShowcase(animation);
  }, []);
  const onStopShowcase = useCallback(() => scene.current?.stopShowcase(), []);
  const onLayout = useCallback((layout: PrintLayout) => setState((s) => ({ ...s, layout })), []);
  const onPreview = useCallback(
    (resolution: PreviewResolution) =>
      setPreview((previous) =>
        previous?.widthPx === resolution.widthPx && previous.heightPx === resolution.heightPx
          ? previous
          : resolution,
      ),
    [],
  );
  const patch = (value: Partial<ProjectState>) => setState((s) => ({ ...s, ...value }));
  const beginSourceRequest = () => {
    // Supersede the renderer decode before file validation, which itself may fail.
    scene.current?.cancelPendingPrint();
    return ++sourceRequest.current;
  };
  const fail = (e: unknown) => {
    logError('APP', 'operation-failed', e);
    setNotice({ text: e instanceof Error ? e.message : String(e), error: true });
  };
  const preset = (value: CameraPreset) => {
    scene.current?.setCameraPreset(value);
    setActiveCamera(value);
  };

  const applySource = async (source: PrintSource, request: number) => {
    if (request !== sourceRequest.current) return;
    const controller = scene.current;
    if (!controller) throw new Error('3D-сцена ещё не готова.');
    const resolution = await controller.setPrintSource(source);
    if (request !== sourceRequest.current) return;
    setPreview(resolution);
    setState((s) => ({ ...s, source, layout: createDefaultLayout() }));
    setNotice({
      text: `Изображение применено: ${source.widthPx} × ${source.heightPx} px`,
      error: false,
    });
  };
  const importFile = async (file: File) => {
    if (
      busyRef.current &&
      busyRef.current !== 'Подготовка изображения…' &&
      busyRef.current !== 'Открытие изображения…'
    ) {
      setNotice({
        text: 'Дождитесь завершения текущей операции и повторите загрузку изображения.',
        error: true,
      });
      return;
    }
    const request = beginSourceRequest();
    setBusy('Подготовка изображения…');
    setNotice(null);
    try {
      await applySource(await importImageFile(file), request);
    } catch (e) {
      if (request === sourceRequest.current) fail(e);
    } finally {
      if (request === sourceRequest.current) setBusy('');
    }
  };
  const openImage = async () => {
    if (busyRef.current) return;
    if (!isTauri()) {
      imageInput.current?.click();
      return;
    }
    const request = beginSourceRequest();
    setBusy('Открытие изображения…');
    setNotice(null);
    try {
      const source = await openNativeImage();
      if (source) await applySource(source, request);
    } catch (e) {
      if (request === sourceRequest.current) fail(e);
    } finally {
      if (request === sourceRequest.current) setBusy('');
    }
  };
  const restoreProject = async (contents: string, request: number) => {
    if (request !== sourceRequest.current) return;
    const restored = parseProject(contents);
    const controller = scene.current;
    if (!controller) throw new Error('3D-сцена ещё не готова.');
    const resolution = await controller.loadProject(restored);
    if (request !== sourceRequest.current || resolution === undefined) return;
    setState(restored);
    setPreview(resolution);
    setActiveCamera(restored.camera.preset);
    setEditPrint(false);
    log('PROJECT', 'restored', { productId: restored.productId, embeddedImage: !!restored.source });
    projectPath.current = undefined;
    setNotice({ text: 'Проект восстановлен вместе с принтом и материалами.', error: false });
  };
  const changeMaterialMap = async (
    target: MaterialTarget,
    kind: MaterialMapKind,
    remove: boolean,
    file?: File,
  ) => {
    if (busyRef.current) return;
    const controller = scene.current;
    if (!controller) return;
    setBusy('Подготовка материала…');
    setNotice(null);
    try {
      if (file && file.size > MAX_MATERIAL_BYTES)
        throw new Error('Карта материала превышает 8 МиБ.');
      const source = remove ? null : file ? await importImageFile(file) : await openNativeImage();
      if (!remove && !source) return;
      const current = stateRef.current;
      const maps = { ...current.materials[target].maps };
      if (source) maps[kind] = source;
      else delete maps[kind];
      const materials = {
        ...current.materials,
        [target]: validateMaterialAssets({ ...current.materials[target], maps }),
      };
      if (!(await controller.setMaterialAssets(materials))) return;
      setState((s) => ({ ...s, materials }));
      controller.update({ ...stateRef.current, materials });
      setNotice({
        text: remove
          ? 'Карта удалена. Восстановлена встроенная поверхность.'
          : `Материал применён: ${source!.name}`,
        error: false,
      });
    } catch (error) {
      fail(error);
    } finally {
      setBusy('');
    }
  };
  const applyLibraryFabric = async () => {
    if (busyRef.current || !scene.current) return;
    setBusy('Подготовка ткани Poly Haven…');
    try {
      const fabric = await loadLibraryFabric();
      const materials = { ...stateRef.current.materials, fabric };
      if (!(await scene.current.setMaterialAssets(materials))) return;
      setState((s) => ({ ...s, materials }));
      scene.current.update({ ...stateRef.current, materials });
      setNotice({
        text: 'Ткань Poly Haven применена. Карты будут сохранены внутри проекта.',
        error: false,
      });
    } catch (error) {
      fail(error);
    } finally {
      setBusy('');
    }
  };
  const openProject = async () => {
    if (busyRef.current) return;
    if (!isTauri()) {
      projectInput.current?.click();
      return;
    }
    const request = beginSourceRequest();
    setBusy('Открытие проекта…');
    setNotice(null);
    try {
      const contents = await openNativeProject();
      if (contents !== null) await restoreProject(contents, request);
    } catch (e) {
      if (request === sourceRequest.current) fail(e);
    } finally {
      if (request === sourceRequest.current) setBusy('');
    }
  };
  const importProjectFile = async (file: File) => {
    if (busyRef.current) return;
    const request = beginSourceRequest();
    setBusy('Открытие проекта…');
    setNotice(null);
    try {
      await restoreProject(await file.text(), request);
    } catch (e) {
      if (request === sourceRequest.current) fail(e);
    } finally {
      if (request === sourceRequest.current) setBusy('');
    }
  };
  const saveProject = async () => {
    if (busyRef.current) return;
    setBusy('Сохранение проекта…');
    setNotice(null);
    try {
      const current = stateRef.current;
      const contents = serializeProject({
        ...current,
        camera: scene.current?.getCameraState() ?? current.camera,
      });
      if (isTauri()) {
        const path = await saveNativeProject(contents, projectPath.current);
        if (path === null) return;
        projectPath.current = path;
      } else download(new Blob([contents], { type: 'application/json' }), 'MatVision.matvision');
      log('PROJECT', 'saved', { embeddedImage: !!current.source });
      setNotice({ text: 'Проект сохранён. Исходное изображение включено в файл.', error: false });
    } catch (e) {
      logError('PROJECT', 'save-failed', e);
      fail(e);
    } finally {
      setBusy('');
    }
  };
  const exportPreview = async () => {
    if (busyRef.current) return;
    const controller = scene.current;
    if (!controller) {
      fail(new Error('3D-сцена ещё не готова к экспорту.'));
      return;
    }
    setBusy('Рендер PNG…');
    setNotice(null);
    try {
      const d = controller.getDiagnostics();
      const scale =
        exportPreset === 'high' ? 3840 / Math.max(d.rendererWidthPx, d.rendererHeightPx) : 1;
      const blob = await controller.exportPng({
        widthPx: Math.max(1, Math.round(d.rendererWidthPx * scale)),
        heightPx: Math.max(1, Math.round(d.rendererHeightPx * scale)),
      });
      if (isTauri()) {
        const path = await saveNativePng(new Uint8Array(await blob.arrayBuffer()));
        if (path === null) return;
      } else download(blob, 'MatVision-preview.png');
      setNotice({ text: 'PNG сохранён без элементов интерфейса.', error: false });
    } catch (e) {
      logError('EXPORT', 'export-failed', e);
      fail(e);
    } finally {
      setBusy('');
    }
  };
  const actionRef = useRef({ openImage, openProject, saveProject, exportPreview, preset });
  actionRef.current = { openImage, openProject, saveProject, exportPreview, preset };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      if (e.key === 'Escape') {
        setHelp(false);
        setSettings(false);
        setEditPrint(false);
        return;
      }
      const target = e.target;
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'o':
            e.preventDefault();
            void (e.shiftKey ? actionRef.current.openProject() : actionRef.current.openImage());
            break;
          case 's':
            e.preventDefault();
            void actionRef.current.saveProject();
            break;
          case 'e':
            e.preventDefault();
            void actionRef.current.exportPreview();
            break;
        }
        return;
      }
      if (e.key === 'F1') {
        e.preventDefault();
        setSettings(false);
        setHelp((v) => !v);
        return;
      }
      if (
        e.altKey ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            (target instanceof HTMLInputElement &&
              !['range', 'checkbox', 'button'].includes(target.type))))
      )
        return;
      switch (e.key.toLowerCase()) {
        case 'r':
          actionRef.current.preset('perspective');
          break;
        case '1':
          actionRef.current.preset('top');
          break;
        case '2':
          actionRef.current.preset('perspective');
          break;
        case 'e':
          setEditPrint((v) => !v);
          break;
        case 'h':
          setHiddenUI((v) => !v);
          break;
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const dpi = state.source
    ? computeEffectiveDpi(state.source, product.printableArea, state.layout)
    : null;
  return (
    <div className={`app-shell ${hiddenUI ? 'ui-hidden' : ''}`}>
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div>
            MatVision <strong>Studio</strong>
            <small>YOUR PRINT. IN PERSPECTIVE.</small>
          </div>
        </div>
        <label className="product-select">
          <span>ПРОДУКТ</span>
          <select
            aria-label="Продукт"
            value={state.productId}
            onChange={(e) => {
              const p = getProduct(e.target.value);
              setState((s) => ({
                ...s,
                productId: p.id,
                thicknessMm: p.thicknessMm,
                camera: { ...p.defaultCameraFraming, preset: 'perspective' },
              }));
              setActiveCamera('perspective');
            }}
          >
            {PRODUCTS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName} · {p.widthMm} × {p.heightMm} мм
              </option>
            ))}
          </select>
        </label>
        <div className="toolbar-actions">
          <button
            className="primary-action"
            disabled={!!busy}
            onClick={() => void openImage()}
            title="Ctrl+O"
          >
            ＋ Изображение
          </button>
          <button
            onClick={() => preset('perspective')}
            title="R — сбросить камеру"
            aria-label="Сбросить камеру"
          >
            ↺
          </button>
          <button
            disabled={!!busy}
            onClick={() => void openProject()}
            title="Ctrl+Shift+O"
            aria-label="Открыть проект"
          >
            ▱
          </button>
          <button disabled={!!busy} onClick={() => void saveProject()} title="Ctrl+S">
            Сохранить проект
          </button>
          <button disabled={!!busy} onClick={() => void exportPreview()} title="Ctrl+E">
            Экспорт PNG
          </button>
          <button disabled={!!busy} onClick={() => setPhoto(true)}>
            Фото
          </button>
          <button
            onClick={() => {
              setHelp(false);
              setSettings(true);
            }}
            aria-label="Настройки"
            title="Настройки качества и профиля материала"
          >
            ⚙
          </button>
          <button
            onClick={() => {
              setSettings(false);
              setHelp(true);
            }}
            aria-label="Справка"
            title="F1"
          >
            ?
          </button>
        </div>
      </header>
      <main className="workspace">
        <Viewport
          state={state}
          onScene={onScene}
          onImage={(file) => void importFile(file)}
          onLayout={onLayout}
          onPreview={onPreview}
          editPrint={editPrint}
        />
        <aside className="inspector">
          <div className="inspector-title">
            <span className="eyebrow">ВАШ ПРИНТ В РЕАЛЬНОМ МАСШТАБЕ</span>
            <h1>{product.displayName}</h1>
            <p>
              {product.widthMm} × {product.heightMm} мм · {state.thicknessMm} мм
            </p>
          </div>
          <div className="source-card" data-testid="source-info">
            {state.source ? (
              <>
                <strong title={state.source.name}>{state.source.name}</strong>
                <span>
                  Источник: {state.source.widthPx} × {state.source.heightPx} px
                </span>
                <span>
                  GPU preview: {preview ? `${preview.widthPx} × ${preview.heightPx}` : '…'} px
                </span>
                <div
                  className={`quality-indicator quality-${dpi!.quality.toLowerCase().replaceAll(' ', '-')}`}
                  data-testid="print-quality"
                >
                  {dpi!.quality} <b>≈ {Math.round(dpi!.minimum)} DPI</b>
                </div>
              </>
            ) : (
              <>
                <strong>Ваш рисунок начинается здесь</strong>
                <span>
                  Перетащите PNG / JPEG / WebP
                  <br />
                  на коврик или откройте файл.
                </span>
              </>
            )}
          </div>
          <PrintControls
            layout={state.layout}
            edit={editPrint}
            onEdit={() => setEditPrint((v) => !v)}
            onChange={onLayout}
            onReset={() => onLayout(createDefaultLayout())}
          />
          <MaterialControls state={state} onChange={patch} />
          <RealismControls
            onLibrary={() => void applyLibraryFabric()}
            state={state}
            busy={!!busy}
            onChange={patch}
            onImport={(target, kind, file) => void changeMaterialMap(target, kind, false, file)}
            onRemove={(target, kind) => void changeMaterialMap(target, kind, true)}
          />
          <section className="control-section">
            <h2>
              <span>04</span> Продукт
            </h2>
            <Slider
              label="Толщина"
              min={1}
              max={6}
              step={0.5}
              value={state.thicknessMm}
              suffix=" мм"
              onChange={(thicknessMm) => patch({ thicknessMm })}
            />
            <label className="field-label">
              Край
              <select
                aria-label="Край"
                value={state.edgePreset}
                onChange={(e) =>
                  patch({ edgePreset: e.target.value as ProjectState['edgePreset'] })
                }
              >
                <option value="standard-cut">Standard Cut</option>
                <option value="stitched">Stitched Edge</option>
              </select>
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={state.referenceMode}
                onChange={(e) => patch({ referenceMode: e.target.checked })}
              />
              Линейка · реальный масштаб
            </label>
          </section>
          <RollControls
            value={state.rollAmount}
            onChange={(rollAmount) => {
              setEditPrint(false);
              patch({ rollAmount });
            }}
            disabled={!!busy}
            resetKey={state.productId}
            onPlayShowcase={onPlayShowcase}
            onStopShowcase={onStopShowcase}
          />
          <section className="control-section">
            <h2>
              <span>06</span> Камера
            </h2>
            <div className="camera-buttons">
              {cameras.map(([id, label]) => (
                <button
                  key={id}
                  className={activeCamera === id ? 'selected' : ''}
                  aria-pressed={activeCamera === id}
                  onClick={() => preset(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={state.turntable}
                onChange={(e) => patch({ turntable: e.target.checked })}
              />
              Turntable · вращать коврик
            </label>
            <button
              className="text-button"
              onClick={() => setHiddenUI(true)}
              title="H — скрыть или вернуть интерфейс"
            >
              Скрыть интерфейс
            </button>
          </section>
          <section className="control-section">
            <h2>
              <span>07</span> Экспорт
            </h2>
            <label className="field-label">
              Разрешение PNG
              <select
                aria-label="Разрешение PNG"
                value={exportPreset}
                onChange={(e) => setExportPreset(e.target.value as 'screen' | 'high')}
              >
                <option value="screen">Screen · текущий viewport</option>
                <option value="high">High Resolution · 3840 px</option>
              </select>
            </label>
          </section>
          <div className="studio-footer">
            <span className="status-dot" />
            Локальная студия<span>1:1 SCALE</span>
          </div>
        </aside>
      </main>
      <footer className="statusbar">
        <span role="status">
          {busy ||
            notice?.text ||
            `${product.displayName} / ${product.widthMm} × ${product.heightMm} × ${state.thicknessMm} мм`}
        </span>
        <span>Studio Preview · sRGB · WebGL2</span>
      </footer>
      {hiddenUI && (
        <button className="restore-ui" onClick={() => setHiddenUI(false)} title="H">
          Показать интерфейс
        </button>
      )}
      {busy && (
        <div className="busy-indicator" role="status">
          {busy}
        </div>
      )}
      {notice?.error && (
        <div className="notice-error" role="alert">
          {notice.text}
          <button aria-label="Закрыть сообщение" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}
      {settings && <Settings state={state} onChange={patch} onClose={() => setSettings(false)} />}
      {help && <Help onClose={() => setHelp(false)} />}
      {photo && scene.current && (
        <PhotoDialog scene={scene.current} onClose={() => setPhoto(false)} />
      )}
      <input
        data-testid="image-input"
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
          e.target.value = '';
        }}
      />
      <input
        data-testid="project-input"
        ref={projectInput}
        type="file"
        accept=".matvision,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importProjectFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
