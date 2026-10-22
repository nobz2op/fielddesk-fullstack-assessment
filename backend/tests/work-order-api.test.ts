
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
    [organizationId, "HTTP API Test Organization"],
  );

  createdOrganizations.push(organizationId);

  for (const user of [
    { id: ownerId, role: "OWNER", name: "API Test Owner" },
    {
      id: technicianId,
      role: "TECHNICIAN",
      name: "API Test Technician",
    },
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

  const token = jwt.sign(
    { organizationId, role: "OWNER" },
    jwtSecret,
    {
      subject: ownerId,
      issuer: "fielddesk-api",
      audience: "fielddesk-client",
      expiresIn: "5m",
    },
  );

  return { organizationId, ownerId, technicianId, token };
}

describe("Work-order scheduling HTTP API", () => {
  beforeAll(async () => {
    const result = await pool.query(
      "SELECT current_database() AS name",
    );

    if (result.rows[0].name !== "fielddesk_test") {
      throw new Error(
        `Safety check failed: connected to ${result.rows[0].name}, not fielddesk_test`,
      );
    }

    // Make the API use the dedicated test database too.
    process.env.DATABASE_URL = connectionString;

    const database = await import("../src/config/database.js");
    appPool = database.pool;

    app = (await import("../src/app.js")).default;
  });

  afterEach(async () => {
    while (createdOrganizations.length > 0) {
      const organizationId = createdOrganizations.pop()!;

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

  it("returns HTTP 409 when assigning an overlapping work order", async () => {
    const fixture = await createFixture();

    const auth = {
      Authorization: `Bearer ${fixture.token}`,
    };

    const firstOrder = await request(app)
      .post("/api/work-orders")
      .set(auth)
      .send({
        title: "First scheduled appointment",
        customerName: "Test Customer One",
        serviceAddress: "123 Test Street",
        scheduledStart: "2030-02-10T09:00:00Z",
        scheduledEnd: "2030-02-10T10:00:00Z",
      });

    expect(firstOrder.status).toBe(201);

    const secondOrder = await request(app)
      .post("/api/work-orders")
      .set(auth)
      .send({
        title: "Overlapping scheduled appointment",
        customerName: "Test Customer Two",
        serviceAddress: "456 Test Avenue",
        scheduledStart: "2030-02-10T09:30:00Z",
        scheduledEnd: "2030-02-10T10:30:00Z",
      });

    expect(secondOrder.status).toBe(201);

    const firstAssignment = await request(app)
      .patch(`/api/work-orders/${firstOrder.body.data.id}/assign`)
      .set(auth)
      .send({ technicianId: fixture.technicianId });

    expect(firstAssignment.status).toBe(200);

    const conflictingAssignment = await request(app)
      .patch(`/api/work-orders/${secondOrder.body.data.id}/assign`)
      .set(auth)
      .send({ technicianId: fixture.technicianId });

    expect(conflictingAssignment.status).toBe(409);
    expect(conflictingAssignment.body).toMatchObject({
      success: false,
      message:
        "Scheduling conflict: this technician already has an overlapping work order.",
    });
  });
});
