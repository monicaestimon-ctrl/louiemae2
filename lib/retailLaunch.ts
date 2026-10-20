/** Launch delivery allowances in cents; charged per item, not per order. */
export function retailDelivery(category: string, name: string) {
  const text = `${category} ${name}`.toLowerCase();
  if (/sectional|corner sofa/.test(text)) return { freight: 45900, delivery: 9900 };
  if (/sofa/.test(text)) return { freight: 34900, delivery: 7900 };
  if (/bench/.test(text)) return { freight: 11900, delivery: 2900 };
  if (/accent chair/.test(text)) return { freight: 19900, delivery: 4900 };
  if (/dining table/.test(text)) return { freight: 29900, delivery: 7900 };
  if (/dining chair|barstool|counterstool|stool/.test(text))
    return { freight: 9900, delivery: 2900 };
  if (/ottoman/.test(text)) return { freight: 16900, delivery: 3900 };
  if (/lighting/.test(text)) return { freight: 4000, delivery: 1900 };
  return null;
}

/** Supplier listings confirmed missing or sold out during launch review. */
export function supplierAvailable(sku: string | undefined, description = '') {
  return !!sku && !['DTB04601603', 'STL01200201', 'FLL03701001'].includes(sku)
    && !/out of stock|sold out/i.test(description);
}

export function retailDescription(description: string) {
  return description.replace(/\s*(?:The configuration shown is the one supplied; )?availability and delivery timing are confirmed with your quote\./gi, '').trim();
}

/** Preserve merchandise contribution dollars after processing and reserve. */
export function launchPrice(baseCents: number, freight: number, delivery: number) {
  if (!Number.isSafeInteger(baseCents) || baseCents <= 0) throw new Error('Invalid retail price');
  const dollars = (baseCents + freight / 0.941 - delivery) / 100;
  return (Math.ceil((dollars + 1) / 10) * 10 - 1) * 100;
}
