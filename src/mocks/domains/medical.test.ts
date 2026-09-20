import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HospitalDto, HospitalOption, PatientDto, type RealtimeEnvelope } from '@/contracts';
import { TransportResult } from '@/lib/api/assumed';
import { MockEngine, MockError, memoryStorage, type MockCareer } from '../engine';
import { installDomains } from './index';
import {
  HOSPITALS,
  loadLevel,
  medicalOf,
  medicalState,
  outcomeFactor,
  rankHospitals,
  stabilityAt,
  type MockPatient,
} from './medical';

async function world(speed = 1, level = 6) {
  let now = Date.parse('2026-03-01T09:00:00.000Z');
  const events: RealtimeEnvelope[] = [];
  let seed = 7;
  const engine = new MockEngine({
    storage: memoryStorage(),
    now: () => now,
    speed,
    emit: (e) => events.push(e),
    random: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
  });
  installDomains(engine);
  // domain QA helpers attach in a microtask (installQa runs after the domains)
  await Promise.resolve();
  engine.qa.createReadyCareer({ email: 'med@example.com', directorName: 'Dr Test', level, credits: 5000 });
  const career = engine.qa.career();
  const advance = (ms: number, step = 250) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      // keep the player "present": the core stops spawning and the away logic kicks in otherwise
      career.lastSeenAt = now;
      engine.process();
    }
  };
  const raw = engine.qa as unknown as {
    giveAmbulance: (typeCode?: string) => { facilityId: string; vehicleId: string };
    medicalConfig: (c: { autoTransportSeconds?: number; externalSeconds?: number }) => void;
    stabilize: (id: string) => void;
    setHospitalLoad: (id: string, load: string | null) => void;
  };
  // every new ambulance gets its crew (the personnel domain blocks uncrewed dispatches)
  const qa = {
    ...raw,
    giveAmbulance: (typeCode?: string) => {
      const out = raw.giveAmbulance(typeCode);
      engine.qa.staffAll();
      return out;
    },
  };
  return { engine, events, advance, career, qa, medical: medicalOf(engine), now: () => now };
}
type World = Awaited<ReturnType<typeof world>>;

const until = (w: World, pred: () => boolean, maxMs = 900_000) => {
  for (let t = 0; t < maxMs && !pred(); t += 1000) w.advance(1000);
  expect(pred(), 'condition reached in time').toBe(true);
};
const spawnFall = (w: World, severity = 4) => {
  // stop random spawns from interfering
  w.engine.cancelActions(w.career, (a) => a.type === 'INCIDENT_SPAWN');
  const id = w.engine.spawnIncident(w.career, 'MED_FALL', false, { severity }).id;
  return id;
};
const patientOf = (career: MockCareer, incidentId: string): MockPatient =>
  medicalState(career).patients.find((p) => p.dto.incidentId === incidentId)!;

describe('medical pure helpers', () => {
  it('stability follows its anchor and never reaches zero (deceased is disabled)', () => {
    const anchor = { value: 50, ratePerSecond: -1, anchorAt: 0 };
    expect(stabilityAt(anchor, 10_000)).toBe(40);
    expect(stabilityAt(anchor, 500_000)).toBeGreaterThan(0);
    expect(stabilityAt({ value: 90, ratePerSecond: 2, anchorAt: 0 }, 60_000)).toBe(100);
  });

  it('derives the hospital load from the occupancy', () => {
    expect(loadLevel(5, 10)).toBe('NORMAL');
    expect(loadLevel(7, 10)).toBe('BUSY');
    expect(loadLevel(9.5, 10)).toBe('SATURATED');
  });

  it('recommends exactly one open hospital, preferring the required unit over the closest one', () => {
    const [pescara, , penne] = HOSPITALS;
    const options = rankHospitals(
      [
        { hospital: penne!, load: 'NORMAL', travelSeconds: 60 },
        { hospital: pescara!, load: 'BUSY', travelSeconds: 240 },
      ],
      { required: 'TRAUMA_CENTER', preferred: 'INTENSIVE_CARE' },
      1,
    );
    expect(options.filter((o) => o.recommended)).toHaveLength(1);
    expect(options[0]!.hospitalId).toBe(pescara!.id);
    expect(options[0]!.compatible).toBe(true);
    expect(options[0]!.reasons.map((r) => r.key)).toContain('medical.reasons.SPECIALTY_AVAILABLE');
    expect(options[1]!.reasons.map((r) => r.key)).toEqual(
      expect.arrayContaining(['medical.reasons.CLOSEST', 'medical.reasons.NOT_COMPATIBLE']),
    );
    expect(z.array(HospitalOption).safeParse(options).success).toBe(true);
  });

  it('never recommends a closed hospital', () => {
    const [pescara, chieti] = HOSPITALS;
    const options = rankHospitals(
      [
        { hospital: pescara!, load: 'CLOSED', travelSeconds: 30 },
        { hospital: chieti!, load: 'SATURATED', travelSeconds: 300 },
      ],
      { required: 'GENERAL_EMERGENCY', preferred: null },
      1,
    );
    expect(options.find((o) => o.recommended)?.hospitalId).toBe(chieti!.id);
  });

  it('has no outcome factor without patients', () => {
    expect(outcomeFactor([], 0)).toBeNull();
  });
});

describe('medical domain', () => {
  it('serves hospitals that match the contract', async () => {
    const w = await world();
    const hospitals = w.medical.hospitals(w.career);
    expect(hospitals.length).toBeGreaterThanOrEqual(5);
    expect(z.array(HospitalDto).safeParse(hospitals).success).toBe(true);
    expect(hospitals.some((h) => h.hasHelipad)).toBe(true);
  });

  it('creates hidden patients with the incident and reveals them when a medical vehicle arrives', async () => {
    const w = await world();
    const { vehicleId } = w.qa.giveAmbulance();
    const incidentId = spawnFall(w);
    expect(w.career.incidents.find((i) => i.id === incidentId)!.patientCount).toBe(1);
    const before = w.medical.patients(w.career, incidentId);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      status: 'UNASSESSED',
      triage: null,
      profileCode: null,
      stability: null,
    });
    expect(z.array(PatientDto).safeParse(before).success).toBe(true);

    w.engine.dispatch(w.career, incidentId, [vehicleId]);
    until(w, () => patientOf(w.career, incidentId).dto.status !== 'UNASSESSED');
    const assessed = patientOf(w.career, incidentId).dto;
    expect(assessed.triage).not.toBeNull();
    expect(assessed.profileCode).toMatch(/^PP_/);
    expect(assessed.stability).not.toBeNull();
    expect(assessed.needs.length).toBeGreaterThan(0);
    expect(PatientDto.safeParse(assessed).success).toBe(true);
    expect(w.events.some((e) => e.type === 'patient.updated')).toBe(true);
  });

  it('runs the whole chain: treat → await transport → transport → handoff → admitted → incident resolved', async () => {
    const w = await world();
    w.qa.medicalConfig({ autoTransportSeconds: 3600, externalSeconds: 3600 });
    const { vehicleId } = w.qa.giveAmbulance();
    const incidentId = spawnFall(w);
    w.engine.dispatch(w.career, incidentId, [vehicleId]);
    until(w, () => patientOf(w.career, incidentId).dto.status === 'TREATING');
    // treated with every required need met → stability improves
    const p = patientOf(w.career, incidentId);
    if (p.dto.needs.every((n) => n.met)) expect(p.dto.stability!.ratePerSecond).toBeGreaterThan(0);
    w.qa.stabilize(p.dto.id);
    expect(p.dto.status).toBe('AWAITING_TRANSPORT');

    // the ambulance is retained on scene while the incident is RESOLVING
    until(w, () => w.career.incidents.find((i) => i.id === incidentId)?.status === 'RESOLVING');
    expect(w.career.vehicles.find((v) => v.id === vehicleId)!.status).toBe('ON_SCENE');

    const options = w.medical.hospitalOptions(w.career, p.dto.id);
    const recommended = options.find((o) => o.recommended)!;
    expect(recommended.reasons.length).toBeGreaterThan(0);
    const result = w.medical.transport(w.career, p.dto.id, { hospitalId: recommended.hospitalId });
    expect(TransportResult.safeParse(result).success).toBe(true);
    expect(result.vehicle).toMatchObject({ status: 'TRANSPORTING', incidentId });
    expect(result.vehicle.movement?.purpose).toBe('TO_HOSPITAL');
    expect(result.patient).toMatchObject({ status: 'IN_TRANSPORT', assignedVehicleId: vehicleId });
    // one patient per ambulance: the same transport cannot start twice
    expect(() =>
      w.medical.transport(w.career, p.dto.id, { hospitalId: recommended.hospitalId }),
    ).toThrowError(MockError);

    until(w, () => w.career.vehicles.find((v) => v.id === vehicleId)!.status === 'AT_HOSPITAL');
    expect(p.dto.status).toBe('HANDOFF');
    until(w, () => !w.career.incidents.some((i) => i.id === incidentId));
    expect(w.career.vehicles.find((v) => v.id === vehicleId)!.status).toMatch(/RETURNING|AVAILABLE/);
    expect(medicalState(w.career).admitted).toBe(1);
    // closed incidents drop their patients
    expect(medicalState(w.career).patients).toHaveLength(0);
    expect(w.career.stats.resolved).toBe(1);
  });

  it('confirms the recommended hospital by itself after the grace time (anti-stall)', async () => {
    const w = await world(12);
    w.qa.medicalConfig({ autoTransportSeconds: 5, externalSeconds: 3600 });
    const { vehicleId } = w.qa.giveAmbulance();
    const incidentId = spawnFall(w);
    w.engine.dispatch(w.career, incidentId, [vehicleId]);
    until(w, () => patientOf(w.career, incidentId)?.dto.status === 'TREATING');
    w.qa.stabilize(patientOf(w.career, incidentId).dto.id);
    until(w, () => !w.career.incidents.some((i) => i.id === incidentId));
    expect(medicalState(w.career).admitted).toBe(1);
  });

  it('hands the patient to an external ambulance when the player has no medical vehicle (never a stall)', async () => {
    const w = await world(12, 2);
    w.qa.medicalConfig({ autoTransportSeconds: 5, externalSeconds: 5 });
    w.engine.cancelActions(w.career, (a) => a.type === 'INCIDENT_SPAWN');
    // a medical incident for a career that owns fire engines only
    const incidentId = w.engine.spawnIncident(w.career, 'MED_FALL', false, { severity: 2 }).id;
    expect(patientOf(w.career, incidentId)).toBeDefined();
    const fire = w.career.vehicles.find((v) => v.status === 'AVAILABLE')!;
    w.engine.dispatch(w.career, incidentId, [fire.id]);
    until(w, () => patientOf(w.career, incidentId)?.external === true);
    expect(patientOf(w.career, incidentId).dto).toMatchObject({
      status: 'IN_TRANSPORT',
      assignedVehicleId: null,
    });
    until(w, () => !w.career.incidents.some((i) => i.id === incidentId));
    expect(w.career.stats.resolved + w.career.stats.failed).toBe(1);
  });

  it('accepts an ambulance sent to a RESOLVING incident whose patient still waits', async () => {
    const w = await world();
    w.qa.medicalConfig({ autoTransportSeconds: 3600, externalSeconds: 3600 });
    const first = w.qa.giveAmbulance();
    const second = w.qa.giveAmbulance();
    const incidentId = spawnFall(w);
    w.engine.dispatch(w.career, incidentId, [first.vehicleId]);
    until(w, () => patientOf(w.career, incidentId).dto.status === 'TREATING');
    w.qa.stabilize(patientOf(w.career, incidentId).dto.id);
    until(w, () => w.career.incidents.find((i) => i.id === incidentId)?.status === 'RESOLVING');
    w.engine.qa.staffAll();
    expect(() => w.engine.dispatch(w.career, incidentId, [second.vehicleId])).not.toThrow();
    until(w, () => w.career.vehicles.find((v) => v.id === second.vehicleId)!.status === 'ON_SCENE');
  });

  it('gates the manual hospital choice behind the HOSPITAL_CHOICE feature and refuses closed hospitals', async () => {
    const w = await world(1, 4);
    w.qa.medicalConfig({ autoTransportSeconds: 3600, externalSeconds: 3600 });
    const { vehicleId } = w.qa.giveAmbulance();
    const incidentId = spawnFall(w, 2);
    w.engine.dispatch(w.career, incidentId, [vehicleId]);
    until(w, () => patientOf(w.career, incidentId).dto.status === 'TREATING');
    const id = patientOf(w.career, incidentId).dto.id;
    w.qa.stabilize(id);
    const options = w.medical.hospitalOptions(w.career, id);
    const other = options.find((o) => !o.recommended)!;
    expect(() => w.medical.transport(w.career, id, { hospitalId: other.hospitalId })).toThrowError(
      /not unlocked/i,
    );
    const recommended = options.find((o) => o.recommended)!;
    w.qa.setHospitalLoad(recommended.hospitalId, 'CLOSED');
    expect(() => w.medical.transport(w.career, id, { hospitalId: recommended.hospitalId })).toThrowError(
      /not accepting/i,
    );
    const next = w.medical.hospitalOptions(w.career, id).find((o) => o.recommended)!;
    expect(next.hospitalId).not.toBe(recommended.hospitalId);
  });

  it('raises the hospital load with admissions and lets it decay', async () => {
    const w = await world(12);
    const state = medicalState(w.career);
    const penne = HOSPITALS[2]!;
    state.load[penne.id] = { extra: 6, anchorAt: w.now() };
    expect(w.medical.hospitals(w.career).find((h) => h.id === penne.id)!.load).toBe('SATURATED');
    w.advance(10 * 60_000, 10_000);
    expect(w.medical.hospitals(w.career).find((h) => h.id === penne.id)!.load).toBe('NORMAL');
  });
});
