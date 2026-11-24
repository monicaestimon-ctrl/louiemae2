/** Exact modeled ZIP coverage must never silently widen to a ZIP-prefix fallback. */
export type DeliveryZoneMap = {
  zip3Zones?: Record<string, string>;
  modeledZip5Zones?: Record<string, string>;
};
export function deliveryZone(config: DeliveryZoneMap | null | undefined, zip: string) {
  const value = zip.trim();
  return config?.modeledZip5Zones !== undefined
    ? config.modeledZip5Zones[value.slice(0, 5)]
    : config?.zip3Zones?.[value.slice(0, 3)];
}
export function deliveryLanes(config: DeliveryZoneMap | null | undefined) {
  const exact = config?.modeledZip5Zones !== undefined;
  return Object.entries(exact ? config.modeledZip5Zones! : config?.zip3Zones ?? {}).map(([prefix, zone]) => ({
    prefix, zone, match: exact ? 'exact_zip' as const : 'zip_prefix' as const,
    controlPrefix: prefix.slice(0, 3),
  }));
}
