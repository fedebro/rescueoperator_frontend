import { AllianceInviteLanding } from '@/features/alliance/invite-landing';

/** Public alliance invite landing: `/invite/alliance/<code>` (the link of a link invite, contracts/alliances.ts). */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <AllianceInviteLanding code={decodeURIComponent(code).toUpperCase()} />;
}
