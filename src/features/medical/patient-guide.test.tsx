import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PatientDto } from '@/contracts';
import { qk } from '@/lib/api/query-keys';
import { renderWithIntl } from '@/test/render';
import { CAREER_ID, incident, snapshot } from '@/test/fixtures';
import { CareerProvider } from '@/features/game/hooks';
import { hasCoachSeen, resetCoachSeen } from '@/features/coaching/store';
import { PATIENT_GUIDE_KEY, PatientGuide, patientGuideStep } from './patient-guide';

const patient = (patch: Partial<PatientDto> = {}) =>
  ({ id: 'pat_1', status: 'UNASSESSED', triage: null, location: null, ...patch }) as PatientDto;

afterEach(() => resetCoachSeen(CAREER_ID));

describe('patient guide (first call with a patient after the 118 unlock)', () => {
  it('one thing at a time: assessment, care, hospital, done', () => {
    expect(patientGuideStep([patient()], false)).toBe('SEND');
    expect(patientGuideStep([patient()], true)).toBe('ASSESS');
    expect(patientGuideStep([patient({ status: 'TREATING', triage: 'ORANGE' })], true)).toBe('TREAT');
    expect(patientGuideStep([patient({ status: 'AWAITING_TRANSPORT', triage: 'ORANGE' })], true)).toBe(
      'HOSPITAL',
    );
    expect(patientGuideStep([patient({ status: 'IN_TRANSPORT', triage: 'ORANGE' })], true)).toBe('DONE');
  });

  function renderGuide(level: number, patients: PatientDto[]) {
    const qc = new QueryClient();
    const snap = snapshot();
    qc.setQueryData(qk.sync(CAREER_ID), {
      ...snap,
      career: { ...snap.career, level, unlockedFamilies: level >= 3 ? ['FIRE', 'EMS'] : ['FIRE'] },
    });
    return renderWithIntl(
      <QueryClientProvider client={qc}>
        <CareerProvider value={CAREER_ID}>
          <PatientGuide incident={incident({ patientCount: 1 })} patients={patients} medicalAssigned />
        </CareerProvider>
      </QueryClientProvider>,
    );
  }

  it('shows only once the 118 is unlocked, and once dismissed never again', () => {
    const first = renderGuide(1, [patient()]);
    expect(screen.queryByTestId('patient-guide')).toBeNull();
    first.unmount();
    const view = renderGuide(3, [patient()]);
    expect(screen.getByTestId('patient-guide')).toHaveAttribute('data-step', 'ASSESS');
    expect(screen.getByTestId('patient-guide')).toHaveTextContent('Valutazione');
    fireEvent.click(screen.getByTestId('patient-guide-dismiss'));
    expect(screen.queryByTestId('patient-guide')).toBeNull();
    expect(hasCoachSeen(CAREER_ID, PATIENT_GUIDE_KEY)).toBe(true);
    view.unmount();
    renderGuide(3, [patient()]);
    expect(screen.queryByTestId('patient-guide')).toBeNull();
  });
});
