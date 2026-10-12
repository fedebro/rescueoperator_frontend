import type { FacilityDto, VehicleDto } from '@/contracts';

export type TransferState = 'OK' | 'CURRENT' | 'INCOMPATIBLE' | 'NOT_OPERATIONAL' | 'FULL';
export interface TransferTarget {
  facility: FacilityDto;
  state: TransferState;
  free: number;
}

/** Every facility as a transfer target with the reason when it cannot take the vehicle (valid ones first). */
export function transferTargets(
  vehicle: Pick<VehicleDto, 'facilityId'>,
  type: { compatibleFacilityTypes: string[]; domain: string; capacityPoints: number } | undefined,
  facilities: readonly FacilityDto[],
): TransferTarget[] {
  return facilities
    .map((facility) => {
      const c = facility.capacities.find((x) => x.domain === type?.domain);
      const free = c ? c.total - c.used : 0;
      const state: TransferState =
        facility.id === vehicle.facilityId
          ? 'CURRENT'
          : !type || !type.compatibleFacilityTypes.includes(facility.typeCode)
            ? 'INCOMPATIBLE'
            : facility.status !== 'OPERATIONAL'
              ? 'NOT_OPERATIONAL'
              : free < type.capacityPoints
                ? 'FULL'
                : 'OK';
      return { facility, state, free };
    })
    .sort((a, b) => Number(b.state === 'OK') - Number(a.state === 'OK'));
}
