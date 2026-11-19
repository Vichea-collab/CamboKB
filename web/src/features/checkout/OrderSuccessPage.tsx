import { Check } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { t } from '../../shared/lib/strings';
import { useDocumentTitle } from '../../shared/lib/useDocumentTitle';

export default function OrderSuccess() {
  const { number = '' } = useParams();
  const paid = useSearchParams()[0].get('paid') === '1';
  useDocumentTitle(paid ? t.success.paidTitle : t.success.title);
  return (
    <div className="mx-auto max-w-md py-6 text-center sm:py-10">
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-green/15 text-green">
        <Check className="size-8" strokeWidth={3} aria-hidden />
      </span>
      <h1 className="title-page mt-5">{paid ? t.success.paidTitle : t.success.title}</h1>
      <p className="mt-2 text-muted">{paid ? t.success.paidBody : t.success.body}</p>
      <div className="panel mt-6 p-5">
        <p className="text-sm font-semibold text-muted">{t.success.number}</p>
        <p className="mt-1 font-display text-2xl font-extrabold tracking-wide text-yellow tabular-nums">
          {number}
        </p>
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Link to={`/account/orders/${number}`} className="btn-ghost">
          {t.success.view}
        </Link>
        <Link to="/" className="btn-primary">
          {t.success.continue}
        </Link>
      </div>
    </div>
  );
}
