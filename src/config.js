function numberEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }
  return parsed;
}

function boolEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function loadConfig() {
  return {
    port: numberEnv("PORT", numberEnv("HTTP__PORT", 3000)),
    apiPath: process.env.HTTP__API__PATH || "/api",
    gateway: {
      mode: process.env.GATEWAY__MODE || "private",
      privateToken: process.env.GATEWAY__PRIVATE_TOKEN || "",
      upstreamUrl:
        process.env.GATEWAY__UPSTREAM_URL ||
        "https://api.sms-gate.app/upstream/v1",
    },
    database: {
      host: process.env.DATABASE__HOST || process.env.DB_HOST || "localhost",
      port: numberEnv("DATABASE__PORT", numberEnv("DB_PORT", 3306)),
      user: process.env.DATABASE__USER || process.env.DB_USER || "root",
      password:
        process.env.DATABASE__PASSWORD || process.env.DB_PASSWORD || "",
      database:
        process.env.DATABASE__DATABASE || process.env.DB_NAME || "sms",
      timezone: process.env.DATABASE__TIMEZONE || "Z",
      connectionLimit: numberEnv("DATABASE__MAX_OPEN_CONNS", 4),
      debug: boolEnv("DATABASE__DEBUG", false),
    },
    jwt: {
      secret: process.env.JWT__SECRET || "",
      issuer: process.env.JWT__ISSUER || "sms-gateway-node",
      accessTtl: process.env.JWT__ACCESS_TTL || "15m",
      refreshTtl: process.env.JWT__REFRESH_TTL || "30d",
    },
    otp: {
      ttlSeconds: numberEnv("OTP__TTL", 300),
    },
  };
}

module.exports = { loadConfig };
