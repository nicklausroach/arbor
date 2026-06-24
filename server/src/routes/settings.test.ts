import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.ARBOR_DB_PATH = join(mkdtempSync(join(tmpdir(), "arbor-test-")), "test.sqlite");

const { migrate, getSetting } = await import("../db/index.js");
const { settingsRouter } = await import("./settings.js");

migrate();

const app = express();
app.use(express.json());
app.use("/settings", settingsRouter);

let baseUrl: string;
let server: ReturnType<typeof app.listen>;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

async function putMaxConcurrency(body: unknown) {
  return fetch(`${baseUrl}/settings/max-concurrency`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /settings/max-concurrency", () => {
  it("accepts integers in 1..999 and persists them", async () => {
    const res = await putMaxConcurrency({ maxConcurrency: 5 });
    expect(res.status).toBe(200);
    expect(getSetting("max_concurrency")).toBe("5");
  });

  it("accepts the upper bound of 999", async () => {
    const res = await putMaxConcurrency({ maxConcurrency: 999 });
    expect(res.status).toBe(200);
    expect(getSetting("max_concurrency")).toBe("999");
  });

  it("floors non-integer values before persisting", async () => {
    const res = await putMaxConcurrency({ maxConcurrency: 3.9 });
    expect(res.status).toBe(200);
    expect(getSetting("max_concurrency")).toBe("3");
  });

  it("rejects values below 1", async () => {
    const res = await putMaxConcurrency({ maxConcurrency: 0 });
    expect(res.status).toBe(400);
  });

  it("rejects values >= 1000", async () => {
    const res = await putMaxConcurrency({ maxConcurrency: 1000 });
    expect(res.status).toBe(400);
  });

  it("rejects a value that floors below 1", async () => {
    const res = await putMaxConcurrency({ maxConcurrency: 0.5 });
    expect(res.status).toBe(400);
  });

  it("rejects non-numeric values", async () => {
    const res = await putMaxConcurrency({ maxConcurrency: "abc" });
    expect(res.status).toBe(400);
  });

  it("rejects a missing value", async () => {
    const res = await putMaxConcurrency({});
    expect(res.status).toBe(400);
  });
});
