
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

const connectionString = process.env.TEST_DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;

if (!connectionString) {
  throw new Error("TEST_DATABASE_URL is required");
}

if (!jwtSecret || jwtSecret.length < 64) {
  throw new Error("A valid JWT_SECRET of at least 64 characters is required");
}

const pool = new Pool({ connectionString });
let app: typeof import("../src/app.js").default;
let appPool: Pool | undefined;
const createdOrganizations: string[] = [];

async function createFixture() {
  const organizationId = randomUUID();
  const ownerId = randomUUID();
  const technicianId = randomUUID();

  await pool.query(
    "INSERT INTO organizations (id, name) VALUES ($1, $2)",
    [organizationId, "Progress Event Test Organization"],
  );

  createdOrganizations.push(organizationId);

  for (const user of [
    { id: ownerId, role: "OWNER", name: "Test Owner" },
    { id: technicianId, role: "TECHNICIAN", name: "Test Technician" },
  ]) {
    await pool.query(
      `INSERT INTO users
        (id, organization_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        user.id,
        organizationId,
        user.name,
        `${user.id}@example.test`,
        "test-password-hash",
        user.role,
      ],
    );
  }

  function createToken(userId: string, role: string) {
    return jwt.sign(
      { organizationId, role },
      jwtSecret,
      {
        subject: userId,
        issuer: "fielddesk-api",
        audience: "fielddesk-client",
        expiresIn: "5m",
      },
    );
  }

  return {
    organizationId,
    ownerId,
    technicianId,
    ownerToken: createToken(ownerId, "OWNER"),
    technicianToken: createToken(technicianId, "TECHNICIAN"),
  };
}

describe("Progress-event API", () => {
  beforeAll(async () => {
    const result = await pool.query(
      "SELECT current_database() AS name",
    );

    if (result.rows[0].name !== "fielddesk_test") {
      throw new Error(
        `Safety check failed: connected to ${result.rows[0].name}, not fielddesk_test`,
      );
    }

    process.env.DATABASE_URL = connectionString;

    const database = await import("../src/config/database.js");
    appPool = database.pool;

    app = (await import("../src/app.js")).default;
  });

  afterEach(async () => {
    while (createdOrganizations.length > 0) {
      const organizationId = createdOrganizations.pop()!;

      await pool.query(
        "DELETE FROM progress_events WHERE organization_id = $1",
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
      await pool.query(
        "DELETE FROM users WHERE organization_id = $1",
        [organizationId],
      );
      await pool.query(
        "DELETE FROM organizations WHERE id = $1",
        [organizationId],
      );
    }
  });

  afterAll(async () => {
    if (appPool) {
      await appPool.end();
    }

    await pool.end();
  });

  it("rejects progress events from non-technicians", async () => {
    const fixture = await createFixture();

    const response = await request(app)
      .post("/api/progress-events")
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .send({
        eventId: "evt-001",
        workOrderId: randomUUID(),
        type: "status_changed",
        occurredAt: "2026-08-04T10:30:00Z",
        payload: { status: "IN_PROGRESS" },
      });

    expect(response.status).toBe(403);
  });

  it("rejects progress events for unassigned work orders", async () => {
    const fixture = await createFixture();

    const auth = {
      Authorization: `Bearer ${fixture.ownerToken}`,
    };

    const workOrder = await request(app)
      .post("/api/work-orders")
      .set(auth)
      .send({
        title: "Unassigned work order",
        customerName: "Test Customer",
        serviceAddress: "123 Test Street",
      });

    expect(workOrder.status).toBe(201);

    const response = await request(app)
      .post("/api/progress-events")
      .set("Authorization", `Bearer ${fixture.technicianToken}`)
      .send({
        eventId: "evt-002",
        workOrderId: workOrder.body.data.id,
        type: "status_changed",
        occurredAt: "2026-08-04T10:30:00Z",
        payload: { status: "IN_PROGRESS" },
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Work order is not assigned to a technician");
  });

  it("rejects progress events from technicians not assigned to the work order", async () => {
    const fixture = await createFixture();

    const auth = {
      Authorization: `Bearer ${fixture.ownerToken}`,
    };

    const workOrder = await request(app)
      .post("/api/work-orders")
      .set(auth)
      .send({
        title: "Other technician's work order",
        customerName: "Test Customer",
        serviceAddress: "123 Test Street",
      });

    expect(workOrder.status).toBe(201);

    // Create another technician
    const otherTechnicianId = randomUUID();
    await pool.query(
      `INSERT INTO users
        (id, organization_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        otherTechnicianId,
        fixture.organizationId,
        "Other Technician",
        `${otherTechnicianId}@example.test`,
        "test-password-hash",
        "TECHNICIAN",
      ],
    );

    const otherTechnicianToken = jwt.sign(
      { organizationId: fixture.organizationId, role: "TECHNICIAN" },
      jwtSecret,
      {
        subject: otherTechnicianId,
        issuer: "fielddesk-api",
        audience: "fielddesk-client",
        expiresIn: "5m",
      },
    );

    // Assign to the fixture technician
    await request(app)
      .patch(`/api/work-orders/${workOrder.body.data.id}/assign`)
      .set(auth)
      .send({ technicianId: fixture.technicianId });

    // Try to submit event as other technician
    const response = await request(app)
      .post("/api/progress-events")
      .set("Authorization", `Bearer ${otherTechnicianToken}`)
      .send({
        eventId: "evt-003",
        workOrderId: workOrder.body.data.id,
        type: "status_changed",
        occurredAt: "2026-08-04T10:30:00Z",
        payload: { status: "IN_PROGRESS" },
      });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("You are not assigned to this work order");
  });

  it("accepts valid progress events from assigned technicians", async () => {
    const fixture = await createFixture();

    const auth = {
      Authorization: `Bearer ${fixture.ownerToken}`,
    };

    const workOrder = await request(app)
      .post("/api/work-orders")
      .set(auth)
      .send({
        title: "Assigned work order",
        customerName: "Test Customer",
        serviceAddress: "123 Test Street",
      });

    expect(workOrder.status).toBe(201);

    await request(app)
      .patch(`/api/work-orders/${workOrder.body.data.id}/assign`)
      .set(auth)
      .send({ technicianId: fixture.technicianId });

    const response = await request(app)
      .post("/api/progress-events")
      .set("Authorization", `Bearer ${fixture.technicianToken}`)
      .send({
        eventId: "evt-004",
        workOrderId: workOrder.body.data.id,
        type: "status_changed",
        occurredAt: "2026-08-04T10:30:00Z",
        payload: { status: "IN_PROGRESS" },
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.event_id).toBe("evt-004");
  });

  it("returns 409 for duplicate event IDs", async () => {
    const fixture = await createFixture();

    const auth = {
      Authorization: `Bearer ${fixture.ownerToken}`,
    };

    const workOrder = await request(app)
      .post("/api/work-orders")
      .set(auth)
      .send({
        title: "Duplicate test work order",
        customerName: "Test Customer",
        serviceAddress: "123 Test Street",
      });

    expect(workOrder.status).toBe(201);

    await request(app)
      .patch(`/api/work-orders/${workOrder.body.data.id}/assign`)
      .set(auth)
      .send({ technicianId: fixture.technicianId });

    const firstEvent = await request(app)
      .post("/api/progress-events")
      .set("Authorization", `Bearer ${fixture.technicianToken}`)
      .send({
        eventId: "evt-duplicate",
        workOrderId: workOrder.body.data.id,
        type: "status_changed",
        occurredAt: "2026-08-04T10:30:00Z",
        payload: { status: "IN_PROGRESS" },
      });

    expect(firstEvent.status).toBe(201);

    const secondEvent = await request(app)
      .post("/api/progress-events")
      .set("Authorization", `Bearer ${fixture.technicianToken}`)
      .send({
        eventId: "evt-duplicate",
        workOrderId: workOrder.body.data.id,
        type: "status_changed",
        occurredAt: "2026-08-04T10:30:00Z",
        payload: { status: "IN_PROGRESS" },
      });

    expect(secondEvent.status).toBe(409);
    expect(secondEvent.body.message).toBe("Event ID already processed for this work order");
  });

  it("handles concurrent duplicate submissions safely", async () => {
    const fixture = await createFixture();

    const auth = {
      Authorization: `Bearer ${fixture.ownerToken}`,
    };

    const workOrder = await request(app)
      .post("/api/work-orders")
      .set(auth)
      .send({
        title: "Concurrent test work order",
        customerName: "Test Customer",
        serviceAddress: "123 Test Street",
      });

    expect(workOrder.status).toBe(201);

    await request(app)
      .patch(`/api/work-orders/${workOrder.body.data.id}/assign`)
      .set(auth)
      .send({ technicianId: fixture.technicianId });

    const results = await Promise.allSettled([
      request(app)
        .post("/api/progress-events")
        .set("Authorization", `Bearer ${fixture.technicianToken}`)
        .send({
          eventId: "evt-concurrent",
          workOrderId: workOrder.body.data.id,
          type: "status_changed",
          occurredAt: "2026-08-04T10:30:00Z",
          payload: { status: "IN_PROGRESS" },
        }),
      request(app)
        .post("/api/progress-events")
        .set("Authorization", `Bearer ${fixture.technicianToken}`)
        .send({
          eventId: "evt-concurrent",
          workOrderId: workOrder.body.data.id,
          type: "status_changed",
          occurredAt: "2026-08-04T10:30:00Z",
          payload: { status: "IN_PROGRESS" },
        }),
    ]);

    const responses = results.map((result) => {
      expect(result.status).toBe("fulfilled");
      if (result.status !== "fulfilled") {
        throw result.reason;
      }
      return result.value;
    });

    expect(responses.map((response) => response.status).sort()).toEqual([
      201,
      409,
    ]);

    const storedEvents = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM progress_events
       WHERE work_order_id = $1 AND event_id = $2`,
      [workOrder.body.data.id, "evt-concurrent"],
    );
    expect(storedEvents.rows[0].count).toBe(1);
  });

  it("rejects invalid payload for status_changed events", async () => {
    const fixture = await createFixture();

    const auth = {
      Authorization: `Bearer ${fixture.ownerToken}`,
    };

    const workOrder = await request(app)
      .post("/api/work-orders")
      .set(auth)
      .send({
        title: "Invalid payload test",
        customerName: "Test Customer",
        serviceAddress: "123 Test Street",
      });

    expect(workOrder.status).toBe(201);

    await request(app)
      .patch(`/api/work-orders/${workOrder.body.data.id}/assign`)
      .set(auth)
      .send({ technicianId: fixture.technicianId });

    const response = await request(app)
      .post("/api/progress-events")
      .set("Authorization", `Bearer ${fixture.technicianToken}`)
      .send({
        eventId: "evt-005",
        workOrderId: workOrder.body.data.id,
        type: "status_changed",
        occurredAt: "2026-08-04T10:30:00Z",
        payload: { note: "Missing status field" },
      });

    expect(response.status).toBe(400);
  });

  it("enforces organization isolation", async () => {
    const fixture1 = await createFixture();
    const fixture2 = await createFixture();

    const auth1 = {
      Authorization: `Bearer ${fixture1.ownerToken}`,
    };

    const workOrder = await request(app)
      .post("/api/work-orders")
      .set(auth1)
      .send({
        title: "Org 1 work order",
        customerName: "Test Customer",
        serviceAddress: "123 Test Street",
      });

    expect(workOrder.status).toBe(201);

    await request(app)
      .patch(`/api/work-orders/${workOrder.body.data.id}/assign`)
      .set(auth1)
      .send({ technicianId: fixture1.technicianId });

    // Try to submit event as technician from org 2
    const response = await request(app)
      .post("/api/progress-events")
      .set("Authorization", `Bearer ${fixture2.technicianToken}`)
      .send({
        eventId: "evt-006",
        workOrderId: workOrder.body.data.id,
        type: "status_changed",
        occurredAt: "2026-08-04T10:30:00Z",
        payload: { status: "IN_PROGRESS" },
      });

    expect(response.status).toBe(404);
  });
});
