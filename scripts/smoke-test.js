const assert = require("assert");

const baseUrl = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);
const registrationToken = process.env.GATEWAY__PRIVATE_TOKEN || "";

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(
      `${options.method || "GET"} ${path} failed: ${response.status} ${text}`,
    );
  }
  return { body, headers: response.headers, status: response.status };
}

function basic(login, password) {
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

async function main() {
  const registerHeaders = {};
  if (registrationToken) {
    registerHeaders.authorization = `Bearer ${registrationToken}`;
  }

  const registered = await request("/mobile/v1/device", {
    method: "POST",
    headers: registerHeaders,
    body: JSON.stringify({ name: "Smoke Test Device" }),
  });
  assert.ok(registered.body.id, "device id missing");
  assert.ok(registered.body.token, "device token missing");
  assert.ok(registered.body.login, "login missing");
  assert.ok(registered.body.password, "password missing");

  const credentials = basic(registered.body.login, registered.body.password);
  const message = await request("/3rdparty/v1/messages", {
    method: "POST",
    headers: { authorization: credentials },
    body: JSON.stringify({
      textMessage: { text: "Smoke test" },
      phoneNumbers: ["+15555550100"],
      deviceId: registered.body.id,
    }),
  });
  assert.strictEqual(message.status, 202);
  assert.ok(message.body.id, "message id missing");

  const pending = await request("/mobile/v1/messages", {
    headers: { authorization: `Bearer ${registered.body.token}` },
  });
  assert.ok(
    pending.body.some((item) => item.id === message.body.id),
    "enqueued message not visible to device",
  );

  await request("/mobile/v1/messages", {
    method: "PATCH",
    headers: { authorization: `Bearer ${registered.body.token}` },
    body: JSON.stringify([
      {
        id: message.body.id,
        state: "Sent",
        recipients: [{ phoneNumber: "+15555550100", state: "Sent" }],
        states: { Sent: new Date().toISOString() },
      },
    ]),
  });

  const state = await request(`/3rdparty/v1/messages/${message.body.id}`, {
    headers: { authorization: credentials },
  });
  assert.strictEqual(state.body.state, "Sent");

  console.log("Smoke test passed");
  console.log(`login=${registered.body.login}`);
  console.log(`password=${registered.body.password}`);
  console.log(`device_id=${registered.body.id}`);
  console.log(`device_token=${registered.body.token}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
