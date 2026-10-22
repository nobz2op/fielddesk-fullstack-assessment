
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});

export async function checkDatabaseConnection(): Promise<void> {
  const result = await pool.query("SELECT NOW() AS current_time");
  console.log("PostgreSQL connected:", result.rows[0].current_time);
}
