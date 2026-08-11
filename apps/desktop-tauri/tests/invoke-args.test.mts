import assert from "node:assert/strict";

import { normalizeInvokeArgs } from "../src/invoke-args.ts";

assert.deepEqual(normalizeInvokeArgs([]), []);
assert.deepEqual(normalizeInvokeArgs(["hello", undefined]), ["hello"]);
assert.deepEqual(normalizeInvokeArgs(["hello", undefined, undefined]), ["hello"]);

const options = { deliverAs: "followUp" };

assert.deepEqual(normalizeInvokeArgs(["hello", options]), ["hello", options]);
assert.deepEqual(normalizeInvokeArgs(["hello", undefined, "tail"]), ["hello", undefined, "tail"]);
assert.deepEqual(normalizeInvokeArgs(["hello", null]), ["hello", null]);

console.log("Tauri invoke argument normalization passed");
