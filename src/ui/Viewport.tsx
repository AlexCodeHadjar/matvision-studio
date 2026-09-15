import { useEffect, useRef, useState } from 'react';
import type { ProjectState } from '../contracts';
import { StudioScene } from '../scene/StudioScene';

export function Viewport({
  state,
  onScene,
}: {
  state: ProjectState;
  onScene: (scene: StudioScene | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const studio = useRef<StudioScene | null>(null);
  const initialState = useRef(state);
  const [error, setError] = useState('');
  const [diagnostics, setDiagnostics] = useState('{}');
  useEffect(() => {
    if (!host.current) return;
    let scene: StudioScene;
    try {
      scene = new StudioScene(host.current, initialState.current, setError);
      studio.current = scene;
      onScene(scene);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось запустить 3D-сцену.');
      return;
    }
    const interval = window.setInterval(
      () => setDiagnostics(JSON.stringify(scene.getDiagnostics())),
      250,
    );
    return () => {
      window.clearInterval(interval);
      scene.dispose();
      studio.current = null;
      onScene(null);
    };
  }, [onScene]);
  useEffect(() => {
    studio.current?.update(state);
  }, [state]);
  return (
    <section className="viewport-wrap">
      <div className="viewport" data-testid="viewport" ref={host} />
      <div className="viewport-label">
        <span className="status-dot" /> STUDIO PREVIEW{' '}
        <span className="label-muted">/ Neutral Studio</span>
      </div>
      <div className="viewport-hint">
        Перетащите мышь, чтобы вращать · Колесо — приблизить · Правая кнопка — сдвинуть
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <output data-testid="scene-diagnostics" hidden>
        {diagnostics}
      </output>
    </section>
  );
}
