import "dotenv/config";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { pool } from "../config/database.js";

async function seed(): Promise<void> {
  const client = await pool.connect();

  try {
    const passwordHash = await bcrypt.hash("FieldDeskDemo!2026", 12);

    const organizations = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Northstar Maintenance",
        prefix: "northstar",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "BlueSky Services",
        prefix: "bluesky",
      },
    ];

    await client.query("BEGIN");

    for (const organization of organizations) {
      await client.query(
        `INSERT INTO organizations (id, name)
         VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING`,
        [organization.id, organization.name],
      );

      const users = [
        { name: `${organization.name} Owner`, role: "OWNER" },
        { name: `${organization.name} Dispatcher`, role: "DISPATCHER" },
        { name: `${organization.name} Technician`, role: "TECHNICIAN" },
      ];

      for (const user of users) {
        const email = `${organization.prefix}.${user.role.toLowerCase()}@example.com`;

        // Seed users are identified by organization and email.
        const existing = await client.query(
          `SELECT id FROM users
           WHERE organization_id = $1 AND email = $2`,
          [organization.id, email],
        );

        if (existing.rowCount && existing.rowCount > 0) {
          console.log(`Already exists: ${email}`);
          continue;
        }

        await client.query(
          `INSERT INTO users
             (id, organization_id, name, email, password_hash, role)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            randomUUID(),
            organization.id,
            user.name,
            email,
            passwordHash,
            user.role,
          ],
        );

        console.log(`Created: ${email} (${user.role})`);
      }
    }

    await client.query("COMMIT");
    console.log("FieldDesk seed completed successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((error: unknown) => {
  console.error("FieldDesk seed failed:", error);
  process.exitCode = 1;
});
