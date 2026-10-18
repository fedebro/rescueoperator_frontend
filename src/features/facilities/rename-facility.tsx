'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Pencil } from 'lucide-react';
import { FACILITY_NAME_MAX, FACILITY_NAME_MIN, type FacilityDto } from '@/contracts';
import { facilitiesApi } from '@/lib/api/depth';
import { useErrorMessage } from '@/lib/api/error-message';
import { qk } from '@/lib/api/query-keys';
import { toast } from '@/stores/toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { useCareerId, usePatchSnapshot } from '@/features/game/hooks';

/**
 * The player's own name for one of their facilities (owner, 2026-10-18; D-141): 2–40 characters, the server applies the same
 * word filter as the Director name. The snapshot is patched at once; the `facility.updated` event confirms it.
 */
export function RenameFacilityButton({
  facility,
  labelled = false,
}: {
  facility: FacilityDto;
  labelled?: boolean;
}) {
  const t = useTranslations('facilities.rename');
  const tc = useTranslations('common');
  const careerId = useCareerId();
  const qc = useQueryClient();
  const patch = usePatchSnapshot();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState(facility.name);
  const name = value.replace(/\s+/g, ' ').trim();
  const valid = name.length >= FACILITY_NAME_MIN && name.length <= FACILITY_NAME_MAX;

  const rename = useMutation({
    mutationFn: () => facilitiesApi.rename(careerId, facility.id, name),
    onSuccess: (updated) => {
      patch((s) => ({
        ...s,
        facilities: s.facilities.map((f) => (f.id === updated.id ? { ...f, name: updated.name } : f)),
      }));
      void qc.invalidateQueries({ queryKey: qk.facility(careerId, facility.id) });
      toast({ tone: 'success', title: t('done', { name: updated.name }) });
      setOpen(false);
    },
  });

  return (
    <>
      <Button
        variant={labelled ? 'secondary' : 'ghost'}
        size={labelled ? 'md' : 'sm'}
        className={labelled ? 'h-11' : 'size-11 shrink-0 p-0 lg:size-9'}
        aria-label={t('action')}
        title={t('action')}
        data-testid="rename-facility"
        onClick={() => {
          setValue(facility.name);
          rename.reset();
          setOpen(true);
        }}
      >
        <Pencil className="size-4" aria-hidden />
        {labelled ? t('action') : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? (
          <DialogContent
            title={t('title')}
            description={t('hint')}
            closeLabel={tc('close')}
            data-testid="rename-facility-dialog"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (valid && !rename.isPending) rename.mutate();
              }}
            >
              <Field
                label={t('label')}
                htmlFor="facility-name"
                error={rename.error ? errorMessage(rename.error) : null}
                hint={t('limits', { min: FACILITY_NAME_MIN, max: FACILITY_NAME_MAX })}
              >
                <Input
                  id="facility-name"
                  value={value}
                  maxLength={FACILITY_NAME_MAX}
                  autoFocus
                  autoComplete="off"
                  onChange={(e) => setValue(e.target.value)}
                  data-testid="facility-name-input"
                />
              </Field>
              <DialogFooter>
                <Button type="button" variant="ghost" className="h-11" onClick={() => setOpen(false)}>
                  {tc('cancel')}
                </Button>
                <Button
                  type="submit"
                  className="h-11"
                  disabled={!valid}
                  loading={rename.isPending}
                  data-testid="rename-facility-save"
                >
                  {t('save')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
