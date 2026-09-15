import { useCallback, useRef, useState } from 'react';
import type { CameraPreset } from '../contracts';
import { PRODUCTS, getProduct } from '../products';
import { createDefaultProject } from '../project';
import type { StudioScene } from '../scene/StudioScene';
import { Viewport } from './Viewport';
import './styles.css';

const cameras: [CameraPreset, string][] = [
  ['perspective', 'Перспектива'],
  ['top', 'Сверху'],
  ['low-angle', 'Низкий угол'],
  ['close-up', 'Крупный план'],
  ['underside', 'Снизу'],
];
export function App() {
  const [state, setState] = useState(createDefaultProject);
  const [activeCamera, setActiveCamera] = useState<CameraPreset>('perspective');
  const scene = useRef<StudioScene | null>(null);
  const onScene = useCallback((value: StudioScene | null) => {
    scene.current = value;
  }, []);
  const product = getProduct(state.productId);
  const preset = (value: CameraPreset) => {
    scene.current?.setCameraPreset(value);
    setActiveCamera(value);
  };
  return (
    <div className="app-shell">
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div>
            MatVision <strong>Studio</strong>
            <small>YOUR PRINT. IN PERSPECTIVE.</small>
          </div>
        </div>
        <div className="toolbar-divider" />
        <label className="product-select">
          <span>ПРОДУКТ</span>
          <select
            aria-label="Продукт"
            value={state.productId}
            onChange={(e) => {
              setState(createDefaultProject(e.target.value));
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
        <button
          className="toolbar-reset"
          onClick={() => preset('perspective')}
          title="Вернуть камеру в исходное положение"
        >
          ↺ Сбросить вид
        </button>
      </header>
      <main className="workspace">
        <Viewport state={state} onScene={onScene} />
        <aside className="inspector">
          <div className="inspector-title">
            <span className="eyebrow">ВАША СТУДИЯ</span>
            <h1>Всё в деталях.</h1>
            <p>
              Посмотрите на коврик
              <br />с новой стороны.
            </p>
          </div>
          <section className="control-section">
            <h2>
              <span>01</span> Продукт
            </h2>
            <div className="product-name">{product.displayName}</div>
            <div className="dimensions">
              {product.widthMm} <span>×</span> {product.heightMm}
              <small> мм</small>
            </div>
            <div className="facts">
              <span>Толщина</span>
              <strong>{state.thicknessMm} мм</strong>
              <span>Углы</span>
              <strong>R{product.cornerRadiusMm} мм</strong>
              <span>Основа</span>
              <strong>Резина</strong>
            </div>
          </section>
          <section className="control-section">
            <h2>
              <span>02</span> Камера
            </h2>
            <div className="camera-buttons">
              {cameras.map(([id, label]) => (
                <button
                  key={id}
                  className={activeCamera === id ? 'selected' : ''}
                  onClick={() => preset(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
          <section className="control-section">
            <h2>
              <span>03</span> Поверхность
            </h2>
            <label className="slider-label">
              Матовая ткань <output>{state.roughness.toFixed(2)}</output>
              <input
                aria-label="Шероховатость"
                type="range"
                min="0.5"
                max="1"
                step="0.01"
                value={state.roughness}
                onChange={(e) => setState((s) => ({ ...s, roughness: Number(e.target.value) }))}
              />
            </label>
            <p className="note">Нейтральное освещение помогает оценить форму и поверхность.</p>
          </section>
          <div className="studio-footer">
            <span className="status-dot" /> Локальная студия<span>1:1 SCALE</span>
          </div>
        </aside>
      </main>
      <footer className="statusbar">
        <span>
          {product.displayName} / {product.widthMm} × {product.heightMm} × {state.thicknessMm} мм
        </span>
        <span>Нейтральная студия · sRGB</span>
      </footer>
    </div>
  );
}
