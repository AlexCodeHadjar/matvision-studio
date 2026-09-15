import { useEffect, useRef, useState } from 'react';
import { Slider } from './Controls';

export function RollControls({
  value,
  onChange,
  disabled,
  resetKey,
}: {
  value: number;
  onChange: (amount: number) => void;
  disabled: boolean;
  resetKey: string;
}) {
  const [animation, setAnimation] = useState<{ from: number; to: number; start: number } | null>(
    null,
  );
  const latestChange = useRef(onChange);
  latestChange.current = onChange;
  useEffect(() => {
    if (!animation || disabled) return;
    let frame = 0;
    const duration = Math.max(450, Math.abs(animation.to - animation.from) * 3500);
    const tick = (now: number) => {
      const progress = Math.max(0, Math.min(1, (now - animation.start) / duration));
      const eased = progress * progress * (3 - 2 * progress);
      latestChange.current(animation.from + (animation.to - animation.from) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else setAnimation(null);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animation, disabled]);
  useEffect(() => {
    setAnimation(null);
  }, [resetKey, disabled]);
  const start = (to: number) => setAnimation({ from: value, to, start: performance.now() });
  return (
    <section className="control-section">
      <h2>
        <span>04</span> Анимация коврика
      </h2>
      <div className="roll-buttons">
        <button disabled={disabled || value >= 1} onClick={() => start(1)}>
          Скрутить
        </button>
        <button disabled={disabled || value <= 0} onClick={() => start(0)}>
          Раскрыть
        </button>
        <button disabled={!animation || disabled} onClick={() => setAnimation(null)}>
          Пауза
        </button>
      </div>
      <fieldset className="roll-position" disabled={disabled}>
        <Slider
          label="Скручивание"
          min={0}
          max={100}
          step={1}
          value={value * 100}
          suffix=" %"
          onChange={(amount) => {
            setAnimation(null);
            onChange(amount / 100);
          }}
        />
      </fieldset>
      <div className="roll-endpoints">
        <span>Разложен</span>
        <span>Рулон</span>
      </div>
      <p className="note">
        Камеру можно вращать во время движения. Ползунок останавливает коврик в выбранном положении.
      </p>
    </section>
  );
}
