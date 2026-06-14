require("dotenv").config();

const { createApp } = require("./src/app");
const { loadConfig } = require("./src/config");
const { createDatabase } = require("./src/db");
const { createServices } = require("./src/services");

async function main() {
  const config = loadConfig();
  const db = createDatabase(config.database);
  const runtime = {
    databaseReady: false,
    lastMigrationError: null,
    startedAt: new Date().toISOString(),
  };

  const services = createServices({ config, db });
  const app = createApp({ config, runtime, services });

  const server = app.listen(config.port, () => {
    console.log(`SMS Gateway Node server listening on port ${config.port}`);
  });

  server.on("error", (error) => {
    console.error("Failed to listen for HTTP requests");
    console.error(error);
    process.exit(1);
  });

  async function migrateWithStatus() {
    try {
      await db.migrate();
      runtime.databaseReady = true;
      runtime.lastMigrationError = null;
      console.log("Database migration completed");
    } catch (error) {
      runtime.databaseReady = false;
      runtime.lastMigrationError = {
        message: error.message,
        code: error.code,
      };
      console.error("Database migration failed");
      console.error(error);
    }
  }

  await migrateWithStatus();
  setInterval(() => {
    if (!runtime.databaseReady) migrateWithStatus();
  }, 30000).unref();
}

main().catch((error) => {
  console.error("Failed to start SMS Gateway Node server");
  console.error(error);
  process.exit(1);
});
