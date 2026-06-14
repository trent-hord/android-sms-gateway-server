const express = require("express");
const crypto = require("crypto");
const { badRequest } = require("../errors");

function createMobileRouter({ auth, config, services }) {
  const router = express.Router();

  router.get("/", (_req, res) => {
    res.json({ name: "SMS Gateway Mobile API", version: "v1" });
  });

  router.post(
    "/device",
    auth.optionalUser,
    auth.requireRegistration,
    async (req, res, next) => {
      try {
        let userId = req.user?.id;
        let password = "";

        if (!userId) {
          const seed = randomCredentialSeed();
          userId = seed.login;
          password = seed.password;
          await services.users.create(userId, password);
        }

        const device = await services.devices.register(userId, req.body);
        res.status(201).json({
          id: device.id,
          token: device.token,
          login: userId,
          password,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/user/code",
    auth.optionalUser,
    auth.requireUser,
    async (req, res, next) => {
      try {
        res.json(await services.users.createCode(req.user.id));
      } catch (error) {
        next(error);
      }
    },
  );

  router.use(auth.optionalDevice);

  router.get("/device", (req, res) => {
    res.json({
      externalIp: req.ip,
      device: req.device ? services.publicDevice(req.device) : null,
    });
  });

  router.use(auth.requireDevice);

  router.patch("/device", async (req, res, next) => {
    try {
      if (req.body.id && req.body.id !== req.device.id) {
        throw badRequest("Device id does not match current token");
      }
      await services.devices.update(req.device, req.body);
      res.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/user/password", async (req, res, next) => {
    try {
      await services.users.changePassword(
        req.device.userId,
        req.body.currentPassword,
        req.body.newPassword,
      );
      res.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

  router.get(["/message", "/messages"], async (req, res, next) => {
    try {
      res.json(
        await services.messages.pendingForDevice(
          req.device.id,
          req.query.order || "lifo",
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  router.patch(["/message", "/messages"], async (req, res, next) => {
    try {
      await services.messages.updateFromDevice(req.device, req.body);
      res.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

  router.get("/webhooks", async (req, res, next) => {
    try {
      res.json(
        await services.webhooks.listForDevice(req.device.userId, req.device.id),
      );
    } catch (error) {
      next(error);
    }
  });

  router.get("/settings", async (req, res, next) => {
    try {
      const settings = await services.settings.get(req.device.userId);
      const origin =
        config.gateway.publicUrl ||
        `${req.protocol}://${req.get("host")}`;
      res.json({
        ...settings,
        gateway: {
          ...(settings.gateway || {}),
          cloud_url: origin,
          notification_channel: "SSE_ONLY",
          ...(config.gateway.privateToken
            ? { private_token: config.gateway.privateToken }
            : {}),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/events", (_req, res) => {
    res.set({
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    });
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    res.write("event: ready\ndata: {}\n\n");
    services.events.subscribe(_req.device.id, res);

    services.messages
      .countPendingForDevice(_req.device.id)
      .then((count) => {
        if (count > 0) {
          services.events.notify(_req.device.id, "MessageEnqueued");
        }
      })
      .catch((error) => console.error("Failed to count pending messages", error));
  });

  return router;
}

function randomCredentialSeed() {
  const value = crypto.randomBytes(16).toString("base64url").slice(0, 21);
  return {
    login: value.slice(0, 6).toUpperCase(),
    password: value.slice(7).toLowerCase(),
  };
}

module.exports = { createMobileRouter };
