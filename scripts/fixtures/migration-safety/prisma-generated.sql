/*
  Warnings:

  - You are about to drop the column `notes` on the `asset` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "leave_request_no_overlap";

-- AlterTable
ALTER TABLE "asset" DROP COLUMN "notes",
ALTER COLUMN "metadata" DROP DEFAULT;

-- CreateTable
CREATE TABLE "asset_note" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "asset_note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_note_tenant_id_idx" ON "asset_note"("tenant_id");

-- AddForeignKey
ALTER TABLE "asset_note" ADD CONSTRAINT "asset_note_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
