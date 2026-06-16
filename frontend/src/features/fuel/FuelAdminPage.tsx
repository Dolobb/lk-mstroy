import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { format, subDays } from 'date-fns';
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Fuel,
  Image,
  Pencil,
  RefreshCw,
  Trash2,
  Truck,
  Users,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { DateRangePicker } from '@/components/DateRangePicker';
import { FilterDropdown, uniqueSortedBy } from '@/components/FilterDropdown';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  closeShift,
  createAtz,
  editEvent,
  fetchAtz,
  fetchDrivers,
  fetchShiftDetail,
  fetchShifts,
  fetchVehicles,
  ttnPhotoUrl,
  updateAtz,
} from './api';
import type {
  AtzStatus,
  DispenseEvent,
  Driver,
  EventEdit,
  ReceiptEvent,
  ShiftDetail,
  ShiftFilters,
  ShiftSummary,
  Vehicle,
} from './types';

type TabId = 'atz' | 'vehicles' | 'shifts' | 'drivers';
type ShiftStatusFilter = 'all' | 'open' | 'closed';
type EventType = 'dispense' | 'receipt';
type EventDialogState =
  | { mode: 'edit'; shiftId: string; type: EventType; event: DispenseEvent | ReceiptEvent }
  | { mode: 'delete'; shiftId: string; type: EventType; event: DispenseEvent | ReceiptEvent }
  | null;

const TABS: Array<{ id: TabId; label: string; icon: ReactNode }> = [
  { id: 'atz', label: 'АТЗ', icon: <Truck className="size-3.5" /> },
  { id: 'vehicles', label: 'ТС', icon: <Truck className="size-3.5" /> },
  { id: 'shifts', label: 'Смены', icon: <CalendarDays className="size-3.5" /> },
  { id: 'drivers', label: 'Водители', icon: <Users className="size-3.5" /> },
];

const optionalNonNegativeNumber = z.number().min(0, 'Значение не может быть меньше 0').optional();
const requiredNonNegativeNumber = z.number().min(0, 'Значение не может быть меньше 0');
const requiredPositiveNumber = z.number().positive('Значение должно быть больше 0');

const createAtzSchema = z.object({
  gosNumber: z.string().trim().min(1, 'Укажите госномер'),
  title: z.string().optional(),
  remainingLiters: requiredNonNegativeNumber,
  isActive: z.boolean(),
});

const updateAtzSchema = z.object({
  title: z.string().optional(),
  remainingLiters: requiredNonNegativeNumber,
  isActive: z.boolean(),
});

const closeShiftSchema = z.object({
  closingRemainingLiters: optionalNonNegativeNumber,
});

const editEventSchema = z.object({
  liters: requiredPositiveNumber,
});

type CreateAtzFormValues = z.infer<typeof createAtzSchema>;
type UpdateAtzFormValues = z.infer<typeof updateAtzSchema>;
type CloseShiftFormValues = z.infer<typeof closeShiftSchema>;
type EditEventFormValues = z.infer<typeof editEventSchema>;

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  const d = String(dt.getDate()).padStart(2, '0');
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const h = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `${d}.${mo}.${dt.getFullYear()} ${h}:${mi}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  const h = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `${h}:${mi}`;
}

function formatLiters(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10) / 10;
  return rounded.toFixed(1).replace(/\.0$/, '');
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isConflictError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('409');
}

function todayYmd(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function daysAgoYmd(days: number): string {
  return format(subDays(new Date(), days), 'yyyy-MM-dd');
}

function StatusBadge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: 'green' | 'amber' | 'muted' | 'red' | 'blue';
}) {
  const tones: Record<typeof tone, string> = {
    green: 'bg-green-500/15 text-green-700 dark:text-green-400',
    amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    muted: 'bg-muted text-muted-foreground',
    red: 'bg-destructive/15 text-destructive',
    blue: 'bg-primary/15 text-primary',
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

function StateMessage({
  loading,
  error,
  empty,
  emptyText,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyText: string;
}) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Загрузка…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (empty) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return null;
}

function SegmentButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function jsonPreview(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function DialogError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
      {message}
    </div>
  );
}

function CreateAtzDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => Promise<void>;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<CreateAtzFormValues>({
    resolver: zodResolver(createAtzSchema),
    defaultValues: {
      gosNumber: '',
      title: '',
      remainingLiters: 0,
      isActive: true,
    },
  });

  useEffect(() => {
    if (open) {
      setSubmitError(null);
      form.reset({
        gosNumber: '',
        title: '',
        remainingLiters: 0,
        isActive: true,
      });
    }
  }, [form, open]);

  const onSubmit = async (values: CreateAtzFormValues) => {
    setSubmitError(null);
    try {
      await createAtz({
        gosNumber: values.gosNumber.trim(),
        title: values.title?.trim() || undefined,
        remainingLiters: values.remainingLiters,
        isActive: values.isActive,
      });
      await onSuccess();
      onOpenChange(false);
    } catch (error) {
      setSubmitError(formatError(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новая АТЗ</DialogTitle>
          <DialogDescription>Создание топливозаправщика и стартового остатка.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <DialogError message={submitError} />

            <FormField
              control={form.control}
              name="gosNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Госномер</FormLabel>
                  <FormControl>
                    <Input {...field} autoFocus />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Название</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="remainingLiters"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Остаток, л</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      value={field.value ?? ''}
                      onChange={event => field.onChange(event.target.value === '' ? undefined : Number(event.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <input
                      id="create-atz-active"
                      type="checkbox"
                      checked={field.value}
                      onChange={event => field.onChange(event.target.checked)}
                      className="size-4 rounded border-border"
                    />
                    <Label htmlFor="create-atz-active" className="text-sm">Активна</Label>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                Создать
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function EditAtzDialog({
  atz,
  onOpenChange,
  onSuccess,
}: {
  atz: AtzStatus | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => Promise<void>;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<UpdateAtzFormValues>({
    resolver: zodResolver(updateAtzSchema),
    defaultValues: {
      title: '',
      remainingLiters: 0,
      isActive: true,
    },
  });

  useEffect(() => {
    if (atz) {
      setSubmitError(null);
      form.reset({
        title: atz.title ?? '',
        remainingLiters: atz.remainingLiters,
        isActive: atz.isActive !== false,
      });
    }
  }, [atz, form]);

  const onSubmit = async (values: UpdateAtzFormValues) => {
    if (!atz) return;

    setSubmitError(null);
    try {
      await updateAtz(atz.id, {
        title: values.title?.trim() ?? undefined,
        remainingLiters: values.remainingLiters,
        isActive: values.isActive,
      });
      await onSuccess();
      onOpenChange(false);
    } catch (error) {
      setSubmitError(formatError(error));
    }
  };

  return (
    <Dialog open={atz !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Изменить АТЗ</DialogTitle>
          <DialogDescription>{atz ? atz.gosNumber : 'Калибровка остатка и статуса.'}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <DialogError message={submitError} />

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Название</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} autoFocus />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="remainingLiters"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Остаток, л</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      value={field.value ?? ''}
                      onChange={event => field.onChange(event.target.value === '' ? undefined : Number(event.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <input
                      id="edit-atz-active"
                      type="checkbox"
                      checked={field.value}
                      onChange={event => field.onChange(event.target.checked)}
                      className="size-4 rounded border-border"
                    />
                    <Label htmlFor="edit-atz-active" className="text-sm">Активна</Label>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function CloseShiftDialog({
  shift,
  currentRemainingLiters,
  onOpenChange,
  onSuccess,
  onAlreadyClosed,
}: {
  shift: ShiftSummary | null;
  currentRemainingLiters: number | undefined;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => Promise<void>;
  onAlreadyClosed: () => Promise<void>;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<CloseShiftFormValues>({
    resolver: zodResolver(closeShiftSchema),
    defaultValues: {
      closingRemainingLiters: undefined,
    },
  });

  useEffect(() => {
    if (shift) {
      setSubmitError(null);
      form.reset({
        closingRemainingLiters: currentRemainingLiters,
      });
    }
  }, [currentRemainingLiters, form, shift]);

  const onSubmit = async (values: CloseShiftFormValues) => {
    if (!shift) return;

    setSubmitError(null);
    try {
      const input = values.closingRemainingLiters === undefined
        ? {}
        : { closingRemainingLiters: values.closingRemainingLiters };
      await closeShift(shift.id, input);
      await onSuccess();
      onOpenChange(false);
    } catch (error) {
      if (isConflictError(error)) {
        setSubmitError('Смена уже закрыта. Список смен обновлён.');
        await onAlreadyClosed();
        return;
      }
      setSubmitError(formatError(error));
    }
  };

  return (
    <Dialog open={shift !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Закрыть смену</DialogTitle>
          <DialogDescription>
            {shift ? `${shift.driver.fullName}, ${shift.atz.gosNumber}` : 'Закрытие открытой смены.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <DialogError message={submitError} />

            <FormField
              control={form.control}
              name="closingRemainingLiters"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Остаток при закрытии, л</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      value={field.value ?? ''}
                      onChange={event => field.onChange(event.target.value === '' ? undefined : Number(event.target.value))}
                      autoFocus
                    />
                  </FormControl>
                  <FormDescription>По умолчанию — текущий остаток АТЗ</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button type="submit" variant="destructive" disabled={form.formState.isSubmitting}>
                Закрыть смену
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function EventMutationDialog({
  state,
  onOpenChange,
  onSuccess,
}: {
  state: EventDialogState;
  onOpenChange: (open: boolean) => void;
  onSuccess: (shiftId: string) => Promise<void>;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<EditEventFormValues>({
    resolver: zodResolver(editEventSchema),
    defaultValues: {
      liters: 0,
    },
  });

  useEffect(() => {
    if (state?.mode === 'edit') {
      setSubmitError(null);
      form.reset({ liters: state.event.liters });
    } else if (state?.mode === 'delete') {
      setSubmitError(null);
    }
  }, [form, state]);

  const submitEdit = async (values: EditEventFormValues) => {
    if (!state || state.mode !== 'edit') return;

    setSubmitError(null);
    try {
      await editEvent(state.type, state.event.id, { liters: values.liters });
      await onSuccess(state.shiftId);
      onOpenChange(false);
    } catch (error) {
      setSubmitError(formatError(error));
    }
  };

  const submitDelete = async () => {
    if (!state || state.mode !== 'delete') return;

    setSubmitError(null);
    try {
      await editEvent(state.type, state.event.id, { isDeleted: true });
      await onSuccess(state.shiftId);
      onOpenChange(false);
    } catch (error) {
      setSubmitError(formatError(error));
    }
  };

  const title = state?.mode === 'delete' ? 'Удалить событие' : 'Изменить событие';

  return (
    <Dialog open={state !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {state ? `${state.type === 'dispense' ? 'Выдача' : 'Получение'} от ${formatTime(state.event.happenedAtClient)}` : 'Событие смены.'}
          </DialogDescription>
        </DialogHeader>

        {state?.mode === 'delete' ? (
          <div className="space-y-4">
            <DialogError message={submitError} />
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              Подтвердите удаление события на {formatLiters(state.event.liters)} л.
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button type="button" variant="destructive" onClick={() => void submitDelete()}>
                Удалить
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submitEdit)} className="space-y-4">
              <DialogError message={submitError} />
              <FormField
                control={form.control}
                name="liters"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Литры</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={field.value ?? ''}
                        onChange={event => field.onChange(event.target.value === '' ? undefined : Number(event.target.value))}
                        autoFocus
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Отмена
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  Сохранить
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AtzCard({ atz, onEdit }: { atz: AtzStatus; onEdit: (atz: AtzStatus) => void }) {
  const busy = atz.openShift !== null;

  return (
    <div
      className={`rounded-lg border border-border bg-card p-4 shadow-sm transition-colors ${
        atz.isActive === false ? 'opacity-50' : 'hover:bg-muted/20'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-lg font-semibold leading-tight">{atz.gosNumber}</div>
          {atz.title && (
            <div className="mt-1 truncate text-xs text-muted-foreground">{atz.title}</div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <StatusBadge tone={busy ? 'amber' : 'green'}>
            {busy ? 'Занят' : 'Свободен'}
          </StatusBadge>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7"
            onClick={() => onEdit(atz)}
            aria-label="Изменить АТЗ"
            title="Изменить"
          >
            <Pencil className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-5 flex items-end gap-2">
        <Fuel className="mb-1 size-5 text-muted-foreground" />
        <div className="text-3xl font-semibold tracking-normal">{formatLiters(atz.remainingLiters)}</div>
        <div className="mb-1 text-sm text-muted-foreground">л</div>
      </div>

      <div className="mt-4 min-h-8 text-xs text-muted-foreground">
        {atz.openShift ? (
          <>
            <div className="font-medium text-foreground">{atz.openShift.driver.fullName}</div>
            <div>с {formatTime(atz.openShift.startedAtClient)}</div>
          </>
        ) : (
          <div>Открытых смен нет</div>
        )}
      </div>
    </div>
  );
}

function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  const isInactive = vehicle.isActive === false;

  return (
    <div
      className={`rounded-lg border border-border bg-card p-4 shadow-sm transition-colors ${
        isInactive ? 'opacity-50' : 'hover:bg-muted/20'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-lg font-semibold leading-tight">{vehicle.gosNumber}</div>
        </div>
        <StatusBadge tone={isInactive ? 'muted' : 'green'}>
          {isInactive ? 'Неактивна' : 'Активна'}
        </StatusBadge>
      </div>

      <div className="mt-5 space-y-2 text-xs">
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">Марка</span>
          <span className="text-right font-medium">{vehicle.mark?.trim() || '—'}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">Тип</span>
          <span className="text-right font-medium">{vehicle.vehicleType?.trim() || '—'}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">Организация</span>
          <span className="text-right font-medium">{vehicle.organizationName?.trim() || '—'}</span>
        </div>
      </div>
    </div>
  );
}

function EventFlags({ isDeleted, wasEdited }: { isDeleted: boolean; wasEdited: boolean }) {
  if (!isDeleted && !wasEdited) return null;

  return (
    <div className="flex items-center gap-1">
      {isDeleted && <StatusBadge tone="red">удалено</StatusBadge>}
      {wasEdited && (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-300">
          <Pencil className="size-3" />
          правлено
        </span>
      )}
    </div>
  );
}

function EventActions({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7"
        onClick={onEdit}
        aria-label="Изменить"
        title="Изменить"
      >
        <Pencil className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7 text-destructive hover:text-destructive"
        onClick={onDelete}
        aria-label="Удалить"
        title="Удалить"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

function DispenseRow({
  event,
  onEdit,
  onDelete,
}: {
  event: DispenseEvent;
  onEdit: (event: DispenseEvent) => void;
  onDelete: (event: DispenseEvent) => void;
}) {
  return (
    <div className={`grid grid-cols-[56px_1fr_auto_auto] items-center gap-3 rounded-md px-2 py-1.5 text-xs ${event.isDeleted ? 'line-through opacity-60' : ''}`}>
      <div className="font-mono text-muted-foreground">{formatTime(event.happenedAtClient)}</div>
      <div>
        <span className="font-mono font-medium">{event.vehicle.gosNumber}</span>
        {event.vehicle.mark && <span className="ml-2 text-muted-foreground">{event.vehicle.mark}</span>}
        {event.recipientName && <div className="text-muted-foreground">Кому: {event.recipientName}</div>}
      </div>
      <div className="flex items-center gap-3">
        <span className="font-semibold">{formatLiters(event.liters)} л</span>
        <EventFlags isDeleted={event.isDeleted} wasEdited={event.wasEdited} />
      </div>
      {event.isDeleted ? <div /> : <EventActions onEdit={() => onEdit(event)} onDelete={() => onDelete(event)} />}
    </div>
  );
}

function ReceiptRow({
  event,
  onEdit,
  onDelete,
}: {
  event: ReceiptEvent;
  onEdit: (event: ReceiptEvent) => void;
  onDelete: (event: ReceiptEvent) => void;
}) {
  const photoUrl = ttnPhotoUrl(event.id);

  return (
    <div className={`grid grid-cols-[56px_90px_1fr_auto] items-center gap-3 rounded-md px-2 py-1.5 text-xs ${event.isDeleted ? 'line-through opacity-60' : ''}`}>
      <div className="font-mono text-muted-foreground">{formatTime(event.happenedAtClient)}</div>
      <div className="font-semibold">{formatLiters(event.liters)} л</div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {event.ttnPhotoStatus === 'uploaded' ? (
            <button
              type="button"
              onClick={() => window.open(photoUrl, '_blank', 'noopener,noreferrer')}
              className="group flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-muted-foreground hover:text-foreground"
            >
              <img
                src={photoUrl}
                alt="Фото ТТН"
                className="h-9 w-12 rounded border border-border object-cover"
              />
              <span className="text-[10px]">открыть</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Image className="size-3.5" />
              фото не загружено
            </span>
          )}
        </div>
        <EventFlags isDeleted={event.isDeleted} wasEdited={event.wasEdited} />
      </div>
      {event.isDeleted ? <div /> : <EventActions onEdit={() => onEdit(event)} onDelete={() => onDelete(event)} />}
    </div>
  );
}

function EditsList({ edits }: { edits: EventEdit[] }) {
  if (edits.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-background/60 p-3">
      <div className="mb-2 text-xs font-semibold">Правки</div>
      <div className="space-y-2">
        {edits.map(edit => (
          <div key={edit.id} className="rounded-md bg-muted/40 p-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono font-semibold">{edit.eventType}</span>
              <span className="text-muted-foreground">{formatDateTime(edit.editedAt)}</span>
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <pre className="max-h-32 overflow-auto rounded border border-border bg-card p-2 text-[10px] text-muted-foreground">
                {jsonPreview(edit.before)}
              </pre>
              <pre className="max-h-32 overflow-auto rounded border border-border bg-card p-2 text-[10px] text-muted-foreground">
                {jsonPreview(edit.after)}
              </pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShiftDetailPanel({
  detail,
  loading,
  error,
  onEditEvent,
  onDeleteEvent,
}: {
  detail: ShiftDetail | undefined;
  loading: boolean;
  error: string | null;
  onEditEvent: (type: EventType, event: DispenseEvent | ReceiptEvent) => void;
  onDeleteEvent: (type: EventType, event: DispenseEvent | ReceiptEvent) => void;
}) {
  if (loading) {
    return <div className="p-4 text-xs text-muted-foreground">Загрузка деталей…</div>;
  }

  if (error) {
    return <div className="p-4 text-xs text-destructive">{error}</div>;
  }

  if (!detail) return null;

  return (
    <div className="grid gap-3 p-3 lg:grid-cols-3">
      <div className="rounded-lg border border-border bg-background/60 p-3">
        <div className="mb-2 text-xs font-semibold">Выдачи</div>
        {detail.dispenses.length > 0 ? (
          <div className="divide-y divide-border/40">
            {detail.dispenses.map(event => (
              <DispenseRow
                key={event.id}
                event={event}
                onEdit={item => onEditEvent('dispense', item)}
                onDelete={item => onDeleteEvent('dispense', item)}
              />
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Нет выдач</div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-background/60 p-3">
        <div className="mb-2 text-xs font-semibold">Получения</div>
        {detail.receipts.length > 0 ? (
          <div className="divide-y divide-border/40">
            {detail.receipts.map(event => (
              <ReceiptRow
                key={event.id}
                event={event}
                onEdit={item => onEditEvent('receipt', item)}
                onDelete={item => onDeleteEvent('receipt', item)}
              />
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Нет получений</div>
        )}
      </div>

      <EditsList edits={detail.edits} />
    </div>
  );
}

export function FuelAdminPage() {
  const [activeTab, setActiveTab] = useState<TabId>('atz');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const [atz, setAtz] = useState<AtzStatus[]>([]);
  const [atzLoading, setAtzLoading] = useState(false);
  const [atzError, setAtzError] = useState<string | null>(null);
  const [atzSearch, setAtzSearch] = useState('');

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [vehiclesError, setVehiclesError] = useState<string | null>(null);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [vehicleMarkFilters, setVehicleMarkFilters] = useState<Set<string>>(new Set());
  const [vehicleMarkFilterOpen, setVehicleMarkFilterOpen] = useState(false);

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const [driversError, setDriversError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState(() => daysAgoYmd(13));
  const [dateTo, setDateTo] = useState(() => todayYmd());
  const [shiftStatus, setShiftStatus] = useState<ShiftStatusFilter>('all');
  const [shifts, setShifts] = useState<ShiftSummary[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [shiftsError, setShiftsError] = useState<string | null>(null);

  const [expandedShiftId, setExpandedShiftId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ShiftDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [createAtzOpen, setCreateAtzOpen] = useState(false);
  const [editingAtz, setEditingAtz] = useState<AtzStatus | null>(null);
  const [closingShift, setClosingShift] = useState<ShiftSummary | null>(null);
  const [eventDialogState, setEventDialogState] = useState<EventDialogState>(null);

  const shiftFilters = useMemo(() => {
    const filters: ShiftFilters = {
      from: `${dateFrom}T00:00:00.000Z`,
      to: `${dateTo}T23:59:59.999Z`,
    };
    if (shiftStatus !== 'all') filters.status = shiftStatus;
    return filters;
  }, [dateFrom, dateTo, shiftStatus]);

  const loadAtz = useCallback(async () => {
    setAtzLoading(true);
    setAtzError(null);
    try {
      setAtz(await fetchAtz());
      setLastUpdatedAt(new Date());
    } catch (error) {
      setAtzError(formatError(error));
    } finally {
      setAtzLoading(false);
    }
  }, []);

  const loadVehicles = useCallback(async () => {
    setVehiclesLoading(true);
    setVehiclesError(null);
    try {
      setVehicles(await fetchVehicles());
      setLastUpdatedAt(new Date());
    } catch (error) {
      setVehiclesError(formatError(error));
    } finally {
      setVehiclesLoading(false);
    }
  }, []);

  const loadDrivers = useCallback(async () => {
    setDriversLoading(true);
    setDriversError(null);
    try {
      setDrivers(await fetchDrivers());
      setLastUpdatedAt(new Date());
    } catch (error) {
      setDriversError(formatError(error));
    } finally {
      setDriversLoading(false);
    }
  }, []);

  const loadShifts = useCallback(async () => {
    setShiftsLoading(true);
    setShiftsError(null);
    try {
      setShifts(await fetchShifts(shiftFilters));
      setLastUpdatedAt(new Date());
    } catch (error) {
      setShiftsError(formatError(error));
    } finally {
      setShiftsLoading(false);
    }
  }, [shiftFilters]);

  useEffect(() => {
    if (activeTab === 'atz') void loadAtz();
  }, [activeTab, loadAtz]);

  useEffect(() => {
    if (activeTab === 'vehicles') void loadVehicles();
  }, [activeTab, loadVehicles]);

  useEffect(() => {
    if (activeTab === 'drivers') void loadDrivers();
  }, [activeTab, loadDrivers]);

  useEffect(() => {
    if (activeTab === 'shifts') void loadShifts();
  }, [activeTab, loadShifts]);

  // Auto-poll: refresh active tab every 30s
  useEffect(() => {
    const id = setInterval(() => {
      if (activeTab === 'atz') void loadAtz();
      else if (activeTab === 'vehicles') void loadVehicles();
      else if (activeTab === 'drivers') void loadDrivers();
      else if (activeTab === 'shifts') void loadShifts();
    }, 30_000);
    return () => clearInterval(id);
  }, [activeTab, loadAtz, loadDrivers, loadShifts, loadVehicles]);

  const refreshCurrent = () => {
    if (activeTab === 'atz') void loadAtz();
    if (activeTab === 'vehicles') void loadVehicles();
    if (activeTab === 'drivers') void loadDrivers();
    if (activeTab === 'shifts') void loadShifts();
  };

  const refreshLoading =
    (activeTab === 'atz' && atzLoading)
    || (activeTab === 'vehicles' && vehiclesLoading)
    || (activeTab === 'drivers' && driversLoading)
    || (activeTab === 'shifts' && shiftsLoading);

  const filteredAtz = useMemo(() => {
    const query = atzSearch.trim().toUpperCase();
    if (!query) return atz;
    return atz.filter(item => item.gosNumber.toUpperCase().includes(query));
  }, [atz, atzSearch]);

  const vehicleMarkValues = useMemo(
    () => uniqueSortedBy(vehicles, vehicle => vehicle.mark),
    [vehicles],
  );

  const filteredVehicles = useMemo(() => {
    let data = vehicles;
    const query = vehicleSearch.trim().toUpperCase();
    if (query) {
      data = data.filter(vehicle => vehicle.gosNumber.toUpperCase().includes(query));
    }

    if (vehicleMarkFilters.size > 0) {
      const selected = new Set([...vehicleMarkFilters].map(mark => mark.toLowerCase()));
      data = data.filter(vehicle => selected.has((vehicle.mark ?? '').toLowerCase()));
    }

    return data;
  }, [vehicleMarkFilters, vehicleSearch, vehicles]);

  const toggleVehicleMarkFilter = useCallback((mark: string) => {
    setVehicleMarkFilters(prev => {
      const next = new Set(prev);
      if (next.has(mark)) next.delete(mark);
      else next.add(mark);
      return next;
    });
  }, []);

  const clearVehicleMarkFilter = useCallback(() => {
    setVehicleMarkFilters(new Set());
  }, []);

  const reloadShiftDetail = useCallback(async (id: string) => {
    setDetailLoadingId(id);
    setDetailErrors(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    try {
      const detail = await fetchShiftDetail(id);
      setDetails(prev => ({ ...prev, [id]: detail }));
    } catch (error) {
      setDetailErrors(prev => ({ ...prev, [id]: formatError(error) }));
    } finally {
      setDetailLoadingId(current => (current === id ? null : current));
    }
  }, []);

  const toggleShift = async (id: string) => {
    if (expandedShiftId === id) {
      setExpandedShiftId(null);
      return;
    }

    setExpandedShiftId(id);
    if (details[id]) return;

    await reloadShiftDetail(id);
  };

  const refreshAfterCloseShift = useCallback(async () => {
    await loadShifts();
    if (atz.length > 0) await loadAtz();
  }, [atz.length, loadAtz, loadShifts]);

  const refreshAfterEventMutation = useCallback(async (shiftId: string) => {
    await reloadShiftDetail(shiftId);
    await loadAtz();
  }, [loadAtz, reloadShiftDetail]);

  const closingShiftRemainingLiters = useMemo(() => {
    if (!closingShift) return undefined;
    return atz.find(item => item.id === closingShift.atz.id)?.remainingLiters;
  }, [atz, closingShift]);

  const renderAtz = () => {
    if (atzLoading || atzError) {
      return (
        <StateMessage
          loading={atzLoading}
          error={atzError}
          empty={false}
          emptyText="АТЗ не найдены"
        />
      );
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
          <input
            type="text"
            value={atzSearch}
            onChange={event => setAtzSearch(event.target.value)}
            placeholder="Поиск по гос. номеру…"
            className="text-xs px-2.5 py-1.5 rounded-lg bg-muted border border-border/50 text-foreground w-48 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <Button type="button" size="sm" onClick={() => setCreateAtzOpen(true)}>
            + АТЗ
          </Button>
          <div className="ml-auto text-xs text-muted-foreground">
            {filteredAtz.length} из {atz.length}
          </div>
        </div>

        {filteredAtz.length === 0 ? (
          <StateMessage
            loading={false}
            error={null}
            empty
            emptyText="АТЗ не найдены"
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredAtz.map(item => <AtzCard key={item.id} atz={item} onEdit={setEditingAtz} />)}
          </div>
        )}
      </div>
    );
  };

  const renderVehicles = () => {
    if (vehiclesLoading || vehiclesError) {
      return (
        <StateMessage
          loading={vehiclesLoading}
          error={vehiclesError}
          empty={false}
          emptyText="ТС не найдены"
        />
      );
    }

    const markFilterActive = vehicleMarkFilters.size > 0;

    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
          <input
            type="text"
            value={vehicleSearch}
            onChange={event => setVehicleSearch(event.target.value)}
            placeholder="Поиск по гос. номеру…"
            className="text-xs px-2.5 py-1.5 rounded-lg bg-muted border border-border/50 text-foreground w-48 focus:outline-none focus:ring-1 focus:ring-primary"
          />

          <div className="relative">
            <button
              type="button"
              onClick={() => setVehicleMarkFilterOpen(open => !open)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                markFilterActive
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border/50 bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              Марка
              {markFilterActive && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[9px] leading-none text-primary-foreground">
                  {vehicleMarkFilters.size}
                </span>
              )}
              <ChevronDown className="size-3" />
            </button>
            {vehicleMarkFilterOpen && (
              <FilterDropdown
                values={vehicleMarkValues}
                selected={vehicleMarkFilters}
                onToggle={toggleVehicleMarkFilter}
                onClear={clearVehicleMarkFilter}
                onClose={() => setVehicleMarkFilterOpen(false)}
              />
            )}
          </div>

          {markFilterActive && (
            <button
              type="button"
              onClick={clearVehicleMarkFilter}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Сбросить фильтр
            </button>
          )}

          <div className="ml-auto text-xs text-muted-foreground">
            {filteredVehicles.length} из {vehicles.length}
          </div>
        </div>

        {filteredVehicles.length === 0 ? (
          <StateMessage
            loading={false}
            error={null}
            empty
            emptyText="ТС не найдены"
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredVehicles.map(vehicle => <VehicleCard key={vehicle.id} vehicle={vehicle} />)}
          </div>
        )}
      </div>
    );
  };

  const renderDrivers = () => {
    if (driversLoading || driversError || drivers.length === 0) {
      return (
        <StateMessage
          loading={driversLoading}
          error={driversError}
          empty={!driversLoading && !driversError && drivers.length === 0}
          emptyText="Водители не найдены"
        />
      );
    }

    return (
      <div className="overflow-auto rounded-lg border border-border bg-card">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-border bg-card text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Логин</th>
              <th className="px-3 py-2 text-left font-medium">ФИО</th>
              <th className="px-3 py-2 text-left font-medium">Активен</th>
              <th className="px-3 py-2 text-left font-medium">Последняя смена</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map(driver => (
              <tr key={driver.id} className="border-b border-border/40 hover:bg-muted/30">
                <td className="px-3 py-2 font-mono">{driver.login}</td>
                <td className="px-3 py-2 font-medium">{driver.fullName}</td>
                <td className="px-3 py-2">
                  <StatusBadge tone={driver.isActive === false ? 'muted' : 'green'}>
                    {driver.isActive === false ? 'нет' : 'да'}
                  </StatusBadge>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{formatDateTime(driver.lastShiftAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderShifts = () => {
    const showState = shiftsLoading || !!shiftsError || shifts.length === 0;

    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
          <DateRangePicker
            dateFrom={dateFrom}
            dateTo={dateTo}
            onRangeChange={(from, to) => {
              setDateFrom(from);
              setDateTo(to);
            }}
          />
          <div className="flex rounded-lg bg-muted/60 p-1">
            <SegmentButton active={shiftStatus === 'all'} onClick={() => setShiftStatus('all')}>
              Все
            </SegmentButton>
            <SegmentButton active={shiftStatus === 'open'} onClick={() => setShiftStatus('open')}>
              Открытые
            </SegmentButton>
            <SegmentButton active={shiftStatus === 'closed'} onClick={() => setShiftStatus('closed')}>
              Закрытые
            </SegmentButton>
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            {shiftsLoading ? 'Загрузка…' : `${shifts.length} смен`}
          </div>
        </div>

        {showState ? (
          <StateMessage
            loading={shiftsLoading}
            error={shiftsError}
            empty={!shiftsLoading && !shiftsError && shifts.length === 0}
            emptyText="Смены не найдены"
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-border bg-card text-muted-foreground">
                  <th className="w-8 px-2 py-2" />
                  <th className="px-3 py-2 text-left font-medium">Водитель</th>
                  <th className="px-3 py-2 text-left font-medium">АТЗ</th>
                  <th className="px-3 py-2 text-left font-medium">Начало</th>
                  <th className="px-3 py-2 text-left font-medium">Конец</th>
                  <th className="px-3 py-2 text-left font-medium">Статус</th>
                  <th className="px-3 py-2 text-right font-medium">Выдано</th>
                  <th className="px-3 py-2 text-right font-medium">Получено</th>
                  <th className="px-3 py-2 text-right font-medium">Правки</th>
                  <th className="px-3 py-2 text-right font-medium">Действия</th>
                </tr>
              </thead>
              <tbody>
                {shifts.map(shift => {
                  const expanded = expandedShiftId === shift.id;
                  return (
                    <Fragment key={shift.id}>
                      <tr
                        onClick={() => void toggleShift(shift.id)}
                        className="cursor-pointer border-b border-border/40 hover:bg-muted/30"
                      >
                        <td className="px-2 py-2 text-muted-foreground">
                          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{shift.driver.fullName}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{shift.driver.login}</div>
                        </td>
                        <td className="px-3 py-2 font-mono">{shift.atz.gosNumber}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(shift.startedAtClient)}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(shift.endedAtClient)}</td>
                        <td className="px-3 py-2">
                          <StatusBadge tone={shift.status === 'open' ? 'amber' : 'muted'}>
                            {shift.status === 'open' ? 'open' : 'closed'}
                          </StatusBadge>
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {formatLiters(shift.dispenseLiters)} л / {shift.dispenseCount} шт
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">{formatLiters(shift.receiptLiters)} л</td>
                        <td className="px-3 py-2 text-right">
                          <span className={shift.editsCount > 0 ? 'font-semibold text-amber-600 dark:text-amber-300' : 'text-muted-foreground'}>
                            {shift.editsCount}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {shift.status === 'open' && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={(event) => {
                                event.stopPropagation();
                                setClosingShift(shift);
                              }}
                            >
                              Закрыть смену
                            </Button>
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr key={`${shift.id}-details`} className="border-b border-border bg-muted/20">
                          <td colSpan={10} className="p-0">
                            <ShiftDetailPanel
                              detail={details[shift.id]}
                              loading={detailLoadingId === shift.id}
                              error={detailErrors[shift.id] ?? null}
                              onEditEvent={(type, event) => {
                                setEventDialogState({ mode: 'edit', shiftId: shift.id, type, event });
                              }}
                              onDeleteEvent={(type, event) => {
                                setEventDialogState({ mode: 'delete', shiftId: shift.id, type, event });
                              }}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden p-3">
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-lg bg-card p-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {lastUpdatedAt && (
            <span className="text-[11px] text-muted-foreground">
              обновлено {lastUpdatedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            type="button"
            onClick={refreshCurrent}
            disabled={refreshLoading}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <RefreshCw className={`size-3.5 ${refreshLoading ? 'animate-spin' : ''}`} />
            Обновить
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab === 'atz' && renderAtz()}
        {activeTab === 'vehicles' && renderVehicles()}
        {activeTab === 'shifts' && renderShifts()}
        {activeTab === 'drivers' && renderDrivers()}
      </div>

      <CreateAtzDialog
        open={createAtzOpen}
        onOpenChange={setCreateAtzOpen}
        onSuccess={loadAtz}
      />
      <EditAtzDialog
        atz={editingAtz}
        onOpenChange={(open) => {
          if (!open) setEditingAtz(null);
        }}
        onSuccess={loadAtz}
      />
      <CloseShiftDialog
        shift={closingShift}
        currentRemainingLiters={closingShiftRemainingLiters}
        onOpenChange={(open) => {
          if (!open) setClosingShift(null);
        }}
        onSuccess={refreshAfterCloseShift}
        onAlreadyClosed={loadShifts}
      />
      <EventMutationDialog
        state={eventDialogState}
        onOpenChange={(open) => {
          if (!open) setEventDialogState(null);
        }}
        onSuccess={refreshAfterEventMutation}
      />
    </div>
  );
}
