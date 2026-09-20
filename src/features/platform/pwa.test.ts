import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installMode, isIosDevice, registerServiceWorker, shouldRegisterServiceWorker } from './pwa';

describe('service worker registration guard', () => {
  const base = { apiMock: false, nodeEnv: 'production', supported: true, secureContext: true };

  it('registers only in production builds that use a real API', () => {
    expect(shouldRegisterServiceWorker(base)).toBe(true);
    // MSW owns the root-scope worker in mock mode: registering /sw.js would replace it.
    expect(shouldRegisterServiceWorker({ ...base, apiMock: true })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...base, nodeEnv: 'development' })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...base, nodeEnv: 'test' })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...base, supported: false })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...base, secureContext: false })).toBe(false);
  });

  describe('registerServiceWorker', () => {
    const register = vi.fn(async () => ({ scope: '/' }) as ServiceWorkerRegistration);
    const install = () => {
      Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });
      Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    };
    afterEach(() => {
      register.mockClear();
      Reflect.deleteProperty(navigator, 'serviceWorker');
    });

    it('never touches navigator.serviceWorker in mock mode or outside production', async () => {
      install();
      expect(await registerServiceWorker({ apiMock: true, nodeEnv: 'production' })).toBeNull();
      expect(await registerServiceWorker({ apiMock: false, nodeEnv: 'development' })).toBeNull();
      expect(register).not.toHaveBeenCalled();
    });

    it('registers /sw.js at the root scope otherwise, and swallows failures', async () => {
      install();
      await registerServiceWorker({ apiMock: false, nodeEnv: 'production' });
      expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
      register.mockRejectedValueOnce(new Error('blocked'));
      expect(await registerServiceWorker({ apiMock: false, nodeEnv: 'production' })).toBeNull();
    });
  });
});

describe('install mode', () => {
  it('prefers installed > native prompt > iOS instructions > unavailable', () => {
    const none = { hasPrompt: false, installed: false, standalone: false, ios: false };
    expect(installMode(none)).toBe('unavailable');
    expect(installMode({ ...none, ios: true })).toBe('ios');
    expect(installMode({ ...none, ios: true, hasPrompt: true })).toBe('native');
    expect(installMode({ ...none, hasPrompt: true, standalone: true })).toBe('installed');
    expect(installMode({ ...none, installed: true })).toBe('installed');
  });

  it('detects iOS including iPadOS pretending to be a Mac', () => {
    expect(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(true);
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isIosDevice('Mozilla/5.0 (Linux; Android 14; Pixel 7)', 5)).toBe(false);
  });
});

describe('public/sw.js', () => {
  const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

  it('never caches API responses, the MSW worker or other origins', () => {
    expect(source).toContain("'/mockServiceWorker.js'");
    expect(source).toContain("'/api/'");
    expect(source).toContain('url.origin !== self.location.origin');
    expect(source).toContain("request.method !== 'GET'");
  });

  it('precaches the offline shell and serves it for failed navigations', () => {
    expect(source).toContain("const OFFLINE_URL = '/offline'");
    expect(source).toContain("request.mode === 'navigate'");
    expect(source).toContain('caches.match(OFFLINE_URL)');
  });
});
