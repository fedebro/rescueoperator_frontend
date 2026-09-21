import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { CatalogTextsOverride } from '@/i18n/catalog-texts';
import { qk } from '@/lib/api/query-keys';
import { renderWithIntl } from '@/test/render';
import { CareerProvider } from '@/features/game/hooks';
import { VehicleOffer, resolveHost } from './shop-screen';

const CAREER_ID = 'car_1';

/** `EMS_MSI`-shaped fixture: crew needs one NURSE (`specialist: true, quickHire: false`) per `vehicle-types.yaml`. */
const vehicleType = {
  code: 'EMS_MSI',
  family: 'EMS',
  domain: 'GROUND',
  name: { key: 'vehicle.EMS_MSI.name', params: { fallback: 'Ambulanza MSI' } },
  description: { key: 'vehicle.EMS_MSI.description', params: { fallback: 'Ambulanza infermieristica' } },
  price: '1750',
  requiredLevel: 5,
  capacityPoints: 1,
  crewMin: 2,
  crewOptimal: 3,
  speedFactor: 1,
  deliverySeconds: 420,
  capabilities: [],
  compatibleFacilityTypes: ['EMS_POST'],
  icon: 'vehicle-ems-msi',
  unlocked: true,
  lockedReason: null,
  movement: 'ROAD',
  airSpeedKmh: null,
  sirenFactor: 0.75,
  preparationSeconds: 45,
  tags: [],
};

const facility = {
  id: 'fac_1',
  name: 'Postazione EMS Centro',
  typeCode: 'EMS_POST',
  status: 'OPERATIONAL',
  capacities: [{ domain: 'GROUND', total: 2, used: 0 }],
};
const host = { kind: 'OK' as const, facility, alternatives: 0 };

function renderOffer(missingCrewRoles?: readonly string[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(qk.sync(CAREER_ID), { career: { credits: '50000' } });
  return renderWithIntl(
    <QueryClientProvider client={qc}>
      <CareerProvider value={CAREER_ID}>
        <CatalogTextsOverride value={{ 'role.NURSE.name': 'Infermiere' }}>
          <ul>
            <VehicleOffer
              type={vehicleType as never}
              onBuy={() => undefined}
              busy={false}
              host={host as never}
              familyLevel={3}
              missingCrewRoles={missingCrewRoles}
            />
          </ul>
        </CatalogTextsOverride>
      </CareerProvider>
    </QueryClientProvider>,
  );
}

describe('VehicleOffer — specialist crew-gap warning', () => {
  it('warns when the crew needs a specialist role the career cannot hire yet, and links to Personnel', () => {
    renderOffer(['NURSE']);
    const warning = screen.getByTestId('crew-gap-warning');
    expect(warning).toHaveAttribute('data-roles', 'NURSE');
    expect(warning).toHaveTextContent('Infermiere');
    expect(screen.getByRole('link', { name: 'Vai al Personale' })).toHaveAttribute(
      'href',
      '/game/personnel?tab=recruitment',
    );
    // Never blocks the purchase: the buy button is still there and enabled.
    expect(screen.getByTestId('buy-vehicle')).toBeInTheDocument();
  });

  it('renders nothing once the role is owned or can be hired (no gap reported)', () => {
    renderOffer([]);
    expect(screen.queryByTestId('crew-gap-warning')).not.toBeInTheDocument();
  });

  it('renders nothing when no crew gap prop is given at all', () => {
    renderOffer(undefined);
    expect(screen.queryByTestId('crew-gap-warning')).not.toBeInTheDocument();
  });
});

describe('resolveHost', () => {
  it('still resolves normally alongside the crew-gap warning (unrelated concerns)', () => {
    const result = resolveHost(
      { compatibleFacilityTypes: ['EMS_POST'], domain: 'GROUND', capacityPoints: 1 },
      [facility as never],
    );
    expect(result.kind).toBe('OK');
  });
});
