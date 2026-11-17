import { formatUsd } from '@cambo/shared';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/**
 * KHQR payment card in the style of NBC's KHQR guideline: red header, payee and
 * amount, then the code. White on purpose so every phone camera reads it.
 */
export function KhqrCard({ qr, amountCents, payee, orderNumber }: { qr: string; amountCents: number; payee: string; orderNumber: string }) {
  const [svg, setSvg] = useState<string>();
  useEffect(() => {
    let live = true;
    QRCode.toString(qr, { type: 'svg', errorCorrectionLevel: 'M', margin: 0, color: { dark: '#000000', light: '#ffffff' } }).then((s) => live && setSvg(s));
    return () => {
      live = false;
    };
  }, [qr]);
  return (
    <figure className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[18px] bg-white text-[#14171c] shadow-pop">
      <div className="relative bg-[#e1232e] px-5 py-3 text-center">
        <span className="font-display text-lg font-bold tracking-[0.18em] text-white">KHQR</span>
        <span className="absolute -bottom-3 right-0 h-6 w-6 bg-white [clip-path:polygon(100%_0,0_0,100%_100%)]" aria-hidden />
      </div>
      <figcaption className="px-6 pt-4">
        <p className="text-sm font-semibold text-[#5b6473]">{payee}</p>
        <p className="font-display text-3xl font-bold tabular-nums">
          {formatUsd(amountCents)} <span className="text-base font-semibold text-[#5b6473]">USD</span>
        </p>
      </figcaption>
      <div className="mx-6 my-4 border-t border-dashed border-[#c9ced6]" />
      <div className="px-8 pb-7">
        {svg ? (
          <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={`KHQR code for order ${orderNumber}`} className="aspect-square w-full" />
        ) : (
          <div className="aspect-square w-full animate-pulse rounded-lg bg-[#eef0f3]" aria-hidden />
        )}
      </div>
    </figure>
  );
}

/** Render the QR to a PNG and download it, so it can be picked from the photo gallery in a bank app. */
export async function saveKhqrPng(qr: string, fileName: string) {
  const dataUrl = await QRCode.toDataURL(qr, { errorCorrectionLevel: 'M', margin: 4, width: 900, color: { dark: '#000000', light: '#ffffff' } });
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
