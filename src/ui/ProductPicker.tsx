import { useEffect, useRef } from 'react';
import type { ProductDefinition } from '../contracts';
import { PRODUCTS, getProduct } from '../products';

function SizePreview({ product }: { product: ProductDefinition }) {
  // One scale for every option preserves both proportions and relative sizes.
  const pixelsPerMm = 88 / Math.max(...PRODUCTS.flatMap((p) => [p.widthMm, p.heightMm]));
  return (
    <span className="mat-size-preview" aria-hidden="true">
      <span
        className="mat-size-shape"
        style={{ width: product.widthMm * pixelsPerMm, height: product.heightMm * pixelsPerMm }}
      />
    </span>
  );
}

export function ProductPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (product: ProductDefinition) => void;
}) {
  const root = useRef<HTMLDetailsElement>(null);
  const product = getProduct(value);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && root.current) {
        root.current.open = false;
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return (
    <div className="product-select">
      <span>РАЗМЕР КОВРИКА</span>
      <details
        ref={root}
        className="mat-size-picker"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && root.current?.open) {
            event.preventDefault();
            event.stopPropagation();
            root.current.open = false;
            root.current.querySelector('summary')?.focus();
          }
        }}
      >
        <summary aria-label="Размер коврика">
          <span>
            {product.widthMm / 10} × {product.heightMm / 10} см
          </span>
          <SizePreview product={product} />
          <span className="mat-size-chevron" aria-hidden="true">
            ⌄
          </span>
        </summary>
        <div className="mat-size-options" role="group" aria-label="Размеры ковриков">
          <p>Толщина всех ковриков — 3 мм</p>
          <div
            className="mat-size-rows"
            onKeyDown={(event) => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                      buttons.length;
              event.preventDefault();
              buttons[next]?.focus();
            }}
          >
            {PRODUCTS.map((p) => (
              <button
                type="button"
                key={p.id}
                data-product-id={p.id}
                aria-pressed={p.id === value}
                onClick={() => {
                  onChange(p);
                  if (root.current) {
                    root.current.open = false;
                    root.current.querySelector('summary')?.focus();
                  }
                }}
              >
                <span>
                  {p.widthMm / 10} × {p.heightMm / 10} см
                </span>
                <SizePreview product={p} />
              </button>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}
