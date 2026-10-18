'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Lock, Package, Truck, Wrench } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageBody } from '@/features/game/shell';
import { SectionHelpButton, SectionPrimer } from '@/features/coaching/section-primer';
import { useFeatureGate } from './api';
import { OrdersTab } from './orders-tab';
import { WarehouseTab } from './stock';
import { LockedFeature } from './visuals';
import { WorkshopTab } from './workshop-tab';

/** Phone tab geometry: icon + label centred in a third of the row, the label allowed to wrap. */
const PHONE_TAB =
  'max-sm:h-auto max-sm:min-h-11 max-sm:justify-center max-sm:gap-1 max-sm:px-1 max-sm:text-center max-sm:text-xs max-sm:leading-tight max-sm:whitespace-normal';

/** /game/logistics — Magazzino · Ordini · Officina. Locked features stay visible and say which level opens them. */
export function LogisticsScreen() {
  const t = useTranslations('logistics');
  const tc = useTranslations('common');
  const ti = useTranslations('coaching.sections.inventory');
  const tm = useTranslations('coaching.sections.maintenance');
  const tco = useTranslations('coaching');
  const inventory = useFeatureGate('INVENTORY');
  const maintenance = useFeatureGate('MAINTENANCE');
  const [tab, setTab] = React.useState('warehouse');
  const lock = (unlocked: boolean) =>
    unlocked ? null : <Lock className="size-3" aria-label={tc('locked')} />;
  const inventoryContent = {
    sectionKey: 'inventory',
    title: ti('title'),
    body: ti('body'),
    tips: [ti('tip1'), ti('tip2')],
  };
  const maintenanceContent = {
    sectionKey: 'maintenance',
    title: tm('title'),
    body: tm('body'),
    tips: [tm('tip1'), tm('tip2')],
  };
  const activeContent = tab === 'workshop' ? maintenanceContent : inventoryContent;
  return (
    <PageBody
      title={t('title')}
      subtitle={t('subtitle')}
      help={
        <SectionHelpButton content={activeContent} label={tco('help.buttonLabel')} closeLabel={tc('close')} />
      }
    >
      <SectionPrimer content={activeContent} />
      <Tabs value={tab} onValueChange={setTab} data-testid="logistics-tabs">
        {/* Phones: three equal columns, every tab in view (German "Bestellungen" no longer scrolls off the edge). */}
        <TabsList className="max-sm:grid max-sm:grid-cols-3 max-sm:px-0">
          <TabsTrigger value="warehouse" className={PHONE_TAB}>
            <Package className="size-4" aria-hidden />
            {t('tabs.warehouse')}
            {lock(inventory.unlocked)}
          </TabsTrigger>
          <TabsTrigger value="orders" className={PHONE_TAB}>
            <Truck className="size-4" aria-hidden />
            {t('tabs.orders')}
            {lock(inventory.unlocked)}
          </TabsTrigger>
          <TabsTrigger value="workshop" className={PHONE_TAB}>
            <Wrench className="size-4" aria-hidden />
            {t('tabs.workshop')}
            {lock(maintenance.unlocked)}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="warehouse" className="pt-4">
          {inventory.unlocked ? (
            <WarehouseTab />
          ) : (
            <LockedFeature title={t('locked.inventory')} level={inventory.requiredLevel} />
          )}
        </TabsContent>
        <TabsContent value="orders" className="pt-4">
          {inventory.unlocked ? (
            <OrdersTab />
          ) : (
            <LockedFeature title={t('locked.inventory')} level={inventory.requiredLevel} />
          )}
        </TabsContent>
        <TabsContent value="workshop" className="pt-4">
          {maintenance.unlocked ? (
            <WorkshopTab />
          ) : (
            <LockedFeature title={t('locked.maintenance')} level={maintenance.requiredLevel} />
          )}
        </TabsContent>
      </Tabs>
    </PageBody>
  );
}
