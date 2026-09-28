/**
 * Identifier of the running build (D-98), inlined at build time by `next.config.ts`: `RELEASE_ID` when the build pins it,
 * the build timestamp otherwise. Each new release asks — once — every device that has not enabled push notifications.
 * Also published as `<meta name="rc-release">` (root layout) so support and the e2e suites can read it.
 */
export const RELEASE_ID: string = process.env.NEXT_PUBLIC_RELEASE_ID || 'dev';

/** Name of the `<meta>` tag carrying {@link RELEASE_ID}. */
export const RELEASE_META_NAME = 'rc-release';
