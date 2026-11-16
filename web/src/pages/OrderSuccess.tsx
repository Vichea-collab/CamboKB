import { Link, useParams } from 'react-router';
import { t } from '../lib/strings';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export default function OrderSuccess() {
  const { number = '' } = useParams();
  useDocumentTitle(t.success.title);
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <div className="mx-auto grid size-16 place-items-center rounded-full bg-green/15 text-3xl text-green">✓</div>
      <h1 className="mt-5 font-display text-3xl font-bold">{t.success.title}</h1>
      <p className="mt-2 text-muted">{t.success.body}</p>
      <div className="panel mt-6 p-5">
        <p className="text-sm text-muted">{t.success.number}</p>
        <p className="mt-1 font-display text-2xl font-bold tracking-wide text-yellow">{number}</p>
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
