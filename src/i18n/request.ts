import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, isLocale, negotiateLocale } from './config';

/** No locale in the URL (one shareable URL per screen, in-app webviews friendly): cookie first, then Accept-Language. */
export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale)
    ? cookieLocale
    : negotiateLocale((await headers()).get('accept-language'));
  const messages = (await import(`../messages/${locale}.json`)) as { default: Record<string, unknown> };
  return { locale, messages: messages.default, timeZone: 'Europe/Rome' };
});
