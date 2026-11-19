-- Share the delivery location through the Telegram bot (checkout -> bot -> checkout).
ALTER TYPE "TelegramAuthPurpose" ADD VALUE 'SHARE_LOCATION';

ALTER TABLE "TelegramAuthRequest" ADD COLUMN "lat" DOUBLE PRECISION,
ADD COLUMN "lng" DOUBLE PRECISION;
