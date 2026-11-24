import React, { useId, useState } from 'react';
import { TradeDeliveryCalculator } from './deferredFeatures';

/** Load on explicit intent and retain entered values when temporarily collapsed. */
export function DeliveryCalculatorDisclosure() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  return <div>
    <button type="button" className="btn lx-ghost" aria-expanded={open} aria-controls={id}
      onClick={() => { setOpened(true); setOpen(value => !value); }}>
      {open ? 'Hide delivery calculator' : 'Open delivery calculator'}
    </button>
    <div id={id} hidden={!open}>{opened && <TradeDeliveryCalculator />}</div>
  </div>;
}

