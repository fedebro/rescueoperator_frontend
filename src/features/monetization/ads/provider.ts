/**
 * Rewarded-video adapter. The server picks the provider (`AdStartResult.provider`) and the client looks it up here, so
 * a real SDK is plugged in by registering an implementation under the provider id — no UI code changes.
 * The server never trusts the client: the reward is granted by `POST /ads/complete` after its own validation
 * (token, minimum watch time, optional provider proof).
 */
export interface RewardedAdConfig {
  adToken: string;
  minWatchSeconds: number;
  /** Opaque, provider-specific (`AdStartResult.providerConfig`): ad unit ids, non-personalised flag for minors (D-82)… */
  providerConfig: Record<string, unknown>;
}
export interface RewardedAdOutcome {
  completed: boolean;
  /** Provider-signed proof forwarded to the server as `providerProof`, when the SDK supplies one. */
  proof?: string;
}
export interface RewardedAdProvider {
  id: string;
  isAvailable(): boolean | Promise<boolean>;
  show(config: RewardedAdConfig): Promise<RewardedAdOutcome>;
}

const registry = new Map<string, RewardedAdProvider>();

export function registerRewardedAdProvider(provider: RewardedAdProvider): () => void {
  registry.set(provider.id, provider);
  return () => {
    if (registry.get(provider.id) === provider) registry.delete(provider.id);
  };
}
export function getRewardedAdProvider(id: string): RewardedAdProvider | undefined {
  return registry.get(id);
}
