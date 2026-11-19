import { AppError } from '../../http/errors';

export type ImageUrls = { sm: string; md: string; lg: string };
export type StoredImage = { storageKey: string; width: number; height: number };

export interface FileClient {
  storeImage(body: Buffer, filename: string, prefix: 'products' | 'banners'): Promise<StoredImage>;
  deleteImage(storageKey: string): Promise<void>;
  /** Public URLs for the variants the file service wrote (it never upscales). */
  imageUrls(storageKey: string, width: number): ImageUrls;
  /** Public base of the file service, e.g. https://shop.example.com/files */
  publicBase(): string;
}

export function buildImageUrls(publicBase: string, storageKey: string, width: number): ImageUrls {
  const url = (w: number) => `${publicBase}/${storageKey}-${w}.webp`;
  const md = width >= 800 ? 800 : 400;
  const lg = width >= 1200 ? 1200 : md;
  return { sm: url(400), md: url(md), lg: url(lg) };
}

/** Talks to the file service's /internal API with the shared secret. */
export class HttpFileClient implements FileClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly publicBaseUrl: string,
  ) {}

  private async request(path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${this.secret}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new AppError(503, 'FILE_SERVICE_UNAVAILABLE', 'File service is unavailable, try again shortly');
    }
    if (res.status >= 400 && res.status < 500) {
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      throw new AppError(res.status, body.error?.code ?? 'UPLOAD_ERROR', body.error?.message ?? 'Upload rejected');
    }
    if (!res.ok) throw new AppError(503, 'FILE_SERVICE_UNAVAILABLE', 'File service error');
    return res;
  }

  async storeImage(body: Buffer, filename: string, prefix: 'products' | 'banners') {
    const form = new FormData();
    form.set('prefix', prefix);
    form.set('file', new Blob([new Uint8Array(body)]), filename);
    const res = await this.request('/internal/images', { method: 'POST', body: form });
    return (await res.json()) as StoredImage;
  }

  async deleteImage(storageKey: string) {
    await this.request(`/internal/images/${storageKey}`, { method: 'DELETE' });
  }

  imageUrls(storageKey: string, width: number) {
    return buildImageUrls(this.publicBaseUrl, storageKey, width);
  }


  publicBase() {
    return this.publicBaseUrl;
  }
}
