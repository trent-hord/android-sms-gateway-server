const express = require("express");
const { envPresence, loadConfig } = require("../config");

function createSystemRouter({ runtime } = {}) {
  const router = express.Router();

  router.get(["/health", "/health/live", "/health/startup"], (_req, res) => {
    res.json({
      status: "ok",
      databaseReady: Boolean(runtime?.databaseReady),
      startedAt: runtime?.startedAt,
      lastMigrationError: runtime?.lastMigrationError || null,
    });
  });

  router.get("/health/ready", (_req, res) => {
    const ready = Boolean(runtime?.databaseReady);
    res.status(ready ? 200 : 503).json({
      status: ready ? "ok" : "degraded",
      databaseReady: ready,
      lastMigrationError: runtime?.lastMigrationError || null,
    });
  });

  router.get("/.well-known/api-catalog", (_req, res) => {
    res.json({
      apis: [
        { name: "Mobile", url: "/mobile/v1" },
        { name: "ThirdParty", url: "/3rdparty/v1" },
      ],
    });
  });

  router.head("/.well-known/api-catalog", (_req, res) => {
    res.sendStatus(200);
  });

  router.get("/metrics", (_req, res) => {
    res.type("text/plain").send("# Metrics are not implemented in the Node port\n");
  });

  router.get("/debug/env", (_req, res) => {
    const config = loadConfig();
    res.json({
      envPresent: envPresence(),
      databaseConfigLooksSet: {
        host: config.database.host !== "localhost",
        user: config.database.user !== "root",
        password: Boolean(config.database.password),
        database: config.database.database !== "sms",
      },
      gateway: {
        mode: config.gateway.mode,
        privateTokenPresent: Boolean(config.gateway.privateToken),
      },
      portType: typeof config.port,
    });
  });

  return router;
}

module.exports = { createSystemRouter };
