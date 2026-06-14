function createEventBus() {
  const subscribers = new Map();

  function subscribe(deviceId, res) {
    if (!subscribers.has(deviceId)) subscribers.set(deviceId, new Set());
    const set = subscribers.get(deviceId);
    set.add(res);
    const keepAlive = setInterval(() => {
      res.write(":keepalive\n\n");
    }, 15000);
    res.on("close", () => {
      clearInterval(keepAlive);
      set.delete(res);
      if (set.size === 0) subscribers.delete(deviceId);
    });
  }

  function notify(deviceId, eventType, data = null) {
    if (!deviceId) return;
    const payload = { event_type: eventType, data };
    for (const res of subscribers.get(deviceId) || []) {
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      if (typeof res.flush === "function") res.flush();
    }
  }

  function notifyMany(deviceIds, eventType, data = null) {
    for (const deviceId of deviceIds) notify(deviceId, eventType, data);
  }

  return { notify, notifyMany, subscribe };
}

module.exports = { createEventBus };
