import { useState } from 'react';
import type { PrintLayout, ProjectState, QualityPreset } from '../contracts';
import { Modal } from './Modal';

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider-label">
      {label}
      <output>
        {Number(value.toFixed(2))}
        {suffix}
      </output>
      <input
        aria-label={label}
        type="range"
        min={Math.min(min, value)}
        max={Math.max(max, value)}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function PrintControls({
  layout,
  edit,
  onEdit,
  onChange,
  onReset,
}: {
  layout: PrintLayout;
  edit: boolean;
  onEdit: () => void;
  onChange: (layout: PrintLayout) => void;
  onReset: () => void;
}) {
  return (
    <section className="control-section">
      <h2>
        <span>01</span> Print Layout
      </h2>
      <label className="field-label">
        Размещение
        <select
          aria-label="Размещение"
          value={layout.mode}
          onChange={(e) => onChange({ ...layout, mode: e.target.value as PrintLayout['mode'] })}
        >
          <option value="cover">Заполнить · Cover</option>
          <option value="contain">Вписать · Contain</option>
          <option value="stretch">Растянуть · Stretch</option>
        </select>
      </label>
      {layout.mode === 'stretch' && <p className="note">Stretch изменяет пропорции рисунка.</p>}
      <button
        className={`edit-print ${edit ? 'selected' : ''}`}
        aria-pressed={edit}
        onClick={onEdit}
        title="E — включить перетаскивание рисунка по поверхности"
      >
        {edit ? '✓ Редактирование принта' : '↔ Двигать принт на коврике'}
      </button>
      <Slider
        label="Масштаб"
        min={0.1}
        max={5}
        value={layout.scale}
        suffix="×"
        onChange={(scale) => onChange({ ...layout, scale })}
      />
      <Slider
        label="Сдвиг X"
        min={-1}
        max={1}
        value={layout.offsetX}
        onChange={(offsetX) => onChange({ ...layout, offsetX })}
      />
      <Slider
        label="Сдвиг Y"
        min={-1}
        max={1}
        value={layout.offsetY}
        onChange={(offsetY) => onChange({ ...layout, offsetY })}
      />
      <Slider
        label="Поворот"
        min={-180}
        max={180}
        step={1}
        value={layout.rotationDeg}
        suffix="°"
        onChange={(rotationDeg) => onChange({ ...layout, rotationDeg })}
      />
      <button className="text-button" onClick={onReset}>
        ↺ Сбросить принт
      </button>
    </section>
  );
}

export function MaterialControls({
  state,
  onChange,
}: {
  state: ProjectState;
  onChange: (patch: Partial<ProjectState>) => void;
}) {
  return (
    <section className="control-section">
      <h2>
        <span>02</span> Материал и свет
      </h2>
      <label className="field-label">
        Ткань
        <select
          aria-label="Материал"
          value={state.materialPreset}
          onChange={(e) =>
            onChange({ materialPreset: e.target.value as ProjectState['materialPreset'] })
          }
        >
          <option value="smooth-cloth">Smooth Cloth</option>
          <option value="fine-weave">Fine Weave</option>
          <option value="gaming-fabric">Gaming Fabric</option>
        </select>
      </label>
      <Slider
        label="Шероховатость"
        min={0.4}
        max={1}
        value={state.roughness}
        onChange={(roughness) => onChange({ roughness })}
      />
      <label className="field-label">
        Освещение
        <select
          aria-label="Освещение"
          value={state.environment}
          onChange={(e) => onChange({ environment: e.target.value as ProjectState['environment'] })}
        >
          <option value="neutral-studio">Neutral Studio</option>
          <option value="bright-studio">Bright Studio</option>
          <option value="warm-room">Warm Room</option>
          <option value="desk-setup">Desk Setup</option>
        </select>
      </label>
      <label className="field-label">
        Поверхность под ковриком
        <select
          aria-label="Поверхность под ковриком"
          value={state.placementSurface}
          onChange={(e) =>
            onChange({ placementSurface: e.target.value as ProjectState['placementSurface'] })
          }
        >
          <option value="studio">Нейтральная студия</option>
          <option value="white-desk">Белый стол</option>
          <option value="graphite">Матовый графит</option>
          <option value="oak">Светлый дуб</option>
          <option value="walnut">Тёмный орех</option>
          <option value="concrete">Светлый бетон</option>
        </select>
      </label>
    </section>
  );
}

export function Settings({
  state,
  onChange,
  onClose,
}: {
  state: ProjectState;
  onChange: (patch: Partial<ProjectState>) => void;
  onClose: () => void;
}) {
  const profile = state.materialProfile;
  const [profileName, setProfileName] = useState(profile.name);
  return (
    <Modal titleId="settings-title" onClose={onClose}>
      <button className="close-button" aria-label="Закрыть настройки" onClick={onClose}>
        ×
      </button>
      <span className="eyebrow">MATVISION STUDIO</span>
      <h2 id="settings-title">Настройки студии</h2>
      <label className="field-label">
        Качество viewport
        <select
          aria-label="Качество viewport"
          value={state.quality}
          onChange={(e) => onChange({ quality: e.target.value as QualityPreset })}
        >
          <option value="low">Low</option>
          <option value="balanced">Balanced</option>
          <option value="high">High</option>
          <option value="ultra">Ultra</option>
        </select>
      </label>
      <h3>Профиль материала</h3>
      <p className="note">
        Ручная компенсация под материал и поставщика. Значения по умолчанию не откалиброваны.
      </p>
      <label className="field-label">
        Название профиля
        <input
          aria-label="Название профиля"
          maxLength={512}
          value={profileName}
          onChange={(e) => {
            setProfileName(e.target.value);
            onChange({
              materialProfile: {
                ...profile,
                name: e.target.value.trim() ? e.target.value : 'Пользовательский профиль',
              },
            });
          }}
          onBlur={() => setProfileName(profile.name)}
        />
      </label>
      <Slider
        label="Яркость материала"
        min={0.25}
        max={2}
        value={profile.brightness}
        onChange={(brightness) => onChange({ materialProfile: { ...profile, brightness } })}
      />
      <Slider
        label="Насыщенность"
        min={0}
        max={2}
        value={profile.saturation}
        onChange={(saturation) => onChange({ materialProfile: { ...profile, saturation } })}
      />
      <Slider
        label="Контраст"
        min={0.25}
        max={2}
        value={profile.contrast}
        onChange={(contrast) => onChange({ materialProfile: { ...profile, contrast } })}
      />
      <Slider
        label="Уровень чёрного"
        min={0}
        max={0.3}
        value={profile.blackLevel}
        onChange={(blackLevel) => onChange({ materialProfile: { ...profile, blackLevel } })}
      />
      <Slider
        label="Шероховатость профиля"
        min={0.05}
        max={1}
        value={profile.roughness}
        onChange={(roughness) => onChange({ materialProfile: { ...profile, roughness } })}
      />
      <label className="field-label color-input">
        Оттенок ткани
        <input
          aria-label="Оттенок ткани"
          type="color"
          value={profile.surfaceTint}
          onChange={(e) =>
            onChange({ materialProfile: { ...profile, surfaceTint: e.target.value } })
          }
        />
      </label>
      <div className="proof-note">
        <strong>Studio Preview</strong>
        <p>
          Print Proof недоступен без ICC-профиля конкретного принтера, чернил и ткани. Для точного
          сравнения нужен откалиброванный монитор.
        </p>
      </div>
    </Modal>
  );
}

export function Help({ onClose }: { onClose: () => void }) {
  return (
    <Modal titleId="help-title" onClose={onClose}>
      <button className="close-button" aria-label="Закрыть справку" onClick={onClose}>
        ×
      </button>
      <h2 id="help-title">Ваша студия — под рукой</h2>
      <p>
        Перетащите PNG, JPEG или WebP из проводника прямо на коврик. Изображение автоматически
        заполняет поверхность с сохранением пропорций.
      </p>
      <dl className="shortcuts">
        <dt>Левая кнопка + drag</dt>
        <dd>Вращать камеру</dd>
        <dt>Правая кнопка + drag</dt>
        <dd>Сдвинуть камеру</dd>
        <dt>Колесо</dt>
        <dd>Приблизить / отдалить</dd>
        <dt>Edit Print + drag</dt>
        <dd>Двигать рисунок</dd>
        <dt>Ctrl + колесо</dt>
        <dd>Масштаб рисунка</dd>
        <dt>Ctrl + O</dt>
        <dd>Открыть изображение</dd>
        <dt>Ctrl + Shift + O</dt>
        <dd>Открыть проект</dd>
        <dt>Ctrl + S</dt>
        <dd>Сохранить проект</dd>
        <dt>Ctrl + E</dt>
        <dd>Экспорт PNG</dd>
        <dt>R / 1 / 2</dt>
        <dd>Сброс камеры / сверху / перспектива</dd>
        <dt>E / H / F1</dt>
        <dd>Edit Print / скрыть UI / справка</dd>
      </dl>
      <p className="note">
        DPI оценивает исходные пиксели на физическом размере принта. Разрешение GPU-preview на эту
        оценку не влияет.
      </p>
    </Modal>
  );
}
