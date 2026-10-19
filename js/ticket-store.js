/**
 * Ticket persistence (localStorage + Server API sync).
 * Keeps customer's booking references locally and syncs live approval status with the backend.
 */
(function () {
  const KEY = window.APP_CONFIG.STORAGE_KEY;
  let memory = [];

  function readAll() {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return memory;
    }
  }

  function writeAll(list) {
    memory = list;
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      /* storage full or blocked - keep in memory */
    }
  }

  function upsert(ticket) {
    const list = readAll();
    const copy = { ...ticket };
    // Avoid storing overly large base64 slip image in localStorage (>220KB)
    if (copy.slipData && copy.slipData.length > 220000) {
      delete copy.slipData;
    }
    const idx = list.findIndex((t) => t.ref === copy.ref);
    if (idx > -1) list[idx] = { ...list[idx], ...copy };
    else list.push(copy);
    writeAll(list);
    return copy;
  }

  async function syncAll() {
    const local = readAll();
    if (!local.length) return [];
    const refs = local.map((t) => t.ref).join(',');
    try {
      const res = await fetch(`/api/orders?refs=${encodeURIComponent(refs)}&includeSlip=false`);
      if (!res.ok) return local;
      const data = await res.json();
      const srvOrders = Array.isArray(data.orders) ? data.orders : [];
      srvOrders.forEach((srv) => upsert(srv));

      // Auto-recover any local tickets missing from the server database so Admin always sees them
      const srvRefSet = new Set(srvOrders.map((o) => String(o.ref).toUpperCase()));
      const missingOnServer = local.filter((t) => t && t.ref && !srvRefSet.has(String(t.ref).toUpperCase()));
      if (missingOnServer.length > 0) {
        const recRes = await fetch('/api/orders/recover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickets: missingOnServer })
        });
        if (recRes.ok) {
          const recData = await recRes.json();
          if (Array.isArray(recData.orders)) {
            const localRefSet = new Set(local.map((l) => String(l.ref).toUpperCase()));
            recData.orders
              .filter((srv) => localRefSet.has(String(srv.ref).toUpperCase()))
              .forEach((srv) => upsert(srv));
          }
        }
      }
    } catch {
      /* offline fallback to local data */
    }
    return readAll().sort((a, b) => b.issuedAt - a.issuedAt);
  }

  async function fetchOne(ref) {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(ref)}?includeSlip=false`);
      if (res.ok) {
        const data = await res.json();
        if (data.order) return upsert(data.order);
      }
    } catch {
      /* fallback to local */
    }
    return readAll().find((t) => t.ref === ref) || null;
  }

  window.TicketStore = {
    all: () => readAll().sort((a, b) => b.issuedAt - a.issuedAt),
    get: (ref) => readAll().find((t) => t.ref === ref),
    add: upsert,
    upsert,
    syncAll,
    fetchOne,
    count: () =>
      readAll()
        .filter((t) => t.status !== 'rejected')
        .reduce((sum, t) => sum + Number(t.qty || 0), 0)
  };
})();
