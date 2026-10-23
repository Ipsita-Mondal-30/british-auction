import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTrigger, extendClose, inTriggerWindow, isOpen, rank, status, toCents, type RankableBid } from './auction';

const t = (hhmm: string) => new Date(`2026-01-01T${hhmm}:00Z`);
let nextId = 1;
const bid = (supplierId: number, total: number, at = '17:00'): RankableBid => ({
  id: nextId++,
  supplierId,
  totalCents: total * 100,
  createdAt: t(at),
});
const name = (id: number) => ['', 'A', 'B', 'C'][id];
const ids = (r: RankableBid[]) => r.map((b) => b.supplierId);

test('rank uses each supplier latest bid, ties go to earlier bid', () => {
  const bids = [bid(1, 1000, '17:00'), bid(2, 900, '17:01'), bid(1, 800, '17:02'), bid(3, 900, '17:00')];
  assert.deepEqual(ids(rank(bids)), [1, 3, 2]); // A=800, C=900@17:00 beats B=900@17:01
});

test('toCents avoids float drift', () => {
  assert.equal(toCents('0.1') + toCents('0.2'), toCents('0.3'));
  assert.equal(toCents(1234.56), 123456);
});

test('isOpen: start inclusive, close exclusive', () => {
  const rfq = { bidStartAt: t('17:00'), currentCloseAt: t('18:00') };
  assert.equal(isOpen(rfq, t('16:59')), false);
  assert.equal(isOpen(rfq, t('17:00')), true);
  assert.equal(isOpen(rfq, new Date(t('18:00').getTime() - 1)), true);
  assert.equal(isOpen(rfq, t('18:00')), false);
});

test('trigger window is the last X minutes before current close', () => {
  assert.equal(inTriggerWindow(t('17:49'), t('18:00'), 10), false);
  assert.equal(inTriggerWindow(t('17:50'), t('18:00'), 10), true);
  assert.equal(inTriggerWindow(t('17:59'), t('18:00'), 10), true);
  assert.equal(inTriggerWindow(t('18:00'), t('18:00'), 10), false);
  // after an extension the window moves with the close time
  assert.equal(inTriggerWindow(t('17:56'), t('18:05'), 10), true);
});

test('BID_RECEIVED always fires', () => {
  const a = bid(1, 1000);
  assert.ok(detectTrigger('BID_RECEIVED', [a], [a, bid(2, 2000)], name));
});

test('ANY_RANK_CHANGE: overtaking fires, bottom entrant and self-undercut do not', () => {
  const a = bid(1, 1000), b = bid(2, 1200);
  const before = rank([a, b]);
  const b2 = bid(2, 900, '17:58');
  assert.equal(detectTrigger('ANY_RANK_CHANGE', before, rank([a, b, b2]), name), 'Rank change: B L2→L1, A L1→L2');
  // new supplier enters at the bottom: nobody moved
  assert.equal(detectTrigger('ANY_RANK_CHANGE', before, rank([a, b, bid(3, 5000)]), name), null);
  // new supplier enters in the middle: B moves L2→L3
  assert.ok(detectTrigger('ANY_RANK_CHANGE', before, rank([a, b, bid(3, 1100)]), name));
  // L1 lowers own price: ranks unchanged
  assert.equal(detectTrigger('ANY_RANK_CHANGE', before, rank([a, b, bid(1, 950)]), name), null);
  // very first bid: no previously ranked supplier
  assert.equal(detectTrigger('ANY_RANK_CHANGE', [], [a], name), null);
});

test('L1_CHANGE: only a different lowest supplier fires', () => {
  const a = bid(1, 1000), b = bid(2, 1200);
  const before = rank([a, b]);
  assert.equal(detectTrigger('L1_CHANGE', before, rank([a, b, bid(3, 900)]), name), 'L1 changed: A → C');
  assert.equal(detectTrigger('L1_CHANGE', before, rank([a, b, bid(2, 1100)]), name), null); // L2 improves, still L2
  assert.equal(detectTrigger('L1_CHANGE', before, rank([a, b, bid(1, 900)]), name), null); // L1 undercuts self
  assert.equal(detectTrigger('L1_CHANGE', [], [a], name), null); // first bid
});

test('extension adds Y to current close, capped at forced close', () => {
  assert.deepEqual(extendClose(t('18:00'), t('18:30'), 5), t('18:05'));
  assert.deepEqual(extendClose(t('18:28'), t('18:30'), 5), t('18:30'));
  assert.equal(extendClose(t('18:30'), t('18:30'), 5), null);
});

test('status derivation', () => {
  const rfq = { bidStartAt: t('17:00'), currentCloseAt: t('18:00'), forcedCloseAt: t('18:30') };
  assert.equal(status(rfq, t('16:00')), 'UPCOMING');
  assert.equal(status(rfq, t('17:30')), 'ACTIVE');
  assert.equal(status(rfq, t('18:00')), 'CLOSED');
  assert.equal(status({ ...rfq, currentCloseAt: t('18:30') }, t('18:30')), 'FORCE_CLOSED');
});
