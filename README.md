# Android SMS Gateway Server, Node.js Port

This repository is a Hostinger-friendly Node.js rewrite of the core
[`android-sms-gateway/server`](https://github.com/android-sms-gateway/server)
private-server API.

It is designed for managed Node hosting where Docker/Go services are not
available. The implementation uses Express and MySQL/MariaDB through `mysql2`.

## Current Compatibility

Implemented:

- `GET /health`, `/health/live`, `/health/ready`, `/health/startup`
- `POST /mobile/v1/device`
- `GET /mobile/v1/device`
- `PATCH /mobile/v1/device`
- `GET /mobile/v1/user/code`
- `PATCH /mobile/v1/user/password`
- `GET /mobile/v1/message` and `/mobile/v1/messages`
- `PATCH /mobile/v1/message` and `/mobile/v1/messages`
- `GET /mobile/v1/webhooks`
- `GET /mobile/v1/settings`
- `GET /mobile/v1/events` minimal Server-Sent Events stream
- `POST /api/upstream/v1/push` translated to SSE for known device push tokens
- `GET /3rdparty/v1/devices`
- `DELETE /3rdparty/v1/devices/:id`
- `POST /3rdparty/v1/messages`
- `GET /3rdparty/v1/messages`
- `GET /3rdparty/v1/messages/:id`
- `POST /3rdparty/v1/messages/inbox/export`
- `GET`, `POST`, `DELETE /3rdparty/v1/webhooks`
- `GET`, `PATCH`, `PUT /3rdparty/v1/settings`
- `POST /3rdparty/v1/auth/token`
- `POST /3rdparty/v1/auth/token/refresh`
- `DELETE /3rdparty/v1/auth/token/:jti`
- `GET /3rdparty/v1/logs`
- `/api/...` aliases for all of the above

Stubbed:

- Inbox listing returns `501`.
- Inbox refresh returns `202` and notifies devices through SSE.
- Metrics returns a placeholder.

Not yet ported from the Go server:

- Firebase Cloud Messaging relay. This port uses SSE/polling on shared hosting.
- Full inbox storage.
- Full webhook signing/retry worker. Outbound message status webhooks are sent
  once on phone status updates.
- Redis/pubsub and multi-worker coordination.
- Message content hashing cleanup workers.
- Prometheus metrics parity.

## Hostinger Setup

1. Create a MySQL database in hPanel and copy the database name, username,
   password, host, and port.
2. Upload this app or connect the Git repository in Hostinger's Node.js app
   manager.
3. Set the startup file to `server.js`.
4. Set the install command to `npm install`.
5. Set the start command to `npm start`.
6. Add the environment variables from `.env.example` in Hostinger.
7. Start the app. On first boot, it creates the required tables.

Use either root-style URLs:

```text
https://your-domain.com/mobile/v1/device
https://your-domain.com/3rdparty/v1/messages
```

or `/api` URLs:

```text
https://your-domain.com/api/mobile/v1/device
https://your-domain.com/api/3rdparty/v1/messages
```

## First Device Registration

For the easiest first test, set:

```text
GATEWAY__MODE=public
```

Then register the Android app against:

```text
https://your-domain.com/mobile/v1
```

The registration response includes `login`, `password`, `id`, and `token`.
After the first device is registered, switch back to:

```text
GATEWAY__MODE=private
GATEWAY__PRIVATE_TOKEN=<a-long-random-token>
```

Future registrations will need:

```text
Authorization: Bearer <GATEWAY__PRIVATE_TOKEN>
```

## Local Development

```bash
npm install
npm start
```

Run syntax checks:

```bash
npm run check
```

Run a deployed smoke test:

```bash
SMOKE_BASE_URL=https://your-domain.com npm run smoke
```

If `GATEWAY__MODE=private`, include `GATEWAY__PRIVATE_TOKEN` in the smoke-test
environment too.
