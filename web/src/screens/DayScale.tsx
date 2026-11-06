import type { ReactNode } from 'react';
import { fromIso, now } from '../time';

export type ScaleKind = 'indiv' | 'group' | 'free' | 'busy' | 'mine' | 'cancelled';

export type ScaleItem = {
  id: number;
  startsAt: string;
  durationMin: number;
  kind: ScaleKind;
  title: ReactNode;
  meta: ReactNode;
  /** Додатковий рядок під заголовком (місця в групі). */
  extra?: ReactNode;
  /** Кнопка-дзвіночок праворуч. */
  side?: ReactNode;
  onClick?: () => void;
  label: string;
};

const MIN_BLOCK = 44;

/**
 * Шкала дня: години зліва, слоти — блоки висотою за тривалістю.
 * Слоти, що перетинаються в часі, стають поруч у колонках.
 * Для сьогоднішнього дня — червона лінія «зараз».
 */
export function DayScale({ items, isToday, nowLabel }: { items: ScaleItem[]; isToday: boolean; nowLabel: string }) {
  const sorted = [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const startOf = (it: ScaleItem) => {
    const d = fromIso(it.startsAt);
    return d.hour + d.minute / 60;
  };
  const endOf = (it: ScaleItem) => startOf(it) + it.durationMin / 60;

  const n = now();
  const nowH = n.hour + n.minute / 60;
  let from = Math.floor(Math.min(...sorted.map(startOf)));
  let to = Math.ceil(Math.max(...sorted.map(endOf)));
  if (isToday && nowH >= from - 1 && nowH <= to + 1) {
    from = Math.min(from, Math.floor(nowH));
    to = Math.max(to, Math.ceil(nowH));
  }
  to = Math.min(Math.max(to, from + 1), 24);

  // Висота години: щоб найкоротший слот мав читабельну висоту.
  const shortest = Math.min(...sorted.map((s) => s.durationMin));
  const hourPx = Math.min(140, Math.max(72, ((MIN_BLOCK + 8) / shortest) * 60));

  // Колонки для перетинів.
  const col = new Map<number, { i: number; n: number }>();
  let cluster: ScaleItem[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const ends: number[] = [];
    const assigned: [ScaleItem, number][] = [];
    for (const it of cluster) {
      let c = ends.findIndex((e) => e <= startOf(it) + 1e-6);
      if (c === -1) {
        c = ends.length;
        ends.push(0);
      }
      ends[c] = endOf(it);
      assigned.push([it, c]);
    }
    for (const [it, c] of assigned) col.set(it.id, { i: c, n: ends.length });
    cluster = [];
  };
  for (const it of sorted) {
    if (cluster.length && startOf(it) >= clusterEnd - 1e-6) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, endOf(it));
  }
  flush();

  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const height = (to - from) * hourPx;

  return (
    <div className="card day-scale">
      <div className="scale" style={{ height }}>
        {hours.map((h) => (
          <span key={h} className="scale-hour" style={{ top: (h - from) * hourPx }}>
            <span>{String(h % 24).padStart(2, '0')}:00</span>
          </span>
        ))}
        {sorted.map((it) => {
          const top = (startOf(it) - from) * hourPx + 3;
          const h = Math.max(MIN_BLOCK, (it.durationMin / 60) * hourPx - 6);
          const c = col.get(it.id) ?? { i: 0, n: 1 };
          const short = h < 64;
          const cls = `block ${it.kind}${short ? ' short' : ''}${it.side ? ' has-bell' : ''}`;
          const style = {
            top,
            height: h,
            left: `calc(${(100 / c.n) * c.i}% + ${c.i ? 3 : 0}px)`,
            right: `calc(${100 - (100 / c.n) * (c.i + 1)}% + ${c.i < c.n - 1 ? 3 : 0}px)`,
          };
          const body = (
            <>
              <span className="block-top">
                <span className="block-title">{it.title}</span>
                {(short || c.n > 1) && <span className="block-meta">{it.meta}</span>}
              </span>
              {!short && c.n === 1 && <span className="block-meta">{it.meta}</span>}
              {!short && it.extra}
            </>
          );
          return it.onClick ? (
            <button key={it.id} className={cls} style={style} onClick={it.onClick} aria-label={it.label}>
              {body}
            </button>
          ) : (
            <div key={it.id} className={cls} style={style} aria-label={it.label}>
              {body}
              {it.side}
            </div>
          );
        })}
        {isToday && nowH >= from && nowH <= to && <div className="now-line" style={{ top: (nowH - from) * hourPx - 5 }} aria-label={nowLabel} />}
      </div>
    </div>
  );
}

export function Seats({ booked, capacity }: { booked: number; capacity: number }) {
  return (
    <span className="seats" aria-hidden>
      {Array.from({ length: Math.min(capacity, 12) }, (_, i) => (
        <span key={i} className={i < booked ? 'on' : ''} />
      ))}
    </span>
  );
}
