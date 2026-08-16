// Cloudflare Workers have no persistent in-memory state across requests
// (each request can land on a different isolate). The original Express
// version kept conversation state in plain JS objects on the class
// instance; here every read/write goes through Workers KV instead, so
// state survives across messages and across isolate restarts.
//
// Keys are namespaced by "kind" (appt, handoff, chat) and phone number
// for per-user state, or stored under a fixed "global:" key for the
// single shared value (currentClientForProfessor).
function createStateStore(kv) {
  const userKey = (kind, phone) => `${kind}:${phone}`;
  const globalKey = (key) => `global:${key}`;

  return {
    async getUser(kind, phone) {
      const raw = await kv.get(userKey(kind, phone));
      return raw ? JSON.parse(raw) : null;
    },
    async setUser(kind, phone, value) {
      await kv.put(userKey(kind, phone), JSON.stringify(value));
    },
    async deleteUser(kind, phone) {
      await kv.delete(userKey(kind, phone));
    },
    async getGlobal(key) {
      const raw = await kv.get(globalKey(key));
      return raw ? JSON.parse(raw) : null;
    },
    async setGlobal(key, value) {
      await kv.put(globalKey(key), JSON.stringify(value));
    },
    async deleteGlobal(key) {
      await kv.delete(globalKey(key));
    },
  };
}

export default createStateStore;
