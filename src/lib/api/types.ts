/** Inferred types for contract schemas that the contract package exports only as Zod values. */
import type { z } from 'zod';
import type * as C from '@/contracts';
import type { DispatchOptionsResultV2 } from './assumed';

export type CatalogDto = z.infer<typeof C.CatalogDto>;
export type VehicleTypeDto = z.infer<typeof C.VehicleTypeDto>;
export type FacilityTypeDto = z.infer<typeof C.FacilityTypeDto>;
export type LedgerEntryDto = z.infer<typeof C.LedgerEntryDto>;
export type DispatchOptionsResult = z.infer<typeof DispatchOptionsResultV2>;
export type LocationSummary = z.infer<typeof C.LocationSummary>;
export type StarterSite = z.infer<typeof C.StarterSite>;
export type AwayReport = z.infer<typeof C.AwayReport>;
export type SessionDto = z.infer<typeof C.SessionDto>;
