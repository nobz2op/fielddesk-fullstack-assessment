
import "dotenv/config";
import app from "./app.js";
import {
  checkDatabaseConnection,
  pool,
} from "./config/database.js";
import { closeRealtimeStreams } from "./routes/realtime.routes.js";

const PORT = Number(process.env.PORT) || 5000;

async function startServer(): Promise<void> {
  try {
    await checkDatabaseConnection();

    const server = app.listen(PORT, () => {
      console.log(`FieldDesk API listening on http://localhost:${PORT}`);
    });

    function shutdown(signal: string): void {
      console.log(`${signal} received. Shutting down server...`);
      closeRealtimeStreams();

      server.close(async (error) => {
        try {
          await pool.end();

          if (error) {
            console.error("HTTP server shutdown failed:", error);
            process.exitCode = 1;
          }
        } catch (shutdownError) {
          console.error("Database pool shutdown failed:", shutdownError);
          process.exitCode = 1;
        }
      });
    }

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    console.error("Failed to start FieldDesk API:", error);
    await pool.end();
    process.exitCode = 1;
  }
}

void startServer();
