
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";

const connectionString = process.env.TEST_DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "TEST_DATABASE_URL is required. Set it to the dedicated fielddesk_test database.",
  );
}

const pool = new Pool({ connectionString });

const createdOrganizations: string[] = [];

async function createFixture() {
  const organizationId = randomUUID();
  const ownerId = randomUUID();
  const technicianAId = randomUUID();
  const technicianBId = randomUUID();

  await pool.query(
    "INSERT INTO organizations (id, name) VALUES ($1, $2)",
    [organizationId, "Scheduling Test Organization"],
  );

  createdOrganizations.push(organizationId);

  for (const user of [
    { id: ownerId, name: "Test Owner", role: "OWNER" },
    { id: technicianAId, name: "Technician A", role: "TECHNICIAN" },
    { id: technicianBId, name: "Technician B", role: "TECHNICIAN" },
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

  return { organizationId, ownerId, technicianAId, technicianBId };
}

async function insertWorkOrder(input: {
  organizationId: string;
  ownerId: string;
  technicianId: string;
  title: string;
  start: string;
  end: string;
}) {
  return pool.query(
    `INSERT INTO work_orders (
       id, organization_id, title, customer_name, service_address,
       assigned_technician_id, created_by, scheduled_start, scheduled_end
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      randomUUID(),
      input.organizationId,
      input.title,
      "Test Customer",
      "123 Test Street",
      input.technicianId,
      input.ownerId,
      input.start,
      input.end,
    ],
  );
}

describe("Technician scheduling database constraint", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT current_database() AS name");

    if (result.rows[0].name !== "fielddesk_test") {
      throw new Error(
        `Safety check failed: connected to ${result.rows[0].name}, not fielddesk_test`,
      );
    }
  });

  afterEach(async () => {
    while (createdOrganizations.length > 0) {
      const organizationId = createdOrganizations.pop()!;

      // Remove dependent rows in foreign-key-safe order.
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
    await pool.end();
  });

  it("rejects overlapping appointments for the same technician", async () => {
    const fixture = await createFixture();

    await insertWorkOrder({
      organizationId: fixture.organizationId,
      ownerId: fixture.ownerId,
      technicianId: fixture.technicianAId,
      title: "First appointment",
      start: "2030-01-10T09:00:00Z",
      end: "2030-01-10T10:00:00Z",
    });

    await expect(
      insertWorkOrder({
        organizationId: fixture.organizationId,
        ownerId: fixture.ownerId,
        technicianId: fixture.technicianAId,
        title: "Overlapping appointment",
        start: "2030-01-10T09:30:00Z",
        end: "2030-01-10T10:30:00Z",
      }),
    ).rejects.toMatchObject({ code: "23P01" });
  });

  it("allows overlapping appointments for different technicians", async () => {
    const fixture = await createFixture();

    await insertWorkOrder({
      organizationId: fixture.organizationId,
      ownerId: fixture.ownerId,
      technicianId: fixture.technicianAId,
      title: "Technician A appointment",
      start: "2030-01-11T09:00:00Z",
      end: "2030-01-11T10:00:00Z",
    });

    await expect(
      insertWorkOrder({
        organizationId: fixture.organizationId,
        ownerId: fixture.ownerId,
        technicianId: fixture.technicianBId,
        title: "Technician B appointment",
        start: "2030-01-11T09:30:00Z",
        end: "2030-01-11T10:30:00Z",
      }),
    ).resolves.toBeDefined();
  });

  it("allows back-to-back appointments for the same technician", async () => {
    const fixture = await createFixture();

    await insertWorkOrder({
      organizationId: fixture.organizationId,
      ownerId: fixture.ownerId,
      technicianId: fixture.technicianAId,
      title: "Morning appointment",
      start: "2030-01-12T09:00:00Z",
      end: "2030-01-12T10:00:00Z",
    });

    await expect(
      insertWorkOrder({
        organizationId: fixture.organizationId,
        ownerId: fixture.ownerId,
        technicianId: fixture.technicianAId,
        title: "Next appointment",
        start: "2030-01-12T10:00:00Z",
        end: "2030-01-12T11:00:00Z",
      }),
    ).resolves.toBeDefined();
  });

  it("allows only one of two concurrent overlapping appointments", async () => {
    const fixture = await createFixture();

    const results = await Promise.allSettled([
      insertWorkOrder({
        organizationId: fixture.organizationId,
        ownerId: fixture.ownerId,
        technicianId: fixture.technicianAId,
        title: "Concurrent appointment A",
        start: "2030-01-13T09:00:00Z",
        end: "2030-01-13T10:00:00Z",
      }),
      insertWorkOrder({
        organizationId: fixture.organizationId,
        ownerId: fixture.ownerId,
        technicianId: fixture.technicianAId,
        title: "Concurrent appointment B",
        start: "2030-01-13T09:30:00Z",
        end: "2030-01-13T10:30:00Z",
      }),
    ]);

    const successful = results.filter(
      (result) => result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result) => result.status === "rejected",
    );

    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const failure = rejected[0];

    if (failure.status === "rejected") {
      expect(failure.reason).toMatchObject({ code: "23P01" });
    }
  });
});
