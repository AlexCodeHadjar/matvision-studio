import { useEffect, useRef, useState } from 'react';
import type { PreviewResolution, PrintLayout, ProjectState } from '../contracts';
import { StudioScene } from '../scene/StudioScene';

export function Viewport({
  state,
  onScene,
  onImage,
  onLayout,
  onPreview,
  editPrint,
  softboxLighting,
  onSoftboxUnsupported,
}: {
  state: ProjectState;
  onScene: (scene: StudioScene | null) => void;
  onImage: (file: File) => void;
  onLayout: (layout: PrintLayout) => void;
  onPreview: (resolution: PreviewResolution) => void;
  editPrint: boolean;
  softboxLighting: boolean;
  onSoftboxUnsupported: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const studio = useRef<StudioScene | null>(null);
  const initialState = useRef(state);
  const [error, setError] = useState('');
  const [diagnostics, setDiagnostics] = useState<ReturnType<StudioScene['getDiagnostics']> | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  useEffect(() => {
    if (!host.current) return;
    let scene: StudioScene;
    try {
      scene = new StudioScene(host.current, initialState.current, setError, onLayout);
      studio.current = scene;
      onScene(scene);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось запустить 3D-сцену.');
      return;
    }
    const interval = window.setInterval(() => {
      const current = scene.getDiagnostics();
      setDiagnostics(current);
      onPreview({ widthPx: current.previewWidthPx, heightPx: current.previewHeightPx });
    }, 250);
    return () => {
      window.clearInterval(interval);
      scene.dispose();
      studio.current = null;
      onScene(null);
    };
  }, [onScene, onLayout, onPreview]);
  useEffect(() => {
    studio.current?.update(state);
  }, [state]);
  useEffect(() => {
    studio.current?.setEditPrint(editPrint);
  }, [editPrint]);
  useEffect(() => {
    if (softboxLighting && studio.current && !studio.current.setSoftboxLighting(true)) {
      setError(
        'Мягкий студийный свет недоступен на этой видеокарте. Используется прежнее освещение.',
      );
      onSoftboxUnsupported();
    } else if (!softboxLighting) studio.current?.setSoftboxLighting(false);
  }, [softboxLighting]);
  return (
    <section
      className={`viewport-wrap ${editPrint ? 'editing-print' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('Files')) {
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) onImage(file);
      }}
    >
      <div className="viewport" data-testid="viewport" ref={host} />
      <div className="viewport-label">
        <span className="status-dot" /> STUDIO PREVIEW{' '}
        <span className="label-muted">/ {state.environment.replaceAll('-', ' ')}</span>
      </div>
      <div className="viewport-hint">
        {editPrint
          ? 'Двигайте рисунок по коврику · Ctrl + колесо — масштаб принта · E — камера'
          : 'Drag — вращать · Колесо — приблизить · Правая кнопка — сдвинуть · E — редактировать принт'}
      </div>
      {dragging && (
        <div className="drop-overlay">
          <span>↓</span>
          <strong>
            Отпустите изображение,
            <br />
            чтобы применить его к коврику
          </strong>
          <small>PNG · JPEG · WebP</small>
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {import.meta.env.DEV && diagnostics && (
        <details className="debug-overlay">
          <summary>Performance · {Math.round(diagnostics.fps)} FPS</summary>
          <pre>{`${diagnostics.frameTimeMs.toFixed(1)} ms / frame\n${diagnostics.drawCalls} draw calls · ${diagnostics.triangles.toLocaleString()} triangles\n${diagnostics.textures} textures · ≈ ${(diagnostics.approximateTextureBytes / 1048576).toFixed(1)} MiB\n${diagnostics.rendererWidthPx} × ${diagnostics.rendererHeightPx} px`}</pre>
        </details>
      )}
      <output data-testid="scene-diagnostics" hidden>
        {JSON.stringify(diagnostics ?? {})}
      </output>
    </section>
  );
}
