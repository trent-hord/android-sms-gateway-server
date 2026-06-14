const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { badRequest, notFound, unauthorized } = require("./errors");
const { createEventBus } = require("./events");

const DEFAULT_SETTINGS = {
  gateway: { cloud_url: null, private_token: null, notification_channel: "SSE_ONLY" },
  encryption: { passphrase: null },
  messages: {
    send_interval_min: null,
    send_interval_max: null,
    limit_period: "Disabled",
    limit_value: null,
    sim_selection_mode: "OSDefault",
    log_lifetime_days: null,
  },
  ping: { interval_seconds: null },
  logs: { lifetime_days: 30 },
  webhooks: { internet_required: true, retry_count: 1, signing_key: null },
};

function id(length = 21) {
  return crypto
    .randomBytes(Math.ceil((length * 3) / 4))
    .toString("base64url")
    .slice(0, length);
}

function toSqlDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 23).replace("T", " ");
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function rowToDevice(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || "",
    authToken: row.auth_token,
    pushToken: row.push_token,
    userId: row.user_id,
    simCards: parseJson(row.sim_cards, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    lastSeen: row.last_seen,
  };
}

function publicDevice(device) {
  return {
    id: device.id,
    name: device.name || "",
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
    deletedAt: device.deletedAt,
    lastSeen: device.lastSeen,
    simCards: device.simCards || [],
  };
}

function contentFromMessage(body) {
  if (body.textMessage?.text !== undefined) {
    return { type: "Text", content: { text: body.textMessage.text } };
  }
  if (body.dataMessage?.data !== undefined) {
    return {
      type: "Data",
      content: { data: body.dataMessage.data, port: body.dataMessage.port },
    };
  }
  if (body.message !== undefined) {
    return { type: "Text", content: { text: body.message } };
  }
  throw badRequest("No message content provided");
}

function validUntilFromBody(body) {
  if (body.validUntil) return toSqlDate(body.validUntil);
  if (body.ttl) {
    const seconds = Number(body.ttl);
    if (Number.isFinite(seconds) && seconds > 0) {
      return toSqlDate(new Date(Date.now() + seconds * 1000));
    }
  }
  return null;
}

function expiresAtFromTtl(ttl) {
  const value = ttl || "15m";
  if (typeof value === "number") {
    return new Date(Date.now() + value * 1000).toISOString();
  }
  const match = String(value).match(/^(\d+)([smhd])?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2] || "s";
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return new Date(Date.now() + amount * multipliers[unit]).toISOString();
}

function stateDto(row, recipients = [], states = {}, includeContent = true) {
  const dto = {
    id: row.ext_id,
    deviceId: row.device_id,
    state: row.state,
    isHashed: Boolean(row.is_hashed),
    isEncrypted: Boolean(row.is_encrypted),
    recipients,
    states,
  };

  if (includeContent) {
    const content = parseJson(row.content, {});
    if (row.type === "Text") dto.textMessage = content;
    if (row.type === "Data") dto.dataMessage = content;
    if (row.is_hashed) dto.hashedMessage = { hash: row.content };
  }

  return dto;
}

function mobileMessageDto(row) {
  const content = parseJson(row.content, {});
  const dto = {
    id: row.ext_id,
    deviceId: "",
    phoneNumbers: parseJson(row.phone_numbers, []),
    isEncrypted: Boolean(row.is_encrypted),
    withDeliveryReport: Boolean(row.with_delivery_report),
    ttl: row.ttl || undefined,
    validUntil: row.valid_until || undefined,
    scheduleAt: row.schedule_at || undefined,
    priority: row.priority,
    createdAt: row.created_at,
  };

  if (row.sim_number !== null) dto.simNumber = row.sim_number;
  if (row.type === "Text") {
    dto.message = content.text || "";
    dto.textMessage = content;
  }
  if (row.type === "Data") {
    dto.dataMessage = content;
  }
  return dto;
}

function createServices({ config, db }) {
  const events = createEventBus();

  const users = {
    async create(userId, password) {
      const passwordHash = await bcrypt.hash(password, 10);
      await db.query(
        "INSERT INTO users (id, password_hash) VALUES (:id, :passwordHash)",
        { id: userId, passwordHash },
      );
      return { id: userId };
    },

    async verifyPassword(userId, password) {
      const rows = await db.query("SELECT * FROM users WHERE id = :id", {
        id: userId,
      });
      const user = rows[0];
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        throw unauthorized();
      }
      return { id: user.id };
    },

    async changePassword(userId, currentPassword, newPassword) {
      await this.verifyPassword(userId, currentPassword);
      const passwordHash = await bcrypt.hash(newPassword, 10);
      await db.query(
        "UPDATE users SET password_hash = :passwordHash WHERE id = :userId",
        { userId, passwordHash },
      );
    },

    async createCode(userId) {
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      const expiresAt = new Date(Date.now() + config.otp.ttlSeconds * 1000);
      await db.query("DELETE FROM user_codes WHERE user_id = :userId", {
        userId,
      });
      await db.query(
        "INSERT INTO user_codes (code, user_id, expires_at) VALUES (:code, :userId, :expiresAt)",
        { code, userId, expiresAt: toSqlDate(expiresAt) },
      );
      return { code, validUntil: expiresAt.toISOString() };
    },

    async consumeCode(code) {
      const rows = await db.query(
        "SELECT * FROM user_codes WHERE code = :code AND expires_at > NOW(3)",
        { code },
      );
      const item = rows[0];
      if (!item) throw unauthorized("Invalid or expired code");
      await db.query("DELETE FROM user_codes WHERE code = :code", { code });
      return { id: item.user_id };
    },
  };

  const devices = {
    async register(userId, body = {}) {
      const device = {
        id: id(),
        token: id(),
        userId,
        name: body.name || null,
        pushToken: body.pushToken || null,
        simCards: body.simCards || [],
      };
      await db.query(
        `INSERT INTO devices
          (id, user_id, name, auth_token, push_token, sim_cards)
         VALUES (:id, :userId, :name, :token, :pushToken, :simCards)`,
        {
          id: device.id,
          userId: device.userId,
          name: device.name,
          token: device.token,
          pushToken: device.pushToken,
          simCards: JSON.stringify(device.simCards),
        },
      );
      return device;
    },

    async findByToken(token) {
      const rows = await db.query(
        "SELECT * FROM devices WHERE auth_token = :token AND deleted_at IS NULL",
        { token },
      );
      const device = rowToDevice(rows[0]);
      if (!device) throw notFound("Device not found");
      await db.query(
        "UPDATE devices SET last_seen = CURRENT_TIMESTAMP(3) WHERE id = :id",
        { id: device.id },
      );
      return device;
    },

    async findByPushToken(pushToken) {
      const rows = await db.query(
        "SELECT * FROM devices WHERE push_token = :pushToken AND deleted_at IS NULL",
        { pushToken },
      );
      return rowToDevice(rows[0]);
    },

    async list(userId) {
      const rows = await db.query(
        "SELECT * FROM devices WHERE user_id = :userId AND deleted_at IS NULL ORDER BY created_at DESC",
        { userId },
      );
      return rows.map(rowToDevice);
    },

    async getAny(userId, deviceId, activeWithinHours) {
      const params = { userId, deviceId: deviceId || null };
      let sql =
        "SELECT * FROM devices WHERE user_id = :userId AND deleted_at IS NULL";
      if (deviceId) sql += " AND id = :deviceId";
      if (activeWithinHours && Number(activeWithinHours) > 0) {
        sql += " AND last_seen >= DATE_SUB(NOW(3), INTERVAL :hours HOUR)";
        params.hours = Number(activeWithinHours);
      }
      sql += " ORDER BY last_seen DESC LIMIT 1";
      const rows = await db.query(sql, params);
      const device = rowToDevice(rows[0]);
      if (!device) throw badRequest("No available device");
      return device;
    },

    async idsForUser(userId, deviceId = null) {
      const params = { userId, deviceId };
      let sql =
        "SELECT id FROM devices WHERE user_id = :userId AND deleted_at IS NULL";
      if (deviceId) sql += " AND id = :deviceId";
      const rows = await db.query(sql, params);
      return rows.map((row) => row.id);
    },

    async update(device, body = {}) {
      await db.query(
        `UPDATE devices
         SET name = COALESCE(:name, name),
             push_token = COALESCE(:pushToken, push_token),
             sim_cards = CASE WHEN :simCards IS NULL THEN sim_cards ELSE :simCards END
         WHERE id = :id`,
        {
          id: device.id,
          name: body.name || null,
          pushToken: body.pushToken || null,
          simCards: body.simCards ? JSON.stringify(body.simCards) : null,
        },
      );
    },

    async remove(userId, idToRemove) {
      const result = await db.query(
        "UPDATE devices SET deleted_at = CURRENT_TIMESTAMP(3) WHERE user_id = :userId AND id = :id",
        { userId, id: idToRemove },
      );
      if (result.affectedRows === 0) throw notFound("Device not found");
    },

    publicDevice,
  };

  const messages = {
    async enqueue(userId, body, options = {}) {
      const device = await devices.getAny(
        userId,
        body.deviceId,
        options.deviceActiveWithin,
      );
      const content = contentFromMessage(body);
      const extId = body.id || id();
      const phoneNumbers = body.phoneNumbers || [];
      if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
        throw badRequest("phoneNumbers must contain at least one phone number");
      }

      const insertedExtId = await db.transaction(async (connection) => {
        const [insert] = await connection.execute(
          `INSERT INTO messages
            (ext_id, user_id, device_id, type, content, ttl, valid_until, schedule_at,
             sim_number, with_delivery_report, priority, is_encrypted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            extId,
            userId,
            device.id,
            content.type,
            JSON.stringify(content.content),
            body.ttl ?? null,
            validUntilFromBody(body),
            toSqlDate(body.scheduleAt),
            body.simNumber ?? null,
            body.withDeliveryReport ? 1 : 0,
            body.priority ?? 0,
            body.isEncrypted ? 1 : 0,
          ],
        );
        const messageId = insert.insertId;
        for (const phoneNumber of phoneNumbers) {
          await connection.execute(
            "INSERT INTO message_recipients (message_id, phone_number) VALUES (?, ?)",
            [messageId, phoneNumber],
          );
        }
        await connection.execute(
          "INSERT INTO message_states (message_id, state) VALUES (?, 'Pending')",
          [messageId],
        );
        return extId;
      });
      const state = await this.getState(userId, insertedExtId);
      events.notify(device.id, "MessageEnqueued");
      return state;
    },

    async getState(userId, extId, includeContent = true) {
      const rows = await db.query(
        "SELECT * FROM messages WHERE user_id = :userId AND ext_id = :extId AND deleted_at IS NULL",
        { userId, extId },
      );
      const row = rows[0];
      if (!row) throw notFound("Message not found");
      const recipients = await db.query(
        "SELECT phone_number AS phoneNumber, state, error FROM message_recipients WHERE message_id = :messageId",
        { messageId: row.id },
      );
      const stateRows = await db.query(
        "SELECT state, updated_at FROM message_states WHERE message_id = :messageId",
        { messageId: row.id },
      );
      const states = Object.fromEntries(
        stateRows.map((item) => [item.state, item.updated_at]),
      );
      return stateDto(row, recipients, states, includeContent);
    },

    async list(userId, query) {
      const limit = Math.min(Number(query.limit || 50), 100);
      const offset = Number(query.offset || 0);
      const params = { userId, limit, offset };
      const where = ["user_id = :userId", "deleted_at IS NULL"];
      if (query.state) {
        where.push("state = :state");
        params.state = query.state;
      }
      if (query.deviceId) {
        where.push("device_id = :deviceId");
        params.deviceId = query.deviceId;
      }
      if (query.from) {
        where.push("created_at >= :from");
        params.from = toSqlDate(query.from);
      }
      if (query.to) {
        where.push("created_at <= :to");
        params.to = toSqlDate(query.to);
      }

      const whereSql = where.join(" AND ");
      const totalRows = await db.query(
        `SELECT COUNT(*) AS total FROM messages WHERE ${whereSql}`,
        params,
      );
      const rows = await db.query(
        `SELECT * FROM messages WHERE ${whereSql}
         ORDER BY created_at DESC LIMIT :limit OFFSET :offset`,
        params,
      );
      const includeContent = query.includeContent === "true";
      return {
        total: totalRows[0]?.total || 0,
        items: await Promise.all(
          rows.map((row) => this.getState(userId, row.ext_id, includeContent)),
        ),
      };
    },

    async pendingForDevice(deviceId, order = "lifo") {
      const direction = order === "fifo" ? "ASC" : "DESC";
      const rows = await db.query(
        `SELECT m.*, JSON_ARRAYAGG(r.phone_number) AS phone_numbers
         FROM messages m
         JOIN message_recipients r ON r.message_id = m.id
         WHERE m.device_id = :deviceId
           AND m.state = 'Pending'
           AND m.deleted_at IS NULL
           AND (m.valid_until IS NULL OR m.valid_until > NOW(3))
           AND (m.schedule_at IS NULL OR m.schedule_at <= NOW(3))
         GROUP BY m.id
         ORDER BY m.priority DESC, m.created_at ${direction}`,
        { deviceId },
      );
      return rows.map(mobileMessageDto);
    },

    async updateFromDevice(device, updates) {
      if (!Array.isArray(updates)) throw badRequest("Expected an array");
      for (const update of updates) {
        const rows = await db.query(
          "SELECT * FROM messages WHERE ext_id = :extId AND device_id = :deviceId AND deleted_at IS NULL",
          { extId: update.id, deviceId: device.id },
        );
        const message = rows[0];
        if (!message) continue;
        await db.query(
          "UPDATE messages SET state = :state WHERE id = :messageId",
          { state: update.state, messageId: message.id },
        );
        const stateEntries = Object.entries(update.states || {});
        if (!stateEntries.some(([state]) => state === update.state)) {
          stateEntries.push([update.state, new Date()]);
        }
        for (const [state, updatedAt] of stateEntries) {
          await db.query(
            `INSERT INTO message_states (message_id, state, updated_at)
             VALUES (:messageId, :state, :updatedAt)
             ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`,
            {
              messageId: message.id,
              state,
              updatedAt: toSqlDate(updatedAt) || toSqlDate(new Date()),
            },
          );
        }
        for (const recipient of update.recipients || []) {
          await db.query(
            `UPDATE message_recipients
             SET state = :state, error = :error
             WHERE message_id = :messageId AND phone_number = :phoneNumber`,
            {
              messageId: message.id,
              phoneNumber: recipient.phoneNumber,
              state: recipient.state || update.state,
              error: recipient.error || null,
            },
          );
        }
        await webhooks.deliverForMessage(device, message.user_id, update);
      }
    },
  };

  const webhooks = {
    async list(userId) {
      return db.query(
        `SELECT id, device_id AS deviceId, url, event,
                created_at AS createdAt, updated_at AS updatedAt
         FROM webhooks
         WHERE user_id = :userId
         ORDER BY created_at DESC`,
        { userId },
      );
    },
    async listForDevice(userId, deviceId) {
      return db.query(
        `SELECT id, device_id AS deviceId, url, event,
                created_at AS createdAt, updated_at AS updatedAt
         FROM webhooks
         WHERE user_id = :userId
           AND (device_id IS NULL OR device_id = :deviceId)
         ORDER BY created_at DESC`,
        { userId, deviceId },
      );
    },
    async replace(userId, body) {
      if (!body.id || !body.url || !body.event) {
        throw badRequest("id, url, and event are required");
      }
      validateWebhookEvent(body.event);
      if (body.deviceId) {
        const ids = await devices.idsForUser(userId, body.deviceId);
        if (ids.length === 0) throw badRequest("Device does not belong to user");
      }
      await db.query(
        `REPLACE INTO webhooks (id, user_id, url, event, device_id)
         VALUES (:id, :userId, :url, :event, :deviceId)`,
        {
          id: body.id,
          userId,
          url: body.url,
          event: body.event,
          deviceId: body.deviceId || null,
        },
      );
      events.notifyMany(
        await devices.idsForUser(userId, body.deviceId || null),
        "WebhooksUpdated",
      );
      return { ...body, deviceId: body.deviceId || null };
    },
    async remove(userId, webhookId) {
      await db.query("DELETE FROM webhooks WHERE user_id = :userId AND id = :id", {
        userId,
        id: webhookId,
      });
      events.notifyMany(await devices.idsForUser(userId), "WebhooksUpdated");
    },
    async deliverForMessage(device, userId, update) {
      const event = webhookEventForState(update.state);
      if (!event) return;
      const hooks = await this.listForDevice(userId, device.id);
      const matching = hooks.filter((hook) => hook.event === event);
      if (matching.length === 0) return;
      const payload = {
        event,
        deviceId: device.id,
        id: update.id,
        state: update.state,
        recipients: update.recipients || [],
        states: update.states || {},
      };
      await Promise.allSettled(
        matching.map((hook) =>
          fetch(hook.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }),
        ),
      );
    },
  };

  const settings = {
    async get(userId) {
      const rows = await db.query("SELECT value FROM settings WHERE user_id = :userId", {
        userId,
      });
      return parseJson(rows[0]?.value, DEFAULT_SETTINGS);
    },
    async set(userId, value) {
      await db.query(
        `REPLACE INTO settings (user_id, value)
         VALUES (:userId, :value)`,
        { userId, value: JSON.stringify(value || DEFAULT_SETTINGS) },
      );
      events.notifyMany(await devices.idsForUser(userId), "SettingsUpdated");
      return value;
    },
    async patch(userId, patch) {
      const current = await this.get(userId);
      const next = deepMerge(current, patch || {});
      return this.set(userId, next);
    },
  };

  const tokens = {
    async issue(userId, body = {}) {
      if (!config.jwt.secret) {
        throw badRequest("JWT is disabled because JWT__SECRET is not set");
      }
      const scopes = body.scopes || ["*"];
      const jti = id(16);
      const accessTtl = body.ttl || config.jwt.accessTtl;
      const accessToken = jwt.sign(
        { typ: "access", scopes },
        config.jwt.secret,
        {
          subject: userId,
          issuer: config.jwt.issuer,
          expiresIn: accessTtl,
          jwtid: jti,
        },
      );
      const refreshJti = id(16);
      const refreshToken = jwt.sign(
        { typ: "refresh", scopes },
        config.jwt.secret,
        {
          subject: userId,
          issuer: config.jwt.issuer,
          expiresIn: config.jwt.refreshTtl,
          jwtid: refreshJti,
        },
      );
      await db.query(
        "INSERT INTO refresh_tokens (jti, user_id, scopes, expires_at) VALUES (:jti, :userId, :scopes, DATE_ADD(NOW(3), INTERVAL 30 DAY))",
        { jti: refreshJti, userId, scopes: JSON.stringify(scopes) },
      );
      return {
        id: jti,
        token_type: "Bearer",
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAtFromTtl(accessTtl),
      };
    },
    async refresh(refreshToken) {
      if (!config.jwt.secret) throw unauthorized();
      const payload = jwt.verify(refreshToken, config.jwt.secret, {
        issuer: config.jwt.issuer,
      });
      if (payload.typ !== "refresh") throw unauthorized();
      const rows = await db.query(
        "SELECT * FROM refresh_tokens WHERE jti = :jti AND revoked_at IS NULL AND expires_at > NOW(3)",
        { jti: payload.jti },
      );
      if (!rows[0]) throw unauthorized();
      const accessJti = id(16);
      const accessTtl = config.jwt.accessTtl;
      return {
        id: accessJti,
        token_type: "Bearer",
        access_token: jwt.sign(
          { typ: "access", scopes: payload.scopes || [] },
          config.jwt.secret,
          {
            subject: payload.sub,
            issuer: config.jwt.issuer,
            expiresIn: config.jwt.accessTtl,
            jwtid: accessJti,
          },
        ),
        expires_at: expiresAtFromTtl(accessTtl),
      };
    },
    async revoke(jti) {
      await db.query(
        "UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP(3) WHERE jti = :jti",
        { jti },
      );
    },
  };

  const inbox = {
    async refresh(userId, body = {}) {
      const data = {
        since: body.since || "",
        until: body.until || "",
      };
      if (Array.isArray(body.messageTypes) && body.messageTypes.length > 0) {
        data.messageTypes = body.messageTypes.join(",");
      }
      if (body.triggerWebhooks !== undefined) {
        data.triggerWebhooks = String(Boolean(body.triggerWebhooks));
      }
      events.notifyMany(
        await devices.idsForUser(userId, body.deviceId || null),
        "MessagesExportRequested",
        data,
      );
    },
  };

  const upstream = {
    async push(items) {
      const notifications = Array.isArray(items) ? items : [items];
      let accepted = 0;
      for (const item of notifications) {
        if (!item?.token || !item?.event) continue;
        const device = await devices.findByPushToken(item.token);
        if (!device) continue;
        events.notify(device.id, item.event, item.data || null);
        accepted += 1;
      }
      return { accepted };
    },
  };

  return {
    devices,
    events,
    inbox,
    messages,
    publicDevice,
    settings,
    tokens,
    upstream,
    users,
    webhooks,
  };
}

const WEBHOOK_EVENTS = new Set([
  "sms:received",
  "sms:data-received",
  "sms:sent",
  "sms:delivered",
  "sms:failed",
  "system:ping",
  "mms:received",
  "mms:downloaded",
]);

function validateWebhookEvent(event) {
  if (!WEBHOOK_EVENTS.has(event)) {
    throw badRequest(`Unsupported webhook event: ${event}`);
  }
}

function webhookEventForState(state) {
  if (state === "Sent") return "sms:sent";
  if (state === "Delivered") return "sms:delivered";
  if (state === "Failed") return "sms:failed";
  return null;
}

function deepMerge(target, source) {
  const result = Array.isArray(target) ? [...target] : { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

module.exports = { createServices };
