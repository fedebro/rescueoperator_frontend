import { InviteLanding } from '@/features/monetization/invite-landing';

/** Public invite landing: `/invite/<code>` (the `inviteUrl` of `ReferralDto`). */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <InviteLanding code={decodeURIComponent(code).toUpperCase()} />;
}
