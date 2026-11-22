-- Telegram-only login, release 1 (expand). Nothing is dropped, so the previous image still works.
ALTER TYPE "TelegramAuthPurpose" ADD VALUE 'LOGIN';

-- Nothing reads the password any more; it is removed in the next release.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- LOGIN requests remember the match code and the browser that asked, so the bot can show them.
ALTER TABLE "TelegramAuthRequest" ADD COLUMN "matchCode" TEXT,
ADD COLUMN "browser" TEXT;

-- Mini App initData signatures that were already used.
CREATE TABLE "TelegramWebAppHash" (
    "hash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramWebAppHash_pkey" PRIMARY KEY ("hash")
);

CREATE INDEX "TelegramWebAppHash_expiresAt_idx" ON "TelegramWebAppHash"("expiresAt");
