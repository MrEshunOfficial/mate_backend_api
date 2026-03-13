// routes/oauth.routes.ts
import { Router } from "express";
import { googleAuth, appleAuth, linkProvider } from "../../controllers/auth/oauth.controller";
import { authenticateToken } from "../../middleware/auth/auth.middleware";

const router = Router();

router.post("/google", googleAuth);
router.post("/apple", appleAuth);
router.post("/link-provider", authenticateToken, linkProvider);

export default router;