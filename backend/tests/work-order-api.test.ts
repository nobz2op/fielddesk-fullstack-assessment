
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
  const dispatcherId = randomUUID();

  await pool.query(
    "INSERT INTO organizations (id, name) VALUES ($1, $2)",
    [organizationId, "HTTP API Test Organization"],
  );

  createdOrganizations.push(organizationId);

  for (const user of [
    { id: ownerId, role: "OWNER", name: "API Test Owner" },
    {
      id: dispatcherId,
      role: "DISPATCHER",
      name: "API Test Dispatcher",
    },
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
    dispatcherId,
    technicianId,
    ownerToken: createToken(ownerId, "OWNER"),
    dispatcherToken: createToken(dispatcherId, "DISPATCHER"),
    technicianToken: createToken(technicianId, "TECHNICIAN"),
  };
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
      Authorization: `Bearer ${fixture.ownerToken}`,
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

  it("returns HTTP 400 when a work-order ID is malformed", async () => {
    const fixture = await createFixture();

    const response = await request(app)
      .get("/api/work-orders/not-a-uuid")
      .set("Authorization", `Bearer ${fixture.ownerToken}`);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: "Invalid work order ID",
    });
  });

  it("returns HTTP 403 when a technician attempts to create a work order", async () => {
    const fixture = await createFixture();

    const response = await request(app)
      .post("/api/work-orders")
      .set("Authorization", `Bearer ${fixture.technicianToken}`)
      .send({
        title: "Technician-created work order",
        customerName: "Test Customer",
        serviceAddress: "123 Test Street",
      });

    expect(response.status).toBe(403);
  });

  it("returns HTTP 403 when a technician attempts to assign a work order", async () => {
    const fixture = await createFixture();

    const created = await request(app)
      .post("/api/work-orders")
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .send({
        title: "Assignment permission test",
        customerName: "Test Customer",
        serviceAddress: "123 Test Street",
      });

    expect(created.status).toBe(201);

    const response = await request(app)
      .patch(`/api/work-orders/${created.body.data.id}/assign`)
      .set("Authorization", `Bearer ${fixture.technicianToken}`)
      .send({ technicianId: fixture.technicianId });

    expect(response.status).toBe(403);
  });

  it("returns HTTP 403 when a dispatcher attempts to delete a work order", async () => {
    const fixture = await createFixture();

    const created = await request(app)
      .post("/api/work-orders")
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .send({
        title: "Deletion permission test",
        customerName: "Test Customer",
        serviceAddress: "123 Test Street",
      });

    expect(created.status).toBe(201);

    const response = await request(app)
      .delete(`/api/work-orders/${created.body.data.id}`)
      .set("Authorization", `Bearer ${fixture.dispatcherToken}`);

    expect(response.status).toBe(403);
  });

  it("allows an owner to remove a work order while retaining its audit history", async () => {
    const fixture = await createFixture();
    const created = await request(app)
      .post("/api/work-orders")
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .send({
        title: "Owner deletion test",
        customerName: "Test Customer",
        serviceAddress: "123 Test Street",
      });

    expect(created.status).toBe(201);
    const workOrderId = created.body.data.id as string;

    const deleted = await request(app)
      .delete(`/api/work-orders/${workOrderId}`)
      .set("Authorization", `Bearer ${fixture.ownerToken}`);

    expect(deleted.status).toBe(200);
    expect(deleted.body.message).toBe("Work order deleted successfully");

    const detail = await request(app)
      .get(`/api/work-orders/${workOrderId}`)
      .set("Authorization", `Bearer ${fixture.ownerToken}`);
    expect(detail.status).toBe(404);

    const list = await request(app)
      .get("/api/work-orders")
      .set("Authorization", `Bearer ${fixture.ownerToken}`);
    expect(list.body.data.map((item: { id: string }) => item.id))
      .not.toContain(workOrderId);

    const audit = await pool.query(
      `SELECT actor_user_id, action, details
       FROM work_order_activities
       WHERE organization_id = $1 AND work_order_id = $2
       ORDER BY created_at DESC`,
      [fixture.organizationId, workOrderId],
    );
    expect(audit.rows[0].actor_user_id).toBe(fixture.ownerId);
    expect(audit.rows[0].action).toBe("DELETED");
    expect(audit.rows[0].details).toMatchObject({ deletedAt: expect.any(String) });
  });

  it("allows an owner to create a work order", async () => {
    const fixture = await createFixture();

    const response = await request(app)
      .post("/api/work-orders")
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .send({
        title: "Owner-created work order",
        customerName: "Test Customer",
        serviceAddress: "123 Test Street",
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.title).toBe("Owner-created work order");
  });

  it("shows technicians only their assigned work orders", async () => {
    const fixture = await createFixture();

    const authOwner = {
      Authorization: `Bearer ${fixture.ownerToken}`,
    };

    // Create two work orders.
    const first = await request(app)
      .post("/api/work-orders")
      .set(authOwner)
      .send({
        title: "Technician One Work",
        customerName: "Customer One",
        serviceAddress: "123 Test Street",
      });

    const second = await request(app)
      .post("/api/work-orders")
      .set(authOwner)
      .send({
        title: "Technician Two Work",
        customerName: "Customer Two",
        serviceAddress: "456 Test Avenue",
      });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    // Assign the first work order to the fixture technician.
    const assignment = await request(app)
      .patch(`/api/work-orders/${first.body.data.id}/assign`)
      .set(authOwner)
      .send({ technicianId: fixture.technicianId });

    expect(assignment.status).toBe(200);

    // Request the list as that technician.
    const response = await request(app)
      .get("/api/work-orders")
      .set("Authorization", `Bearer ${fixture.technicianToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.map((order: { id: string }) => order.id))
      .toContain(first.body.data.id);
    expect(response.body.data.map((order: { id: string }) => order.id))
      .not.toContain(second.body.data.id);
  });

  it("lists active work orders for each role using the soft-delete schema and role scope", async () => {
    const fixture = await createFixture();
    const ownerAuth = { Authorization: `Bearer ${fixture.ownerToken}` };
    const dispatcherAuth = {
      Authorization: `Bearer ${fixture.dispatcherToken}`,
    };
    const technicianAuth = {
      Authorization: `Bearer ${fixture.technicianToken}`,
    };

    const assignedOrder = await request(app)
      .post("/api/work-orders")
      .set(ownerAuth)
      .send({
        title: "Active assigned order",
        customerName: "Active Customer",
        serviceAddress: "123 Active Street",
      });
    const removedOrder = await request(app)
      .post("/api/work-orders")
      .set(ownerAuth)
      .send({
        title: "Removed order",
        customerName: "Former Customer",
        serviceAddress: "456 Former Avenue",
      });

    expect(assignedOrder.status).toBe(201);
    expect(removedOrder.status).toBe(201);

    const assignment = await request(app)
      .patch(`/api/work-orders/${assignedOrder.body.data.id}/assign`)
      .set(ownerAuth)
      .send({ technicianId: fixture.technicianId });
    expect(assignment.status).toBe(200);

    const deletion = await request(app)
      .delete(`/api/work-orders/${removedOrder.body.data.id}`)
      .set(ownerAuth);
    expect(deletion.status).toBe(200);

    const [ownerList, dispatcherList, technicianList] = await Promise.all([
      request(app).get("/api/work-orders").set(ownerAuth),
      request(app).get("/api/work-orders").set(dispatcherAuth),
      request(app).get("/api/work-orders").set(technicianAuth),
    ]);

    expect(ownerList.status).toBe(200);
    expect(dispatcherList.status).toBe(200);
    expect(technicianList.status).toBe(200);
    expect(ownerList.body.data.map((item: { id: string }) => item.id))
      .toEqual([assignedOrder.body.data.id]);
    expect(dispatcherList.body.data.map((item: { id: string }) => item.id))
      .toEqual([assignedOrder.body.data.id]);
    expect(technicianList.body.data.map((item: { id: string }) => item.id))
      .toEqual([assignedOrder.body.data.id]);
  });

  it("returns 404 when a technician requests another technician's work order", async () => {
    const fixture = await createFixture();

    const created = await request(app)
      .post("/api/work-orders")
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .send({
        title: "Unassigned work order",
        customerName: "Test Customer",
        serviceAddress: "123 Test Street",
      });

    expect(created.status).toBe(201);

    const response = await request(app)
      .get(`/api/work-orders/${created.body.data.id}`)
      .set("Authorization", `Bearer ${fixture.technicianToken}`);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Work order not found");
  });

  it("returns 404 when a technician requests another technician's activity history", async () => {
    const fixture = await createFixture();

    const created = await request(app)
      .post("/api/work-orders")
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .send({
        title: "Private activity history",
        customerName: "Test Customer",
        serviceAddress: "456 Test Avenue",
      });

    expect(created.status).toBe(201);

    const response = await request(app)
      .get(`/api/work-orders/${created.body.data.id}/activities`)
      .set("Authorization", `Bearer ${fixture.technicianToken}`);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Work order not found");
  });

  it("allows a technician to update the status of their assigned work order", async () => {
    const fixture = await createFixture();

    const created = await request(app)
      .post("/api/work-orders")
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .send({
        title: "Technician status update test",
        customerName: "Test Customer",
        serviceAddress: "123 Test Street",
      });

    expect(created.status).toBe(201);

    const assignment = await request(app)
      .patch(`/api/work-orders/${created.body.data.id}/assign`)
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .send({ technicianId: fixture.technicianId });

    expect(assignment.status).toBe(200);

    const response = await request(app)
      .patch(`/api/work-orders/${created.body.data.id}`)
      .set("Authorization", `Bearer ${fixture.technicianToken}`)
      .send({ status: "IN_PROGRESS" });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("IN_PROGRESS");
  });

  it("rejects technician attempts to change customer details or priority", async () => {
    const fixture = await createFixture();

    const created = await request(app)
      .post("/api/work-orders")
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .send({
        title: "Technician restricted fields test",
        customerName: "Original Customer",
        serviceAddress: "123 Test Street",
      });

    expect(created.status).toBe(201);

    const assignment = await request(app)
      .patch(`/api/work-orders/${created.body.data.id}/assign`)
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .send({ technicianId: fixture.technicianId });

    expect(assignment.status).toBe(200);

    const response = await request(app)
      .patch(`/api/work-orders/${created.body.data.id}`)
      .set("Authorization", `Bearer ${fixture.technicianToken}`)
      .send({
        customerName: "Changed Customer",
        priority: "URGENT",
      });

    expect(response.status).toBe(400);
  });

  it("returns 404 when a technician tries to update an unassigned work order", async () => {
    const fixture = await createFixture();

    const created = await request(app)
      .post("/api/work-orders")
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .send({
        title: "Unassigned technician update test",
        customerName: "Test Customer",
        serviceAddress: "123 Test Street",
      });

    expect(created.status).toBe(201);

    const response = await request(app)
      .patch(`/api/work-orders/${created.body.data.id}`)
      .set("Authorization", `Bearer ${fixture.technicianToken}`)
      .send({ status: "IN_PROGRESS" });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Work order not found");
  });
});
