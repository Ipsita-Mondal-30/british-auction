import { Router, type NextFunction, type Request, type Response } from 'express';
import { Prisma, PrismaClient, type User } from '@prisma/client';
import type { Server } from 'socket.io';
import { z } from 'zod';
import * as A from './auction';

export const prisma = new PrismaClient();

export class HttpError extends Error {
  constructor(public status: number, message: string, public issues?: unknown) {
    super(message);
  }
}

const DAY = 86_400_000;
const fmt = (cents: number) => (cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const TRIGGER_LABEL: Record<A.TriggerType, string> = {
  BID_RECEIVED: 'Bid received',
  ANY_RANK_CHANGE: 'Supplier ranking changed',
  L1_CHANGE: 'Lowest bidder (L1) changed',
};

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw new HttpError(400, issues[0].message, issues);
  }
  return r.data;
}

function parseId(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'RFQ not found');
  return id;
}

// ponytail: mock auth — trusts the x-user-id header. Swap for real sessions/JWT before production.
async function auth(req: Request, res: Response, next: NextFunction) {
  const id = Number(req.header('x-user-id'));
  const user = Number.isInteger(id) ? await prisma.user.findUnique({ where: { id } }) : null;
  if (!user) throw new HttpError(401, 'Pick a user to log in as');
  res.locals.user = user;
  next();
}

function requireRole(res: Response, role: User['role']): User {
  const user: User = res.locals.user;
  if (user.role !== role) throw new HttpError(403, `Only ${role.toLowerCase()}s can do this`);
  return user;
}

const rfqInput = z
  .object({
    refId: z.string().trim().min(1, 'Reference ID is required').max(50),
    name: z.string().trim().min(1, 'RFQ name is required').max(200),
    bidStartAt: z.coerce.date({ error: 'Bid start time is required' }),
    bidCloseAt: z.coerce.date({ error: 'Bid close time is required' }),
    forcedCloseAt: z.coerce.date({ error: 'Forced close time is required' }),
    pickupDate: z.coerce.date({ error: 'Pickup / service date is required' }),
    triggerWindowMin: z.number().int().min(1, 'Trigger window (X) must be at least 1 minute').max(1440),
    extensionMin: z.number().int().min(1, 'Extension duration (Y) must be at least 1 minute').max(1440),
    triggerType: z.enum(['BID_RECEIVED', 'ANY_RANK_CHANGE', 'L1_CHANGE']),
  })
  .superRefine((v, ctx) => {
    const fail = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (v.bidCloseAt <= v.bidStartAt) fail('bidCloseAt', 'Bid close time must be after bid start time');
    if (v.forcedCloseAt <= v.bidCloseAt) fail('forcedCloseAt', 'Forced close time must be later than bid close time');
    if (v.bidCloseAt <= new Date()) fail('bidCloseAt', 'Bid close time must be in the future');
    // pickupDate is a calendar date (UTC midnight); it may fall on the same day as forced close
    if (v.pickupDate.getTime() + DAY <= v.forcedCloseAt.getTime())
      fail('pickupDate', 'Pickup / service date cannot be before the forced close date');
  });

const money = (label: string) =>
  z
    .number({ error: `${label} is required` })
    .min(0, `${label} cannot be negative`)
    .max(1e9)
    .transform((n) => Math.round(n * 100)); // → cents

const bidInput = z.object({
  carrierName: z.string().trim().min(1, 'Carrier name is required').max(100),
  freightCharges: money('Freight charges'),
  originCharges: money('Origin charges'),
  destinationCharges: money('Destination charges'),
  transitTimeDays: z.number({ error: 'Transit time is required' }).int().min(1, 'Transit time must be at least 1 day').max(365),
  quoteValidUntil: z.coerce.date({ error: 'Quote validity date is required' }),
});

type BidRow = Prisma.BidGetPayload<{ include: { supplier: { select: { id: true; name: true; company: true } } } }>;
type EventRow = Prisma.AuctionEventGetPayload<{}>;

const withCents = <T extends { totalAmount: Prisma.Decimal }>(b: T) => ({ ...b, totalCents: A.toCents(b.totalAmount) });

const bidOut = ({ totalCents, ...b }: BidRow & { totalCents: number }) => b;

/** What a supplier may see of the activity log: their own bids, never competitor identities. */
function supplierEvent(e: EventRow, me: number, rfq: { triggerType: A.TriggerType; triggerWindowMin: number }) {
  const reason =
    e.type === 'BID_PLACED'
      ? e.actorId === me
        ? e.reason
        : 'A competitor placed a bid'
      : e.type === 'TIME_EXTENDED'
        ? `${TRIGGER_LABEL[rfq.triggerType]} in the last ${rfq.triggerWindowMin} min`
        : 'Trigger fired, but the auction is already at its forced close time';
  const { actorId, bidId, ...rest } = e;
  return { ...rest, reason, mine: actorId === me };
}

async function details(id: number, user: User) {
  const rfq = await prisma.rfq.findUnique({
    where: { id },
    include: {
      buyer: { select: { name: true, company: true } },
      bids: { include: { supplier: { select: { id: true, name: true, company: true } } }, orderBy: { id: 'asc' } },
      events: { orderBy: { id: 'asc' } },
    },
  });
  if (!rfq) throw new HttpError(404, 'RFQ not found');

  const { bids, events, ...config } = rfq;
  const ranked = A.rank(bids.map(withCents));
  const base = {
    ...config,
    status: A.status(rfq, new Date()),
    lowestBid: ranked[0]?.totalAmount ?? null,
    bidCount: bids.length,
    supplierCount: ranked.length,
  };

  if (user.role === 'BUYER') {
    // Every bid ever placed, lowest first; `current` marks each supplier's live quote.
    const live = new Set(ranked.map((b) => b.id));
    const allBids = bids
      .map(withCents)
      .sort((a, b) => a.totalCents - b.totalCents || a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)
      .map((b) => ({ ...bidOut(b), current: live.has(b.id) }));
    return {
      ...base,
      ranking: ranked.map((b, i) => ({ rank: i + 1, ...bidOut(b) })),
      allBids,
      events,
    };
  }
  const myRank = ranked.findIndex((b) => b.supplierId === user.id);
  return {
    ...base,
    myRank: myRank < 0 ? null : myRank + 1,
    myBids: bids.filter((b) => b.supplierId === user.id),
    events: events.map((e) => supplierEvent(e, user.id, rfq)),
  };
}

export function routes(io: Server) {
  const r = Router();

  r.get('/health', (_req, res) => {
    res.json({ ok: true, serverNow: new Date() });
  });

  r.get('/users', async (_req, res) => {
    res.json(await prisma.user.findMany({ orderBy: [{ role: 'asc' }, { id: 'asc' }] }));
  });

  r.use(auth);

  r.get('/rfqs', async (_req, res) => {
    const user: User = res.locals.user;
    const [rfqs, mins] = await Promise.all([
      prisma.rfq.findMany({ orderBy: { id: 'desc' } }),
      prisma.bid.groupBy({ by: ['rfqId'], _min: { totalAmount: true }, _count: true }),
    ]);
    // Bids only ever go down per supplier, so the global minimum is the current L1 price.
    const byRfq = new Map(mins.map((m) => [m.rfqId, m]));
    const now = new Date();

    // Suppliers also get their own rank per RFQ (drives "you've been outbid" notifications).
    // ponytail: loads every bid; fine at assignment scale, move to a window-function query if bids grow large.
    const myRank = new Map<number, number>();
    if (user.role === 'SUPPLIER') {
      const bids = await prisma.bid.findMany({ select: { id: true, rfqId: true, supplierId: true, totalAmount: true, createdAt: true } });
      const perRfq = new Map<number, typeof bids>();
      for (const b of bids) perRfq.set(b.rfqId, [...(perRfq.get(b.rfqId) ?? []), b]);
      for (const [rfqId, list] of perRfq) {
        const i = A.rank(list.map(withCents)).findIndex((b) => b.supplierId === user.id);
        if (i >= 0) myRank.set(rfqId, i + 1);
      }
    }

    res.json({
      serverNow: now,
      rfqs: rfqs.map((rfq) => ({
        ...rfq,
        status: A.status(rfq, now),
        lowestBid: byRfq.get(rfq.id)?._min.totalAmount ?? null,
        bidCount: byRfq.get(rfq.id)?._count ?? 0,
        ...(user.role === 'SUPPLIER' && { myRank: myRank.get(rfq.id) ?? null }),
      })),
    });
  });

  r.post('/rfqs', async (req, res) => {
    const buyer = requireRole(res, 'BUYER');
    const input = parse(rfqInput, req.body);
    try {
      const rfq = await prisma.rfq.create({
        data: { ...input, buyerId: buyer.id, currentCloseAt: input.bidCloseAt },
      });
      io.to('list').emit('rfq:updated', { rfqId: rfq.id });
      res.status(201).json(rfq);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new HttpError(409, `Reference ID "${input.refId}" is already in use`, [
          { path: 'refId', message: 'Reference ID is already in use' },
        ]);
      throw e;
    }
  });

  r.get('/rfqs/:id', async (req, res) => {
    res.json({ serverNow: new Date(), rfq: await details(parseId(req.params.id), res.locals.user) });
  });

  r.post('/rfqs/:id/bids', async (req, res) => {
    // Arrival time is the bid's timestamp. Close times only ever move later, so checking
    // against arrival (not lock-acquired) time never lets a late bid in.
    const now = new Date();
    const id = parseId(req.params.id);
    const supplier = requireRole(res, 'SUPPLIER');
    const input = parse(bidInput, req.body);
    const totalCents = input.freightCharges + input.originCharges + input.destinationCharges;
    if (totalCents <= 0) throw new HttpError(400, 'Total charges must be greater than 0');
    if (input.quoteValidUntil.getTime() + DAY <= now.getTime())
      throw new HttpError(400, 'Quote validity cannot be in the past');

    await prisma.$transaction(
      async (tx) => {
        // Row lock: bids on the same RFQ are processed one at a time.
        await tx.$queryRaw`SELECT id FROM "Rfq" WHERE id = ${id} FOR UPDATE`;
        const rfq = await tx.rfq.findUnique({
          where: { id },
          include: { bids: { select: { id: true, supplierId: true, totalAmount: true, createdAt: true } } },
        });
        if (!rfq) throw new HttpError(404, 'RFQ not found');
        if (!A.isOpen(rfq, now))
          throw new HttpError(409, now < rfq.bidStartAt ? 'Bidding has not started yet' : 'Bidding is closed');

        const existing = rfq.bids.map(withCents);
        const before = A.rank(existing);
        const mine = before.find((b) => b.supplierId === supplier.id);
        if (mine && totalCents >= mine.totalCents)
          throw new HttpError(400, `New bid must be lower than your previous bid of ${fmt(mine.totalCents)}`);

        const cents = (c: number) => (c / 100).toFixed(2);
        const bid = await tx.bid.create({
          data: {
            rfqId: id,
            supplierId: supplier.id,
            carrierName: input.carrierName,
            freightCharges: cents(input.freightCharges),
            originCharges: cents(input.originCharges),
            destinationCharges: cents(input.destinationCharges),
            totalAmount: cents(totalCents),
            transitTimeDays: input.transitTimeDays,
            quoteValidUntil: input.quoteValidUntil,
            createdAt: now,
          },
        });
        const after = A.rank([...existing, { ...bid, totalCents }]);
        const myRank = after.findIndex((b) => b.supplierId === supplier.id) + 1;

        const users = await tx.user.findMany({ where: { id: { in: after.map((b) => b.supplierId) } } });
        const name = (sid: number) => users.find((u) => u.id === sid)?.name ?? `#${sid}`;

        await tx.auctionEvent.create({
          data: {
            rfqId: id,
            type: 'BID_PLACED',
            actorId: supplier.id,
            bidId: bid.id,
            reason: `${supplier.name} bid ${fmt(totalCents)} → now L${myRank}`,
            createdAt: now,
          },
        });

        if (!A.inTriggerWindow(now, rfq.currentCloseAt, rfq.triggerWindowMin)) return;
        const cause = A.detectTrigger(rfq.triggerType, before, after, name);
        if (!cause) return;

        const newClose = A.extendClose(rfq.currentCloseAt, rfq.forcedCloseAt, rfq.extensionMin);
        const window = `in the last ${rfq.triggerWindowMin} min`;
        if (!newClose) {
          await tx.auctionEvent.create({
            data: {
              rfqId: id,
              type: 'EXTENSION_CAPPED',
              actorId: supplier.id,
              bidId: bid.id,
              reason: `${cause} ${window}, but the auction is already at its forced close time`,
              createdAt: now,
            },
          });
          return;
        }
        const addedMin = (newClose.getTime() - rfq.currentCloseAt.getTime()) / 60_000;
        await tx.rfq.update({ where: { id }, data: { currentCloseAt: newClose } });
        await tx.auctionEvent.create({
          data: {
            rfqId: id,
            type: 'TIME_EXTENDED',
            actorId: supplier.id,
            bidId: bid.id,
            oldCloseAt: rfq.currentCloseAt,
            newCloseAt: newClose,
            reason:
              `${cause} ${window} → extended by ${+addedMin.toFixed(2)} min` +
              (addedMin < rfq.extensionMin ? ' (capped at forced close time)' : ''),
            createdAt: now,
          },
        });
      },
      { maxWait: 10_000, timeout: 10_000 },
    );

    io.to(`rfq:${id}`).to('list').emit('rfq:updated', { rfqId: id });
    res.status(201).json({ serverNow: new Date(), rfq: await details(id, supplier) });
  });

  return r;
}
