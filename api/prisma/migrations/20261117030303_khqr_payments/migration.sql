-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "lastCheckedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "KhqrCode" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "md5" TEXT NOT NULL,
    "qrString" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KhqrCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KhqrCode_md5_key" ON "KhqrCode"("md5");

-- CreateIndex
CREATE INDEX "KhqrCode_paymentId_idx" ON "KhqrCode"("paymentId");

-- CreateIndex
CREATE INDEX "Payment_method_status_expiresAt_idx" ON "Payment"("method", "status", "expiresAt");

-- AddForeignKey
ALTER TABLE "KhqrCode" ADD CONSTRAINT "KhqrCode_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
