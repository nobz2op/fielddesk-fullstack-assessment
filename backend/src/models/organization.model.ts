import { pool } from "../config/database.js";

export interface Organization {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export async function findOrganizationById(
  organizationId: string,
): Promise<Organization | null> {
  const result = await pool.query<Organization>(
    `SELECT id, name, created_at, updated_at
     FROM organizations
     WHERE id = $1
     LIMIT 1`,
    [organizationId],
  );

  return result.rows[0] ?? null;
}

export async function createOrganization(
  id: string,
  name: string,
): Promise<Organization> {
  const result = await pool.query<Organization>(
    `INSERT INTO organizations (id, name)
     VALUES ($1, $2)
     RETURNING id, name, created_at, updated_at`,
    [id, name],
  );

  return result.rows[0];
}
