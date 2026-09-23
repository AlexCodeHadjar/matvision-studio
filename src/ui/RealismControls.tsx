import { useRef, useState } from 'react';
import type { MaterialMapKind, MaterialTarget, ProjectState } from '../contracts';
import { isTauri } from '../native';
import { Slider } from './Controls';

export function RealismControls({
  state,
  busy,
  onChange,
  onImport,
  onRemove,
  onLibrary,
}: {
  state: ProjectState;
  busy: boolean;
  onChange: (patch: Partial<ProjectState>) => void;
  onImport: (target: MaterialTarget, kind: MaterialMapKind, file?: File) => void;
  onRemove: (target: MaterialTarget, kind: MaterialMapKind) => void;
  onLibrary: () => void;
}) {
  const [target, setTarget] = useState<MaterialTarget>('fabric');
  const pending = useRef<{ target: MaterialTarget; kind: MaterialMapKind } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const assets = state.materials[target];
  const setting = (patch: Partial<ProjectState['realism']>) =>
    onChange({ realism: { ...state.realism, ...patch } });
  return (
    <section className="control-section realism-controls">
      <h2>
        <span>03</span> Реализм
      </h2>
      <fieldset disabled={busy}>
        <button onClick={onLibrary}>Применить ткань Poly Haven</button>
        <p className="note">Настоящие карты переплетения и шероховатости 2K. Принт сохраняется.</p>
        <p className="note">
          Детальный режим: полное разрешение теней и усиленное сглаживание. Кнопка «Фото»
          рассчитывает отражённый свет и мягкие тени.
        </p>
        <label className="field-label">
          Режим просмотра
          <select
            aria-label="Режим просмотра"
            value={state.realism.mode}
            onChange={(e) => setting({ mode: e.target.value as 'fast' | 'detailed' })}
          >
            <option value="fast">Быстрый · меньше нагрузка</option>
            <option value="detailed">Детальный · контактные тени</option>
          </select>
        </label>
        {state.realism.mode === 'detailed' && (
          <Slider
            label="Контактные тени"
            value={state.realism.contactShadow}
            min={0}
            max={2}
            onChange={(contactShadow) => setting({ contactShadow })}
          />
        )}
        <Slider
          label="Размер переплетения"
          value={state.realism.weaveScale}
          min={0.25}
          max={4}
          suffix="×"
          onChange={(weaveScale) => setting({ weaveScale })}
        />
        <Slider
          label="Рельеф ткани"
          value={state.realism.relief}
          min={0}
          max={3}
          onChange={(relief) => setting({ relief })}
        />
        <Slider
          label="Мягкий блеск ткани"
          value={state.realism.sheen}
          min={0}
          max={2}
          onChange={(sheen) => setting({ sheen })}
        />
        <Slider
          label="Рельеф резины"
          value={state.realism.rubberRelief}
          min={0}
          max={3}
          onChange={(rubberRelief) => setting({ rubberRelief })}
        />
        <details>
          <summary>Свой материал · карты поверхности</summary>
          <p className="note">
            Необязательно: встроенные материалы уже готовы. PNG, JPEG, WebP · до 8 МиБ и 16 Мп на
            карту. Все карты сохраняются в проекте.
          </p>
          <label className="field-label">
            Поверхность
            <select
              aria-label="Поверхность материала"
              value={target}
              onChange={(e) => setTarget(e.target.value as MaterialTarget)}
            >
              <option value="fabric">Ткань</option>
              <option value="rubber">Резина</option>
            </select>
          </label>
          {(
            [
              ['color', 'Цвет'],
              ['normal', 'Микрорельеф'],
              ['roughness', 'Шероховатость'],
              ['height', 'Высота'],
            ] as const
          ).map(([kind, label]) => (
            <div className="material-map-row" key={kind}>
              <button
                title={assets.maps[kind]?.name ?? `Загрузить: ${label}`}
                onClick={() => {
                  if (isTauri()) onImport(target, kind);
                  else {
                    pending.current = { target, kind };
                    input.current?.click();
                  }
                }}
              >
                {label}
                <small>{assets.maps[kind]?.name ?? 'Выбрать карту…'}</small>
              </button>
              {assets.maps[kind] && (
                <button
                  aria-label={`Удалить карту: ${label}`}
                  onClick={() => onRemove(target, kind)}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <label className="field-label">
            Ширина и высота повторения, мм
            <input
              aria-label="Размер материала, мм"
              type="number"
              min={0.1}
              max={2000}
              step={0.1}
              value={assets.tileMm}
              onChange={(e) => {
                const tileMm = e.target.valueAsNumber;
                if (Number.isFinite(tileMm) && tileMm >= 0.1 && tileMm <= 2000)
                  onChange({ materials: { ...state.materials, [target]: { ...assets, tileMm } } });
              }}
            />
          </label>
          <label className="field-label">
            Тип карты микрорельефа
            <select
              aria-label="Тип карты микрорельефа"
              value={assets.normalY}
              onChange={(e) =>
                onChange({
                  materials: {
                    ...state.materials,
                    [target]: { ...assets, normalY: e.target.value as 'opengl' | 'directx' },
                  },
                })
              }
            >
              <option value="opengl">OpenGL · Y вверх</option>
              <option value="directx">DirectX · Y вниз</option>
            </select>
          </label>
          <p className="note">
            Цвет ткани тонирует принт. Белая карта сохраняет его цвета. Высота добавляет мелкий
            рельеф без изменения силуэта. Используйте бесшовные карты; их реальный размер указывает
            автор материала.
          </p>
          <input
            ref={input}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0],
                choice = pending.current;
              if (file && choice) onImport(choice.target, choice.kind, file);
              e.target.value = '';
            }}
          />
        </details>
      </fieldset>
    </section>
  );
}
