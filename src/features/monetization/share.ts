/** Invite sharing: Web Share API first, explicit fallbacks (copy, WhatsApp, Telegram, e-mail) always available. */
export interface SharePayload {
  title: string;
  text: string;
  url: string;
}
export type ShareChannel = 'whatsapp' | 'telegram' | 'email';

export function shareIntentUrl(channel: ShareChannel, { title, text, url }: SharePayload): string {
  const enc = encodeURIComponent;
  switch (channel) {
    case 'whatsapp':
      return `https://wa.me/?text=${enc(`${text} ${url}`)}`;
    case 'telegram':
      return `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`;
    case 'email':
      return `mailto:?subject=${enc(title)}&body=${enc(`${text}\n\n${url}`)}`;
  }
}

export const canNativeShare = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/** 'shared' | 'dismissed' (the user closed the sheet) | 'unsupported' (caller shows the fallbacks). */
export async function nativeShare(payload: SharePayload): Promise<'shared' | 'dismissed' | 'unsupported'> {
  if (!canNativeShare()) return 'unsupported';
  try {
    await navigator.share(payload);
    return 'shared';
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'dismissed' : 'unsupported';
  }
}

/** Clipboard API with the legacy fallback needed by in-app webviews (TikTok/Instagram). */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* permission denied → legacy path */
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
