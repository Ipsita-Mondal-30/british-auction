'use client';

import { useState, type FormEvent } from 'react';
import { CircleNotch } from '@phosphor-icons/react';
import { api, ApiError, type RfqDetails, type User } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { notify } from '@/lib/notify';
import { Button, cx, Field, inputClass } from './ui';

type Form = {
  carrierName: string;
  freightCharges: string;
  originCharges: string;
  destinationCharges: string;
  transitTimeDays: string;
  quoteValidUntil: string;
};
type Errors = Partial<Record<keyof Form | 'total', string>>;

const CHARGES = [
  ['freightCharges', 'Freight'],
  ['originCharges', 'Origin'],
  ['destinationCharges', 'Destination'],
] as const;

export function BidForm({
  rfq,
  user,
  open,
  onPlaced,
}: {
  rfq: RfqDetails;
  user: User;
  open: boolean;
  onPlaced: (rfq: RfqDetails) => void;
}) {
  const last = rfq.myBids?.at(-1);
  const [form, setForm] = useState<Form>(() => ({
    carrierName: last?.carrierName ?? user.company,
    freightCharges: last?.freightCharges ?? '',
    originCharges: last?.originCharges ?? '',
    destinationCharges: last?.destinationCharges ?? '',
    transitTimeDays: String(last?.transitTimeDays ?? ''),
    quoteValidUntil: last?.quoteValidUntil.slice(0, 10) ?? new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
  }));
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  const cents = (v: string) => Math.round(Number(v || 0) * 100);
  const total = cents(form.freightCharges) + cents(form.originCharges) + cents(form.destinationCharges);
  const prev = last ? cents(last.totalAmount) : null;
  const l1 = rfq.lowestBid ? cents(rfq.lowestBid) : null;

  const set = (k: keyof Form) => (e: { target: { value: string } }) => {
    setForm({ ...form, [k]: e.target.value });
    setErrors(({ [k]: _, total: __, ...rest }) => rest);
  };

  function validate(): Errors {
    const e: Errors = {};
    if (!form.carrierName.trim()) e.carrierName = 'Carrier name is required';
    for (const [k, label] of CHARGES) {
      if (form[k] === '') e[k] = `${label} charges are required`;
      else if (Number(form[k]) < 0) e[k] = 'Cannot be negative';
    }
    const days = Number(form.transitTimeDays);
    if (!Number.isInteger(days) || days < 1) e.transitTimeDays = 'Whole days, at least 1';
    if (!form.quoteValidUntil) e.quoteValidUntil = 'Validity date is required';
    else if (form.quoteValidUntil < new Date().toISOString().slice(0, 10)) e.quoteValidUntil = 'Cannot be in the past';
    if (!Object.keys(e).length) {
      if (total <= 0) e.total = 'Total charges must be greater than 0';
      else if (prev !== null && total >= prev) e.total = `Must be lower than your previous bid of ${fmtMoney(prev / 100)}`;
    }
    return e;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      document.getElementById(Object.keys(e)[0])?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const res = await api<{ rfq: RfqDetails }>(`/rfqs/${rfq.id}/bids`, {
        method: 'POST',
        body: JSON.stringify({
          carrierName: form.carrierName,
          freightCharges: Number(form.freightCharges),
          originCharges: Number(form.originCharges),
          destinationCharges: Number(form.destinationCharges),
          transitTimeDays: Number(form.transitTimeDays),
          quoteValidUntil: form.quoteValidUntil,
        }),
      });
      notify({
        kind: 'success',
        id: `placed-${rfq.id}`,
        title: `Bid of ${fmtMoney(total / 100)} placed`,
        description: res.rfq.myRank === 1 ? "You're the lowest bidder (L1)." : `You're now L${res.rfq.myRank}.`,
      });
      onPlaced(res.rfq);
    } catch (err) {
      const e = err as ApiError;
      const fieldErrors = Object.fromEntries(e.issues.filter((i) => i.path).map((i) => [i.path, i.message]));
      setErrors(Object.keys(fieldErrors).length ? fieldErrors : { total: e.message });
    } finally {
      setSubmitting(false);
    }
  }

  const field = (k: keyof Form, type: string, extra: object = {}) => ({
    id: k,
    type,
    value: form[k],
    onChange: set(k),
    disabled: !open || submitting,
    'aria-invalid': !!errors[k],
    'aria-describedby': errors[k] ? `${k}-error` : undefined,
    className: cx(inputClass(!!errors[k]), type === 'number' && 'font-mono tabular-nums', 'disabled:opacity-60'),
    ...extra,
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-5 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Carrier name" htmlFor="carrierName" error={errors.carrierName}>
          <input {...field('carrierName', 'text')} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Transit time" htmlFor="transitTimeDays" error={errors.transitTimeDays}>
            <div className="relative">
              <input {...field('transitTimeDays', 'number', { min: 1, step: 1, inputMode: 'numeric' })} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-fg-3">days</span>
            </div>
          </Field>
          <Field label="Quote valid until" htmlFor="quoteValidUntil" error={errors.quoteValidUntil}>
            <input {...field('quoteValidUntil', 'date')} />
          </Field>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {CHARGES.map(([k, label]) => (
          <Field key={k} label={`${label} charges`} htmlFor={k} error={errors[k]}>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-3">₹</span>
              <input {...field(k, 'number', { min: 0, step: '0.01', inputMode: 'decimal' })} className={cx(field(k, 'number').className, 'pl-7')} />
            </div>
          </Field>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-surface-2 px-4 py-3">
        <div>
          <div className="text-xs text-fg-3">Total quote</div>
          <div className="font-mono text-xl font-semibold tabular-nums">{fmtMoney(total / 100)}</div>
        </div>
        <div className="text-right text-xs leading-relaxed text-fg-2">
          {prev !== null && <div>Your last bid {fmtMoney(prev / 100)}</div>}
          {l1 !== null && total > 0 && (
            <div className={total < l1 ? 'font-medium text-ok' : undefined}>
              {total < l1 ? `Beats current L1 by ${fmtMoney((l1 - total) / 100)}` : `Current L1 ${fmtMoney(l1 / 100)}`}
            </div>
          )}
        </div>
      </div>

      {errors.total && (
        <p role="alert" className="text-sm text-danger">
          {errors.total}
        </p>
      )}

      <Button type="submit" disabled={!open || submitting} className="w-full sm:w-auto">
        {submitting && <CircleNotch size={16} className="animate-spin" />}
        {!open ? 'Bidding is not open' : submitting ? 'Placing bid' : last ? 'Place lower bid' : 'Place bid'}
      </Button>
    </form>
  );
}
