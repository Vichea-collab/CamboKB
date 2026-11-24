import type { ReactNode } from 'react';
import { t } from '../lib/strings';

/** One grey block that stands where something will appear. Size and corners come from the class. */
export const Bone = ({ className = '' }: { className?: string }) => <span className={`bone block ${className}`} />;

const times = (n: number, make: (i: number) => ReactNode) => Array.from({ length: n }, (_, i) => make(i));

// ---- parts the shapes share ------------------------------------------------------------------------------------

/** A page's back link and title. */
const Heading = ({ back = true }: { back?: boolean }) => (
  <div className="mb-5">
    {back && <Bone className="mb-3 mt-2.5 h-4 w-24" />}
    <Bone className="h-9 w-56 max-w-[70%] rounded-lg" />
  </div>
);

const Lines = ({ n = 3 }: { n?: number }) => (
  <div className="space-y-2.5">
    {times(n, (i) => (
      <Bone key={i} className={`h-4 ${i === n - 1 ? 'w-3/5' : i % 2 ? 'w-11/12' : 'w-full'}`} />
    ))}
  </div>
);

const Field = () => (
  <div>
    <Bone className="mb-2 h-3.5 w-24" />
    <Bone className="h-12 w-full rounded-xl" />
  </div>
);

const FormPanel = ({ fields = 2 }: { fields?: number }) => (
  <div className="panel space-y-4 p-5">
    <Bone className="h-6 w-40" />
    {times(fields, (i) => (
      <Field key={i} />
    ))}
    <Bone className="h-11 w-32 rounded-xl" />
  </div>
);

/** Order totals and the like: a label on the left, a value on the right. */
const Pairs = ({ n = 4 }: { n?: number }) => (
  <div className="space-y-3">
    {times(n, (i) => (
      <div key={i} className="flex justify-between gap-6">
        <Bone className="h-4 w-24" />
        <Bone className="h-4 w-16" />
      </div>
    ))}
  </div>
);

const ItemRow = () => (
  <div className="flex gap-3 py-3.5">
    <Bone className="size-[72px] shrink-0 rounded-xl" />
    <div className="min-w-0 flex-1 space-y-2">
      <Bone className="h-4 w-4/5" />
      <Bone className="h-3 w-1/3" />
      <div className="flex items-center justify-between pt-1">
        <Bone className="h-9 w-28 rounded-xl" />
        <Bone className="h-5 w-14" />
      </div>
    </div>
  </div>
);

const ListRow = () => (
  <div className="panel flex items-center gap-4 p-4">
    <div className="min-w-0 flex-1 space-y-2">
      <div className="flex gap-2">
        <Bone className="h-5 w-28" />
        <Bone className="h-5 w-20 rounded-full" />
      </div>
      <Bone className="h-4 w-3/5" />
      <Bone className="h-3 w-24" />
    </div>
    <Bone className="h-6 w-16" />
  </div>
);

const List = () => (
  <div className="space-y-3">
    {times(4, (i) => (
      <ListRow key={i} />
    ))}
  </div>
);

const Order = () => (
  <div className="grid items-start gap-5 lg:grid-cols-[1fr_360px]">
    <div className="space-y-5">
      <div className="panel space-y-5 p-5">
        <Bone className="h-6 w-36" />
        <div className="flex justify-between gap-3">
          {times(4, (i) => (
            <Bone key={i} className="size-9 rounded-full" />
          ))}
        </div>
      </div>
      <div className="panel divide-y divide-line px-5 py-1.5">
        {times(2, (i) => (
          <ItemRow key={i} />
        ))}
      </div>
    </div>
    <div className="panel space-y-5 p-5">
      <Pairs />
      <Bone className="h-12 w-full rounded-xl" />
    </div>
  </div>
);

const Table = () => (
  <div className="panel divide-y divide-line">
    {times(7, (i) => (
      <div key={i} className="flex items-center gap-5 px-4 py-4">
        <Bone className="h-4 w-2/5" />
        <Bone className="h-4 w-1/5" />
        <Bone className="hidden h-4 w-1/5 sm:block" />
        <Bone className="ml-auto h-4 w-14" />
      </div>
    ))}
  </div>
);

const Tiles = () => (
  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {times(4, (i) => (
      <div key={i} className="panel space-y-3 p-4">
        <Bone className="h-4 w-20" />
        <Bone className="h-8 w-24" />
        <Bone className="h-3 w-16" />
      </div>
    ))}
  </div>
);

const Sheet = () => (
  <div className="mx-auto aspect-[826/1160] max-w-[826px] space-y-8 rounded-2xl bg-surface p-[6%] ring-1 ring-line">
    <div className="flex items-center justify-between">
      <Bone className="size-16 rounded-full" />
      <Bone className="h-7 w-2/5" />
    </div>
    <Lines />
    <div className="space-y-2">
      {times(9, (i) => (
        <Bone key={i} className="h-6 w-full rounded-sm" />
      ))}
    </div>
  </div>
);

// ---- the shapes: one per kind of page, laid out like the page itself so nothing moves when the data arrives -----

const shapes = {
  /** Any page without a shape of its own. */
  page: () => (
    <>
      <Heading />
      <div className="space-y-5">
        <div className="panel p-5">
          <Lines n={4} />
        </div>
        <div className="panel p-5">
          <Lines />
        </div>
      </div>
    </>
  ),
  product: () => (
    <>
      <Bone className="mb-4 mt-2.5 h-4 w-40" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] md:gap-12">
        <Bone className="aspect-square w-full rounded-2xl" />
        <div>
          <Bone className="h-9 w-4/5 rounded-lg" />
          <Bone className="mt-3 h-4 w-3/5" />
          <div className="mt-6 flex items-center gap-3">
            <Bone className="h-10 w-28 rounded-lg" />
            <Bone className="h-7 w-24 rounded-full" />
          </div>
          <Bone className="mt-6 hidden h-12 w-64 rounded-xl md:block" />
          <Bone className="mt-9 h-6 w-40" />
          <div className="mt-3 divide-y divide-line overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
            {times(5, (i) => (
              <div key={i} className="grid grid-cols-[2fr_3fr] gap-3 px-4 py-3.5">
                <Bone className="h-4 w-3/5" />
                <Bone className="h-4 w-4/5" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  ),
  /** A list under a title that is already there (my orders). */
  list: () => <List />,
  listPage: () => (
    <>
      <Heading />
      <List />
    </>
  ),
  order: () => (
    <>
      <Heading />
      <Order />
    </>
  ),
  profile: () => (
    <>
      <Heading />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <FormPanel />
        <FormPanel fields={1} />
      </div>
    </>
  ),
  checkout: () => (
    <>
      <Heading />
      <div className="grid items-start gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <FormPanel />
          <FormPanel />
        </div>
        <div className="panel space-y-5 p-5">
          <ItemRow />
          <Pairs />
        </div>
      </div>
    </>
  ),
  pay: () => (
    <div className="mx-auto max-w-md py-4 sm:py-8">
      <Bone className="mb-5 mt-2.5 h-4 w-20" />
      <Bone className="mx-auto h-9 w-48 rounded-lg" />
      <Bone className="mx-auto mt-3 h-4 w-40" />
      <Bone className="mx-auto mt-7 aspect-[3/4] w-full max-w-[320px] rounded-2xl" />
      <Bone className="mx-auto mt-6 h-4 w-64 max-w-full" />
    </div>
  ),
  login: () => (
    <div className="mx-auto max-w-md space-y-5 rounded-3xl bg-surface p-7 ring-1 ring-line sm:my-8">
      <Bone className="h-4 w-28" />
      <Bone className="h-9 w-56 max-w-full rounded-lg" />
      <Lines n={2} />
      <Bone className="h-12 w-full rounded-xl" />
    </div>
  ),
  cart: () => (
    <div className="divide-y divide-line">
      {times(3, (i) => (
        <ItemRow key={i} />
      ))}
    </div>
  ),
  /** Contact and delivery: a panel of label and value rows. */
  rows: () => (
    <div className="panel divide-y divide-line">
      {times(4, (i) => (
        <div key={i} className="grid gap-2 p-4 sm:grid-cols-[10rem_1fr] sm:gap-4">
          <Bone className="h-4 w-24" />
          <Bone className="h-4 w-44" />
        </div>
      ))}
    </div>
  ),
  text: () => <Lines n={5} />,
  info: () => (
    <div className="mx-auto max-w-2xl sm:py-4">
      <Heading />
      <div className="mt-8 space-y-8">
        <Lines n={4} />
        <Lines n={4} />
      </div>
    </div>
  ),
  /** An invoice or a report: a sheet of paper. */
  sheet: () => <Sheet />,
  sheetPage: () => (
    <div className="mx-auto max-w-4xl">
      <Heading />
      <Sheet />
    </div>
  ),
  table: () => <Table />,
  tablePage: () => (
    <>
      <Heading back={false} />
      <Table />
    </>
  ),
  tiles: () => (
    <>
      <Tiles />
      <div className="panel mt-5 space-y-4 p-5">
        <Bone className="h-6 w-40" />
        <Bone className="h-56 w-full rounded-xl" />
      </div>
    </>
  ),
  dashboard: () => (
    <>
      <Heading back={false} />
      <Tiles />
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="panel space-y-5 p-5">
          <Bone className="h-6 w-36" />
          <Pairs n={6} />
        </div>
        <div className="panel space-y-5 p-5">
          <Bone className="h-6 w-28" />
          <Pairs n={4} />
        </div>
      </div>
    </>
  ),
  form: () => (
    <>
      <Heading back={false} />
      <div className="space-y-5">
        <FormPanel fields={3} />
        <FormPanel />
      </div>
    </>
  ),
  /** The admin site itself is still loading, so there is no menu yet. */
  admin: () => (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 lg:px-8">
      <Heading back={false} />
      <Tiles />
      <div className="panel mt-5 p-5">
        <Pairs n={6} />
      </div>
    </div>
  ),
};

export type SkeletonShape = keyof typeof shapes;
export const SKELETON_SHAPES = Object.keys(shapes) as SkeletonShape[];

/**
 * What shows while a page or a part of it loads: grey blocks laid out like what is coming. Screen readers hear one
 * word. It appears after a moment, so something that loads at once does not flash.
 */
export function LoadingState({ shape = 'page' }: { shape?: SkeletonShape }) {
  return (
    <div role="status" data-shape={shape}>
      <span className="sr-only">{t.common.loading}</span>
      <div aria-hidden="true" className="skeleton-in">
        {shapes[shape]()}
      </div>
    </div>
  );
}
