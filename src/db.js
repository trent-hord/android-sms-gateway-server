const mysql = require("mysql2/promise");

function createDatabase(databaseConfig) {
  const pool = mysql.createPool({
    host: databaseConfig.host,
    port: databaseConfig.port,
    user: databaseConfig.user,
    password: databaseConfig.password,
    database: databaseConfig.database,
    timezone: databaseConfig.timezone,
    waitForConnections: true,
    connectionLimit: databaseConfig.connectionLimit,
    namedPlaceholders: true,
    multipleStatements: false,
  });

  async function query(sql, params = {}) {
    const [rows] = await pool.execute(sql, params);
    return rows;
  }

  async function transaction(fn) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await fn(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function migrate() {
    validateDatabaseConfig(databaseConfig);

    const statements = [
      `CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(32) PRIMARY KEY,
        password_hash VARCHAR(255) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
      )`,
      `CREATE TABLE IF NOT EXISTS devices (
        id CHAR(21) PRIMARY KEY,
        user_id VARCHAR(32) NOT NULL,
        name VARCHAR(128) NULL,
        auth_token CHAR(21) NOT NULL UNIQUE,
        push_token VARCHAR(512) NULL,
        sim_cards JSON NULL,
        last_seen DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        deleted_at DATETIME(3) NULL,
        INDEX idx_devices_user (user_id),
        INDEX idx_devices_last_seen (last_seen)
      )`,
      `CREATE TABLE IF NOT EXISTS messages (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        ext_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        device_id CHAR(21) NOT NULL,
        type ENUM('Text','Data') NOT NULL DEFAULT 'Text',
        content TEXT NOT NULL,
        state ENUM('Pending','Processed','Sent','Delivered','Failed') NOT NULL DEFAULT 'Pending',
        ttl BIGINT UNSIGNED NULL,
        valid_until DATETIME(3) NULL,
        schedule_at DATETIME(3) NULL,
        sim_number TINYINT UNSIGNED NULL,
        with_delivery_report TINYINT(1) NOT NULL DEFAULT 0,
        priority TINYINT NOT NULL DEFAULT 0,
        is_hashed TINYINT(1) NOT NULL DEFAULT 0,
        is_encrypted TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        deleted_at DATETIME(3) NULL,
        UNIQUE KEY unq_messages_ext_device (ext_id, device_id),
        INDEX idx_messages_user (user_id),
        INDEX idx_messages_device_state (device_id, state)
      )`,
      `CREATE TABLE IF NOT EXISTS message_recipients (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        message_id BIGINT UNSIGNED NOT NULL,
        phone_number VARCHAR(128) NOT NULL,
        state ENUM('Pending','Processed','Sent','Delivered','Failed') NOT NULL DEFAULT 'Pending',
        error VARCHAR(256) NULL,
        UNIQUE KEY unq_recipients_message_phone (message_id, phone_number)
      )`,
      `CREATE TABLE IF NOT EXISTS message_states (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        message_id BIGINT UNSIGNED NOT NULL,
        state ENUM('Pending','Processed','Sent','Delivered','Failed') NOT NULL,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY unq_message_state (message_id, state)
      )`,
      `CREATE TABLE IF NOT EXISTS webhooks (
        id VARCHAR(64) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        url VARCHAR(2048) NOT NULL,
        event VARCHAR(128) NOT NULL,
        device_id CHAR(21) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id, user_id),
        INDEX idx_webhooks_device (device_id)
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        user_id VARCHAR(32) PRIMARY KEY,
        value JSON NOT NULL,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
      )`,
      `CREATE TABLE IF NOT EXISTS user_codes (
        code VARCHAR(16) PRIMARY KEY,
        user_id VARCHAR(32) NOT NULL,
        expires_at DATETIME(3) NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS refresh_tokens (
        jti VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(32) NOT NULL,
        scopes JSON NOT NULL,
        expires_at DATETIME(3) NOT NULL,
        revoked_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      )`,
    ];

    for (const statement of statements) {
      await pool.execute(statement);
    }

    await addColumnIfMissing(
      "messages",
      "ttl",
      "ALTER TABLE messages ADD COLUMN ttl BIGINT UNSIGNED NULL AFTER state",
    );
    await addColumnIfMissing(
      "webhooks",
      "device_id",
      "ALTER TABLE webhooks ADD COLUMN device_id CHAR(21) NULL AFTER event",
    );
    await addIndexIfMissing(
      "webhooks",
      "idx_webhooks_device",
      "ALTER TABLE webhooks ADD INDEX idx_webhooks_device (device_id)",
    );
  }

  async function addColumnIfMissing(tableName, columnName, alterSql) {
    const rows = await query(
      `SELECT COUNT(*) AS count
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = :tableName
         AND COLUMN_NAME = :columnName`,
      { tableName, columnName },
    );
    if (Number(rows[0]?.count || 0) === 0) {
      await pool.execute(alterSql);
    }
  }

  async function addIndexIfMissing(tableName, indexName, alterSql) {
    const rows = await query(
      `SELECT COUNT(*) AS count
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = :tableName
         AND INDEX_NAME = :indexName`,
      { tableName, indexName },
    );
    if (Number(rows[0]?.count || 0) === 0) {
      await pool.execute(alterSql);
    }
  }

  return { migrate, pool, query, transaction };
}

function validateDatabaseConfig(databaseConfig) {
  const missing = [];
  if (!databaseConfig.host || databaseConfig.host === "localhost") {
    missing.push("DATABASE__HOST");
  }
  if (!databaseConfig.user || databaseConfig.user === "root") {
    missing.push("DATABASE__USER");
  }
  if (!databaseConfig.password) {
    missing.push("DATABASE__PASSWORD");
  }
  if (!databaseConfig.database || databaseConfig.database === "sms") {
    missing.push("DATABASE__DATABASE");
  }

  if (missing.length > 0) {
    throw new Error(
      `Database environment is incomplete. Set these Hostinger Node.js environment variables: ${missing.join(", ")}.`,
    );
  }
}

module.exports = { createDatabase };
