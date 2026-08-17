// Socialfix test fixture — minimal `chrome.*` shim for running the extension's
// content scripts as plain <script> tags on a file:// page (no extension
// loading, no network). Only what the Instagram modal code paths touch:
//
//   chrome.storage.local.get / set / remove / clear   (Promise AND callback forms)
//   chrome.storage.onChanged                          (inert listener registry)
//   chrome.runtime.getManifest / id / lastError / onMessage
//   chrome.tabs.query / sendMessage
//
// Storage is one JSON blob in localStorage (Chromium gives file:// pages a
// working localStorage, shared by every file:// page in the profile), so a
// value written by one fixture load is visible on the next — that is what lets
// the "re-applies the stored modal size on the next dialog" assertion survive
// a page reload. If localStorage throws (some hardened profiles), we fall back
// to an in-memory object and say so once in the console.
//
// Introspection hooks (all on window):
//   __bwiResetStorage()  – wipe everything (memory + localStorage blob)
//   __bwiStorageDump()   – current storage object (deep copy)
//   __bwiStorageLog      – last 200 {op, keys, t} calls, newest last
(function () {
  "use strict";

  const BLOB_KEY = "__bwi_chrome_storage_local";
  let memory = null; // used only if localStorage is unusable
  let warned = false;

  function warnOnce(err) {
    if (warned) return;
    warned = true;
    console.warn("[bwi-fixture] localStorage unavailable, using in-memory storage:", err);
  }

  function load() {
    if (memory) return memory;
    try {
      const raw = window.localStorage.getItem(BLOB_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      warnOnce(err);
      memory = {};
      return memory;
    }
  }

  function save(obj) {
    if (memory) {
      memory = obj;
      return;
    }
    try {
      window.localStorage.setItem(BLOB_KEY, JSON.stringify(obj));
    } catch (err) {
      warnOnce(err);
      memory = obj;
    }
  }

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  const log = (window.__bwiStorageLog = []);
  function record(op, keys) {
    log.push({ op, keys: clone(keys), t: Date.now() });
    if (log.length > 200) log.shift();
  }

  // Resolve a Promise AND invoke an optional callback, like the real API does
  // when both forms are used. Callbacks run asynchronously (microtask) so
  // callers can't observe a sync/async difference from real Chrome.
  function settle(value, cb) {
    const p = Promise.resolve(value);
    if (typeof cb === "function") p.then((v) => cb(v));
    return p;
  }

  function get(keys, cb) {
    if (typeof keys === "function") {
      cb = keys;
      keys = null;
    }
    record("get", keys);
    const all = load();
    let out = {};
    if (keys === null || keys === undefined) {
      out = clone(all);
    } else if (typeof keys === "string") {
      if (Object.prototype.hasOwnProperty.call(all, keys)) out[keys] = clone(all[keys]);
    } else if (Array.isArray(keys)) {
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(all, k)) out[k] = clone(all[k]);
      }
    } else if (typeof keys === "object") {
      // Object form: keys with default values.
      for (const k of Object.keys(keys)) {
        out[k] = Object.prototype.hasOwnProperty.call(all, k) ? clone(all[k]) : clone(keys[k]);
      }
    }
    return settle(out, cb);
  }

  function set(items, cb) {
    record("set", Object.keys(items || {}));
    const all = load();
    for (const k of Object.keys(items || {})) all[k] = clone(items[k]);
    save(all);
    return settle(undefined, cb);
  }

  function remove(keys, cb) {
    const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : [];
    record("remove", list);
    const all = load();
    for (const k of list) delete all[k];
    save(all);
    return settle(undefined, cb);
  }

  function clear(cb) {
    record("clear", null);
    save({});
    return settle(undefined, cb);
  }

  const inertEvent = {
    addListener() {},
    removeListener() {},
    hasListener() {
      return false;
    },
  };

  window.chrome = {
    storage: {
      local: { get, set, remove, clear },
      onChanged: inertEvent,
    },
    runtime: {
      id: "bwi-fixture",
      lastError: undefined,
      getManifest: () => ({ name: "Socialfix (fixture)", version: "test" }),
      onMessage: inertEvent,
    },
    tabs: {
      query: async () => [],
      sendMessage: async () => {
        throw new Error("no tab");
      },
    },
  };

  window.__bwiResetStorage = function () {
    memory = null;
    try {
      window.localStorage.removeItem(BLOB_KEY);
    } catch (err) {
      warnOnce(err);
      memory = {};
    }
    log.length = 0;
  };

  window.__bwiStorageDump = function () {
    return clone(load());
  };
})();
