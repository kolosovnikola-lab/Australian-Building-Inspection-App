import { Router, type IRouter } from "express";
import healthRouter from "./health";
import inspectionsRouter from "./inspections";
import aiRouter from "./ai";

const router: IRouter = Router();

router.use(healthRouter);
router.use(inspectionsRouter);
router.use(aiRouter);

export default router;
