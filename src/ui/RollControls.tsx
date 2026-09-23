import { useEffect, useRef, useState } from 'react';
import type { ShowcaseAnimation } from '../contracts';
import { Slider } from './Controls';

const showcases: { id: ShowcaseAnimation; label: string; description: string; duration: number }[] =
  [
    {
      id: 'corner-lift',
      label: 'Подъём уголка',
      description: 'Изнанка, толщина и оверлок',
      duration: 4200,
    },
    { id: 'soft-wave', label: 'Мягкая волна', description: 'Гибкость материала', duration: 4200 },
    {
      id: 'table-drop',
      label: 'Укладка на стол',
      description: 'Последовательное касание поверхности',
      duration: 4400,
    },
    { id: 'mat-flip', label: 'Переворот', description: 'Показ резиновой изнанки', duration: 5600 },
    {
      id: 'dual-roll',
      label: 'С двух сторон',
      description: 'Встречное скручивание краёв',
      duration: 5600,
    },
    {
      id: 'edge-flyby',
      label: 'Облёт края',
      description: 'Крупный план оверлока и угла',
      duration: 6500,
    },
    {
      id: 'moving-light',
      label: 'Движущийся свет',
      description: 'Рельеф ткани, резины и нитей',
      duration: 5200,
    },
    {
      id: 'layer-reveal',
      label: 'Показ слоёв',
      description: 'Ткань и резиновая основа',
      duration: 4800,
    },
  ];

export function RollControls({
  value,
  onChange,
  disabled,
  resetKey,
  onPlayShowcase,
  onStopShowcase,
}: {
  value: number;
  onChange: (amount: number) => void;
  disabled: boolean;
  resetKey: string;
  onPlayShowcase: (animation: ShowcaseAnimation) => void;
  onStopShowcase: () => void;
}) {
  const [animation, setAnimation] = useState<{ from: number; to: number; start: number } | null>(
    null,
  );
  const latestChange = useRef(onChange);
  const [activeShowcase, setActiveShowcase] = useState<ShowcaseAnimation | null>(null);
  const showcaseTimer = useRef<number | null>(null);
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
    setActiveShowcase(null);
    if (showcaseTimer.current !== null) window.clearTimeout(showcaseTimer.current);
    onStopShowcase();
  }, [resetKey, disabled]);
  useEffect(
    () => () => {
      if (showcaseTimer.current !== null) window.clearTimeout(showcaseTimer.current);
      onStopShowcase();
    },
    [onStopShowcase],
  );
  const stop = () => {
    setAnimation(null);
    setActiveShowcase(null);
    if (showcaseTimer.current !== null) window.clearTimeout(showcaseTimer.current);
    showcaseTimer.current = null;
    onStopShowcase();
  };
  const start = (to: number) => {
    stop();
    setAnimation({ from: value, to, start: performance.now() });
  };
  const playShowcase = (id: ShowcaseAnimation, duration: number) => {
    stop();
    setActiveShowcase(id);
    onPlayShowcase(id);
    showcaseTimer.current = window.setTimeout(() => {
      setActiveShowcase(null);
      showcaseTimer.current = null;
    }, duration + 100);
  };
  return (
    <section className="control-section">
      <h2>
        <span>05</span> Анимация коврика
      </h2>
      <div className="roll-buttons">
        <button disabled={disabled || value >= 1} onClick={() => start(1)}>
          Скрутить
        </button>
        <button disabled={disabled || value <= 0} onClick={() => start(0)}>
          Раскрыть
        </button>
        <button disabled={(!animation && !activeShowcase) || disabled} onClick={stop}>
          {activeShowcase ? 'Остановить' : 'Пауза'}
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
            stop();
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
      <h3 className="showcase-heading">Демонстрации материала</h3>
      <div className="showcase-buttons">
        {showcases.map((item) => (
          <button
            key={item.id}
            className={activeShowcase === item.id ? 'selected' : ''}
            aria-pressed={activeShowcase === item.id}
            disabled={disabled}
            title={item.description}
            onClick={() => playShowcase(item.id, item.duration)}
          >
            <strong>{item.label}</strong>
            <span>{item.description}</span>
          </button>
        ))}
      </div>
      <p className="note">Демонстрации не изменяют сохранённые параметры проекта.</p>
    </section>
  );
}
