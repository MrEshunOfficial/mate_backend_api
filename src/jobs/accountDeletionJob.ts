import cron from "node-cron";
import { accountDeletionService } from "../service/auth/account-deletion.service";

/**
 * Polls for deletion events whose grace period has elapsed and runs
 * the cascade pipeline for each one.
 *
 * Frequency: every 5 minutes — adjust to your SLA.
 * The pipeline itself is idempotent: events that already completed or
 * failed are skipped via the isReadyToProcess virtual.
 */
export const startDeletionScheduler = (): void => {
  cron.schedule("*/5 * * * *", async () => {
    console.log("[DeletionScheduler] Checking for ready events...");
    try {
      await accountDeletionService.processReadyEvents();
    } catch (err) {
      console.error("[DeletionScheduler] Unexpected error:", err);
    }
  });

  console.log("[DeletionScheduler] Started — polling every 5 minutes");
};