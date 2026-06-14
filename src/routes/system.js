const express = require("express");

function createSystemRouter() {
  const router = express.Router();

  router.get(["/health", "/health/ready", "/health/live", "/health/startup"], (_req, res) => {
    res.json({ status: "ok" });
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

  return router;
}

module.exports = { createSystemRouter };
