import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";
import { authorizeInspectorResource, populateOptionalInspectorAuth, requireInspectorAuth } from "./middlewares/inspectorAuth";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(clerkMiddleware((req) => ({
  publishableKey: publishableKeyFromHost(
    getClerkProxyHost(req) ?? "",
    process.env.CLERK_PUBLISHABLE_KEY,
  ),
})));

app.use("/api", (req, res, next) => {
  if (req.path === "/healthz" || req.path.startsWith("/reports/")) {
    next();
    return;
  }
  if (req.method === "GET" && req.path === "/inspections") {
    populateOptionalInspectorAuth(req, res, next);
    return;
  }
  if (req.method === "POST" && req.path === "/ai/vision/inspect") {
    populateOptionalInspectorAuth(req, res, next);
    return;
  }
  requireInspectorAuth(req, res, (authError) => {
    if (authError) {
      next(authError);
      return;
    }
    authorizeInspectorResource(req, res, next);
  });
}, router);

export default app;
