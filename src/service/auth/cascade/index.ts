/**
 * Cascade index — registers every collection handler with the cascade registry.
 *
 * ─── Adding a new collection ──────────────────────────────────────────────────
 *
 *   1. Create:   service/account-deletion/cascades/myModel.cascade.ts
 *                (copy any existing cascade file as a template)
 *
 *   2. Add ONE line below:
 *                import "./myModel.cascade";
 *
 *   That's it. The pipeline picks it up automatically on next run.
 *
 * ─── Execution order ─────────────────────────────────────────────────────────
 *
 *   Handlers run in the order they are imported here.
 *   Recommended order:
 *     1. HARD_DELETE collections first  (no dependencies)
 *     2. ANONYMISE collections          (may reference booking/payment IDs)
 *     3. SOFT_DELETE collections last   (may need other records intact for review)
 *
 * ─── The user document ───────────────────────────────────────────────────────
 *
 *   The User document itself is NOT registered here.
 *   It is hard-deleted by AccountDeletionService AFTER all cascade steps
 *   succeed — it is always the final, point-of-no-return step.
 */

// ── HARD_DELETE ───────────────────────────────────────────────────────────────
import "./userProfile.cascade";
import "./notification.cascade";
import "./file.cascade";

// ── ANONYMISE ─────────────────────────────────────────────────────────────────
import "./booking.cascade";
import "./payment.cascade";
import "./review.cascade";
import "./message.cascade";

// ── SOFT_DELETE ───────────────────────────────────────────────────────────────
import "./dispute.cascade";
import "./service.cascade";