'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Lock, Package, Truck, Wrench } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageBody } from '@/features/game/shell';
import { useFeatureGate } from './api';
import { OrdersTab } from './orders-tab';
import { WarehouseTab } from './stock';
import { LockedFeature } from './visuals';
import { WorkshopTab } from './workshop-tab';

/** /game/logistics — Magazzino · Ordini · Officina. Locked features stay visible and say which level opens them. */
export function LogisticsScreen() {
  const t = useTranslations('logistics');
  const tc = useTranslations('common');
  const inventory = useFeatureGate('INVENTORY');
  const maintenance = useFeatureGate('MAINTENANCE');
  const [tab, setTab] = React.useState('warehouse');
  const lock = (unlocked: boolean) =>
    unlocked ? null : <Lock className="size-3" aria-label={tc('locked')} />;
  return (
    <PageBody title={t('title')} subtitle={t('subtitle')}>
      <Tabs value={tab} onValueChange={setTab} data-testid="logistics-tabs">
        <TabsList>
          <TabsTrigger value="warehouse">
            <Package className="size-4" aria-hidden />
            {t('tabs.warehouse')}
            {lock(inventory.unlocked)}
          </TabsTrigger>
          <TabsTrigger value="orders">
            <Truck className="size-4" aria-hidden />
            {t('tabs.orders')}
            {lock(inventory.unlocked)}
          </TabsTrigger>
          <TabsTrigger value="workshop">
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
