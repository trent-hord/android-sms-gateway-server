function numberEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }
  return parsed;
}

function portEnv() {
  const value = process.env.PORT || process.env.HTTP__PORT;
  if (value === undefined || value === "") return 3000;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

function boolEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function cleanEnv(value) {
  if (typeof value !== "string") return value;
  return value.trim().replace(/^["']|["']$/g, "");
}

function envAny(names, fallback = "") {
  for (const name of names) {
    const value = cleanEnv(process.env[name]);
    if (value !== undefined && value !== "") return value;
  }
  return fallback;
}

function parseDatabaseUrl(value) {
  if (!value) return {};
  const parsed = new URL(value);
  if (parsed.protocol !== "mysql:") {
    throw new Error("DATABASE_URL must start with mysql://");
  }
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username || ""),
    password: decodeURIComponent(parsed.password || ""),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
  };
}

function loadConfig() {
  const databaseUrl = parseDatabaseUrl(process.env.DATABASE_URL);

  return {
    port: portEnv(),
    apiPath: process.env.HTTP__API__PATH || "/api",
    gateway: {
      mode: envAny(["GATEWAY__MODE", "GATEWAY_MODE"], "private").toLowerCase(),
      privateToken: envAny([
        "GATEWAY__PRIVATE_TOKEN",
        "GATEWAY_PRIVATE_TOKEN",
      ]),
      publicUrl: envAny([
        "GATEWAY__PUBLIC_URL",
        "GATEWAY_PUBLIC_URL",
        "PUBLIC_URL",
        "APP_URL",
      ]),
      upstreamUrl:
        envAny(["GATEWAY__UPSTREAM_URL", "GATEWAY_UPSTREAM_URL"]) ||
        "https://api.sms-gate.app/upstream/v1",
    },
    database: {
      host:
        envAny(["DATABASE__HOST", "DATABASE_HOST", "DB_HOST", "MYSQL_HOST"]) ||
        databaseUrl.host ||
        "localhost",
      port: Number(
        envAny(["DATABASE__PORT", "DATABASE_PORT", "DB_PORT", "MYSQL_PORT"]) ||
          databaseUrl.port ||
          3306,
      ),
      user:
        envAny(["DATABASE__USER", "DATABASE_USER", "DB_USER", "MYSQL_USER"]) ||
        databaseUrl.user ||
        "root",
      password:
        envAny([
          "DATABASE__PASSWORD",
          "DATABASE_PASSWORD",
          "DB_PASSWORD",
          "MYSQL_PASSWORD",
        ]) ||
        databaseUrl.password ||
        "",
      database:
        envAny([
          "DATABASE__DATABASE",
          "DATABASE_DATABASE",
          "DATABASE__NAME",
          "DATABASE_NAME",
          "DB_NAME",
          "MYSQL_DATABASE",
        ]) ||
        databaseUrl.database ||
        "sms",
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

function envPresence() {
  const names = [
    "DATABASE_URL",
    "DATABASE__HOST",
    "DATABASE_HOST",
    "DB_HOST",
    "MYSQL_HOST",
    "DATABASE__PORT",
    "DATABASE_PORT",
    "DB_PORT",
    "MYSQL_PORT",
    "DATABASE__USER",
    "DATABASE_USER",
    "DB_USER",
    "MYSQL_USER",
    "DATABASE__PASSWORD",
    "DATABASE_PASSWORD",
    "DB_PASSWORD",
    "MYSQL_PASSWORD",
    "DATABASE__DATABASE",
    "DATABASE_DATABASE",
    "DATABASE_NAME",
    "DB_NAME",
    "MYSQL_DATABASE",
    "GATEWAY__MODE",
    "GATEWAY_MODE",
    "GATEWAY__PRIVATE_TOKEN",
    "GATEWAY_PRIVATE_TOKEN",
    "GATEWAY__PUBLIC_URL",
    "GATEWAY_PUBLIC_URL",
    "PUBLIC_URL",
    "APP_URL",
  ];
  return Object.fromEntries(names.map((name) => [name, Boolean(process.env[name])]));
}

module.exports = { envPresence, loadConfig };
