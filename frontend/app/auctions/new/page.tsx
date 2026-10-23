'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CircleNotch } from '@phosphor-icons/react';
import { api, ApiError, useRequireUser, type Rfq, type TriggerType } from '@/lib/api';
import { fmtDateTime, TRIGGER_HELP, TRIGGER_LABEL, TRIGGER_SENTENCE } from '@/lib/format';
import { Button, cx, ErrorNote, Field, inputClass, Panel, Skeleton } from '@/components/ui';

type Form = {
  refId: string;
  name: string;
  bidStartAt: string;
  bidCloseAt: string;
  forcedCloseAt: string;
  pickupDate: string;
  triggerWindowMin: string;
  extensionMin: string;
  triggerType: TriggerType;
};
type Errors = Partial<Record<keyof Form, string>>;

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function defaults(): Form {
  const start = new Date(Math.ceil(Date.now() / 300_000) * 300_000);
  const close = new Date(start.getTime() + 60 * 60_000);
  const forced = new Date(close.getTime() + 30 * 60_000);
  const pickup = new Date(forced.getTime() + 2 * 86_400_000);
  return {
    refId: `RFQ-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    name: '',
    bidStartAt: toLocalInput(start),
    bidCloseAt: toLocalInput(close),
    forcedCloseAt: toLocalInput(forced),
    pickupDate: toLocalInput(pickup).slice(0, 10),
    triggerWindowMin: '10',
    extensionMin: '5',
    triggerType: 'L1_CHANGE',
  };
}

/** Mirrors the server rules so mistakes show before submitting. The server stays authoritative. */
function validate(f: Form): Errors {
  const e: Errors = {};
  const t = (s: string) => (s ? new Date(s).getTime() : NaN);
  const [start, close, forced] = [t(f.bidStartAt), t(f.bidCloseAt), t(f.forcedCloseAt)];
  if (!f.refId.trim()) e.refId = 'Reference ID is required';
  if (!f.name.trim()) e.name = 'RFQ name is required';
  if (isNaN(start)) e.bidStartAt = 'Bid start time is required';
  if (isNaN(close)) e.bidCloseAt = 'Bid close time is required';
  else if (close <= start) e.bidCloseAt = 'Must be after the bid start time';
  else if (close <= Date.now()) e.bidCloseAt = 'Must be in the future';
  if (isNaN(forced)) e.forcedCloseAt = 'Forced close time is required';
  else if (forced <= close) e.forcedCloseAt = 'Must be later than the bid close time';
  if (!f.pickupDate) e.pickupDate = 'Pickup / service date is required';
  else if (!isNaN(forced) && f.pickupDate < toLocalInput(new Date(forced)).slice(0, 10))
    e.pickupDate = 'Cannot be before the forced close date';
  const x = Number(f.triggerWindowMin);
  const y = Number(f.extensionMin);
  if (!Number.isInteger(x) || x < 1) e.triggerWindowMin = 'Whole minutes, at least 1';
  if (!Number.isInteger(y) || y < 1) e.extensionMin = 'Whole minutes, at least 1';
  return e;
}

export default function NewRfqPage() {
  const user = useRequireUser();
  const router = useRouter();
  useEffect(() => {
    if (user && user.role !== 'BUYER') router.replace('/auctions');
  }, [user, router]);

  // The form reads the clock for defaults, so it only mounts on the client once the user is known.
  if (!user || user.role !== 'BUYER') return <Skeleton className="h-[640px] rounded-xl" />;
  return <RfqForm />;
}

function RfqForm() {
  const router = useRouter();
  const [form, setForm] = useState<Form>(defaults);
  const [touched, setTouched] = useState<Partial<Record<keyof Form, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const errors = useMemo(() => ({ ...validate(form), ...serverErrors }), [form, serverErrors]);

  const set = (k: keyof Form) => (e: { target: { value: string } }) => {
    setForm({ ...form, [k]: e.target.value });
    setServerErrors(({ [k]: _, ...rest }) => rest);
  };
  const shown = (k: keyof Form) => (touched[k] ? errors[k] : undefined);
  const blur = (k: keyof Form) => () => setTouched((t) => ({ ...t, [k]: true }));
  const input = (k: keyof Form, type = 'text', extra: object = {}) => ({
    id: k,
    type,
    value: form[k],
    onChange: set(k),
    onBlur: blur(k),
    'aria-invalid': !!shown(k),
    'aria-describedby': shown(k) ? `${k}-error` : undefined,
    className: inputClass(!!shown(k)),
    ...extra,
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(Object.fromEntries(Object.keys(form).map((k) => [k, true])));
    setSubmitError(null);
    const invalid = Object.keys(validate(form));
    if (invalid.length) {
      document.getElementById(invalid[0])?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const rfq = await api<Rfq>('/rfqs', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          bidStartAt: new Date(form.bidStartAt).toISOString(),
          bidCloseAt: new Date(form.bidCloseAt).toISOString(),
          forcedCloseAt: new Date(form.forcedCloseAt).toISOString(),
          triggerWindowMin: Number(form.triggerWindowMin),
          extensionMin: Number(form.extensionMin),
        }),
      });
      router.push(`/auctions/${rfq.id}`);
    } catch (err) {
      const e = err as ApiError;
      const fieldErrors = Object.fromEntries(e.issues.filter((i) => i.path).map((i) => [i.path, i.message]));
      setServerErrors(fieldErrors);
      if (!Object.keys(fieldErrors).length) setSubmitError(e.message);
      setSubmitting(false);
    }
  }

  const start = new Date(form.bidStartAt);
  const close = new Date(form.bidCloseAt);
  const forced = new Date(form.forcedCloseAt);
  const datesOk = !isNaN(start.getTime()) && !isNaN(close.getTime()) && !isNaN(forced.getTime()) && forced > close && close > start;
  const headroomMin = datesOk ? Math.round((forced.getTime() - close.getTime()) / 60_000) : 0;
  const maxExtensions = datesOk && Number(form.extensionMin) > 0 ? Math.ceil(headroomMin / Number(form.extensionMin)) : 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/auctions" className="inline-flex items-center gap-1.5 text-sm text-fg-2 hover:text-fg">
          <ArrowLeft size={14} /> Auctions
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">New RFQ</h1>
      </div>

      <form onSubmit={submit} noValidate className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Panel title="Details">
            <div className="grid gap-5 p-5 md:grid-cols-[2fr_1fr_1fr]">
              <Field label="RFQ name" htmlFor="name" error={shown('name')}>
                <input {...input('name')} placeholder="e.g. Mumbai to Delhi, 2 x 40ft" />
              </Field>
              <Field label="Reference ID" htmlFor="refId" error={shown('refId')} hint="Must be unique">
                <input {...input('refId')} className={cx(inputClass(!!shown('refId')), 'font-mono')} />
              </Field>
              <Field label="Pickup / service date" htmlFor="pickupDate" error={shown('pickupDate')}>
                <input {...input('pickupDate', 'date')} />
              </Field>
            </div>
          </Panel>

          <Panel title="Bidding schedule">
            <div className="grid gap-5 p-5 sm:grid-cols-3">
              <Field label="Bid start" htmlFor="bidStartAt" error={shown('bidStartAt')}>
                <input {...input('bidStartAt', 'datetime-local')} />
              </Field>
              <Field label="Bid close" htmlFor="bidCloseAt" error={shown('bidCloseAt')} hint="Can move later with extensions">
                <input {...input('bidCloseAt', 'datetime-local')} />
              </Field>
              <Field label="Forced close" htmlFor="forcedCloseAt" error={shown('forcedCloseAt')} hint="Hard stop, never extended">
                <input {...input('forcedCloseAt', 'datetime-local')} />
              </Field>
            </div>
          </Panel>

          <Panel title="Extension rules">
            <div className="space-y-5 p-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Trigger window (X)" htmlFor="triggerWindowMin" error={shown('triggerWindowMin')} hint="Minutes before close to watch for activity">
                  <div className="relative">
                    <input {...input('triggerWindowMin', 'number', { min: 1, step: 1, inputMode: 'numeric' })} />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-fg-3">min</span>
                  </div>
                </Field>
                <Field label="Extension duration (Y)" htmlFor="extensionMin" error={shown('extensionMin')} hint="Minutes added each time it triggers">
                  <div className="relative">
                    <input {...input('extensionMin', 'number', { min: 1, step: 1, inputMode: 'numeric' })} />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-fg-3">min</span>
                  </div>
                </Field>
              </div>

              <fieldset>
                <legend className="text-sm font-medium">Extend when</legend>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  {(Object.keys(TRIGGER_LABEL) as TriggerType[]).map((t) => (
                    <label
                      key={t}
                      className={cx(
                        'press cursor-pointer rounded-lg border p-3.5',
                        form.triggerType === t ? 'border-accent bg-accent-soft' : 'border-line-strong hover:bg-surface-2',
                      )}
                    >
                      <input
                        type="radio"
                        name="triggerType"
                        value={t}
                        checked={form.triggerType === t}
                        onChange={set('triggerType')}
                        className="sr-only"
                      />
                      <span className={cx('block text-sm font-medium', form.triggerType === t && 'text-accent')}>{TRIGGER_LABEL[t]}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-fg-2">{TRIGGER_HELP[t]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </Panel>
        </div>

        <div className="space-y-4 lg:sticky lg:top-20">
          <Panel title="How this auction runs">
            <div className="space-y-4 p-5 text-sm">
              {datesOk ? (
                <ol className="space-y-3">
                  <li className="flex justify-between gap-3">
                    <span className="text-fg-2">Opens</span>
                    <span className="text-right font-medium">{fmtDateTime(start.toISOString())}</span>
                  </li>
                  <li className="flex justify-between gap-3">
                    <span className="text-fg-2">Closes</span>
                    <span className="text-right font-medium">{fmtDateTime(close.toISOString())}</span>
                  </li>
                  <li className="flex justify-between gap-3">
                    <span className="text-fg-2">Hard stop</span>
                    <span className="text-right font-medium">{fmtDateTime(forced.toISOString())}</span>
                  </li>
                </ol>
              ) : (
                <p className="text-fg-2">Fix the schedule to preview the timeline.</p>
              )}
              <p className="border-t border-line pt-4 leading-relaxed text-fg-2">
                If <span className="font-medium text-fg">{TRIGGER_SENTENCE[form.triggerType]}</span> in the last{' '}
                <span className="font-medium text-fg">{form.triggerWindowMin || 'X'} min</span> before close, the close moves{' '}
                <span className="font-medium text-fg">{form.extensionMin || 'Y'} min</span> later.
                {datesOk && (
                  <>
                    {' '}
                    That leaves {headroomMin} min of headroom, room for up to {maxExtensions} extension{maxExtensions === 1 ? '' : 's'}.
                  </>
                )}
              </p>
            </div>
          </Panel>
          {submitError && <ErrorNote message={submitError} />}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting && <CircleNotch size={16} className="animate-spin" />}
            {submitting ? 'Creating' : 'Create RFQ'}
          </Button>
        </div>
      </form>
    </div>
  );
}
