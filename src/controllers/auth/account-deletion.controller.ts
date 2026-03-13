import { Response } from "express";
import { AuthenticatedRequest } from "../../types/user.types";
import { accountDeletionService } from "../../service/auth/account-deletion.service";

// ─── Error map ────────────────────────────────────────────────────────────────

const ERRORS: Record<string, [number, string]> = {
  DELETION_ALREADY_SCHEDULED: [409, "A deletion request is already pending"],
  DELETION_BLOCKED:           [422, "Account cannot be deleted — resolve active bookings or disputes first"],
  NO_PENDING_DELETION:        [404, "No pending deletion request found"],
  GRACE_PERIOD_EXPIRED:       [410, "Grace period has expired — deletion can no longer be cancelled"],
  EVENT_NOT_FOUND:            [404, "Deletion event not found"],
  NOT_READY_TO_PROCESS:       [409, "Deletion event is not ready to process"],
};

const handleError = (res: Response, err: any) => {
  const mapped = ERRORS[err?.message];
  if (mapped) {
    const [status, message] = mapped;
    res.status(status).json({ success: false, message });
    return;
  }
  console.error("[AccountDeletion]", err);
  res.status(500).json({ success: false, message: "Internal server error" });
};

// ─── Controllers ─────────────────────────────────────────────────────────────

/** POST /account/deletion — user requests account deletion */
export const requestDeletion = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const event = await accountDeletionService.scheduleDeletion(
      req.userId!,
      "user"
    );

    res.status(202).json({
      success:           true,
      message:           "Account deletion scheduled. You have 24 hours to cancel.",
      gracePeriodEndsAt: event.gracePeriodEndsAt,
      deletionSummary:   event.validationSnapshot.deletionSummary,
    });
  } catch (err) {
    handleError(res, err);
  }
};

/** DELETE /account/deletion — user cancels a pending deletion */
export const cancelDeletion = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    await accountDeletionService.cancelDeletion(req.userId!);
    res.json({ success: true, message: "Deletion request cancelled" });
  } catch (err) {
    handleError(res, err);
  }
};

/** GET /account/deletion/status — user checks current deletion status */
export const getDeletionStatus = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const events = await accountDeletionService.getDeletionStatus(req.userId!);
    res.json({ success: true, events });
  } catch (err) {
    handleError(res, err);
  }
};

/** GET /admin/deletion/review — admin queue of failed deletions */
export const getAdminReviewQueue = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const events = await accountDeletionService.getAdminReviewQueue();
    res.json({ success: true, events });
  } catch (err) {
    handleError(res, err);
  }
};

/** POST /admin/deletion/:eventId/retry — manually re-run a failed pipeline */
export const retryDeletion = async (
  req: AuthenticatedRequest & { params: { eventId: string } },
  res: Response
): Promise<void> => {
  try {
    await accountDeletionService.executePipeline(req.params.eventId);
    res.json({ success: true, message: "Pipeline retried successfully" });
  } catch (err) {
    handleError(res, err);
  }
};