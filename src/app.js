const express = require("express");
const { createAuth } = require("./auth");
const { HttpError } = require("./errors");
const { createMobileRouter } = require("./routes/mobile");
const { createSystemRouter } = require("./routes/system");
const { createThirdPartyRouter } = require("./routes/thirdparty");

function createApp({ config, runtime, services }) {
  const app = express();
  const auth = createAuth({ config, services });
  const systemRouter = createSystemRouter({ runtime });
  const mobileRouter = createMobileRouter({ auth, config, services });
  const thirdPartyRouter = createThirdPartyRouter({ auth, config, services });

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  for (const prefix of ["", config.apiPath]) {
    app.use(prefix, systemRouter);
    app.use(`${prefix}/mobile/v1`, mobileRouter);
    app.use(`${prefix}/3rdparty/v1`, thirdPartyRouter);
    app.post(`${prefix}/upstream/v1/push`, async (req, res, next) => {
      try {
        res.status(202).json(await services.upstream.push(req.body));
      } catch (error) {
        next(error);
      }
    });
  }

  app.use((_req, _res, next) => {
    next(new HttpError(404, "Route not found"));
  });

  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ message: error.message || "Internal error" });
  });

  return app;
}

module.exports = { createApp };
