// controllers/profiles/handlers/roleTransition.handler.ts
import { Response, NextFunction } from "express";
import { UserRole } from "../../../../types/base.types";
import { RoleTransitionStatus } from "../../../../types/role-transition.types";
import {
  RequestRoleChangeBody,
  RoleTransitionValidationResponse,
  RoleTransitionResponse,
} from "../../../../types/role-transition.types";
import { RoleTransitionService } from "../../../../service/profiles/core/roleTransition.service";
import { AuthenticatedRequest } from "../../../../types/user.types";
import { handleError } from "../../../../utils/auth/auth.controller.utils";

export class RoleTransitionHandler {
  private transitionService: RoleTransitionService;

  constructor() {
    this.transitionService = new RoleTransitionService();
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private getUserId(req: AuthenticatedRequest): string {
    if (!req.userId) throw new Error("UNAUTHORIZED");
    return req.userId;
  }

  private isValidRole(role: unknown): role is UserRole {
    return Object.values(UserRole).includes(role as UserRole);
  }

  // ─── Endpoints ───────────────────────────────────────────────────────────────

  /**
   * Dry-run validation — checks eligibility without changing any data.
   * GET /api/profiles/role-transition/validate?toRole=customer
   *
   * Use this to show the user what will happen (and any blockers)
   * before they confirm the transition.
   */
  validateTransition = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      const userId = this.getUserId(req);
      const { toRole } = req.query;

      if (!toRole || !this.isValidRole(toRole)) {
        res.status(400).json({
          success: false,
          message: `toRole must be one of: ${Object.values(UserRole).join(", ")}`,
        } satisfies RoleTransitionValidationResponse);
        return;
      }

      const validation = await this.transitionService.validate(userId, toRole);

      const isBlocked = validation.status === RoleTransitionStatus.BLOCKED;

      res.status(isBlocked ? 409 : 200).json({
        success: !isBlocked,
        message: isBlocked
          ? "Role transition is blocked. Resolve all blockers before proceeding."
          : "Role transition is eligible. Submit POST /api/profiles/role-transition to proceed.",
        validation,
      } satisfies RoleTransitionValidationResponse);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "UNAUTHORIZED") {
          res.status(401).json({ success: false, message: "Unauthorized" });
          return;
        }
        if (
          error.message.startsWith("User is already") ||
          error.message === "Profile not found"
        ) {
          res.status(400).json({ success: false, message: error.message });
          return;
        }
      }
      handleError(res, error, "Failed to validate role transition");
    }
  };

  /**
   * Execute the role transition.
   * POST /api/profiles/role-transition
   *
   * Body: { toRole: UserRole, acknowledgedDataHandling: boolean }
   *
   * The client must call GET validate first to see what will change,
   * then re-submit here with acknowledgedDataHandling: true to confirm.
   */
  executeTransition = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      const userId = this.getUserId(req);
      const { toRole, acknowledgedDataHandling }: RequestRoleChangeBody =
        req.body;

      if (!toRole || !this.isValidRole(toRole)) {
        res.status(400).json({
          success: false,
          message: `toRole must be one of: ${Object.values(UserRole).join(", ")}`,
        } satisfies RoleTransitionResponse);
        return;
      }

      if (!acknowledgedDataHandling) {
        res.status(400).json({
          success: false,
          message:
            "You must set acknowledgedDataHandling: true to confirm you understand what will change.",
        } satisfies RoleTransitionResponse);
        return;
      }

      const event = await this.transitionService.execute(
        userId,
        toRole,
        acknowledgedDataHandling
      );

      res.status(200).json({
        success: true,
        message: `Role successfully changed to ${toRole}.`,
        transition: {
          userId: event.userId,
          fromRole: event.fromRole,
          toRole: event.toRole,
          status: event.status,
          completedAt: event.completedAt,
          dataHandling: event.dataHandling,
        },
      } satisfies RoleTransitionResponse);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "UNAUTHORIZED") {
          res.status(401).json({ success: false, message: "Unauthorized" });
          return;
        }
        // Validation blockers surface as 409 Conflict
        if (error.message.startsWith("Role transition blocked:")) {
          res.status(409).json({ success: false, message: error.message });
          return;
        }
        if (
          error.message.startsWith("User is already") ||
          error.message === "Profile not found" ||
          error.message.startsWith("You must acknowledge")
        ) {
          res.status(400).json({ success: false, message: error.message });
          return;
        }
      }
      handleError(res, error, "Failed to execute role transition");
    }
  };

  /**
   * Get the current user's role transition history.
   * GET /api/profiles/role-transition/history
   */
  getTransitionHistory = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      const userId = this.getUserId(req);
      const history = await this.transitionService.getTransitionHistory(userId);

      res.status(200).json({
        success: true,
        message: "Transition history retrieved successfully",
        data: history,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        res.status(401).json({ success: false, message: "Unauthorized" });
        return;
      }
      handleError(res, error, "Failed to retrieve transition history");
    }
  };
}

