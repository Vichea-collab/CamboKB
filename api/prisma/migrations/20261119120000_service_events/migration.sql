-- DropTable
DROP TABLE "TelegramOutbox";

-- CreateTable
CREATE TABLE "ServiceEvent" (
    "id" UUID NOT NULL,
    "target" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "requestId" TEXT,
    "dedupeKey" TEXT,
    "emittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "ServiceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceEvent_status_nextAttemptAt_idx" ON "ServiceEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ServiceEvent_target_status_idx" ON "ServiceEvent"("target", "status");

-- CreateIndex
CREATE INDEX "ServiceEvent_createdAt_idx" ON "ServiceEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceEvent_target_dedupeKey_key" ON "ServiceEvent"("target", "dedupeKey");

