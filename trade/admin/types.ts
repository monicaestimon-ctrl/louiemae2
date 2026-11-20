import type { ComponentType } from 'react';
import type { DimsCm } from '../../lib/holmDims';
export type StaffProps = {
  admin: boolean;
  toast: (message: string) => void;
  Turntable: ComponentType<{ url: string; dims: DimsCm | null; height?: number }>;
};
export type StaffContext = { me: { admin: boolean } } & Omit<StaffProps, 'admin'>;
