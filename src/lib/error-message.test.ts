import assert from "node:assert/strict";
import { test } from "node:test";
import { errorMessage } from "./error-message.ts";

test("router error text admits real Error objects only", () => {
  assert.equal(errorMessage(new Error("Request failed")), "Request failed");
  const fallback = "An unexpected error occurred. Try reloading the page.";
  for (const value of [undefined, null, 0, "untrusted", { message: "untrusted" }, new Error("")]) {
    assert.equal(errorMessage(value), fallback);
  }
  assert.equal(errorMessage({ get message() { throw new Error("must not be read"); } }), fallback);
});
