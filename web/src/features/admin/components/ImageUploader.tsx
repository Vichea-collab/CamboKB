import { ArrowLeft, ArrowRight, ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

type Img = { id: string; sm: string };

export function ImageUploader({
  images,
  onUpload,
  onReorder,
  onDelete,
}: {
  images: Img[];
  onUpload: (files: File[]) => Promise<void>;
  onReorder: (ids: string[]) => void;
  onDelete: (id: string) => void;
}) {
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
          <figure
            key={img.id}
            className="media group relative aspect-square rounded-xl border border-line"
          >
            <img src={img.sm} alt="" className="size-full object-cover" />
            {i === 0 && (
              <span className="badge absolute left-1.5 top-1.5 bg-yellow text-yellow-ink">
                Cover
              </span>
            )}
            <div className="absolute inset-x-1.5 bottom-1.5 flex justify-between gap-1">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="icon-btn size-8 bg-bg/85 text-ink"
                aria-label={`Move photo ${i + 1} left`}
              >
                <ArrowLeft className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => onDelete(img.id)}
                className="icon-btn-danger size-8 bg-bg/85 text-danger"
                aria-label={`Delete photo ${i + 1}`}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === images.length - 1}
                className="icon-btn size-8 bg-bg/85 text-ink"
                aria-label={`Move photo ${i + 1} right`}
              >
                <ArrowRight className="size-4" aria-hidden />
              </button>
            </div>
          </figure>
        ))}
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong text-sm font-semibold text-muted transition-colors hover:border-yellow/60 hover:text-ink"
        >
          <ImagePlus className="size-6" aria-hidden />
          {busy ? 'Uploading…' : 'Add photos'}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => pick(e.target.files)}
      />
      <p className="mt-2 text-xs text-muted">
        JPEG, PNG or WebP up to 8 MB. The first photo is the cover.
      </p>
      {error && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
