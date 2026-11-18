-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "TelegramOutbox" (
    "id" UUID NOT NULL,
    "chatId" BIGINT NOT NULL,
    "text" TEXT NOT NULL,
    "parseMode" TEXT,
    "replyMarkup" JSONB,
    "dedupeKey" TEXT,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "TelegramOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramOutbox_dedupeKey_key" ON "TelegramOutbox"("dedupeKey");

-- CreateIndex
CREATE INDEX "TelegramOutbox_status_nextAttemptAt_idx" ON "TelegramOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "TelegramOutbox_createdAt_idx" ON "TelegramOutbox"("createdAt");

