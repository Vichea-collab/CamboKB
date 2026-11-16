import { useEffect, useRef, useState } from 'react';
import type { Banner } from '../lib/types';

/** Auto-advancing banners (5 s), swipeable, pauses on hover/focus and for reduced motion. */
export function BannerCarousel({ banners }: { banners: Banner[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);
  const count = banners.length;

  useEffect(() => {
    if (count < 2 || paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % count), 5000);
    return () => clearInterval(id);
  }, [count, paused]);

  if (!count) return null;
  const go = (i: number) => setIndex((i + count) % count);
  const first = banners[0]!;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Promotions"
      className="relative mx-auto max-w-[920px] overflow-hidden rounded-[20px] border border-line bg-surface shadow-[0_4px_18px_rgb(0_0_0/0.35)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const start = touchX.current;
        const end = e.changedTouches[0]?.clientX;
        if (start !== null && end !== undefined && Math.abs(end - start) > 40) go(index + (end < start ? 1 : -1));
        touchX.current = null;
      }}
    >
      <div className="flex transition-transform duration-500 ease-out" style={{ transform: `translateX(-${index * 100}%)`, aspectRatio: `${first.width} / ${first.height}` }}>
        {banners.map((b, i) => {
          const img = (
            <img
              src={b.image.lg}
              srcSet={`${b.image.sm} 400w, ${b.image.md} 800w, ${b.image.lg} 1200w`}
              sizes="(min-width: 1240px) 1180px, 100vw"
              alt=""
              loading={i === 0 ? 'eager' : 'lazy'}
              fetchPriority={i === 0 ? 'high' : 'auto'}
              className="size-full object-cover"
            />
          );
          return (
            <div key={b.id} className="h-full w-full shrink-0" aria-hidden={i !== index} aria-roledescription="slide">
              {b.linkUrl ? (
                <a href={b.linkUrl} tabIndex={i === index ? 0 : -1} className="block size-full">
                  {img}
                </a>
              ) : (
                img
              )}
            </div>
          );
        })}
      </div>
      {count > 1 && (
        <div className="absolute inset-x-0 bottom-2.5 flex justify-center gap-1.5">
          {banners.map((b, i) => (
            <button
              key={b.id}
              onClick={() => go(i)}
              aria-label={`Show banner ${i + 1} of ${count}`}
              aria-current={i === index}
              className={`h-1.5 rounded-full transition-all ${i === index ? 'w-5 bg-yellow' : 'w-1.5 bg-white/45 hover:bg-white/70'}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
