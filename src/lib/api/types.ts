/** Inferred types for contract schemas that the contract package exports only as Zod values. */
import type { z } from 'zod';
import type * as C from '@/contracts';

export type CatalogDto = z.infer<typeof C.CatalogDto>;
export type VehicleTypeDto = z.infer<typeof C.VehicleTypeDto>;
export type FacilityTypeDto = z.infer<typeof C.FacilityTypeDto>;
export type LedgerEntryDto = z.infer<typeof C.LedgerEntryDto>;
export type DispatchOptionsResult = z.infer<typeof C.DispatchOptionsResult>;
export type LocationSummary = z.infer<typeof C.LocationSummary>;
export type StarterSite = z.infer<typeof C.StarterSite>;
export type AwayReport = z.infer<typeof C.AwayReport>;
export type SessionDto = z.infer<typeof C.SessionDto>;
/** One row of the dispatch options (a vehicle's ETA, what blocks it, and — when busy — its `chain` preview). */
export type DispatchOption = DispatchOptionsResult['options'][number];
/** `DispatchOption.chain`: what ★POST /vehicles/:id/chain would do for the incident of the options (redirect now, or queue). */
export type DispatchChain = NonNullable<DispatchOption['chain']>;
export type ChainVehicleResult = z.infer<typeof C.ChainVehicleResult>;
/** Body options of ★POST /vehicles/:id/chain: `queueOnly` never redirects (the vehicle finishes its way home and resupply first). */
export type ChainOptions = { queueOnly?: boolean };
