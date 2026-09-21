import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { qk } from '@/lib/api/query-keys';
import { renderWithIntl } from '@/test/render';
import { CareerProvider } from '@/features/game/hooks';
import { waterApi } from '@/lib/api/depth';
import { WaterSourcePanel } from './water-source-panel';

vi.mock('@/lib/api/depth', () => ({ waterApi: { sources: vi.fn(), choose: vi.fn() } }));

const CAREER_ID = 'car_1';
const INCIDENT_ID = 'inc_01HZZZZZZZZZZZZZZZZZZZZZZ1';

const heli = {
  id: 'veh_01HZZZZZZZZZZZZZZZZZZZZZZ1',
  callSign: 'AIB-1',
  status: 'ON_SCENE',
  typeCode: 'AIB_HELI',
  family: 'WILDFIRE',
  incidentId: INCIDENT_ID,
  capabilities: [{ code: 'WATER_SUPPLY', value: 40 }],
};
const engine = { ...heli, id: 'veh_2', callSign: 'VF-1', typeCode: 'FIRE_APS' };
const catalog = {
  vehicleTypes: [
    { code: 'AIB_HELI', movement: 'AIR' },
    { code: 'FIRE_APS', movement: 'ROAD' },
  ],
};

const nearest = {
  id: 'w1:0',
  kind: 'WATER' as const,
  name: 'Fiume Pescara',
  locality: 'Pescara',
  position: [14.21, 42.46] as [number, number],
  distanceMeters: 3900,
  runSeconds: 140,
  recommended: true,
  selected: false,
};
const sea = {
  ...nearest,
  id: 'c1:0',
  kind: 'COAST' as const,
  name: null,
  distanceMeters: 33_300,
  runSeconds: 620,
  recommended: false,
};

function renderPanel(vehicles: unknown[] = [heli]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(qk.sync(CAREER_ID), { vehicles, facilities: [] });
  qc.setQueryData(qk.catalog(CAREER_ID), catalog);
  return renderWithIntl(
    <QueryClientProvider client={qc}>
      <CareerProvider value={CAREER_ID}>
        <WaterSourcePanel incident={{ id: INCIDENT_ID } as never} />
      </CareerProvider>
    </QueryClientProvider>,
  );
}

describe('WaterSourcePanel', () => {
  beforeEach(() => {
    vi.mocked(waterApi.sources)
      .mockReset()
      .mockResolvedValue({ options: [nearest, sea], selectedId: null } as never);
    vi.mocked(waterApi.choose).mockReset();
  });

  it('shows the auto-selected nearest source with its real name — no interaction needed', async () => {
    renderPanel();
    expect(await screen.findByTestId('water-source-panel')).toBeInTheDocument();
    expect(screen.getByText('Fiume Pescara')).toBeInTheDocument();
    // The nearest one is flagged as such; the player never has to pick anything.
    expect(screen.getByText('Più vicino')).toBeInTheDocument();
    expect(screen.queryByTestId('water-source-option')).not.toBeInTheDocument();
  });

  it('stays out of the way for an incident with no water-supply aircraft', () => {
    renderPanel([engine]);
    expect(screen.queryByTestId('water-source-panel')).not.toBeInTheDocument();
    expect(waterApi.sources).not.toHaveBeenCalled();
  });

  it('names an unnamed coastline segment with its locality instead of a bare id', async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId('choose-other-water-source'));
    expect(await screen.findAllByTestId('water-source-option')).toHaveLength(2);
    expect(screen.getByText('Mare presso Pescara')).toBeInTheDocument();
  });

  it('sends the manual choice and keeps the server answer', async () => {
    vi.mocked(waterApi.choose).mockResolvedValue({
      options: [
        { ...nearest, selected: false },
        { ...sea, selected: true },
      ],
      selectedId: sea.id,
    } as never);
    renderPanel();
    fireEvent.click(await screen.findByTestId('choose-other-water-source'));
    const options = await screen.findAllByTestId('water-source-option');
    const alternative = options.find((o) => o.getAttribute('data-water-source-id') === sea.id)!;
    expect(alternative.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(alternative);

    await waitFor(() => expect(waterApi.choose).toHaveBeenCalledWith(CAREER_ID, INCIDENT_ID, sea.id));
    // The panel now reads back the chosen source instead of the nearest one.
    await waitFor(() =>
      expect(screen.getByTestId('water-source-panel')).toHaveTextContent('Mare presso Pescara'),
    );
  });
});
