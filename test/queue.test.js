#!/usr/bin/env node
// Socialfix queue.js test suite — dependency-free, runs via `node test/queue.test.js`.
// Tests the safety-critical throttle/cap/action-block logic that every bulk action
// depends on. Stubs chrome.storage.local and BWI.api in-memory.

const assert = require("assert");
const vm = require("vm");
const fs = require("fs");
const path = require("path");

// Test harness: counts, results, and assertion helpers.
class TestHarness {
  constructor() {
    this.results = [];
    this.passCount = 0;
    this.failCount = 0;
  }

  test(name, fn) {
    try {
      fn();
      this.results.push({ name, pass: true });
      this.passCount++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      this.results.push({ name, pass: false, error: err.message });
      this.failCount++;
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  report() {
    console.log(
      `\n${"=".repeat(60)}` +
      `\n${this.passCount} passed, ${this.failCount} failed\n` +
      `${"=".repeat(60)}`
    );
    return this.failCount === 0;
  }
}

const harness = new TestHarness();

// ---- In-memory chrome.storage.local stub ----

const storage = {};
const chromeStub = {
  storage: {
    local: {
      get: async (keys) => {
        if (typeof keys === "string") {
          return { [keys]: storage[keys] };
        }
        const result = {};
        for (const key of keys) {
          if (key in storage) result[key] = storage[key];
        }
        return result;
      },
      set: async (obj) => {
        for (const [key, value] of Object.entries(obj)) {
          storage[key] = value;
        }
      },
    },
  },
};

// ---- Load config.js and queue.js in a sandbox ----

function createSandbox() {
  const sandbox = {
    window: { BWI: {} },
    chrome: chromeStub,
    setTimeout,
    console,
  };

  // Load and execute config.js
  const configCode = fs.readFileSync(path.join(__dirname, "../src/config.js"), "utf8");
  vm.runInNewContext(configCode, sandbox);

  // Load and execute queue.js
  const queueCode = fs.readFileSync(path.join(__dirname, "../src/queue.js"), "utf8");
  vm.runInNewContext(queueCode, sandbox);

  return sandbox;
}

// ---- Test: isActionBlock() ----

console.log("\nTest Suite: isActionBlock()\n");

harness.test("isActionBlock returns false for null/undefined", () => {
  const sandbox = createSandbox();
  const isActionBlock = sandbox.window.BWI.queueUtil.isActionBlock;
  assert.strictEqual(isActionBlock(null), false);
  assert.strictEqual(isActionBlock(undefined), false);
  assert.strictEqual(isActionBlock({}), false);
});

harness.test("isActionBlock detects 429 status", () => {
  const sandbox = createSandbox();
  const isActionBlock = sandbox.window.BWI.queueUtil.isActionBlock;
  assert.strictEqual(isActionBlock({ status: 429 }), true);
  assert.strictEqual(isActionBlock({ status: 400 }), false);
});

harness.test("isActionBlock detects Instagram feedback_required (object property)", () => {
  const sandbox = createSandbox();
  const isActionBlock = sandbox.window.BWI.queueUtil.isActionBlock;
  assert.strictEqual(isActionBlock({ body: { feedback_required: true } }), true);
  assert.strictEqual(isActionBlock({ body: { feedback_required: false } }), false);
});

harness.test("isActionBlock detects Instagram spam signal", () => {
  const sandbox = createSandbox();
  const isActionBlock = sandbox.window.BWI.queueUtil.isActionBlock;
  assert.strictEqual(isActionBlock({ body: { spam: true } }), true);
  assert.strictEqual(isActionBlock({ body: { spam: false } }), false);
});

harness.test("isActionBlock detects Instagram message 'feedback_required'", () => {
  const sandbox = createSandbox();
  const isActionBlock = sandbox.window.BWI.queueUtil.isActionBlock;
  assert.strictEqual(isActionBlock({ body: { message: "feedback_required" } }), true);
  assert.strictEqual(isActionBlock({ body: { message: "error" } }), false);
});

harness.test("isActionBlock detects Instagram challenge/block/wait patterns in message", () => {
  const sandbox = createSandbox();
  const isActionBlock = sandbox.window.BWI.queueUtil.isActionBlock;
  const patterns = [
    "checkpoint",
    "Challenge",
    "BLOCK",
    "wait_a_bit",
    "consent_required",
    "login_required",
  ];
  for (const pattern of patterns) {
    assert.strictEqual(isActionBlock({ body: { message: pattern } }), true, `pattern "${pattern}" should block`);
  }
});

harness.test("isActionBlock detects X error codes (88=rate-limit, 326=locked, 64=suspended, 261=write-restricted)", () => {
  const sandbox = createSandbox();
  const isActionBlock = sandbox.window.BWI.queueUtil.isActionBlock;
  const codes = [88, 326, 64, 261];
  for (const code of codes) {
    assert.strictEqual(
      isActionBlock({ body: { errors: [{ code: String(code) }] } }),
      true,
      `X error code ${code} should block`
    );
  }
});

harness.test("isActionBlock ignores X errors with non-blocking codes", () => {
  const sandbox = createSandbox();
  const isActionBlock = sandbox.window.BWI.queueUtil.isActionBlock;
  assert.strictEqual(isActionBlock({ body: { errors: [{ code: "100" }] } }), false);
  assert.strictEqual(isActionBlock({ body: { errors: [{ code: "144" }] } }), false);
});

harness.test("isActionBlock handles X errors array with mixed codes", () => {
  const sandbox = createSandbox();
  const isActionBlock = sandbox.window.BWI.queueUtil.isActionBlock;
  // One blocking code among others
  assert.strictEqual(isActionBlock({ body: { errors: [{ code: "100" }, { code: "88" }] } }), true);
  // No blocking codes
  assert.strictEqual(isActionBlock({ body: { errors: [{ code: "100" }, { code: "144" }] } }), false);
});

// ---- Test: getDailyCount / bumpDailyCount ----

console.log("\nTest Suite: getDailyCount / bumpDailyCount\n");

harness.test("getDailyCount returns 0 for missing key", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const getDailyCount = sandbox.window.BWI.queueUtil.getDailyCount;
  const count = await getDailyCount();
  assert.strictEqual(count, 0);
});

harness.test("getDailyCount returns stored value", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const getDailyCount = sandbox.window.BWI.queueUtil.getDailyCount;
  const bumpDailyCount = sandbox.window.BWI.queueUtil.bumpDailyCount;

  // Bump once
  await bumpDailyCount();
  let count = await getDailyCount();
  assert.strictEqual(count, 1);

  // Bump multiple more times
  await bumpDailyCount(undefined, 5);
  count = await getDailyCount();
  assert.strictEqual(count, 6);
});

harness.test("getDailyCount uses date-based key", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const getDailyCount = sandbox.window.BWI.queueUtil.getDailyCount;
  const bumpDailyCount = sandbox.window.BWI.queueUtil.bumpDailyCount;

  // Get today's date key
  const today = new Date().toISOString().slice(0, 10);
  const expectedKey = `bwi_daily_${today}`;

  // Bump and verify it's stored under the right key
  await bumpDailyCount();
  assert(storage.hasOwnProperty(expectedKey), `storage should have key ${expectedKey}`);
  assert.strictEqual(storage[expectedKey], 1);
});

harness.test("getDailyCount respects custom prefix", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const getDailyCount = sandbox.window.BWI.queueUtil.getDailyCount;
  const bumpDailyCount = sandbox.window.BWI.queueUtil.bumpDailyCount;

  const prefix = "bwi_daily_custom_";
  await bumpDailyCount(prefix, 10);
  const count = await getDailyCount(prefix);
  assert.strictEqual(count, 10);

  // Default key should still be 0
  const defaultCount = await getDailyCount();
  assert.strictEqual(defaultCount, 0);
});

harness.test("bumpDailyCount increments from current value", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const getDailyCount = sandbox.window.BWI.queueUtil.getDailyCount;
  const bumpDailyCount = sandbox.window.BWI.queueUtil.bumpDailyCount;

  await bumpDailyCount(undefined, 3);
  await bumpDailyCount(undefined, 2);
  const count = await getDailyCount();
  assert.strictEqual(count, 5);
});

// ---- Test: queue.run() with caps and blocks ----

console.log("\nTest Suite: queue.run() throttle & cap logic\n");

harness.test("queue stops exactly at sessionCap", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const queue = sandbox.window.BWI.queue;

  let callCount = 0;
  const action = async () => {
    callCount++;
  };

  const items = Array.from({ length: 100 }, (_, i) => ({ pk: i }));

  const events = [];
  queue.onProgress((state) => {
    events.push(state);
  });

  await queue.run(items, action, {
    sessionCap: 10,
    dailyCap: 150,
    minDelay: 0,
    maxDelay: 0,
  });

  assert.strictEqual(callCount, 10, "should have called action exactly 10 times");
  const complete = events.find((e) => e.phase === "complete");
  assert(complete, "should emit complete event");
  assert.strictEqual(complete.done, 10, "complete event should report 10 done");
});

harness.test("queue stops exactly at dailyCap", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const queue = sandbox.window.BWI.queue;
  const bumpDailyCount = sandbox.window.BWI.queueUtil.bumpDailyCount;

  // Pre-spend the daily budget
  await bumpDailyCount(undefined, 145); // 145 of 150

  let callCount = 0;
  const action = async () => {
    callCount++;
  };

  const items = Array.from({ length: 100 }, (_, i) => ({ pk: i }));

  const events = [];
  queue.onProgress((state) => {
    events.push(state);
  });

  await queue.run(items, action, {
    sessionCap: 100,
    dailyCap: 150,
    minDelay: 0,
    maxDelay: 0,
  });

  assert.strictEqual(callCount, 5, "should have called action exactly 5 times (150 - 145)");
  const complete = events.find((e) => e.phase === "complete");
  assert.strictEqual(complete.done, 5, "complete event should report 5 done");
});

harness.test("queue stops when daily cap is already exceeded", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const queue = sandbox.window.BWI.queue;
  const bumpDailyCount = sandbox.window.BWI.queueUtil.bumpDailyCount;

  // Pre-spend the entire daily budget
  await bumpDailyCount(undefined, 150);

  let callCount = 0;
  const action = async () => {
    callCount++;
  };

  const items = Array.from({ length: 100 }, (_, i) => ({ pk: i }));

  const events = [];
  queue.onProgress((state) => {
    events.push(state);
  });

  await queue.run(items, action, {
    sessionCap: 100,
    dailyCap: 150,
    minDelay: 0,
    maxDelay: 0,
  });

  assert.strictEqual(callCount, 0, "should not call action at all");
  const stopped = events.find((e) => e.phase === "stopped");
  assert(stopped, "should emit stopped event");
  assert.strictEqual(stopped.reason, "daily-cap", "should stop with reason 'daily-cap'");
});

harness.test("queue bumps daily count on successful action", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const queue = sandbox.window.BWI.queue;
  const getDailyCount = sandbox.window.BWI.queueUtil.getDailyCount;

  const action = async () => {};
  const items = Array.from({ length: 5 }, (_, i) => ({ pk: i }));

  const events = [];
  queue.onProgress((state) => {
    events.push(state);
  });

  await queue.run(items, action, {
    sessionCap: 100,
    dailyCap: 150,
    minDelay: 0,
    maxDelay: 0,
  });

  const count = await getDailyCount();
  assert.strictEqual(count, 5, "daily count should be incremented by 5");
});

harness.test("queue does NOT bump daily count in DRY_RUN mode", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  sandbox.window.BWI.config.DRY_RUN = true;
  const queue = sandbox.window.BWI.queue;
  const getDailyCount = sandbox.window.BWI.queueUtil.getDailyCount;

  const action = async () => {};
  const items = Array.from({ length: 5 }, (_, i) => ({ pk: i }));

  await queue.run(items, action, {
    sessionCap: 100,
    dailyCap: 150,
    minDelay: 0,
    maxDelay: 0,
  });

  const count = await getDailyCount();
  assert.strictEqual(count, 0, "daily count should not be incremented in DRY_RUN mode");
});

// ---- Test: queue.run() action-block detection ----

console.log("\nTest Suite: queue.run() action-block detection\n");

harness.test("queue stops on action-block (429)", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const queue = sandbox.window.BWI.queue;

  let callCount = 0;
  const action = async () => {
    callCount++;
    if (callCount === 3) {
      const err = new Error("Rate limited");
      err.status = 429;
      throw err;
    }
  };

  const items = Array.from({ length: 10 }, (_, i) => ({ pk: i }));

  const events = [];
  queue.onProgress((state) => {
    events.push(state);
  });

  await queue.run(items, action, {
    sessionCap: 100,
    dailyCap: 150,
    minDelay: 0,
    maxDelay: 0,
  });

  assert.strictEqual(callCount, 3, "should have called action 3 times before hitting block");
  const stopped = events.find((e) => e.phase === "stopped");
  assert(stopped, "should emit stopped event");
  assert.strictEqual(stopped.reason, "action-block", "should stop with reason 'action-block'");
  assert.strictEqual(stopped.done, 2, "should report 2 successful before the block");
});

harness.test("queue stops on Instagram feedback_required block", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const queue = sandbox.window.BWI.queue;

  let callCount = 0;
  const action = async () => {
    callCount++;
    if (callCount === 2) {
      const err = new Error("Feedback required");
      err.body = { feedback_required: true };
      throw err;
    }
  };

  const items = Array.from({ length: 10 }, (_, i) => ({ pk: i }));

  const events = [];
  queue.onProgress((state) => {
    events.push(state);
  });

  await queue.run(items, action, {
    sessionCap: 100,
    dailyCap: 150,
    minDelay: 0,
    maxDelay: 0,
  });

  assert.strictEqual(callCount, 2, "should stop at the block");
  const stopped = events.find((e) => e.phase === "stopped");
  assert.strictEqual(stopped.reason, "action-block");
  assert.strictEqual(stopped.done, 1, "should report 1 successful");
});

harness.test("queue stops on X error code 88 (rate-limit)", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const queue = sandbox.window.BWI.queue;

  let callCount = 0;
  const action = async () => {
    callCount++;
    if (callCount === 2) {
      const err = new Error("Rate limited");
      err.body = { errors: [{ code: "88" }] };
      throw err;
    }
  };

  const items = Array.from({ length: 10 }, (_, i) => ({ pk: i }));

  const events = [];
  queue.onProgress((state) => {
    events.push(state);
  });

  await queue.run(items, action, {
    sessionCap: 100,
    dailyCap: 150,
    minDelay: 0,
    maxDelay: 0,
  });

  const stopped = events.find((e) => e.phase === "stopped");
  assert.strictEqual(stopped.reason, "action-block");
});

harness.test("queue stops on X error code 326 (locked/verify)", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const queue = sandbox.window.BWI.queue;

  let callCount = 0;
  const action = async () => {
    callCount++;
    if (callCount === 1) {
      const err = new Error("Account locked");
      err.body = { errors: [{ code: "326" }] };
      throw err;
    }
  };

  const items = Array.from({ length: 10 }, (_, i) => ({ pk: i }));

  const events = [];
  queue.onProgress((state) => {
    events.push(state);
  });

  await queue.run(items, action, {
    sessionCap: 100,
    dailyCap: 150,
    minDelay: 0,
    maxDelay: 0,
  });

  const stopped = events.find((e) => e.phase === "stopped");
  assert.strictEqual(stopped.reason, "action-block");
  assert.strictEqual(stopped.done, 0);
});

harness.test("queue continues on non-block errors", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const queue = sandbox.window.BWI.queue;

  let callCount = 0;
  const action = async () => {
    callCount++;
    if (callCount === 2) {
      const err = new Error("Item not found");
      err.status = 404;
      throw err;
    }
  };

  const items = Array.from({ length: 5 }, (_, i) => ({ pk: i }));

  const events = [];
  queue.onProgress((state) => {
    events.push(state);
  });

  await queue.run(items, action, {
    sessionCap: 100,
    dailyCap: 150,
    minDelay: 0,
    maxDelay: 0,
  });

  assert.strictEqual(callCount, 5, "should continue despite the 404 error");
  const complete = events.find((e) => e.phase === "complete");
  assert.strictEqual(complete.done, 4, "4 successful");
  assert.strictEqual(complete.failed, 1, "1 failed");
});

// ---- Test: queue.run() user stop request ----

console.log("\nTest Suite: queue.run() stop request\n");

harness.test("queue stops immediately when stop() is called", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const queue = sandbox.window.BWI.queue;

  let callCount = 0;
  const action = async () => {
    callCount++;
    if (callCount === 3) {
      queue.stop(); // User requests stop during action 3
    }
  };

  const items = Array.from({ length: 100 }, (_, i) => ({ pk: i }));

  const events = [];
  queue.onProgress((state) => {
    events.push(state);
  });

  await queue.run(items, action, {
    sessionCap: 100,
    dailyCap: 150,
    minDelay: 0,
    maxDelay: 0,
  });

  assert(callCount <= 4, "should stop shortly after stop() is called");
  const stopped = events.find((e) => e.phase === "stopped");
  assert(stopped, "should emit stopped event");
  assert.strictEqual(stopped.reason, "user", "should stop with reason 'user'");
});

// ---- Test: queue.run() uses custom options ----

console.log("\nTest Suite: queue.run() custom options\n");

harness.test("queue uses custom dailyKey", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const queue = sandbox.window.BWI.queue;
  const getDailyCount = sandbox.window.BWI.queueUtil.getDailyCount;

  const action = async () => {};
  const items = Array.from({ length: 5 }, (_, i) => ({ pk: i }));

  await queue.run(items, action, {
    sessionCap: 100,
    dailyCap: 150,
    minDelay: 0,
    maxDelay: 0,
    dailyKey: "bwi_daily_custom_",
  });

  // Custom key should have been incremented
  const count = await getDailyCount("bwi_daily_custom_");
  assert.strictEqual(count, 5);

  // Default key should still be 0
  const defaultCount = await getDailyCount();
  assert.strictEqual(defaultCount, 0);
});

harness.test("queue respects minDelay and maxDelay (timing test)", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const queue = sandbox.window.BWI.queue;

  const actionTimes = [];
  const action = async () => {
    actionTimes.push(Date.now());
  };

  const items = Array.from({ length: 3 }, (_, i) => ({ pk: i }));

  await queue.run(items, action, {
    sessionCap: 100,
    dailyCap: 150,
    minDelay: 50,
    maxDelay: 100,
  });

  // Check delays between consecutive actions (should be >= minDelay)
  for (let i = 1; i < actionTimes.length; i++) {
    const delay = actionTimes[i] - actionTimes[i - 1];
    assert(delay >= 40, `delay of ${delay}ms should be >= minDelay`); // Allow 10ms margin
  }
});

// ---- Test: queue singleton behavior ----

console.log("\nTest Suite: queue singleton behavior\n");

harness.test("queue.isBusy() returns false when not running", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const queue = sandbox.window.BWI.queue;
  assert.strictEqual(queue.isBusy(), false);
});

harness.test("queue.run() returns immediately when busy", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const queue = sandbox.window.BWI.queue;

  let firstRunCompleted = false;
  const action = async () => {
    await new Promise((r) => setTimeout(r, 100)); // Slow action
  };

  const items = Array.from({ length: 10 }, (_, i) => ({ pk: i }));

  // Start first run
  const firstRun = queue.run(items, action, {
    sessionCap: 100,
    dailyCap: 150,
    minDelay: 0,
    maxDelay: 0,
  }).then(() => {
    firstRunCompleted = true;
  });

  // Immediately try second run
  const secondRunStarted = queue.isBusy();
  const secondRun = queue.run(items, action, {
    sessionCap: 100,
    dailyCap: 150,
    minDelay: 0,
    maxDelay: 0,
  });

  assert.strictEqual(secondRunStarted, true, "queue should be busy during first run");
  assert.strictEqual(secondRun, undefined, "second run should return immediately (undefined)");

  await firstRun;
  assert.strictEqual(firstRunCompleted, true);
});

// ---- Test: feature-zone action (function) vs API action (method name) ----

console.log("\nTest Suite: queue.run() action types\n");

harness.test("queue calls async function actions with item as argument", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const queue = sandbox.window.BWI.queue;

  const receivedItems = [];
  const action = async (item) => {
    receivedItems.push(item);
  };

  const items = [{ pk: 100, username: "user1" }, { pk: 101, username: "user2" }];

  await queue.run(items, action, {
    sessionCap: 100,
    dailyCap: 150,
    minDelay: 0,
    maxDelay: 0,
  });

  assert.deepStrictEqual(receivedItems, items);
});

harness.test("queue calls BWI.api method-name actions with (pk, item)", async () => {
  storage = {}; // Clear storage
  const sandbox = createSandbox();
  const queue = sandbox.window.BWI.queue;

  // Mock BWI.api.unfollow
  sandbox.window.BWI.api = {
    unfollow: async (pk, item) => {
      // This should be called with pk and item
    },
  };

  const receivedCalls = [];
  const origUnfollow = sandbox.window.BWI.api.unfollow;
  sandbox.window.BWI.api.unfollow = async (pk, item) => {
    receivedCalls.push({ pk, item });
    return origUnfollow.call(this, pk, item);
  };

  const items = [{ pk: 100, username: "user1" }, { pk: 101, username: "user2" }];

  await queue.run(items, "unfollow", {
    sessionCap: 100,
    dailyCap: 150,
    minDelay: 0,
    maxDelay: 0,
  });

  assert.strictEqual(receivedCalls.length, 2);
  assert.strictEqual(receivedCalls[0].pk, 100);
  assert.deepStrictEqual(receivedCalls[0].item, items[0]);
  assert.strictEqual(receivedCalls[1].pk, 101);
  assert.deepStrictEqual(receivedCalls[1].item, items[1]);
});

// ---- Run all tests and report ----

console.log("Running Socialfix queue.js test suite...");
console.log("=========================================\n");

const success = harness.report();
process.exit(success ? 0 : 1);
