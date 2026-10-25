
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
import fs from "fs/promises";
import path from "path";

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
const uploadedStorageIdentifiers: string[] = [];

async function createWorkOrder(ownerToken: string, title: string) {
  const response = await request(app)
    .post("/api/work-orders")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({
      title,
      customerName: "Attachment Test Customer",
      serviceAddress: "123 Attachment Test Street",
    });

  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function createFixture() {
  const organizationId = randomUUID();
  const ownerId = randomUUID();
  const technicianId = randomUUID();

  await pool.query(
    "INSERT INTO organizations (id, name) VALUES ($1, $2)",
    [organizationId, "Attachment Test Organization"],
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

describe("Attachment API", () => {
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

    while (uploadedStorageIdentifiers.length > 0) {
      const identifier = uploadedStorageIdentifiers.pop()!;
      await fs.rm(path.join(process.cwd(), "uploads", identifier), {
        force: true,
      });
    }
  });

  afterAll(async () => {
    if (appPool) {
      await appPool.end();
    }

    await pool.end();
  });

  it("returns organization storage usage", async () => {
    const fixture = await createFixture();

    const response = await request(app)
      .get("/api/attachments/storage-usage")
      .set("Authorization", `Bearer ${fixture.ownerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveProperty("totalUsage");
    expect(response.body.data).toHaveProperty("totalFiles");
    expect(response.body.data).toHaveProperty("quota");
  });

  it("lists attachments for a work order", async () => {
    const fixture = await createFixture();

    const auth = {
      Authorization: `Bearer ${fixture.ownerToken}`,
    };

    const workOrder = await request(app)
      .post("/api/work-orders")
      .set(auth)
      .send({
        title: "List attachments test",
        customerName: "Test Customer",
        serviceAddress: "123 Test Street",
      });

    expect(workOrder.status).toBe(201);

    const response = await request(app)
      .get(`/api/attachments/work-order/${workOrder.body.data.id}`)
      .set("Authorization", `Bearer ${fixture.ownerToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it("uploads and downloads a valid PDF for an authorised work order", async () => {
    const fixture = await createFixture();
    const workOrderId = await createWorkOrder(
      fixture.ownerToken,
      "PDF attachment workflow",
    );
    const pdf = Buffer.from("%PDF-1.4\nassessment test file\n%%EOF\n");

    const upload = await request(app)
      .post(`/api/attachments/work-order/${workOrderId}`)
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .attach("file", pdf, {
        filename: "assessment.pdf",
        contentType: "application/pdf",
      });

    expect(upload.status).toBe(201);
    expect(upload.body.data.storage_identifier).toMatch(/^[0-9a-f-]{36}$/i);
    expect(upload.body.data.original_filename).toBe("assessment.pdf");
    uploadedStorageIdentifiers.push(upload.body.data.storage_identifier);

    const listed = await request(app)
      .get(`/api/attachments/work-order/${workOrderId}`)
      .set("Authorization", `Bearer ${fixture.ownerToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);

    const download = await request(app)
      .get(`/api/attachments/${upload.body.data.id}/download`)
      .set("Authorization", `Bearer ${fixture.ownerToken}`);
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toContain("application/pdf");
    expect(download.headers["content-disposition"]).toContain("assessment.pdf");
  });

  it("rejects a PDF MIME type when the file signature is not a PDF", async () => {
    const fixture = await createFixture();
    const workOrderId = await createWorkOrder(
      fixture.ownerToken,
      "Invalid PDF attachment",
    );

    const response = await request(app)
      .post(`/api/attachments/work-order/${workOrderId}`)
      .set("Authorization", `Bearer ${fixture.ownerToken}`)
      .attach("file", Buffer.from("not a PDF"), {
        filename: "fake.pdf",
        contentType: "application/pdf",
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/content does not match/i);
  });

  it("prevents a different organisation from downloading an attachment", async () => {
    const owner = await createFixture();
    const other = await createFixture();
    const workOrderId = await createWorkOrder(
      owner.ownerToken,
      "Tenant private attachment",
    );
    const upload = await request(app)
      .post(`/api/attachments/work-order/${workOrderId}`)
      .set("Authorization", `Bearer ${owner.ownerToken}`)
      .attach("file", Buffer.from("%PDF-1.4\nprivate\n%%EOF\n"), {
        filename: "private.pdf",
        contentType: "application/pdf",
      });

    expect(upload.status).toBe(201);
    uploadedStorageIdentifiers.push(upload.body.data.storage_identifier);

    const download = await request(app)
      .get(`/api/attachments/${upload.body.data.id}/download`)
      .set("Authorization", `Bearer ${other.ownerToken}`);

    expect(download.status).toBe(404);
  });

  it("enforces the organisation storage quota", async () => {
    const fixture = await createFixture();
    const workOrderId = await createWorkOrder(
      fixture.ownerToken,
      "Quota-limited attachment",
    );
    const previousQuota = process.env.ATTACHMENT_ORG_QUOTA_BYTES;
    process.env.ATTACHMENT_ORG_QUOTA_BYTES = "1";

    try {
      const response = await request(app)
        .post(`/api/attachments/work-order/${workOrderId}`)
        .set("Authorization", `Bearer ${fixture.ownerToken}`)
        .attach("file", Buffer.from("%PDF-1.4\nquota\n%%EOF\n"), {
          filename: "quota.pdf",
          contentType: "application/pdf",
        });

      expect(response.status).toBe(409);
      expect(response.body.message).toMatch(/quota exceeded/i);
    } finally {
      if (previousQuota === undefined) {
        delete process.env.ATTACHMENT_ORG_QUOTA_BYTES;
      } else {
        process.env.ATTACHMENT_ORG_QUOTA_BYTES = previousQuota;
      }
    }
  });

  it("does not allow a technician to upload to an unassigned work order", async () => {
    const fixture = await createFixture();
    const workOrderId = await createWorkOrder(
      fixture.ownerToken,
      "Unassigned attachment target",
    );

    const response = await request(app)
      .post(`/api/attachments/work-order/${workOrderId}`)
      .set("Authorization", `Bearer ${fixture.technicianToken}`)
      .attach("file", Buffer.from("%PDF-1.4\nunauthorized\n%%EOF\n"), {
        filename: "unauthorized.pdf",
        contentType: "application/pdf",
      });

    expect(response.status).toBe(404);
  });
});
