import type { ProductKind, PrintSide, ProjectState } from '../contracts';
import {
  activePrintArea,
  getProduct,
  productKind,
  PRODUCT_CATEGORIES,
  isTextile,
} from '../products';
import { computePrintTransform } from '../print-layout/layout';

export function ProductPrintControls({
  state,
  busy,
  onKind,
  onSide,
  onChange,
}: {
  state: ProjectState;
  busy: boolean;
  onKind: (kind: ProductKind) => void;
  onSide: (side: PrintSide) => void;
  onChange: (patch: Partial<ProjectState>) => void;
}) {
  const product = getProduct(state.productId),
    kind = productKind(product),
    area = activePrintArea(state);
  const transform = state.source ? computePrintTransform(state.source, area, state.layout) : null;
  return (
    <section className="control-section product-print-controls">
      <h2>
        <span>00</span> Товар и зона печати
      </h2>
      <div className="product-kind-buttons">
        {PRODUCT_CATEGORIES.map(([id, label]) => (
          <button
            key={id}
            disabled={busy}
            aria-pressed={kind === id}
            className={kind === id ? 'selected' : ''}
            onClick={() => onKind(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {isTextile(product) && (
        <>
          {product.backPrintableArea && (
            <div className="side-buttons">
              <button
                disabled={busy}
                className={(state.printSide ?? 'front') === 'front' ? 'selected' : ''}
                aria-pressed={(state.printSide ?? 'front') === 'front'}
                onClick={() => onSide('front')}
              >
                Спереди
              </button>
              <button
                disabled={busy}
                className={state.printSide === 'back' ? 'selected' : ''}
                aria-pressed={state.printSide === 'back'}
                onClick={() => onSide('back')}
              >
                Сзади
              </button>
            </div>
          )}
          <label className="field-label color-input">
            {kind === 'tshirt' ? 'Цвет футболки' : 'Цвет изделия'}
            <input
              aria-label={kind === 'tshirt' ? 'Цвет футболки' : 'Цвет изделия'}
              type="color"
              disabled={busy}
              value={state.productColor ?? '#f4f3ee'}
              onChange={(e) => onChange({ productColor: e.target.value })}
            />
          </label>
          {product.backPrintableArea && (
            <p className="note">
              Для передней и задней стороны можно загрузить разные изображения.
            </p>
          )}
        </>
      )}
      {kind === 'mug' && (
        <>
          <p className="note">
            Сублимация на наружной стенке. Ручка и полоса рядом с ней, внутренность, верхний бортик
            и дно остаются белыми.
          </p>
          <div className="mug-placement-buttons">
            <button
              disabled={busy}
              onClick={() => onChange({ layout: { ...state.layout, offsetX: -0.25 } })}
            >
              Левая сторона
            </button>
            <button
              disabled={busy}
              onClick={() => onChange({ layout: { ...state.layout, offsetX: 0 } })}
            >
              Напротив ручки
            </button>
            <button
              disabled={busy}
              onClick={() => onChange({ layout: { ...state.layout, offsetX: 0.25 } })}
            >
              Правая сторона
            </button>
          </div>
        </>
      )}
      {kind !== 'mat' && (
        <>
          <strong className="print-area-size">
            Зона: {area.widthMm} × {area.heightMm} мм
          </strong>
          <div
            className="print-area-preview"
            aria-label="Развёртка зоны печати"
            style={{
              aspectRatio: area.widthMm / area.heightMm,
              background: kind === 'mug' ? '#fff' : (state.productColor ?? '#f4f3ee'),
            }}
          >
            {state.source && transform ? (
              <img
                src={state.source.dataUrl}
                alt="Принт внутри рабочей зоны"
                style={{
                  width: `${(transform.widthMm / area.widthMm) * 100}%`,
                  height: `${(transform.heightMm / area.heightMm) * 100}%`,
                  left: `${(0.5 + state.layout.offsetX) * 100}%`,
                  top: `${(0.5 - state.layout.offsetY) * 100}%`,
                  transform: `translate(-50%,-50%) rotate(${-state.layout.rotationDeg}deg)`,
                }}
              />
            ) : (
              <span>Загрузите изображение</span>
            )}
          </div>
          {transform && transform.visibleFraction < 0.995 && (
            <p className="print-clipping-note">
              Часть рисунка выходит за рабочую зону и обрезается. Используйте «Вписать» или
              уменьшите масштаб.
            </p>
          )}
          <p className="note">{product.description}</p>
        </>
      )}
    </section>
  );
}
