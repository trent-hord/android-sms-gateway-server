const express = require("express");
const { parseBearer } = require("../auth");
const { badRequest } = require("../errors");

const scopes = {
  devicesList: "devices:list",
  devicesDelete: "devices:delete",
  inboxList: "inbox:list",
  inboxRefresh: "inbox:refresh",
  logsRead: "logs:read",
  messagesList: "messages:list",
  messagesRead: "messages:read",
  messagesSend: "messages:send",
  messagesExport: "messages:export",
  settingsRead: "settings:read",
  settingsWrite: "settings:write",
  tokensManage: "tokens:manage",
  webhooksList: "webhooks:list",
  webhooksWrite: "webhooks:write",
  webhooksDelete: "webhooks:delete",
};

function createThirdPartyRouter({ auth, config, services }) {
  const router = express.Router();

  router.get(["/health", "/health/ready", "/health/live", "/health/startup"], (_req, res) => {
    res.json({ status: "ok" });
  });

  router.use(auth.optionalUser);

  router.get(
    "/devices",
    auth.requireScope(scopes.devicesList),
    async (req, res, next) => {
      try {
        const devices = await services.devices.list(req.user.id);
        res.json(devices.map(services.publicDevice));
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    "/devices/:id",
    auth.requireScope([scopes.devicesDelete, "devices:write"]),
    async (req, res, next) => {
      try {
        await services.devices.remove(req.user.id, req.params.id);
        res.sendStatus(204);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/messages",
    auth.requireScope(scopes.messagesSend),
    async (req, res, next) => {
      try {
        const state = await services.messages.enqueue(req.user.id, req.body, {
          skipPhoneValidation: req.query.skipPhoneValidation === "true",
          deviceActiveWithin: req.query.deviceActiveWithin,
        });
        res
          .status(202)
          .location(`${req.baseUrl}/messages/${state.id}`)
          .json(state);
      } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
          error.status = 409;
          error.message = "Message with this id already exists";
        }
        next(error);
      }
    },
  );

  router.get(
    "/messages",
    auth.requireScope(scopes.messagesList),
    async (req, res, next) => {
      try {
        const result = await services.messages.list(req.user.id, req.query);
        res.set("X-Total-Count", String(result.total));
        res.json(result.items);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/messages/:id",
    auth.requireScope(scopes.messagesRead),
    async (req, res, next) => {
      try {
        res.json(await services.messages.getState(req.user.id, req.params.id));
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/messages/inbox/export",
    auth.requireScope(scopes.messagesExport),
    (_req, res) => {
      res.set("Deprecation", "true").sendStatus(202);
    },
  );

  router.get(
    "/webhooks",
    auth.requireScope(scopes.webhooksList),
    async (req, res, next) => {
      try {
        res.json(await services.webhooks.list(req.user.id));
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/webhooks",
    auth.requireScope(scopes.webhooksWrite),
    async (req, res, next) => {
      try {
        res.status(201).json(await services.webhooks.replace(req.user.id, req.body));
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    "/webhooks/:id",
    auth.requireScope([scopes.webhooksDelete, scopes.webhooksWrite]),
    async (req, res, next) => {
      try {
        await services.webhooks.remove(req.user.id, req.params.id);
        res.sendStatus(204);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/settings",
    auth.requireScope(scopes.settingsRead),
    async (req, res, next) => {
      try {
        res.json(await services.settings.get(req.user.id));
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    "/settings",
    auth.requireScope(scopes.settingsWrite),
    async (req, res, next) => {
      try {
        res.json(await services.settings.patch(req.user.id, req.body));
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    "/settings",
    auth.requireScope(scopes.settingsWrite),
    async (req, res, next) => {
      try {
        res.json(await services.settings.set(req.user.id, req.body));
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/auth/token",
    auth.requireScope(scopes.tokensManage),
    async (req, res, next) => {
      try {
        res.status(201).json(await services.tokens.issue(req.user.id, req.body));
      } catch (error) {
        next(error);
      }
    },
  );

  router.post("/auth/token/refresh", async (req, res, next) => {
    try {
      const token = parseBearer(req.get("authorization"));
      if (!token) throw badRequest("Refresh token is required");
      res.json(await services.tokens.refresh(token));
    } catch (error) {
      next(error);
    }
  });

  router.delete(
    "/auth/token/:jti",
    auth.requireScope(scopes.tokensManage),
    async (req, res, next) => {
      try {
        await services.tokens.revoke(req.params.jti);
        res.sendStatus(204);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get("/inbox", auth.requireScope(scopes.inboxList), (_req, res) => {
    res.status(501).json({ message: "Inbox API is not implemented yet" });
  });

  router.post(
    "/inbox/refresh",
    auth.requireScope(scopes.inboxRefresh),
    async (req, res, next) => {
      try {
        await services.inbox.refresh(req.user.id, req.body);
        res.sendStatus(202);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get("/logs", auth.requireScope(scopes.logsRead), (_req, res) => {
    res.json([]);
  });

  return router;
}

module.exports = { createThirdPartyRouter };
