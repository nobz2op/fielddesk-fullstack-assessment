import { pool } from "../config/database.js";

export type UserRole = "OWNER" | "DISPATCHER" | "TECHNICIAN";

export interface User {
  id: string;
  organization_id: string;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateUserInput {
  id: string;
  organization_id: string;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
}

export async function findUserByEmail(
  organizationId: string,
  email: string,
): Promise<User | null> {
  const result = await pool.query<User>(
    `SELECT id, organization_id, name, email, password_hash,
            role, is_active, created_at, updated_at
     FROM users
     WHERE organization_id = $1 AND email = $2
     LIMIT 1`,
    [organizationId, email],
  );

  return result.rows[0] ?? null;
}

export async function createUser(
  input: CreateUserInput,
): Promise<User> {
  const result = await pool.query<User>(
    `INSERT INTO users
       (id, organization_id, name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, organization_id, name, email, password_hash,
               role, is_active, created_at, updated_at`,
    [
      input.id,
      input.organization_id,
      input.name,
      input.email,
      input.password_hash,
      input.role,
    ],
  );

  return result.rows[0];
}
