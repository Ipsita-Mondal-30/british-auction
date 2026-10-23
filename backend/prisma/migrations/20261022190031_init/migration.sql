-- CreateEnum
CREATE TYPE "Role" AS ENUM ('BUYER', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('BID_RECEIVED', 'ANY_RANK_CHANGE', 'L1_CHANGE');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('BID_PLACED', 'TIME_EXTENDED', 'EXTENSION_CAPPED');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "role" "Role" NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfq" (
    "id" SERIAL NOT NULL,
    "refId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "buyerId" INTEGER NOT NULL,
    "bidStartAt" TIMESTAMP(3) NOT NULL,
    "bidCloseAt" TIMESTAMP(3) NOT NULL,
    "currentCloseAt" TIMESTAMP(3) NOT NULL,
    "forcedCloseAt" TIMESTAMP(3) NOT NULL,
    "pickupDate" DATE NOT NULL,
    "triggerWindowMin" INTEGER NOT NULL,
    "extensionMin" INTEGER NOT NULL,
    "triggerType" "TriggerType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rfq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" SERIAL NOT NULL,
    "rfqId" INTEGER NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "carrierName" TEXT NOT NULL,
    "freightCharges" DECIMAL(12,2) NOT NULL,
    "originCharges" DECIMAL(12,2) NOT NULL,
    "destinationCharges" DECIMAL(12,2) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "transitTimeDays" INTEGER NOT NULL,
    "quoteValidUntil" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionEvent" (
    "id" SERIAL NOT NULL,
    "rfqId" INTEGER NOT NULL,
    "type" "EventType" NOT NULL,
    "actorId" INTEGER,
    "bidId" INTEGER,
    "oldCloseAt" TIMESTAMP(3),
    "newCloseAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuctionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rfq_refId_key" ON "Rfq"("refId");

-- CreateIndex
CREATE INDEX "Bid_rfqId_supplierId_createdAt_idx" ON "Bid"("rfqId", "supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "AuctionEvent_rfqId_createdAt_idx" ON "AuctionEvent"("rfqId", "createdAt");

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionEvent" ADD CONSTRAINT "AuctionEvent_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionEvent" ADD CONSTRAINT "AuctionEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionEvent" ADD CONSTRAINT "AuctionEvent_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid"("id") ON DELETE SET NULL ON UPDATE CASCADE;
