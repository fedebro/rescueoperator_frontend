import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PatientDto } from '@/contracts';
import { qk } from '@/lib/api/query-keys';
import { CAREER_ID, INCIDENT_ID, incident, snapshot, vehicle } from '@/test/fixtures';
import { renderWithIntl } from '@/test/render';
import { CareerProvider } from '@/features/game/hooks';
import {
  BoardingPicker,
  FieldPostBanner,
  MULTI_PATIENT_CAPACITY,
  coPassengerCandidates,
  isFieldPostType,
  isMultiPatient,
} from './mass-casualty';

const patient = (n: number, patch: Partial<PatientDto> = {}): PatientDto => ({
  id: `pat_01J8Z0000000000000000000${String(n).padStart(2, '0')}`,
  incidentId: INCIDENT_ID,
  label: `Paziente ${n}`,
  profileCode: 'PP_MODERATE_MEDICAL',
  triage: 'GREEN',
  status: 'AWAITING_TRANSPORT',
  stability: null,
  needs: [],
  transportRequired: true,
  assignedVehicleId: null,
  hospitalId: null,
  busyUntil: null,
  ...patch,
});

describe('who rides with a patient', () => {
  const list = [
    patient(1, { triage: 'ORANGE' }),
    patient(2, { triage: 'GREEN' }),
    patient(3, { triage: 'RED' }),
    patient(4, { triage: 'WHITE' }),
    patient(5, { triage: 'BLUE', status: 'TREATING' }),
    patient(6, { triage: 'ORANGE' }),
  ];

  it('the others waiting for transport, worst triage first; the default pick fills the vehicle', () => {
    const { candidates, preselected } = coPassengerCandidates(list[0]!, list, MULTI_PATIENT_CAPACITY);
    expect(candidates.map((p) => p.label)).toEqual(['Paziente 3', 'Paziente 6', 'Paziente 2', 'Paziente 4']);
    expect(preselected).toEqual([list[2]!.id, list[5]!.id, list[1]!.id]);
  });

  it('a single-patient vehicle boards nobody else', () => {
    expect(coPassengerCandidates(list[0]!, list, 1).preselected).toEqual([]);
  });

  it('reads the catalog tags', () => {
    expect(isMultiPatient(['MULTI_PATIENT'])).toBe(true);
    expect(isMultiPatient(undefined)).toBe(false);
    expect(isFieldPostType(['NO_TRANSPORT'])).toBe(true);
    expect(isFieldPostType(['WINCH'])).toBe(false);
  });
});

describe('BoardingPicker', () => {
  const list = [patient(1), patient(2, { triage: 'RED' }), patient(3), patient(4), patient(5)];

  function Harness({ initial, onChange }: { initial: string[]; onChange?: (ids: string[]) => void }) {
    const [value, setValue] = React.useState(initial);
    return (
      <BoardingPicker
        patient={list[0]!}
        patients={list}
        capacity={MULTI_PATIENT_CAPACITY}
        value={value}
        onChange={(ids) => {
          setValue(ids);
          onChange?.(ids);
        }}
      />
    );
  }

  it('ticks the default pick, says how many are aboard, and stops at the capacity', () => {
    const { preselected } = coPassengerCandidates(list[0]!, list, MULTI_PATIENT_CAPACITY);
    const onChange = vi.fn();
    renderWithIntl(<Harness initial={preselected} onChange={onChange} />);
    const picker = screen.getByTestId('boarding-picker');
    expect(picker).toHaveAttribute('data-selected', '3');
    expect(picker).toHaveTextContent('4 pazienti a bordo su 4');
    const rows = screen.getAllByTestId('boarding-patient');
    expect(rows).toHaveLength(4);
    // The worst code first.
    expect(rows[0]).toHaveAttribute('data-patient-id', list[1]!.id);
    const boxes = screen.getAllByRole('checkbox');
    // Full: the one left out cannot be ticked.
    expect(boxes[3]).toBeDisabled();
    fireEvent.click(boxes[0]!);
    expect(onChange).toHaveBeenLastCalledWith(preselected.filter((id) => id !== list[1]!.id));
    expect(picker).toHaveAttribute('data-selected', '2');
    expect(picker).toHaveTextContent('3 pazienti a bordo su 4');
    expect(boxes[3]).not.toBeDisabled();
  });

  it('says so when nobody else waits', () => {
    renderWithIntl(
      <BoardingPicker
        patient={list[0]!}
        patients={[list[0]!]}
        capacity={MULTI_PATIENT_CAPACITY}
        value={[]}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByTestId('boarding-none')).toHaveTextContent('può portarne fino a 4 per viaggio');
  });
});

describe('FieldPostBanner', () => {
  const render = (status: string) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(
      qk.sync(CAREER_ID),
      snapshot({
        vehicles: [
          vehicle({
            callSign: 'PMA 1',
            typeCode: 'EMS_PMA',
            incidentId: INCIDENT_ID,
            status: status as never,
          }),
        ],
      }),
    );
    qc.setQueryData(qk.catalog(CAREER_ID), { vehicleTypes: [{ code: 'EMS_PMA', tags: ['NO_TRANSPORT'] }] });
    return renderWithIntl(
      <QueryClientProvider client={qc}>
        <CareerProvider value={CAREER_ID}>
          <FieldPostBanner incident={incident()} />
        </CareerProvider>
      </QueryClientProvider>,
    );
  };

  it('shows the advanced medical post working on scene, and what it changes', () => {
    render('ON_SCENE');
    expect(screen.getByTestId('field-post-banner')).toHaveTextContent('Posto medico avanzato attivo (PMA 1)');
  });

  it('says nothing while it is still on its way', () => {
    render('EN_ROUTE');
    expect(screen.queryByTestId('field-post-banner')).not.toBeInTheDocument();
  });
});
