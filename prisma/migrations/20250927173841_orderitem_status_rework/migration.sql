/*
  Warnings:

  - The values [COMPLETED] on the enum `FulfillmentStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "public"."FulfillmentStatus_new" AS ENUM ('NEW', 'CONFIRMED', 'SHIPPED', 'CANCELLED');
ALTER TABLE "public"."OrderItem" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."OrderItem" ALTER COLUMN "status" TYPE "public"."FulfillmentStatus_new" USING ("status"::text::"public"."FulfillmentStatus_new");
ALTER TYPE "public"."FulfillmentStatus" RENAME TO "FulfillmentStatus_old";
ALTER TYPE "public"."FulfillmentStatus_new" RENAME TO "FulfillmentStatus";
DROP TYPE "public"."FulfillmentStatus_old";
ALTER TABLE "public"."OrderItem" ALTER COLUMN "status" SET DEFAULT 'NEW';
COMMIT;
