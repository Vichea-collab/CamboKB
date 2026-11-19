import { Keyboard } from 'lucide-react';
import { useState } from 'react';
import type { ProductDetailData } from '../../shared/lib/types';
import { t } from '../../shared/lib/strings';

export function ImageGallery({
  images,
  name,
}: {
  images: ProductDetailData['images'];
  name: string;
}) {
  const [index, setIndex] = useState(0);
  const current = images[index];
  if (!current)
    return (
      <div className="media grid aspect-square place-items-center rounded-2xl border border-line text-muted/50">
        <Keyboard className="size-14" aria-hidden />
      </div>
    );
  return (
    <div>
      <div className="media relative aspect-square rounded-2xl border border-line">
        <img
          src={current.lg}
          srcSet={`${current.sm} 400w, ${current.md} 800w, ${current.lg} 1200w`}
          sizes="(min-width: 1024px) 560px, 100vw"
          alt={t.product.photoAlt(name, index + 1)}
          className="size-full object-cover"
        />
        {images.length > 1 && (
          <span className="badge absolute bottom-3 right-3 border border-line bg-bg/85 tabular-nums backdrop-blur-md">
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
              aria-label={t.product.photoGo(i + 1)}
              aria-current={i === index}
              className={`media size-16 shrink-0 rounded-xl border-2 transition-colors ${i === index ? 'border-yellow' : 'border-transparent opacity-70 hover:opacity-100'}`}
            >
              <img src={img.sm} alt="" loading="lazy" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
