import { useRef, useState } from 'react';

type Img = { id: string; sm: string };

export function ImageUploader({ images, onUpload, onReorder, onDelete }: { images: Img[]; onUpload: (files: File[]) => Promise<void>; onReorder: (ids: string[]) => void; onDelete: (id: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const move = (i: number, d: -1 | 1) => {
    const ids = images.map((x) => x.id);
    const [id] = ids.splice(i, 1);
    ids.splice(i + d, 0, id!);
    onReorder(ids);
  };
  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(undefined);
    try {
      await onUpload([...files]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        {images.map((img, i) => (
          <figure key={img.id} className="group relative aspect-square overflow-hidden rounded-xl border border-line bg-[#090c10]">
            <img src={img.sm} alt="" className="size-full object-cover" />
            {i === 0 && <span className="absolute left-1.5 top-1.5 rounded-full bg-yellow px-2 py-0.5 text-[10px] font-bold text-bg">Cover</span>}
            <div className="absolute inset-x-1.5 bottom-1.5 flex justify-between gap-1">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="grid size-8 place-items-center rounded-lg bg-bg/85 text-xs disabled:opacity-30" aria-label={`Move photo ${i + 1} left`}>
                ←
              </button>
              <button type="button" onClick={() => onDelete(img.id)} className="grid size-8 place-items-center rounded-lg bg-bg/85 text-xs text-danger" aria-label={`Delete photo ${i + 1}`}>
                ✕
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === images.length - 1} className="grid size-8 place-items-center rounded-lg bg-bg/85 text-xs disabled:opacity-30" aria-label={`Move photo ${i + 1} right`}>
                →
              </button>
            </div>
          </figure>
        ))}
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="grid aspect-square place-items-center rounded-xl border-2 border-dashed border-line-strong text-sm font-semibold text-muted hover:border-yellow/60 hover:text-ink"
        >
          {busy ? 'Uploading…' : '+ Add photos'}
        </button>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => pick(e.target.files)} />
      <p className="mt-2 text-xs text-muted">JPEG, PNG or WebP up to 8 MB. The first photo is the cover.</p>
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}
