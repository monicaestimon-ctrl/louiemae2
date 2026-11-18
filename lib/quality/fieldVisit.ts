import {
  parseFieldBatch,
  validMetricValue,
  type FieldBatch,
  type FieldMetric,
  type FieldSample,
} from './fieldPolicy';
export type FieldVisitIdentity = Omit<FieldBatch, 'version' | 'samples'>;
type Observation = { id: string; name: FieldMetric; value: number };
/** Memory-only accumulator for one hard navigation or bfcache visit, never an account/session ID. */
export function createFieldVisit(identity: FieldVisitIdentity) {
  if (
    !parseFieldBatch({ ...identity, version: 1, samples: [{ name: 'LCP', value: 0, revision: 1 }] })
  )
    throw new Error('Invalid field visit');
  const fixed = { ...identity };
  const latest = new Map<FieldMetric, { id: string; sample: FieldSample }>();
  let revoked = false;
  return {
    observe(observation: Observation): boolean {
      if (
        revoked ||
        !['LCP', 'CLS', 'INP'].includes(observation.name) ||
        typeof observation.id !== 'string' ||
        observation.id.length < 1 ||
        observation.id.length > 128 ||
        !validMetricValue(observation.name, observation.value)
      )
        return false;
      const previous = latest.get(observation.name);
      // A new web-vitals metric ID belongs to a new visit; the caller must rotate the whole visit.
      if (previous && previous.id !== observation.id) return false;
      if (previous?.sample.value === observation.value || (previous?.sample.revision ?? 0) >= 100)
        return false;
      latest.set(observation.name, {
        id: observation.id,
        sample: {
          name: observation.name,
          value: observation.value,
          revision: (previous?.sample.revision ?? 0) + 1,
        },
      });
      return true;
    },
    snapshot(): FieldBatch | null {
      if (revoked || !latest.size) return null;
      return {
        version: 1,
        ...fixed,
        samples: [...latest.values()].map(({ sample }) => ({ ...sample })),
      };
    },
    revoke() {
      revoked = true;
      latest.clear();
    },
  };
}
