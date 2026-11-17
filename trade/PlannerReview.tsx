import React from 'react';
import type { SavedProductIdentity } from './projectIdentity';

type Props = {
  missing: { item: SavedProductIdentity; index: number }[];
  remove: (index: number) => void;
  back: () => void;
  message?: (item: SavedProductIdentity) => string;
};

/** Keep unavailable room records visible without loading a misleading 3D layout. */
export function PlannerReview({ missing, remove, back, message }: Props) {
  return <main className="wrap">
    <h1>Review saved room items</h1>
    <p>Your room is preserved. Some saved products need review. Remove them or return later before editing or rendering this layout.</p>
    <ul>{missing.map(({ item, index }) => <li key={index}>
      <span>{message ? message(item) : `Unavailable saved item ${item.pid}`}</span>{' '}
      <button className="btn btn-line" onClick={() => remove(index)}>Remove saved item {item.pid}</button>
    </li>)}</ul>
    <button className="btn btn-line" onClick={back}>Back to catalog</button>
  </main>;
}
