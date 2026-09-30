import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HospitalDto, HospitalOption, IncidentDto, PatientDto, type RealtimeEnvelope } from '@/contracts';
import { TransportPatientResult } from '@/contracts';
import { MockEngine, MockError, iso, memoryStorage, sceneOf, type MockCareer } from '../engine';
import { PATIENT_PROFILES } from '../data/catalog';
import { installDomains } from './index';
import {
  HOSPITALS,
  byRecoveryPriority,
  loadLevel,
  medicalOf,
  medicalState,
  outcomeFactor,
  rankHospitals,
  stabilityAt,
  type MockPatient,
} from './medical';
import {
  RECOVERY_KNOBS,
  coastGuardRecoverySeconds,
  isWaterUnit,
  landingOf,
  recoveryCapacity,
  recoveryHopSeconds,
  waterQa,
} from './water';

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
    setProfiles: (incidentId: string, codes: string[]) => void;
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
  it('stability follows its anchor and never reaches zero (the mock keeps every patient alive)', () => {
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
    expect(TransportPatientResult.safeParse(result).success).toBe(true);
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

  it('"load and go" (D-101): a patient the units here cannot stabilise is not treated, and can leave for hospital as it is', async () => {
    const w = await world();
    w.qa.medicalConfig({ autoTransportSeconds: 3600, externalSeconds: 3600 });
    // EMS_MSB: MEDICAL_BASIC 70, no MEDICAL_ADVANCED — a major trauma (RED) needs MEDICAL_ADVANCED 80 as well
    const { vehicleId } = w.qa.giveAmbulance();
    const incidentId = spawnFall(w);
    w.qa.setProfiles(incidentId, ['PP_MAJOR_TRAUMA']);
    w.engine.dispatch(w.career, incidentId, [vehicleId]);
    until(w, () => patientOf(w.career, incidentId).dto.status === 'ASSESSED');
    const p = patientOf(w.career, incidentId);
    expect(p.dto.transportRequired).toBe(true);
    // like the server: no treatment starts, ever, and nothing moves by itself — only the player's choice
    w.advance(180_000);
    expect(p.dto).toMatchObject({ status: 'ASSESSED', busyUntil: null });
    expect(p.dto.needs.find((n) => n.capability === 'MEDICAL_ADVANCED')!.met).toBe(false);
    expect(p.dto.stability!.ratePerSecond).toBeLessThan(0);
    expect(w.career.actions.some((a) => a.type === 'PATIENT_AUTO_TRANSPORT' && a.ref === p.dto.id)).toBe(
      false,
    );

    const hospitalId = w.medical.hospitalOptions(w.career, p.dto.id).find((o) => o.recommended)!.hospitalId;
    const result = w.medical.transport(w.career, p.dto.id, { hospitalId });
    expect(TransportPatientResult.safeParse(result).success).toBe(true);
    expect(result.patient.status).toBe('IN_TRANSPORT');
    expect(result.vehicle).toMatchObject({ id: vehicleId, status: 'TRANSPORTING' });
    // left unstabilised: the outcome can only be "admitted, worsened" or "admitted, stable" on how the trip goes
    expect(p.stabilized).toBe(false);
    until(w, () => p.dto.status === 'ADMITTED');
  });

  it('refuses a transport for a patient who needs no hospital, or who is already on the way', async () => {
    const w = await world();
    w.qa.medicalConfig({ autoTransportSeconds: 3600, externalSeconds: 3600 });
    const { vehicleId } = w.qa.giveAmbulance();
    const incidentId = spawnFall(w);
    w.engine.dispatch(w.career, incidentId, [vehicleId]);
    until(w, () => patientOf(w.career, incidentId).dto.status !== 'UNASSESSED');
    const p = patientOf(w.career, incidentId);
    const hospitalId = w.medical.hospitalOptions(w.career, p.dto.id).find((o) => o.recommended)!.hospitalId;
    const refusal = () => {
      try {
        w.medical.transport(w.career, p.dto.id, { hospitalId });
      } catch (e) {
        return e instanceof MockError ? (e.details as { reason?: string } | undefined)?.reason : 'THROWN';
      }
      return 'OK';
    };
    p.dto = { ...p.dto, transportRequired: false };
    expect(refusal()).toBe('TRANSPORT_NOT_REQUIRED');
    p.dto = { ...p.dto, transportRequired: true, status: 'IN_TRANSPORT' };
    expect(refusal()).toBe('PATIENT_NOT_TRANSPORTABLE');
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

  it('two ambulances staffed one after the other both leave the same station, each on its own dispatch', async () => {
    const w = await world();
    // `giveAmbulance` staffs each new ambulance on its own (two separate `staffAll`): the station then has two crews.
    const first = w.qa.giveAmbulance();
    const second = w.qa.giveAmbulance();
    const a = spawnFall(w);
    const b = w.engine.spawnIncident(w.career, 'MED_FALL', false, { severity: 4 }).id;
    // The first one's top-up to its optimal crew takes the best candidates left, never both drivers of the station.
    expect(() => w.engine.dispatch(w.career, a, [first.vehicleId])).not.toThrow();
    const option = w.engine
      .dispatchOptions(w.career, b)
      .options.find((o) => o.vehicleId === second.vehicleId)!;
    expect(option).toMatchObject({ dispatchable: true, blockedReason: null });
    expect(option.crew).toMatchObject({ missingQualifications: [] });
    expect(() => w.engine.dispatch(w.career, b, [second.vehicleId])).not.toThrow();
    expect(w.career.vehicles.find((v) => v.id === second.vehicleId)!.status).toBe('PREPARING');
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

describe('mass-casualty care (major incidents §1)', () => {
  const TRIAGE_RANK: Record<string, number> = { RED: 0, ORANGE: 1, BLUE: 2, GREEN: 3, WHITE: 4 };
  const multiPatient = (w: World) => {
    w.engine.cancelActions(w.career, (a) => a.type === 'INCIDENT_SPAWN');
    return w.engine.spawnIncident(w.career, 'MED_MULTI_PATIENT', false, { severity: 6 }).id;
  };
  const patientsAt = (w: World, incidentId: string) =>
    medicalState(w.career).patients.filter((p) => p.dto.incidentId === incidentId);
  const onScene = (w: World, vehicleId: string) =>
    until(w, () => w.career.vehicles.find((v) => v.id === vehicleId)!.status === 'ON_SCENE');

  it('the maxi ambulance boards the other waiting patients, worst code first, up to 4 in one trip', async () => {
    const w = await world(1, 9);
    w.qa.medicalConfig({ autoTransportSeconds: 3600, externalSeconds: 3600 });
    (w.qa as unknown as { medicalConfig: (c: Record<string, unknown>) => void }).medicalConfig({
      alwaysTransport: true,
    });
    const { vehicleId } = w.qa.giveAmbulance('EMS_MAXI');
    const incidentId = multiPatient(w);
    w.engine.dispatch(w.career, incidentId, [vehicleId]);
    onScene(w, vehicleId);
    const patients = patientsAt(w, incidentId);
    expect(patients.length).toBeGreaterThanOrEqual(4);
    for (const p of patients) w.qa.stabilize(p.dto.id);
    const [first] = patients;
    const hospital = w.medical.hospitalOptions(w.career, first!.dto.id).find((o) => o.recommended)!;
    const result = w.medical.transport(w.career, first!.dto.id, { hospitalId: hospital.hospitalId });
    expect(TransportPatientResult.safeParse(result).success).toBe(true);
    expect(result.boarded).toHaveLength(3);
    const ranks = result.boarded.map((b) => TRIAGE_RANK[b.triage!] ?? 9);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    for (const p of [result.patient, ...result.boarded])
      expect(p).toMatchObject({
        status: 'IN_TRANSPORT',
        assignedVehicleId: vehicleId,
        hospitalId: hospital.hospitalId,
      });
    expect(result.vehicle.status).toBe('TRANSPORTING');
    // Everyone aboard arrives with the vehicle and is handed over.
    until(w, () => w.career.vehicles.find((v) => v.id === vehicleId)!.status === 'AT_HOSPITAL');
    expect(patientsAt(w, incidentId).filter((p) => p.dto.status === 'HANDOFF')).toHaveLength(4);
  });

  it('boards exactly the patients the player picked, within the capacity', async () => {
    const w = await world(1, 9);
    w.qa.medicalConfig({ autoTransportSeconds: 3600, externalSeconds: 3600 });
    (w.qa as unknown as { medicalConfig: (c: Record<string, unknown>) => void }).medicalConfig({
      alwaysTransport: true,
    });
    const { vehicleId } = w.qa.giveAmbulance('EMS_MAXI');
    const incidentId = multiPatient(w);
    w.engine.dispatch(w.career, incidentId, [vehicleId]);
    onScene(w, vehicleId);
    const patients = patientsAt(w, incidentId);
    for (const p of patients) w.qa.stabilize(p.dto.id);
    const [a, b, c, d, e] = patients.map((p) => p.dto.id);
    const hospitalId = w.medical.hospitalOptions(w.career, a!).find((o) => o.recommended)!.hospitalId;
    // Over the capacity: refused.
    expect(() =>
      w.medical.transport(w.career, a!, { hospitalId, vehicleId, withPatientIds: [b!, c!, d!, e ?? b!] }),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    const result = w.medical.transport(w.career, a!, { hospitalId, vehicleId, withPatientIds: [c!] });
    expect(result.boarded.map((p) => p.id)).toEqual([c]);
    expect(patientsAt(w, incidentId).find((p) => p.dto.id === b)!.dto.status).toBe('AWAITING_TRANSPORT');
  });

  it('a normal ambulance carries one patient: a list of others is refused', async () => {
    const w = await world(1, 9);
    w.qa.medicalConfig({ autoTransportSeconds: 3600, externalSeconds: 3600 });
    (w.qa as unknown as { medicalConfig: (c: Record<string, unknown>) => void }).medicalConfig({
      alwaysTransport: true,
    });
    const { vehicleId } = w.qa.giveAmbulance('EMS_MSB');
    const incidentId = multiPatient(w);
    w.engine.dispatch(w.career, incidentId, [vehicleId]);
    onScene(w, vehicleId);
    const patients = patientsAt(w, incidentId);
    for (const p of patients) w.qa.stabilize(p.dto.id);
    const [a, b] = patients.map((p) => p.dto.id);
    const hospitalId = w.medical.hospitalOptions(w.career, a!).find((o) => o.recommended)!.hospitalId;
    expect(() => w.medical.transport(w.career, a!, { hospitalId, vehicleId, withPatientIds: [b!] })).toThrow(
      expect.objectContaining({ code: 'CONFLICT', details: { reason: 'SINGLE_PATIENT_VEHICLE' } }),
    );
    expect(w.medical.transport(w.career, a!, { hospitalId, vehicleId }).boarded).toEqual([]);
  });

  it('the advanced medical post treats on scene, faster, and releases the lighter codes there', async () => {
    const w = await world(1, 9);
    w.qa.medicalConfig({ autoTransportSeconds: 3600, externalSeconds: 3600 });
    (w.qa as unknown as { medicalConfig: (c: Record<string, unknown>) => void }).medicalConfig({
      alwaysTransport: true,
    });
    const { vehicleId } = w.qa.giveAmbulance('EMS_PMA');
    const incidentId = multiPatient(w);
    w.engine.dispatch(w.career, incidentId, [vehicleId]);
    onScene(w, vehicleId);
    const light = new Set(['GREEN', 'WHITE', 'BLUE']);
    until(w, () =>
      patientsAt(w, incidentId).every(
        (p) => p.dto.status === 'RELEASED_ON_SCENE' || p.dto.status === 'AWAITING_TRANSPORT',
      ),
    );
    for (const p of patientsAt(w, incidentId)) {
      const triage = p.dto.triage!;
      if (light.has(triage)) expect(p.dto.status).toBe('RELEASED_ON_SCENE');
    }
    // It never carries anybody: no hospital option can use it.
    const waiting = patientsAt(w, incidentId).find((p) => p.dto.status === 'AWAITING_TRANSPORT');
    if (waiting) {
      const hospitalId = w.medical
        .hospitalOptions(w.career, waiting.dto.id)
        .find((o) => o.recommended)!.hospitalId;
      expect(() => w.medical.transport(w.career, waiting.dto.id, { hospitalId, vehicleId })).toThrow(
        expect.objectContaining({ code: 'VEHICLE_NOT_AVAILABLE' }),
      );
    }
  });
});

describe('water patients (analisi/note-agenti/water-patients.md)', () => {
  /** A level-18 career off duty (no random calls), rich enough for a Base nautica; no automatic hospital or external step. */
  async function waterWorld(speed = 1) {
    const w = await world(speed, 18);
    w.engine.setDuty(w.career, false);
    w.engine.credit(w.career, 500_000, 'ADMIN_ADJUSTMENT', true);
    const raw = w.engine.qa as unknown as {
      buildNauticalBase: () => string;
      recoverNow: (incidentId?: string) => void;
      medicalConfig: (c: Record<string, unknown>) => void;
    };
    raw.medicalConfig({ autoTransportSeconds: 3600, externalSeconds: 3600 });
    const water = waterQa(w.engine);
    let baseId: string | null = null;
    /** A crewed boat of that type at the Base nautica (bought on first use). */
    const boat = (typeCode = 'FIRE_BOAT') => {
      baseId ??= raw.buildNauticalBase();
      const id = water.addBoat(typeCode, baseId);
      w.engine.qa.staffAll();
      return id;
    };
    const incident = (id: string) => w.career.incidents.find((i) => i.id === id)!;
    const vehicle = (id: string) => w.career.vehicles.find((v) => v.id === id)!;
    const patients = (incidentId: string) =>
      medicalState(w.career).patients.filter((p) => p.dto.incidentId === incidentId);
    const onScene = (vehicleId: string) => until(w, () => vehicle(vehicleId).status === 'ON_SCENE');
    const arrivedAt = (vehicleId: string, incidentId: string) =>
      [...w.career.legs].reverse().find((l) => l.vehicleId === vehicleId && l.incidentId === incidentId)!
        .arrivedAt!;
    /** Fixes the (hidden) profile of each patient, in label order (the last code for the rest). */
    const profiles = (incidentId: string, codes: string[]) =>
      patients(incidentId).forEach((p, i) => {
        p.profileCode = codes[i] ?? codes.at(-1)!;
      });
    const refusal = (fn: () => unknown): { code: string; details?: unknown } => {
      try {
        fn();
      } catch (e) {
        return e instanceof MockError ? { code: e.code, details: e.details } : { code: 'THROWN' };
      }
      return { code: 'OK' };
    };
    return { ...w, raw, water, boat, incident, vehicle, patients, onScene, arrivedAt, profiles, refusal };
  }
  const recoveredLines = (w: World, incidentId: string, key: string) =>
    (w.career.timelines[incidentId] ?? []).filter((e) => e.text.key === key);

  it('knows the water units, how many people each brings per trip and who is picked up first', () => {
    const unit = (typeCode: string) => isWaterUnit({ typeCode });
    for (const code of ['FIRE_BOAT', 'EMS_JETSKI', 'EMS_WATER_AMBULANCE', 'POL_PATROL_BOAT', 'FIRE_FIREBOAT'])
      expect(unit(code), code).toBe(true);
    // winch helicopters reach the water too; the other aircraft and the land units do not
    for (const code of ['EMS_HELI', 'FIRE_HELI', 'ALP_HELI']) expect(unit(code), code).toBe(true);
    for (const code of ['EMS_MSB', 'FIRE_APS', 'POL_HELI', 'AIB_HELI', 'AIB_PLANE'])
      expect(unit(code), code).toBe(false);
    expect(
      ['EMS_JETSKI', 'EMS_WATER_AMBULANCE', 'FIRE_BOAT', 'POL_PATROL_BOAT', 'FIRE_FIREBOAT', 'EMS_HELI'].map(
        recoveryCapacity,
      ),
    ).toEqual([1, 2, 4, 6, 8, 1]);
    expect(recoveryCapacity('SOME_OTHER_BOAT')).toBe(RECOVERY_KNOBS.defaultCapacity);
    const patient = (label: string, profileCode: string) =>
      ({ dto: { label }, profileCode }) as unknown as MockPatient;
    const order = [
      patient('Paziente 10', 'PP_MINOR_MEDICAL'),
      patient('Paziente 3', 'PP_HYPOTHERMIA'),
      patient('Paziente 2', 'PP_NEAR_DROWNING'),
      patient('Paziente 1', 'PP_UNCONSCIOUS'),
      patient('Paziente 4', 'PP_NEAR_DROWNING'),
    ]
      .sort(byRecoveryPriority)
      .map((p) => p.dto.label);
    // the worst true triage first (RED, ORANGE, BLUE…), then the label order
    expect(order).toEqual(['Paziente 2', 'Paziente 4', 'Paziente 1', 'Paziente 3', 'Paziente 10']);
  });

  it('puts the patients of a water incident in the water, those of a land incident ashore as before', async () => {
    const w = await waterWorld();
    w.boat(); // a boat able to do the water part: no Coast Guard
    const id = w.water.spawnWater('MED_SWIMMER_DISTRESS', { severity: 3 });
    expect(w.incident(id).waterSupport).toBeNull();
    const list = w.medical.patients(w.career, id);
    expect(list.length).toBeGreaterThan(0);
    for (const p of list)
      expect(p).toMatchObject({
        status: 'UNASSESSED',
        location: 'WATER',
        recovery: { by: null, vehicleId: null, etaAt: null, recoveredAt: null },
      });
    expect(z.array(PatientDto).safeParse(list).success).toBe(true);
    const land = w.engine.spawnIncident(w.career, 'MED_FALL', false, { severity: 4 }).id;
    expect(w.medical.patients(w.career, land)[0]).toMatchObject({ location: 'ASHORE', recovery: null });
  });

  it('the Coast Guard lands everybody still in the water at one instant, always the same for an incident', async () => {
    const w = await waterWorld();
    // no boat: the Coast Guard covers the water part
    const id = w.water.spawnWater('MED_SWIMMER_DISTRESS', { severity: 3 });
    const inc = w.incident(id);
    const seconds = coastGuardRecoverySeconds(id);
    expect(seconds).toBeGreaterThanOrEqual(RECOVERY_KNOBS.coastGuardSeconds[0]);
    expect(seconds).toBeLessThanOrEqual(RECOVERY_KNOBS.coastGuardSeconds[1]);
    expect(coastGuardRecoverySeconds(id)).toBe(seconds);
    const recoveryAt = iso(Date.parse(inc.createdAt) + seconds * 1000);
    expect(inc.waterSupport).toMatchObject({ provider: 'COAST_GUARD', recoveryAt });
    expect(IncidentDto.safeParse(inc).success).toBe(true);
    const list = w.patients(id);
    for (const p of list)
      expect(p.dto.recovery).toEqual({
        by: 'COAST_GUARD',
        vehicleId: null,
        etaAt: recoveryAt,
        recoveredAt: null,
      });

    until(w, () => list.every((p) => p.dto.location === 'ASHORE'));
    for (const p of list)
      expect(p.dto.recovery).toEqual({
        by: 'COAST_GUARD',
        vehicleId: null,
        etaAt: null,
        recoveredAt: recoveryAt,
      });
    const [line, ...more] = recoveredLines(w, id, 'timeline.patients_recovered_coast_guard');
    expect(more).toEqual([]);
    expect(line).toMatchObject({
      at: recoveryAt,
      text: { params: { labels: list.map((p) => p.dto.label).join(', '), count: list.length } },
    });
    expect(
      w.events.some(
        (e) =>
          e.type === 'patient.updated' &&
          e.payload.recovered === true &&
          (e.payload.patient as PatientDto).id === list[0]!.dto.id,
      ),
    ).toBe(true);
    // the instant stays on the incident once it is past (= done)
    expect(w.incident(id).waterSupport!.recoveryAt).toBe(recoveryAt);
  });

  it('the ambulance at the meeting point does nothing for a patient in the water, then takes over once ashore', async () => {
    const w = await waterWorld();
    // a late Coast Guard, and an external ambulance that would step in after 5 s if nobody were bringing them ashore
    w.raw.medicalConfig({ coastGuardSeconds: 900, externalSeconds: 5 });
    const id = w.water.spawnWater('MED_SWIMMER_DISTRESS', { severity: 3 });
    const { vehicleId: ambulance } = w.qa.giveAmbulance();
    w.engine.dispatch(w.career, id, [ambulance]);
    w.onScene(ambulance);
    w.advance(120_000);
    const list = w.patients(id);
    for (const p of list) {
      expect(p.dto).toMatchObject({ status: 'UNASSESSED', location: 'WATER', needs: [], stability: null });
      expect(p.external).toBe(false);
      const decay = PATIENT_PROFILES.find((x) => x.code === p.profileCode)!.stability.decayPerMinuteUntreated;
      expect(p.stability.ratePerSecond).toBeCloseTo(-decay / 60, 9);
    }
    const first = list[0]!;
    // whatever its status, nobody leaves for hospital from the water
    w.qa.stabilize(first.dto.id);
    expect(first.dto).toMatchObject({ status: 'AWAITING_TRANSPORT', location: 'WATER' });
    expect(
      w.refusal(() => w.medical.transport(w.career, first.dto.id, { hospitalId: HOSPITALS[0]!.id })),
    ).toEqual({ code: 'CONFLICT', details: { reason: 'PATIENT_IN_WATER' } });
    expect(w.career.actions.some((a) => a.type === 'PATIENT_AUTO_TRANSPORT')).toBe(false);

    until(w, () => first.dto.location === 'ASHORE');
    expect(first.dto.recovery!.by).toBe('COAST_GUARD');
    // ashore: the ambulance assesses the others at once, the hospital timer runs, the transport leaves the meeting point
    for (const p of list.slice(1)) expect(p.dto.status).not.toBe('UNASSESSED');
    expect(w.career.actions.some((a) => a.type === 'PATIENT_AUTO_TRANSPORT' && a.ref === first.dto.id)).toBe(
      true,
    );
    const recommended = w.medical.hospitalOptions(w.career, first.dto.id).find((o) => o.recommended)!;
    const result = w.medical.transport(w.career, first.dto.id, { hospitalId: recommended.hospitalId });
    expect(result.vehicle).toMatchObject({ id: ambulance, status: 'TRANSPORTING' });
    expect(result.vehicle.movement!.path[0]).toEqual(w.incident(id).position);
  });

  it('only the water units count in the water: the boat assesses with its own capabilities, lands the patient, then load and go', async () => {
    const w = await waterWorld();
    const boatId = w.boat('FIRE_BOAT');
    const { vehicleId: ambulance } = w.qa.giveAmbulance();
    w.raw.medicalConfig({ alwaysTransport: true });
    const id = w.water.spawnWater('MED_SWIMMER_DISTRESS', { severity: 3 });
    w.profiles(id, ['PP_NEAR_DROWNING']);
    w.engine.dispatch(w.career, id, [ambulance]);
    w.onScene(ambulance);
    w.advance(30_000);
    const first = w.patients(id)[0]!;
    expect(first.dto).toMatchObject({ status: 'UNASSESSED', location: 'WATER' });

    // a long pickup: time to watch the care in the water
    w.raw.medicalConfig({ waterPickupSeconds: 600 });
    w.engine.dispatch(w.career, id, [boatId]);
    w.onScene(boatId);
    const inc = w.incident(id);
    const landsAt =
      w.arrivedAt(boatId, id) +
      (600 + recoveryHopSeconds(w.engine, 'FIRE_BOAT', sceneOf(inc), landingOf(w.career, inc))) * 1000;
    expect(first.dto).toMatchObject({
      status: 'ASSESSED',
      location: 'WATER',
      recovery: { by: 'VEHICLE', vehicleId: boatId, etaAt: iso(landsAt), recoveredAt: null },
    });
    // what the BOAT brings (MEDICAL_BASIC 45 < 60): the ambulance's 70 at the meeting point does not count
    expect(first.dto.needs).toEqual([
      { capability: 'MEDICAL_BASIC', met: false },
      { capability: 'MEDICAL_ADVANCED', met: false },
    ]);
    // nothing the boat can give (like the server): no treatment in the water, no hospital timer, no "awaiting transport"
    // notification — and no transport from the water
    w.advance(60_000);
    expect(first.dto).toMatchObject({ status: 'ASSESSED', location: 'WATER', busyUntil: null });
    expect(w.career.actions.some((a) => a.type === 'PATIENT_AUTO_TRANSPORT')).toBe(false);
    const awaiting = () =>
      w.career.notifications.filter((n) => n.title.key === 'notifications.patientAwaitingTransport');
    expect(awaiting()).toEqual([]);
    const hospitalId = w.medical
      .hospitalOptions(w.career, first.dto.id)
      .find((o) => o.recommended)!.hospitalId;
    expect(w.refusal(() => w.medical.transport(w.career, first.dto.id, { hospitalId }))).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'PATIENT_IN_WATER' },
    });

    // the landing, at the planned instant: one timeline line, the event, every unit on scene counts from now on
    until(w, () => first.dto.location === 'ASHORE');
    expect(first.dto.recovery).toEqual({
      by: 'VEHICLE',
      vehicleId: boatId,
      etaAt: null,
      recoveredAt: iso(landsAt),
    });
    const [line] = recoveredLines(w, id, 'timeline.patients_recovered');
    expect(line).toMatchObject({
      at: iso(landsAt),
      vehicleId: boatId,
      text: {
        params: {
          labels: w
            .patients(id)
            .map((p) => p.dto.label)
            .join(', '),
          count: w.patients(id).length,
          callSign: w.vehicle(boatId).callSign,
        },
      },
    });
    expect(
      w.events.some(
        (e) =>
          e.type === 'patient.updated' &&
          e.payload.recovered === true &&
          (e.payload.patient as PatientDto).id === first.dto.id,
      ),
    ).toBe(true);
    // ashore the ambulance counts, but it has no MEDICAL_ADVANCED: still assessed, no treatment, no hospital timer
    expect(first.dto.needs.find((n) => n.capability === 'MEDICAL_BASIC')!.met).toBe(true);
    expect(first.dto.needs.find((n) => n.capability === 'MEDICAL_ADVANCED')!.met).toBe(false);
    expect(first.dto.status).toBe('ASSESSED');
    expect(w.career.actions.some((a) => a.type === 'PATIENT_AUTO_TRANSPORT' && a.ref === first.dto.id)).toBe(
      false,
    );
    expect(awaiting()).toEqual([]);
    // "load and go" (D-101): the player takes them to hospital as they are, from the meeting point
    const result = w.medical.transport(w.career, first.dto.id, { hospitalId });
    expect(TransportPatientResult.safeParse(result).success).toBe(true);
    expect(result.patient.status).toBe('IN_TRANSPORT');
    expect(result.vehicle).toMatchObject({ id: ambulance, status: 'TRANSPORTING' });
    expect(result.vehicle.movement!.path[0]).toEqual(inc.position);
  });

  it('a water ambulance treats a near-drowning patient in the water', async () => {
    const w = await waterWorld();
    const unit = w.boat('EMS_WATER_AMBULANCE');
    w.raw.medicalConfig({ waterPickupSeconds: 900, alwaysTransport: true });
    const id = w.water.spawnWater('MED_SWIMMER_DISTRESS', { severity: 3 });
    w.profiles(id, ['PP_NEAR_DROWNING']);
    w.engine.dispatch(w.career, id, [unit]);
    w.onScene(unit);
    const p = w.patients(id)[0]!;
    until(w, () => p.dto.status === 'TREATING');
    expect(p.dto.location).toBe('WATER');
    expect(p.dto.needs.every((n) => n.met)).toBe(true);
    expect(p.dto.stability!.ratePerSecond).toBeGreaterThan(0);
    until(w, () => p.dto.status === 'AWAITING_TRANSPORT');
    expect(p.dto.location).toBe('WATER');
    expect(p.stabilized).toBe(true);
  });

  it('treated to the end in the water with no hospital needed: released there at once — the trip lands nobody for them', async () => {
    const w = await waterWorld();
    const unit = w.boat('EMS_WATER_AMBULANCE'); // 2 people per trip
    w.raw.medicalConfig({ waterPickupSeconds: 900 });
    const id = w.water.spawnWater('MULTI_CAPSIZED_BOAT', { severity: 7, body: 'SEA' });
    const list = w.patients(id);
    expect(list.length).toBeGreaterThanOrEqual(3);
    // all minor: the first two need no hospital, the others do
    w.profiles(id, ['PP_MINOR_MEDICAL']);
    list.forEach((p, i) => (p.transportDrawn = i >= 2));
    w.engine.dispatch(w.career, id, [unit]);
    w.onScene(unit);
    const [first, second, third] = list;
    const firstTrip = first!.dto.recovery!.etaAt!;
    expect(second!.dto.recovery).toMatchObject({ by: 'VEHICLE', vehicleId: unit, etaAt: firstTrip });
    expect(third!.dto.recovery!.by).toBeNull();
    // treated aboard, no hospital needed: released at once, still in the water
    until(w, () => first!.dto.status === 'RELEASED_ON_SCENE' && second!.dto.status === 'RELEASED_ON_SCENE');
    for (const p of [first!, second!]) expect(p.dto.location).toBe('WATER');
    expect(first!.outcome).toBe('RELEASED_ON_SCENE');
    // the others wait in the water, awaiting the hospital
    until(w, () => third!.dto.status === 'AWAITING_TRANSPORT');
    expect(third!.dto.location).toBe('WATER');
    // the trip ends at its instant with nobody to land; the unit sails back for the next ones
    until(w, () => third!.dto.recovery?.by === 'VEHICLE');
    const inc = w.incident(id);
    const out = recoveryHopSeconds(w.engine, 'EMS_WATER_AMBULANCE', sceneOf(inc), landingOf(w.career, inc));
    const back = recoveryHopSeconds(w.engine, 'EMS_WATER_AMBULANCE', landingOf(w.career, inc), sceneOf(inc));
    expect(third!.dto.recovery!.etaAt).toBe(iso(Date.parse(firstTrip) + (back + 900 + out) * 1000));
    expect(recoveredLines(w, id, 'timeline.patients_recovered')).toEqual([]);
    for (const p of [first!, second!]) expect(p.dto.location).toBe('WATER');
  });

  it('a jet ski brings one person per trip, the worst first; its next trip first goes back to the scene', async () => {
    const w = await waterWorld();
    const jet = w.boat('EMS_JETSKI');
    const id = w.water.spawnWater('MULTI_CAPSIZED_BOAT', { severity: 5, body: 'SEA' });
    expect(w.incident(id).waterSupport).toBeNull();
    const list = w.patients(id);
    expect(list.length).toBeGreaterThanOrEqual(2);
    // Paziente 1 hypothermia (BLUE), Paziente 2 near drowning (RED), the others minor (WHITE)
    w.profiles(id, ['PP_HYPOTHERMIA', 'PP_NEAR_DROWNING', 'PP_MINOR_MEDICAL']);
    w.engine.dispatch(w.career, id, [jet]);
    w.onScene(jet);
    const inc = w.incident(id);
    const out = recoveryHopSeconds(w.engine, 'EMS_JETSKI', sceneOf(inc), landingOf(w.career, inc));
    const back = recoveryHopSeconds(w.engine, 'EMS_JETSKI', landingOf(w.career, inc), sceneOf(inc));
    expect(out).toBeGreaterThanOrEqual(5);
    const firstLanding = w.arrivedAt(jet, id) + (RECOVERY_KNOBS.pickupSeconds + out) * 1000;
    const aboard = () =>
      list
        .filter((p) => p.dto.location === 'WATER' && p.dto.recovery?.by === 'VEHICLE')
        .map((p) => p.dto.label);
    expect(aboard()).toEqual(['Paziente 2']);
    expect(list[1]!.dto.recovery!.etaAt).toBe(iso(firstLanding));
    expect(list.filter((p) => p.dto.recovery?.by === null)).toHaveLength(list.length - 1);

    until(w, () => list[1]!.dto.location === 'ASHORE');
    expect(list[1]!.dto.recovery).toEqual({
      by: 'VEHICLE',
      vehicleId: jet,
      etaAt: null,
      recoveredAt: iso(firstLanding),
    });
    // at once the next one (the BLUE before the WHITE ones), sailing back to the scene first
    expect(aboard()).toEqual(['Paziente 1']);
    expect(list[0]!.dto.recovery!.etaAt).toBe(
      iso(firstLanding + (back + RECOVERY_KNOBS.pickupSeconds + out) * 1000),
    );
    // trip after trip until nobody is left in the water: one line per trip
    until(w, () => list.every((p) => p.dto.location === 'ASHORE'));
    expect(recoveredLines(w, id, 'timeline.patients_recovered')).toHaveLength(list.length);
  });

  it('no trip that would land after the Coast Guard; a trip that lands before takes the people', async () => {
    const w = await waterWorld();
    // the calls come in before the career has a boat: the Coast Guard covers both
    w.raw.medicalConfig({ coastGuardSeconds: 5000 });
    const late = w.water.spawnWater('MED_SWIMMER_DISTRESS', { severity: 3 });
    w.raw.medicalConfig({ coastGuardSeconds: 700 });
    const soon = w.water.spawnWater('MED_SWIMMER_DISTRESS', { severity: 3 });
    const [a, b] = [w.boat('FIRE_BOAT'), w.boat('FIRE_BOAT')];
    w.raw.medicalConfig({ waterPickupSeconds: 1000 });
    w.engine.dispatch(w.career, soon, [a]);
    w.engine.dispatch(w.career, late, [b]);
    w.onScene(a);
    w.onScene(b);
    // soon: the trip would land after the Coast Guard, the boat only gives its care in the water
    for (const p of w.patients(soon))
      expect(p.dto).toMatchObject({ location: 'WATER', recovery: { by: 'COAST_GUARD' } });
    expect(w.patients(soon)[0]!.dto.status).not.toBe('UNASSESSED');
    // late: the boat lands them long before the Coast Guard would
    for (const p of w.patients(late)) expect(p.dto.recovery).toMatchObject({ by: 'VEHICLE', vehicleId: b });
    const coastGuardAt = Date.parse(w.incident(late).waterSupport!.recoveryAt!);
    expect(Date.parse(w.patients(late)[0]!.dto.recovery!.etaAt!)).toBeLessThan(coastGuardAt);
    expect(
      w.career.actions.some(
        (a) => a.type === 'PATIENT_COAST_GUARD' && w.patients(late).some((p) => p.dto.id === a.ref),
      ),
    ).toBe(false);
    until(
      w,
      () => [...w.patients(soon), ...w.patients(late)].every((p) => p.dto.location === 'ASHORE'),
      3_600_000,
    );
    for (const p of w.patients(soon)) expect(p.dto.recovery!.by).toBe('COAST_GUARD');
    for (const p of w.patients(late)) expect(p.dto.recovery!.by).toBe('VEHICLE');
  });

  it('when the work ends the water units stay while somebody is in the water; a boat with no care to give then goes home', async () => {
    const w = await waterWorld();
    const patrol = w.boat('POL_PATROL_BOAT');
    const { vehicleId: ambulance } = w.qa.giveAmbulance();
    w.raw.medicalConfig({ waterPickupSeconds: 3000 });
    const id = w.water.spawnWater('MED_SWIMMER_DISTRESS', { severity: 3 });
    w.engine.dispatch(w.career, id, [patrol, ambulance]);
    w.onScene(patrol);
    const list = w.patients(id);
    // no medical crew aboard: it brings them ashore without assessing them
    for (const p of list)
      expect(p.dto).toMatchObject({ status: 'UNASSESSED', recovery: { by: 'VEHICLE', vehicleId: patrol } });
    until(w, () => w.incident(id).status === 'RESOLVING');
    expect(w.vehicle(patrol).status).toBe('ON_SCENE');
    expect(w.vehicle(ambulance).status).toBe('ON_SCENE');
    w.raw.recoverNow(id);
    expect(list.every((p) => p.dto.location === 'ASHORE')).toBe(true);
    expect(w.vehicle(patrol).status).toBe('RETURNING');
    expect(w.vehicle(ambulance).status).toBe('ON_SCENE');
    // the ambulance at the meeting point assesses them now
    expect(list.every((p) => p.dto.status !== 'UNASSESSED')).toBe(true);
  });

  it('a unit recalled during a trip still lands the people aboard at the planned instant', async () => {
    const w = await waterWorld();
    const boatId = w.boat('FIRE_BOAT');
    const id = w.water.spawnWater('MED_SWIMMER_DISTRESS', { severity: 3 });
    w.engine.dispatch(w.career, id, [boatId]);
    w.onScene(boatId);
    const p = w.patients(id)[0]!;
    const etaAt = p.dto.recovery!.etaAt!;
    w.engine.recall(w.career, boatId);
    expect(w.vehicle(boatId).status).toBe('RETURNING');
    until(w, () => p.dto.location === 'ASHORE');
    expect(p.dto.recovery).toEqual({ by: 'VEHICLE', vehicleId: boatId, etaAt: null, recoveredAt: etaAt });
  });

  it('a multi-patient ambulance boards only the people already ashore', async () => {
    const w = await waterWorld();
    const { vehicleId: maxi } = w.qa.giveAmbulance('EMS_MAXI');
    const jet = w.boat('EMS_JETSKI');
    w.raw.medicalConfig({ waterPickupSeconds: 5000 });
    const id = w.water.spawnWater('MULTI_CAPSIZED_BOAT', { severity: 5, body: 'SEA' });
    w.engine.dispatch(w.career, id, [maxi, jet]);
    w.onScene(maxi);
    w.onScene(jet);
    const list = w.patients(id);
    w.raw.recoverNow(id); // the jet ski's first trip: one person ashore, the next one aboard
    const [ashore] = list.filter((p) => p.dto.location === 'ASHORE');
    const wet = list.filter((p) => p.dto.location === 'WATER');
    expect(ashore).toBeDefined();
    expect(wet.length).toBeGreaterThan(0);
    // its trip over, the jet ski went back at once for the next one
    expect(wet.filter((p) => p.dto.recovery?.by === 'VEHICLE')).toHaveLength(1);
    for (const p of list) w.qa.stabilize(p.dto.id);
    const hospitalId = w.medical
      .hospitalOptions(w.career, ashore!.dto.id)
      .find((o) => o.recommended)!.hospitalId;
    expect(
      w.refusal(() =>
        w.medical.transport(w.career, ashore!.dto.id, {
          hospitalId,
          vehicleId: maxi,
          withPatientIds: [wet[0]!.dto.id],
        }),
      ),
    ).toEqual({ code: 'CONFLICT', details: { reason: 'PATIENT_IN_WATER' } });
    const result = w.medical.transport(w.career, ashore!.dto.id, { hospitalId, vehicleId: maxi });
    expect(result.boarded).toEqual([]);
  });

  it('nobody reaches the water: the external rescuers take the patient in the end (never a stall)', async () => {
    const w = await waterWorld(12);
    w.raw.medicalConfig({ autoTransportSeconds: 5, externalSeconds: 5 });
    // no Coast Guard on a river
    const id = w.water.spawnWater('MULTI_PERSON_IN_WATER', { body: 'RIVER' });
    expect(w.incident(id).waterSupport).toBeNull();
    const { vehicleId } = w.qa.giveAmbulance();
    w.engine.dispatch(w.career, id, [vehicleId]);
    const p = w.patients(id)[0]!;
    until(w, () => p.external);
    expect(p.dto).toMatchObject({ status: 'IN_TRANSPORT', assignedVehicleId: null });
    until(w, () => !w.career.incidents.some((i) => i.id === id));
    expect(w.career.stats.resolved + w.career.stats.failed).toBe(1);
  });
});
