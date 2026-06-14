function createEventBus() {
  const subscribers = new Map();

  function subscribe(deviceId, res) {
    if (!subscribers.has(deviceId)) subscribers.set(deviceId, new Set());
    const set = subscribers.get(deviceId);
    set.add(res);
    res.on("close", () => {
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
    }
  }

  function notifyMany(deviceIds, eventType, data = null) {
    for (const deviceId of deviceIds) notify(deviceId, eventType, data);
  }

  return { notify, notifyMany, subscribe };
}

module.exports = { createEventBus };
