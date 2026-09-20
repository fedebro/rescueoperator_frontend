import { xpThreshold } from './data/catalog';
import { PESCARA } from './data/pescara';
import { MockError, type MockCareer, type MockEngine } from './engine';

/**
 * QA / demo helpers exposed as `window.__rcMock.qa.*` (and used by unit tests and Playwright to reach a game state
 * quickly). They go through the same engine functions as the REST handlers, so every invariant still holds.
 * Domain modules may add their own entries: `engine.qa.myHelper = (...) => …`.
 */
export type QaHelpers = Record<string, (...args: never[]) => unknown> & {
  createReadyCareer: (o: {
    email: string;
    directorName: string;
    level?: number;
    credits?: number;
    tutorialDone?: boolean;
  }) => { careerId: string };
  career: () => MockCareer;
  grant: (o: { credits?: number; xp?: number }) => void;
  setLevel: (level: number) => void;
  /** `minDistanceMeters` forces a far spawn, so the travel phase lasts long enough to be observed. */
  spawn: (templateCode: string, severity?: number, minDistanceMeters?: number) => string;
  fastForward: (seconds: number) => void;
  setFlag: (key: string, enabled: boolean) => void;
  /** Overridden by the personnel domain: instantly hires and onboards enough qualified crew for every owned vehicle. */
  staffAll: () => void;
  /** Freezes / resumes the simulation clock so a transient phase can be inspected deterministically. */
  pause: (paused?: boolean) => void;
};

export function installQa(engine: MockEngine): void {
  const current = (): MockCareer => {
    const email = engine.state.currentSession?.email;
    const id = email ? engine.state.users[email]?.user.activeCareerId : null;
    const career = id ? engine.state.careers[id] : undefined;
    if (!career) throw new MockError(404, 'NOT_FOUND', 'No active career in the mock session');
    return career;
  };
  const qa: QaHelpers = {
    /** Creates account + session + career in Pescara, past the tutorial, ready to play. */
    createReadyCareer: ({ email, directorName, level = 1, credits, tutorialDone = true }) => {
      const { challengeId } = engine.requestOtp(email);
      engine.verifyOtp(
        { challengeId, code: '123456', directorName, acceptTerms: true, confirmAge: true },
        'qa',
      );
      const account = engine.state.users[email.trim().toLowerCase()]!;
      const site = engine.starterSites()[0]!;
      const summary = engine.createCareer(account, { locationId: PESCARA.id, siteId: site.id });
      const career = engine.state.careers[summary.id]!;
      if (tutorialDone) {
        const tutorial = career.incidents.find((i) => i.isTutorial);
        if (tutorial) engine.close(career, tutorial, 'CANCELLED', engine.now());
        career.pendingOutcomes = [];
        engine.advanceTutorial(career, 'DONE');
      }
      if (level > 1) engine.awardXp(career, xpThreshold(level) - Number(career.summary.xp));
      if (credits !== undefined) {
        const delta = credits - Number(career.summary.credits);
        if (delta !== 0) engine.credit(career, delta, 'ADMIN_ADJUSTMENT');
      }
      engine.save();
      return { careerId: summary.id };
    },
    career: current,
    grant: ({ credits, xp }) => {
      const career = current();
      if (credits) engine.credit(career, credits, 'ADMIN_ADJUSTMENT');
      if (xp) engine.awardXp(career, xp);
      engine.save();
    },
    setLevel: (level) => {
      const career = current();
      const missing = xpThreshold(level) - Number(career.summary.xp);
      if (missing > 0) engine.awardXp(career, missing);
      engine.save();
    },
    spawn: (templateCode, severity, minDistanceMeters) => {
      const incident = engine.spawnIncident(current(), templateCode, false, { severity, minDistanceMeters });
      engine.save();
      return incident.id;
    },
    /** Brings every pending scheduled action `seconds` (real) closer and executes what became due. */
    fastForward: (seconds) => {
      for (const career of Object.values(engine.state.careers))
        for (const action of career.actions) action.dueAt -= seconds * 1000;
      engine.process();
      engine.save();
    },
    staffAll: () => undefined,
    pause: (paused = true) => {
      engine.paused = paused;
    },
    setFlag: (key, enabled) => {
      engine.state.featureFlags[key] = enabled;
      engine.save();
    },
  };
  // Never drop helpers a domain registered earlier (install order must not matter).
  engine.qa = Object.assign(qa, (engine.qa as QaHelpers | undefined) ?? {});
}
