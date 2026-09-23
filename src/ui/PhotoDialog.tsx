import { useEffect, useRef, useState } from 'react';
import type { StudioScene } from '../scene/StudioScene';
import type { PhotoRenderer } from '../photo/PhotoRenderer';
import type { PhotoSnapshot } from '../photo/snapshot';
import { isTauri, saveNativePng } from '../native';
import { Modal } from './Modal';
import {
  PHOTO_PRESETS,
  type DenoiseMode,
  type PhotoPreset,
  type PhotoSettings,
} from '../photo/settings';

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
  const [preset, setPreset] = useState<PhotoPreset>('preview');
  const [denoise, setDenoise] = useState<DenoiseMode>('off');
  const [focalLengthMm, setFocalLengthMm] = useState<number | null>(null);
  const [fStop, setFStop] = useState<number | null>(null);
  const [focusDistanceMm, setFocusDistanceMm] = useState(() =>
    Math.max(
      50,
      Math.min(5000, Math.round(scene.camera.position.distanceTo(scene.controls.target) * 1000)),
    ),
  );
  const [displacementMm, setDisplacementMm] = useState(0);
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
      const settings: PhotoSettings = {
        preset,
        samples: target,
        longSidePx: size as PhotoSettings['longSidePx'],
        denoise,
        focalLengthMm,
        focusDistanceMm,
        fStop,
        displacementMm,
      };
      current = { abort: new AbortController(), frame: 0, resume: scene.pauseForPhoto() };
      job.current = current;
      const module = await import('../photo/PhotoRenderer');
      if (job.current !== current) return;
      current.snapshot = await scene.preparePhoto(
        size > 2048 ? 4096 : 2048,
        current.abort.signal,
        lighting,
        displacementMm,
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
        settings,
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
            current.engine!.finish(current.abort.signal);
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
    try {
      job.current?.engine?.finish(job.current.abort.signal);
    } catch (error) {
      setPhase('error');
      setStatus(error instanceof Error ? error.message : String(error));
      return;
    }
    setPhase('paused');
    setStatus('Расчёт остановлен. Текущий кадр можно сохранить или начать заново.');
  };
  const save = async () => {
    const engine = job.current?.engine;
    if (!engine) return;
    setSaving(true);
    try {
      if (phase === 'rendering') pause();
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
            Качество фото
            <select
              aria-label="Качество фото"
              disabled={running}
              value={preset}
              onChange={(e) => {
                const choice = e.target.value as PhotoPreset;
                setPreset(choice);
                setTarget(PHOTO_PRESETS[choice].samples);
                setSize(PHOTO_PRESETS[choice].longSidePx);
                if (choice === 'preview') setDisplacementMm(0);
              }}
            >
              <option value="preview">Photo Preview · 512 проходов</option>
              <option value="high">Photo High · 1024 прохода</option>
              <option value="ultra">Photo Ultra · 2048 проходов</option>
              <option value="reference">Photo Reference · 4096 проходов</option>
            </select>
          </label>
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
              <option value={2048}>2048 проходов</option>
              <option value={4096}>4096 проходов</option>
            </select>
          </label>
        </div>
        <details className="photo-advanced">
          <summary>Дополнительные настройки</summary>
          <div className="photo-options">
            <label>
              Шумоподавление
              <select
                aria-label="Шумоподавление фото"
                disabled={running}
                value={denoise}
                onChange={(e) => setDenoise(e.target.value as DenoiseMode)}
              >
                <option value="off">Выключено · исходный кадр</option>
                <option value="smart">Мягкий GPU-фильтр · linear HDR</option>
              </select>
            </label>
            <label>
              Фокусное расстояние
              <select
                aria-label="Фокусное расстояние фото"
                disabled={running}
                value={focalLengthMm ?? 'current'}
                onChange={(e) =>
                  setFocalLengthMm(e.target.value === 'current' ? null : Number(e.target.value))
                }
              >
                <option value="current">Текущий ракурс Studio</option>
                <option value={35}>35 мм</option>
                <option value={50}>50 мм</option>
                <option value={70}>70 мм · макро</option>
              </select>
            </label>
            <label>
              Диафрагма
              <select
                aria-label="Диафрагма фото"
                disabled={running}
                value={fStop ?? 'off'}
                onChange={(e) => setFStop(e.target.value === 'off' ? null : Number(e.target.value))}
              >
                <option value="off">Без размытия</option>
                <option value={16}>f/16 · слабое</option>
                <option value={8}>f/8</option>
                <option value={4}>f/4</option>
                <option value={2}>f/2 · макро</option>
              </select>
            </label>
            <label>
              Дистанция фокусировки · мм
              <input
                aria-label="Дистанция фокусировки фото"
                type="number"
                min={50}
                max={5000}
                step={10}
                disabled={running || fStop === null}
                value={focusDistanceMm}
                onChange={(e) => setFocusDistanceMm(Number(e.target.value))}
              />
            </label>
            <label>
              Геометрический рельеф ткани · мм
              <select
                aria-label="Рельеф ткани фото"
                disabled={running || !scene.hasFabricHeightMap || preset === 'preview'}
                value={displacementMm}
                onChange={(e) => setDisplacementMm(Number(e.target.value))}
              >
                <option value={0}>Выключен</option>
                <option value={0.05}>0,05 мм</option>
                <option value={0.1}>0,10 мм</option>
                <option value={0.2}>0,20 мм</option>
              </select>
            </label>
          </div>
          <p className="note">
            Рельеф требует карты высоты ткани и Photo High или выше. Для шумоподавления используется
            встроенный пространственный фильтр, не OIDN.
          </p>
        </details>
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
          Фоторежим: three-gpu-pathtracer · 10 отражений луча · float HDR до вывода · отдельная
          геометрия каждой нити. Положение камеры и материалы проекта не изменяются.
        </p>
      </div>
    </Modal>
  );
}
