import { useEffect, useRef, useState } from 'react';
import type { ProjectState } from '../contracts';
import type { StudioScene } from '../scene/StudioScene';
import { isTauri, saveNativePng } from '../native';
import {
  CyclesBackend,
  type CyclesCapabilities,
  type CyclesStatus,
} from '../ultimate/CyclesBackend';
import { createCyclesPackage, cyclesPrototypeWarnings } from '../ultimate/package';
import { Modal } from './Modal';

const PRESETS = {
  draft: { label: 'Ultimate Draft', longSide: 512, samples: 16 },
  high: { label: 'Ultimate High', longSide: 1280, samples: 64 },
  reference: { label: 'Ultimate Reference', longSide: 1920, samples: 256 },
} as const;

type Preset = keyof typeof PRESETS;

export function UltimateDialog({
  scene,
  state,
  onClose,
}: {
  scene: StudioScene;
  state: ProjectState;
  onClose: () => void;
}) {
  const backend = useRef(new CyclesBackend());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const active = useRef(false);
  const [capabilities, setCapabilities] = useState<CyclesCapabilities | null>(null);
  const [preset, setPreset] = useState<Preset>('draft');
  const [device, setDevice] = useState('AUTO');
  const [phase, setPhase] = useState('checking');
  const [progress, setProgress] = useState(0);
  const [detail, setDetail] = useState('Проверка локального Blender/Cycles…');
  const [pngDataUrl, setPngDataUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const warnings = cyclesPrototypeWarnings(state);

  useEffect(() => {
    mounted.current = true;
    const path = localStorage.getItem('matvision-blender-path') ?? undefined;
    void backend.current
      .getCapabilities(path)
      .then((result) => {
        if (!mounted.current) return;
        setCapabilities(result);
        setPhase(result.available ? 'ready' : 'unavailable');
        setDetail(
          result.available
            ? `Blender ${result.version} готов к локальному рендеру.`
            : (result.reason ?? 'Cycles недоступен.'),
        );
      })
      .catch((error) => {
        if (mounted.current) {
          setPhase('unavailable');
          setDetail(String(error));
        }
      });
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (active.current) void backend.current.dispose();
    };
  }, []);

  const choose = async () => {
    try {
      const path = await backend.current.chooseExecutable();
      if (!path) return;
      setPhase('checking');
      const found = await backend.current.getCapabilities(path);
      if (!mounted.current) return;
      setCapabilities(found);
      setPhase(found.available ? 'ready' : 'unavailable');
      setDetail(
        found.available
          ? `Blender ${found.version} готов.`
          : (found.reason ?? 'Cycles недоступен.'),
      );
      if (found.available) localStorage.setItem('matvision-blender-path', path);
    } catch (error) {
      setPhase('unavailable');
      setDetail(error instanceof Error ? error.message : String(error));
    }
  };

  const poll = async () => {
    try {
      const status: CyclesStatus = await backend.current.poll();
      if (!mounted.current || !active.current) return;
      setProgress(status.progress);
      setDetail(
        status.detail ||
          (status.stage === 'rendering' ? 'Cycles рассчитывает изображение…' : 'Подготовка сцены…'),
      );
      if (status.stage === 'done') {
        active.current = false;
        setPngDataUrl(status.pngDataUrl);
        setPhase('done');
        setDetail(
          `${status.detail || 'Cycles CPU'} · ${Math.round(status.elapsedMs / 1000)} с · PNG готов.`,
        );
      } else if (status.stage === 'idle') {
        active.current = false;
        setPhase('ready');
      } else {
        setPhase(status.stage);
        timer.current = setTimeout(() => void poll(), 500);
      }
    } catch (error) {
      active.current = false;
      setPhase('error');
      setDetail(error instanceof Error ? error.message : String(error));
    }
  };

  const start = async () => {
    if (!capabilities?.available) return;
    const choice = PRESETS[preset];
    const aspect = scene.camera.aspect;
    const widthPx = Math.round(choice.longSide * Math.min(1, aspect));
    const heightPx = Math.round(choice.longSide / Math.max(1, aspect));
    const scenePackage = createCyclesPackage(state, scene.getCameraState(), {
      widthPx,
      heightPx,
      samples: choice.samples,
      device,
    });
    setPngDataUrl(null);
    setProgress(0);
    setPhase('preparing');
    setDetail('Создание временного пакета сцены…');
    try {
      await backend.current.render(scenePackage, state.source?.dataUrl ?? null);
      active.current = true;
      void poll();
    } catch (error) {
      setPhase('error');
      setDetail(error instanceof Error ? error.message : String(error));
    }
  };

  const cancel = async () => {
    if (timer.current) clearTimeout(timer.current);
    active.current = false;
    try {
      await backend.current.cancel();
      setPhase('ready');
      setDetail('Рендер отменён; временные файлы удалены.');
    } catch (error) {
      setPhase('error');
      setDetail(String(error));
    }
  };

  const save = async () => {
    if (!pngDataUrl) return;
    setSaving(true);
    try {
      const bytes = new Uint8Array(await (await fetch(pngDataUrl)).arrayBuffer());
      await saveNativePng(bytes);
    } catch (error) {
      setDetail(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const running = phase === 'preparing' || phase === 'rendering';
  return (
    <Modal
      titleId="ultimate-title"
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <div className="ultimate-dialog">
        <h2 id="ultimate-title">Ultimate · локальный Cycles prototype</h2>
        <p>Отдельный offline-рендер. Studio и Фото работают независимо от Blender.</p>
        <p role="status">{detail}</p>
        <button disabled={running || saving} onClick={() => void choose()}>
          Выбрать Blender 4.5 LTS
        </button>
        {capabilities?.available && (
          <>
            <div className="photo-options">
              <label>
                Качество
                <select
                  aria-label="Качество Ultimate"
                  disabled={running}
                  value={preset}
                  onChange={(e) => setPreset(e.target.value as Preset)}
                >
                  {Object.entries(PRESETS).map(([id, value]) => (
                    <option key={id} value={id}>
                      {value.label} · {value.longSide} px / {value.samples} проходов
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Устройство
                <select
                  aria-label="Устройство Ultimate"
                  disabled={running}
                  value={device}
                  onChange={(e) => setDevice(e.target.value)}
                >
                  <option value="AUTO">Авто · доступная GPU или CPU</option>
                  {capabilities.devices.map((entry) => (
                    <option key={`${entry.backend}-${entry.name}`} value={entry.backend}>
                      {entry.backend} · {entry.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {warnings.length > 0 && (
              <div className="note" role="note">
                Ограничения прототипа: {warnings.join(' ')}
              </div>
            )}
            <div className="photo-actions">
              <button disabled={running || saving} onClick={() => void start()}>
                Рассчитать Ultimate
              </button>
              {running && <button onClick={() => void cancel()}>Отменить рендер</button>}
              <button disabled={!pngDataUrl || saving} onClick={() => void save()}>
                {saving ? 'Сохранение…' : 'Сохранить PNG'}
              </button>
            </div>
            <progress aria-label="Готовность Ultimate" max={1} value={progress} />
            {pngDataUrl && (
              <img className="ultimate-result" src={pngDataUrl} alt="Результат Cycles" />
            )}
          </>
        )}
        <div className="photo-actions">
          <button disabled={saving} onClick={onClose}>
            Вернуться в студию
          </button>
        </div>
        {!isTauri() && (
          <p className="note">Откройте установленное Windows-приложение для Ultimate.</p>
        )}
        <p className="note">
          Прототип переносит размеры коврика, принт, базовые ткань/резину, камеру и свет. Шов, изгиб
          и пользовательские карты пока не передаются; Cycles использует собственный AgX output.
        </p>
      </div>
    </Modal>
  );
}
