import "dotenv/config";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { Pool } from "pg";
import jwt from "jsonwebtoken";
import request from "supertest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

const connectionString = process.env.TEST_DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;

if (!connectionString) {
  throw new Error("TEST_DATABASE_URL is required; refusing to use DATABASE_URL.");
}
if (!jwtSecret || jwtSecret.length < 64) {
  throw new Error("A valid JWT_SECRET of at least 64 characters is required");
}

const pool = new Pool({ connectionString });
let app: typeof import("../src/app.js").default;
let appPool: Pool | undefined;
let server: import("node:http").Server;
let baseUrl: string;
const createdOrganizations: string[] = [];
const streamControllers: AbortController[] = [];

async function createFixture(name: string) {
  const organizationId = randomUUID();
  const ownerId = randomUUID();
  await pool.query(
    "INSERT INTO organizations (id, name) VALUES ($1, $2)",
    [organizationId, name],
  );
  createdOrganizations.push(organizationId);
  await pool.query(
    `INSERT INTO users
       (id, organization_id, name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5, 'OWNER')`,
    [ownerId, organizationId, `${name} Owner`, `${ownerId}@example.test`, "test-hash"],
  );
  const token = jwt.sign(
    { organizationId, role: "OWNER" },
    jwtSecret!,
    {
      subject: ownerId,
      issuer: "fielddesk-api",
      audience: "fielddesk-client",
      expiresIn: "5m",
    },
  );
  return { organizationId, ownerId, token };
}

async function openStream(token: string) {
  const controller = new AbortController();
  streamControllers.push(controller);
  const response = await fetch(`${baseUrl}/api/realtime/events`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body!.getReader();
  let pending = "";

  const nextEvent = async () => {
    while (true) {
      const boundary = pending.indexOf("\n\n");
      if (boundary >= 0) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        const eventName = frame.match(/^event:\s*(.+)$/m)?.[1];
        const data = frame.match(/^data:\s*(.+)$/m)?.[1];
        if (eventName && data && eventName !== "connected") {
          return { type: eventName, data: JSON.parse(data) as { workOrderId: string } };
        }
        continue;
      }

      const chunk = await reader.read();
      if (chunk.done) throw new Error("Real-time stream closed unexpectedly");
      pending += new TextDecoder().decode(chunk.value);
    }
  };

  return { nextEvent, close: () => controller.abort() };
}

async function createWorkOrder(token: string, title: string) {
  const response = await request(app)
    .post("/api/work-orders")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title,
      customerName: "Realtime Test Customer",
      serviceAddress: "123 Realtime Test Street",
    });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

describe("Authenticated organization-scoped real-time events", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");
    if (result.rows[0].name !== "fielddesk_test") {
      throw new Error(
        `Safety check failed: connected to ${result.rows[0].name}, not fielddesk_test`,
      );
    }
    process.env.DATABASE_URL = connectionString;
    const database = await import("../src/config/database.js");
    appPool = database.pool;
    app = (await import("../src/app.js")).default;

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const controller of streamControllers.splice(0)) controller.abort();
    while (createdOrganizations.length > 0) {
      const organizationId = createdOrganizations.pop()!;
      await pool.query(
        "DELETE FROM progress_events WHERE organization_id = $1",
        [organizationId],
      );
      await pool.query(
        "DELETE FROM attachments WHERE organization_id = $1",
        [organizationId],
      );
      await pool.query(
        "DELETE FROM work_order_activities WHERE organization_id = $1",
        [organizationId],
      );
      await pool.query(
        "DELETE FROM work_orders WHERE organization_id = $1",
        [organizationId],
      );
      await pool.query("DELETE FROM users WHERE organization_id = $1", [organizationId]);
      await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
    }
  });

  afterAll(async () => {
    for (const controller of streamControllers) controller.abort();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    if (appPool) await appPool.end();
    await pool.end();
  });

  it("rejects unauthenticated event-stream requests", async () => {
    const response = await request(app).get("/api/realtime/events");
    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Authentication required");
  });

  it("delivers work-order events only to subscribers in the same organization", async () => {
    const north = await createFixture("Realtime North");
    const south = await createFixture("Realtime South");
    const northStream = await openStream(north.token);
    const southStream = await openStream(south.token);

    const southOrderId = await createWorkOrder(south.token, "South tenant order");
    const northOrderId = await createWorkOrder(north.token, "North tenant order");

    const [northEvent, southEvent] = await Promise.all([
      northStream.nextEvent(),
      southStream.nextEvent(),
    ]);

    expect(northEvent).toEqual({
      type: "work_order.created",
      data: { workOrderId: northOrderId, occurredAt: expect.any(String) },
    });
    expect(southEvent).toEqual({
      type: "work_order.created",
      data: { workOrderId: southOrderId, occurredAt: expect.any(String) },
    });
    northStream.close();
    southStream.close();
  });
});
