// Resets the DB to demo data with times relative to "now". Run: npm run seed
import { PrismaClient, type TriggerType } from '@prisma/client';

try {
  process.loadEnvFile();
} catch {} // no .env when DATABASE_URL is passed inline

// The seed wipes every table. Refuse to touch a remote database unless explicitly told to.
const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && !process.argv.includes('--force')) {
  console.error('Refusing to reset a non-local database. Re-run with: npm run seed -- --force');
  process.exit(1);
}

const prisma = new PrismaClient();
const MIN = 60_000;
const at = (minFromNow: number) => new Date(Date.now() + minFromNow * MIN);
const day = (daysFromNow: number) => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime() + daysFromNow * 86_400_000;

async function main() {
  await prisma.$executeRaw`TRUNCATE "AuctionEvent", "Bid", "Rfq", "User" RESTART IDENTITY CASCADE`;

  const buyer = await prisma.user.create({ data: { name: 'Priya Sharma', company: 'Acme Manufacturing', role: 'BUYER' } });
  const suppliers = [];
  for (const [name, company] of [
    ['Rahul Verma', 'Swift Freight'],
    ['Ananya Iyer', 'Oceanic Carriers'],
    ['Karan Mehta', 'Northline Cargo'],
    ['Sara Khan', 'Rapid Haul'],
  ]) {
    suppliers.push(await prisma.user.create({ data: { name, company, role: 'SUPPLIER' } }));
  }
  const [s1, s2, s3, s4] = suppliers;

  async function rfq(
    refId: string,
    name: string,
    t: { start: number; close: number; current?: number; forced: number },
    cfg: { x: number; y: number; type: TriggerType },
    bids: [supplier: typeof s1, total: number, minFromNow: number][],
  ) {
    const r = await prisma.rfq.create({
      data: {
        refId,
        name,
        buyerId: buyer.id,
        bidStartAt: at(t.start),
        bidCloseAt: at(t.close),
        currentCloseAt: at(t.current ?? t.close),
        forcedCloseAt: at(t.forced),
        pickupDate: new Date(day(Math.ceil(t.forced / 1440) + 2)),
        triggerWindowMin: cfg.x,
        extensionMin: cfg.y,
        triggerType: cfg.type,
      },
    });
    for (const [s, total, when] of bids) {
      const freight = Math.round(total * 0.7);
      const origin = Math.round(total * 0.15);
      const createdAt = at(when);
      const bid = await prisma.bid.create({
        data: {
          rfqId: r.id,
          supplierId: s.id,
          carrierName: s.company,
          freightCharges: freight,
          originCharges: origin,
          destinationCharges: total - freight - origin,
          totalAmount: total,
          transitTimeDays: 3 + (s.id % 4),
          quoteValidUntil: new Date(day(30)),
          createdAt,
        },
      });
      await prisma.auctionEvent.create({
        data: {
          rfqId: r.id,
          type: 'BID_PLACED',
          actorId: s.id,
          bidId: bid.id,
          reason: `${s.name} bid ${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
          createdAt,
        },
      });
    }
    return r;
  }

  // Demo: closes in 5 min and we're already inside the 10-min window, so an L1-changing bid extends it.
  await rfq(
    'RFQ-1001',
    'Mumbai → Delhi, 2 x 40ft containers',
    { start: -60, close: 5, forced: 20 },
    { x: 10, y: 5, type: 'L1_CHANGE' },
    [
      [s1, 182000, -50],
      [s2, 175000, -40],
      [s3, 179500, -30],
      [s1, 171000, -20],
    ],
  );

  await rfq(
    'RFQ-1002',
    'Chennai → Bengaluru, refrigerated LTL',
    { start: -30, close: 120, forced: 180 },
    { x: 15, y: 10, type: 'ANY_RANK_CHANGE' },
    [
      [s2, 64000, -25],
      [s4, 61500, -15],
    ],
  );

  await rfq(
    'RFQ-1003',
    'Pune → Kolkata, project cargo',
    { start: 60, close: 24 * 60, forced: 24 * 60 + 60 },
    { x: 10, y: 5, type: 'BID_RECEIVED' },
    [],
  );

  await rfq(
    'RFQ-0999',
    'Ahmedabad → Jaipur, palletised FMCG',
    { start: -26 * 60, close: -2 * 60, forced: -60 },
    { x: 10, y: 5, type: 'BID_RECEIVED' },
    [
      [s3, 98000, -25 * 60],
      [s1, 95000, -20 * 60],
      [s3, 93500, -5 * 60],
    ],
  );

  // Force closed: kept extending until it hit the forced close cap.
  const fc = await rfq(
    'RFQ-0998',
    'Kochi Port → Hyderabad, 1 x 20ft container',
    { start: -6 * 60, close: -3 * 60, current: -2 * 60 - 45, forced: -2 * 60 - 45 },
    { x: 10, y: 10, type: 'ANY_RANK_CHANGE' },
    [
      [s1, 88000, -5 * 60],
      [s2, 86000, -4 * 60],
      [s1, 85000, -3 * 60 - 4],
      [s2, 84000, -2 * 60 - 55],
    ],
  );
  await prisma.auctionEvent.createMany({
    data: [
      {
        rfqId: fc.id,
        type: 'TIME_EXTENDED',
        actorId: s1.id,
        oldCloseAt: at(-3 * 60),
        newCloseAt: at(-2 * 60 - 50),
        reason: `Rank change: ${s1.name} L2→L1, ${s2.name} L1→L2 in the last 10 min → extended by 10 min`,
        createdAt: at(-3 * 60 - 4),
      },
      {
        rfqId: fc.id,
        type: 'TIME_EXTENDED',
        actorId: s2.id,
        oldCloseAt: at(-2 * 60 - 50),
        newCloseAt: at(-2 * 60 - 45),
        reason: `Rank change: ${s2.name} L2→L1, ${s1.name} L1→L2 in the last 10 min → extended by 5 min (capped at forced close time)`,
        createdAt: at(-2 * 60 - 55),
      },
    ],
  });

  console.log(`Seeded 1 buyer, ${suppliers.length} suppliers, 5 RFQs`);
}

main().finally(() => prisma.$disconnect());
