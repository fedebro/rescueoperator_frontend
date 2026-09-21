'use client';
import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { GraduationCap, UserPlus, Users, UsersRound } from 'lucide-react';
import { formatAmount } from '@/lib/format';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, Stat } from '@/components/ui/misc';
import { PageBody } from '@/features/game/shell';
import { SectionHelpButton, SectionPrimer } from '@/features/coaching/section-primer';
import { OperatorSheet } from './operator-sheet';
import { usePersonnel } from './queries';
import { RecruitmentTab } from './recruitment-tab';
import { RosterTab } from './roster-tab';
import { TeamsTab } from './teams-tab';
import { TrainingTab } from './training-tab';

const TABS = ['roster', 'teams', 'recruitment', 'training'] as const;
type TabId = (typeof TABS)[number];
const isTab = (value: string | null): value is TabId => TABS.includes(value as TabId);

/**
 * /game/personnel. Deep links: `?tab=roster|teams|recruitment|training`, `?operator=<personnelId>` (notification action
 * OPEN_PERSONNEL, dispatch "fix it" links) and `?facility=<facilityId>` (roster pre-filtered from the facility page).
 */
export function PersonnelScreen() {
  const t = useTranslations('personnel');
  const tc = useTranslations('common');
  const tp = useTranslations('coaching.sections.personnel');
  const tco = useTranslations('coaching');
  const locale = useLocale();
  const params = useSearchParams();
  const requestedTab = params.get('tab');
  const [tab, setTab] = React.useState<TabId>(isTab(requestedTab) ? requestedTab : 'roster');
  const [selected, setSelected] = React.useState<string | null>(params.get('operator'));
  const people = usePersonnel().data;

  const ready = people?.filter((p) => p.status === 'AVAILABLE' || p.status === 'ASSIGNED').length;
  const cost = people?.reduce((sum, p) => sum + BigInt(p.costPerPeriod), 0n);
  const personnelContent = {
    sectionKey: 'personnel',
    title: tp('title'),
    body: tp('body'),
    tips: [tp('tip1'), tp('tip2')],
  };

  return (
    <PageBody
      title={t('title')}
      subtitle={t('subtitle')}
      actions={
        <SectionHelpButton
          content={personnelContent}
          label={tco('help.buttonLabel')}
          closeLabel={tc('close')}
        />
      }
    >
      <SectionPrimer content={personnelContent} />
      <Card className="grid grid-cols-3 gap-3">
        <Stat label={t('summary.total')} value={people?.length ?? '—'} />
        <Stat label={t('summary.ready')} value={ready ?? '—'} />
        <Stat
          label={t('summary.cost')}
          value={cost === undefined ? '—' : `${formatAmount(cost, locale)} ${tc('credits')}`}
        />
      </Card>
      <Tabs value={tab} onValueChange={(v) => isTab(v) && setTab(v)}>
        <TabsList aria-label={t('title')}>
          <TabsTrigger value="roster">
            <Users className="size-4" aria-hidden />
            {t('tabs.roster')}
          </TabsTrigger>
          <TabsTrigger value="teams">
            <UsersRound className="size-4" aria-hidden />
            {t('tabs.teams')}
          </TabsTrigger>
          <TabsTrigger value="recruitment">
            <UserPlus className="size-4" aria-hidden />
            {t('tabs.recruitment')}
          </TabsTrigger>
          <TabsTrigger value="training">
            <GraduationCap className="size-4" aria-hidden />
            {t('tabs.training')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="roster" className="pt-4">
          <RosterTab onSelect={setSelected} selectedId={selected} initialFacility={params.get('facility')} />
        </TabsContent>
        <TabsContent value="teams" className="pt-4">
          <TeamsTab onSelect={setSelected} />
        </TabsContent>
        <TabsContent value="recruitment" className="pt-4">
          <RecruitmentTab onSelect={setSelected} />
        </TabsContent>
        <TabsContent value="training" className="pt-4">
          <TrainingTab onSelect={setSelected} />
        </TabsContent>
      </Tabs>
      <OperatorSheet personnelId={selected} onClose={() => setSelected(null)} />
    </PageBody>
  );
}
