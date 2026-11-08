import React from 'react';
import type { DeliveryAccess } from '../../lib/delivery/destination';

export default function DeliveryAccessFields({
  value,
  onChange,
}: {
  value: DeliveryAccess;
  onChange: (value: DeliveryAccess) => void;
}) {
  return (
    <fieldset className="col-span-2 grid gap-2 text-sm">
      <legend>Delivery location and service</legend>
      <label>
        Location
        <select
          className="block w-full border p-2"
          value={value.destinationType}
          onChange={(e) =>
            onChange({
              ...value,
              destinationType: e.target.value as DeliveryAccess['destinationType'],
              loadingDock: false,
            })
          }
        >
          <option value="residential">Residential</option>
          <option value="commercial">Commercial</option>
        </select>
      </label>
      <label>
        Requested service
        <select
          className="block w-full border p-2"
          value={value.requestedService}
          onChange={(e) =>
            onChange({
              ...value,
              requestedService: e.target.value as DeliveryAccess['requestedService'],
            })
          }
        >
          <option value="standard">Standard delivery</option>
          <option value="inside">Inside delivery — quote required</option>
          <option value="white_glove">White glove — quote required</option>
          <option value="expedited">Expedited — quote required</option>
        </select>
      </label>
      {(
        [
          'stairs',
          'limitedAccess',
          ...(value.destinationType === 'commercial' ? ['loadingDock'] : []),
        ] as const
      ).map((key) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={value[key as keyof DeliveryAccess] === true}
            onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
          />{' '}
          {key === 'stairs'
            ? 'Delivery requires stairs'
            : key === 'limitedAccess'
              ? 'Restricted access, gate, or delivery restrictions'
              : 'A loading dock is available'}
        </label>
      ))}
      <p className="text-xs">
        Special services and restricted access require confirmation before payment. A commercial
        address does not automatically reduce delivery charges.
      </p>
    </fieldset>
  );
}
