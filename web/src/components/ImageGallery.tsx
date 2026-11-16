import { useState } from 'react';
import type { ProductDetailData } from '../lib/types';

export function ImageGallery({ images, name }: { images: ProductDetailData['images']; name: string }) {
  const [index, setIndex] = useState(0);
  const current = images[index];
  if (!current) return <div className="grid aspect-square place-items-center rounded-[20px] bg-[#090c10] text-5xl opacity-40">⌨️</div>;
  return (
    <div>
      <div className="relative aspect-square overflow-hidden rounded-[20px] border border-line bg-[#090c10]">
        <img
          src={current.lg}
          srcSet={`${current.sm} 400w, ${current.md} 800w, ${current.lg} 1200w`}
          sizes="(min-width: 1024px) 560px, 100vw"
          alt={`${name}, photo ${index + 1}`}
          className="size-full object-cover"
        />
        {images.length > 1 && (
          <span className="absolute bottom-3 right-3 rounded-full border border-line bg-bg/85 px-2.5 py-1 text-xs font-bold tabular-nums backdrop-blur-md">
            {index + 1}/{images.length}
          </span>
        )}
      </div>
      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {images.map((img, i) => (
            <button
              key={img.id}
              onClick={() => setIndex(i)}
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === index}
              className={`size-16 shrink-0 overflow-hidden rounded-xl border-2 bg-[#090c10] transition-colors ${i === index ? 'border-yellow' : 'border-transparent opacity-70 hover:opacity-100'}`}
            >
              <img src={img.sm} alt="" loading="lazy" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
