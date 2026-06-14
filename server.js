require("dotenv").config();

const { createApp } = require("./src/app");
const { loadConfig } = require("./src/config");
const { createDatabase } = require("./src/db");
const { createServices } = require("./src/services");

async function main() {
  const config = loadConfig();
  const db = createDatabase(config.database);
  await db.migrate();

  const services = createServices({ config, db });
  const app = createApp({ config, services });

  app.listen(config.port, () => {
    console.log(`SMS Gateway Node server listening on port ${config.port}`);
  });
}

main().catch((error) => {
  console.error("Failed to start SMS Gateway Node server");
  console.error(error);
  process.exit(1);
});
