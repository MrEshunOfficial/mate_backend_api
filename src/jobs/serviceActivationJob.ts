import cron from "node-cron";
import { ServiceService } from "../service/services/services.service";

const serviceService = new ServiceService();

/**
 * Polls for services whose scheduledActivationAt has elapsed and activates
 * them — unless an admin has rejected them in the interim.
 *
 * Frequency: every 5 minutes — matches the deletion scheduler cadence.
 * Override AUTO_ACTIVATION_DELAY_MS in env to control the grace window.
 */
export const startServiceActivationScheduler = (): void => {
  cron.schedule("*/5 * * * *", async () => {
    console.log("[ServiceActivationScheduler] Checking for pending activations...");
    try {
      const { activated, skippedRejected, errors } =
        await serviceService.processScheduledActivations();

      if (activated > 0 || errors.length > 0) {
        console.log(
          `[ServiceActivationScheduler] activated=${activated} skippedRejected=${skippedRejected} errors=${errors.length}`
        );
      }

      if (errors.length > 0) {
        console.error("[ServiceActivationScheduler] Errors:", errors);
      }
    } catch (err) {
      console.error("[ServiceActivationScheduler] Unexpected error:", err);
    }
  });

  console.log("[ServiceActivationScheduler] Started — polling every 5 minutes");
};