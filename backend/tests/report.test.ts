import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import bcrypt from "bcrypt";

const { Pool } = pg;

const connectionString = process.env.TEST_DATABASE_URL;

if (!connectionString) {
  throw new Error("TEST_DATABASE_URL is required; refusing to use DATABASE_URL.");
}

const pool = new Pool({ connectionString });
let app: typeof import("../src/app.js").default;
let appPool: pg.Pool | undefined;

const createdOrganizations: string[] = [];

async function createFixture() {
  const organizationId = randomUUID();
  createdOrganizations.push(organizationId);
  const ownerId = randomUUID();
  const password = "AssessmentTestPassword123!";

  await pool.query(
    `INSERT INTO organizations (id, name, created_at) VALUES ($1, $2, NOW())`,
    [organizationId, "Test Organization"],
  );

  const ownerPassword = await bcrypt.hash(password, 10);

  await pool.query(
    `INSERT INTO users (id, organization_id, name, email, password_hash, role, is_active, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())`,
    [
      ownerId,
      organizationId,
      "Test Owner",
      `owner-${organizationId}@example.com`,
      ownerPassword,
      "OWNER",
    ],
  );

  const loginResponse = await request(app)
    .post("/api/auth/login")
    .send({
      organizationId,
      email: `owner-${organizationId}@example.com`,
      password,
    });

  expect(loginResponse.status).toBe(200);

  return {
    organizationId,
    ownerId,
    ownerToken: loginResponse.body.token as string,
  };
}

async function insertWorkOrder(
  organizationId: string,
  ownerId: string,
  input: {
    title: string;
    status?: "OPEN" | "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  },
) {
  await pool.query(
    `INSERT INTO work_orders (
       id, organization_id, title, customer_name, service_address,
       status, created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      randomUUID(),
      organizationId,
      input.title,
      "Report Test Customer",
      "123 Report Test Street",
      input.status ?? "OPEN",
      ownerId,
    ],
  );
}

describe("Report API", () => {
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

  it("exports CSV with organization isolation", async () => {
    const own = await createFixture();
    const other = await createFixture();

    await insertWorkOrder(own.organizationId, own.ownerId, {
      title: "Visible work order",
    });
    await insertWorkOrder(other.organizationId, other.ownerId, {
      title: "Other organization work order",
    });

    const response = await request(app)
      .get("/api/reports/work-orders/csv")
      .set("Authorization", `Bearer ${own.ownerToken}`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.text).toContain("Visible work order");
    expect(response.text).not.toContain("Other organization work order");
  });

  it("filters CSV export by status", async () => {
    const fixture = await createFixture();
    await insertWorkOrder(fixture.organizationId, fixture.ownerId, {
      title: "Open report order",
      status: "OPEN",
    });
    await insertWorkOrder(fixture.organizationId, fixture.ownerId, {
      title: "Completed report order",
      status: "COMPLETED",
    });

    const response = await request(app)
      .get("/api/reports/work-orders/csv?status=OPEN")
      .set("Authorization", `Bearer ${fixture.ownerToken}`);

    expect(response.status).toBe(200);
    expect(response.text).toContain("Open report order");
    expect(response.text).not.toContain("Completed report order");
  });

  it("protects formula-like cell values in CSV", async () => {
    const fixture = await createFixture();
    await insertWorkOrder(fixture.organizationId, fixture.ownerId, {
      title: "\t=1+1",
    });

    const response = await request(app)
      .get("/api/reports/work-orders/csv")
      .set("Authorization", `Bearer ${fixture.ownerToken}`);

    expect(response.status).toBe(200);
    expect(response.text).toContain("'\t=1+1");
  });

  it("does not expose another organization's work order through search", async () => {
    const own = await createFixture();
    const other = await createFixture();
    await insertWorkOrder(other.organizationId, other.ownerId, {
      title: "Private tenant marker",
    });

    const response = await request(app)
      .get("/api/reports/work-orders/csv?search=Private%20tenant%20marker")
      .set("Authorization", `Bearer ${own.ownerToken}`);

    expect(response.status).toBe(200);
    expect(response.text).not.toContain("Private tenant marker");
    expect(response.text.trimEnd().split("\n")).toHaveLength(1);
  });

  it("streams CSV results across multiple database batches", async () => {
    const fixture = await createFixture();
    const rows = Array.from({ length: 501 }, (_, index) => {
      const offset = index * 7;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
    });
    const values = Array.from({ length: 501 }, (_, index) => [
      randomUUID(),
      fixture.organizationId,
      `Streaming order ${index}`,
      "Report Test Customer",
      "123 Report Test Street",
      "OPEN",
      fixture.ownerId,
    ]).flat();

    await pool.query(
      `INSERT INTO work_orders (
         id, organization_id, title, customer_name, service_address, status, created_by
       ) VALUES ${rows.join(", ")}`,
      values,
    );

    const response = await request(app)
      .get("/api/reports/work-orders/csv")
      .set("Authorization", `Bearer ${fixture.ownerToken}`);

    expect(response.status).toBe(200);
    const csvRows = response.text.trimEnd().split("\n");
    expect(csvRows).toHaveLength(502);
    expect(response.text).toContain("Streaming order 0");
    expect(response.text).toContain("Streaming order 500");
  });
});
