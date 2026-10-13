import { useEffect, useRef, useState } from 'react';
import type { StudioScene } from '../scene/StudioScene';
import type { PhotoRenderer } from '../photo/PhotoRenderer';
import type { PhotoSnapshot } from '../photo/snapshot';
import { isTauri, saveNativePng } from '../native';
import { Modal } from './Modal';

interface Job {
  abort: AbortController;
  frame: number;
  engine?: PhotoRenderer;
  snapshot?: PhotoSnapshot;
  resume: () => void;
}
export function PhotoDialog({ scene, onClose }: { scene: StudioScene; onClose: () => void }) {
  const [size, setSize] = useState(1920),
    [target, setTarget] = useState(512);
  const [lighting, setLighting] = useState<'studio' | 'hdri'>('hdri');
  const [phase, setPhase] = useState<
    'idle' | 'preparing' | 'rendering' | 'paused' | 'done' | 'error'
  >('idle');
  const [samples, setSamples] = useState(0),
    [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const host = useRef<HTMLDivElement>(null),
    job = useRef<Job | null>(null);
  const clear = () => {
    const current = job.current;
    job.current = null;
    if (!current) return;
    current.abort.abort();
    cancelAnimationFrame(current.frame);
    current.engine?.dispose();
    current.snapshot?.dispose();
    current.resume();
  };
  useEffect(() => clear, []);
  const start = async () => {
    clear();
    setSamples(0);
    setStatus('Подготовка геометрии и материалов…');
    setPhase('preparing');
    let current: Job;
    try {
      current = { abort: new AbortController(), frame: 0, resume: scene.pauseForPhoto() };
      job.current = current;
      const module = await import('../photo/PhotoRenderer');
      if (job.current !== current) return;
      current.snapshot = await scene.preparePhoto(
        size > 2048 ? 4096 : 2048,
        current.abort.signal,
        lighting,
      );
      if (job.current !== current) {
        current.snapshot.dispose();
        return;
      }
      const aspect = current.snapshot.camera.aspect;
      const width = Math.round(size * Math.min(1, aspect)),
        height = Math.round(size / Math.max(1, aspect));
      const canvas = document.createElement('canvas');
      host.current?.replaceChildren(canvas);
      current.engine = new module.PhotoRenderer(
        canvas,
        width,
        height,
        scene.renderer.toneMappingExposure,
      );
      setStatus('Подготовка отражений и мягкого света…');
      await current.engine.prepare(current.snapshot, current.abort.signal, (fraction) => {
        if (job.current === current) setStatus(`Подготовка сцены: ${Math.round(fraction * 100)}%`);
      });
      if (job.current !== current) return;
      setPhase('rendering');
      const tick = () => {
        if (job.current !== current || current.abort.signal.aborted) return;
        try {
          current.engine!.step();
          const count = Math.floor(current.engine!.samples);
          setSamples(count);
          setStatus(
            count ? 'Свет уточняется, шум постепенно уменьшается.' : 'Подготовка первого кадра…',
          );
          if (count >= target) {
            setPhase('done');
            setStatus('Фото готово.');
          } else current.frame = requestAnimationFrame(tick);
        } catch (error) {
          setPhase('error');
          setStatus(error instanceof Error ? error.message : String(error));
        }
      };
      current.frame = requestAnimationFrame(tick);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      clear();
      setPhase('error');
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const pause = () => {
    if (job.current) cancelAnimationFrame(job.current.frame);
    setPhase('paused');
    setStatus('Расчёт остановлен. Текущий кадр можно сохранить или начать заново.');
  };
  const save = async () => {
    const engine = job.current?.engine;
    if (!engine) return;
    setSaving(true);
    try {
      const blob = await engine.png();
      if (isTauri()) await saveNativePng(new Uint8Array(await blob.arrayBuffer()));
      else {
        const url = URL.createObjectURL(blob),
          link = document.createElement('a');
        link.href = url;
        link.download = `MatVision-photo-${Math.floor(engine.samples)}-samples.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };
  const running = phase === 'preparing' || phase === 'rendering';
  return (
    <Modal
      titleId="photo-title"
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <div className="photo-dialog">
        <h2 id="photo-title">Фото · мягкий свет и отражения</h2>
        <p>
          Снимок текущего ракурса и изгиба. Свет рассчитывается постепенно; больше проходов — чище
          мелкие детали и тени.
        </p>
        <div className="photo-options">
          <label>
            Освещение
            <select
              aria-label="Свет фото"
              disabled={running}
              value={lighting}
              onChange={(e) => setLighting(e.target.value as 'studio' | 'hdri')}
            >
              <option value="hdri">Фотостудия · HDR Poly Haven</option>
              <option value="studio">Текущая студийная схема</option>
            </select>
          </label>
          <label>
            Длинная сторона
            <select
              aria-label="Размер фото"
              disabled={running}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            >
              <option value={1920}>1920 px</option>
              <option value={2560}>2560 px</option>
              <option value={3840}>3840 px</option>
            </select>
          </label>
          <label>
            Чистота изображения
            <select
              aria-label="Проходы фото"
              disabled={running}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
            >
              <option value={128}>128 проходов</option>
              <option value={512}>512 проходов</option>
              <option value={1024}>1024 прохода</option>
            </select>
          </label>
        </div>
        <div className="photo-canvas" ref={host} />
        <progress aria-label="Готовность фото" max={target} value={samples} />
        <p role="status">
          {status || 'Подготовьте ракурс в студии и начните расчёт.'}
          {samples > 0 && ` · ${samples} / ${target}`}
        </p>
        <div className="photo-actions">
          <button disabled={running || saving} onClick={() => void start()}>
            Рассчитать фото
          </button>
          {phase === 'rendering' && <button onClick={pause}>Остановить расчёт</button>}
          <button disabled={samples < 1 || saving} onClick={() => void save()}>
            {saving ? 'Сохранение…' : 'Сохранить фото PNG'}
          </button>
          <button disabled={saving} onClick={onClose}>
            {running ? 'Отменить и вернуться' : 'Вернуться в студию'}
          </button>
        </div>
        <p className="note">
          Фоторежим: three-gpu-pathtracer · 10 отражений луча · отдельная геометрия каждой нити.
          Положение камеры и материалы проекта не изменяются.
        </p>
      </div>
    </Modal>
  );
}
