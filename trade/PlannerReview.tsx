import React from 'react';

type Props = {
  missing: { item: { pid: number }; index: number }[];
  remove: (index: number) => void;
  back: () => void;
};

/** Keep unavailable room records visible without loading a misleading 3D layout. */
export function PlannerReview({ missing, remove, back }: Props) {
  return <main className="wrap">
    <h1>Review saved room items</h1>
    <p>Your room is preserved. Some saved products are unavailable. Remove them or return later before editing or rendering this layout.</p>
    <ul>{missing.map(({ item, index }) => <li key={index}>
      <span>Unavailable saved item {item.pid}</span>{' '}
      <button className="btn btn-line" onClick={() => remove(index)}>Remove saved item {item.pid}</button>
    </li>)}</ul>
    <button className="btn btn-line" onClick={back}>Back to catalog</button>
  </main>;
}
