const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { unauthorized, forbidden } = require("./errors");

const ALL_SCOPES = ["*"];

function parseBasic(header) {
  if (!header || !header.toLowerCase().startsWith("basic ")) return null;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) return null;
  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

function parseBearer(header) {
  if (!header || !header.toLowerCase().startsWith("bearer ")) return null;
  return header.slice(7);
}

function parseCode(header) {
  if (!header || !header.toLowerCase().startsWith("code ")) return null;
  return header.slice(5);
}

function createAuth({ config, services }) {
  async function optionalUser(req, _res, next) {
    try {
      const header = req.get("authorization");
      const basic = parseBasic(header);
      if (basic) {
        const user = await services.users.verifyPassword(
          basic.username,
          basic.password,
        );
        req.user = user;
        req.scopes = ALL_SCOPES;
        return next();
      }

      const code = parseCode(header);
      if (code) {
        req.user = await services.users.consumeCode(code);
        req.scopes = ALL_SCOPES;
        return next();
      }

      const bearer = parseBearer(header);
      if (bearer && config.jwt.secret) {
        try {
          const payload = jwt.verify(bearer, config.jwt.secret, {
            issuer: config.jwt.issuer,
          });
          if (payload.typ === "access") {
            req.user = { id: payload.sub };
            req.scopes = payload.scopes || [];
          }
        } catch (_error) {
          // Bearer can also be a device token on mobile endpoints.
        }
      }

      return next();
    } catch (error) {
      return next(error);
    }
  }

  async function requireUser(req, _res, next) {
    if (!req.user) return next(unauthorized());
    return next();
  }

  function requireScope(scope) {
    return (req, _res, next) => {
      if (!req.user) return next(unauthorized());
      const accepted = Array.isArray(scope) ? scope : [scope];
      if (
        req.scopes?.includes("*") ||
        accepted.some((item) => req.scopes?.includes(item))
      ) {
        return next();
      }
      return next(forbidden("Missing required scope"));
    };
  }

  async function optionalDevice(req, _res, next) {
    try {
      const token = parseBearer(req.get("authorization"));
      if (token) {
        req.device = await services.devices.findByToken(token);
      }
      return next();
    } catch (error) {
      return next(error.status === 404 ? undefined : error);
    }
  }

  async function requireDevice(req, _res, next) {
    if (!req.device) return next(unauthorized());
    return next();
  }

  async function requireRegistration(req, _res, next) {
    if (config.gateway.mode === "public" || req.user) return next();

    const token = parseBearer(req.get("authorization"));
    if (token && token === config.gateway.privateToken) return next();
    return next(unauthorized("Registration token required"));
  }

  return {
    optionalDevice,
    optionalUser,
    requireDevice,
    requireRegistration,
    requireScope,
    requireUser,
  };
}

module.exports = { createAuth, parseBasic, parseBearer };
