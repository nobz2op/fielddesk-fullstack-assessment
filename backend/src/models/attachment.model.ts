import { randomUUID } from "node:crypto";
import { pool } from "../config/database.js";

export type AttachmentFileType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"
  | "application/pdf";

const ALLOWED_FILE_TYPES: AttachmentFileType[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_ORG_QUOTA = 100 * 1024 * 1024; // 100MB

function getOrganizationQuota(): number {
  const configuredQuota = process.env.ATTACHMENT_ORG_QUOTA_BYTES;
  if (configuredQuota === undefined) return DEFAULT_ORG_QUOTA;

  const quota = Number(configuredQuota);
  if (!Number.isSafeInteger(quota) || quota <= 0) {
    throw new Error("ATTACHMENT_ORG_QUOTA_BYTES must be a positive safe integer");
  }
  return quota;
}

export interface CreateAttachmentInput {
  organizationId: string;
  workOrderId: string;
  uploadedBy: string;
  storageIdentifier: string;
  originalFilename: string;
  fileType: AttachmentFileType;
  fileSize: number;
}

export async function createAttachment(input: CreateAttachmentInput) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const organizationResult = await client.query(
      `SELECT id
       FROM organizations
       WHERE id = $1
       FOR UPDATE`,
      [input.organizationId],
    );

    if (organizationResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return { notFound: true as const };
    }

    // Verify the work order exists and belongs to the organization
    const workOrderResult = await client.query(
      `SELECT wo.id
       FROM work_orders wo
       WHERE wo.id = $1
         AND wo.organization_id = $2
         AND wo.deleted_at IS NULL
       FOR UPDATE`,
      [input.workOrderId, input.organizationId],
    );

    if (workOrderResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return { notFound: true as const };
    }

    // Check organization storage quota
    const quotaResult = await client.query(
      `SELECT COALESCE(SUM(file_size), 0)::bigint AS current_usage
       FROM attachments
       WHERE organization_id = $1`,
      [input.organizationId],
    );

    const currentUsage = Number(quotaResult.rows[0].current_usage);
    const newUsage = currentUsage + input.fileSize;
    const quota = getOrganizationQuota();

    if (newUsage > quota) {
      await client.query("ROLLBACK");
      return { quotaExceeded: true as const, currentUsage, quota };
    }

    // Create the attachment record
    const result = await client.query(
      `INSERT INTO attachments (
        id, organization_id, work_order_id, uploaded_by,
        storage_identifier, original_filename, file_type, file_size
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        randomUUID(),
        input.organizationId,
        input.workOrderId,
        input.uploadedBy,
        input.storageIdentifier,
        input.originalFilename,
        input.fileType,
        input.fileSize,
      ],
    );

    // Record activity
    await client.query(
      `INSERT INTO work_order_activities (
        id, organization_id, work_order_id,
        actor_user_id, action, details
      )
      VALUES ($1, $2, $3, $4, 'ATTACHMENT_ADDED', $5)`,
      [
        randomUUID(),
        input.organizationId,
        input.workOrderId,
        input.uploadedBy,
        JSON.stringify({
          attachmentId: result.rows[0].id,
          filename: input.originalFilename,
          fileSize: input.fileSize,
        }),
      ],
    );

    await client.query("COMMIT");

    return { success: true as const, attachment: result.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getAttachmentById(
  attachmentId: string,
  organizationId: string,
) {
  const result = await pool.query(
    `SELECT *
     FROM attachments
     WHERE id = $1
       AND organization_id = $2`,
    [attachmentId, organizationId],
  );

  return result.rows[0] ?? null;
}

export async function listAttachmentsByWorkOrder(
  workOrderId: string,
  organizationId: string,
) {
  const result = await pool.query(
    `SELECT *
     FROM attachments
     WHERE work_order_id = $1
       AND organization_id = $2
     ORDER BY created_at DESC`,
    [workOrderId, organizationId],
  );

  return result.rows;
}

export async function getOrganizationStorageUsage(
  organizationId: string,
) {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(file_size), 0)::bigint AS total_usage,
       COUNT(*)::int AS total_files
     FROM attachments
     WHERE organization_id = $1`,
    [organizationId],
  );

  return {
    totalUsage: Number(result.rows[0].total_usage),
    totalFiles: result.rows[0].total_files,
    quota: getOrganizationQuota(),
  };
}

export function validateFileType(fileType: string): fileType is AttachmentFileType {
  return ALLOWED_FILE_TYPES.includes(fileType as AttachmentFileType);
}

export function detectAttachmentFileType(
  file: Buffer,
): AttachmentFileType | null {
  if (
    file.length >= 5 &&
    file.subarray(0, 5).toString("ascii") === "%PDF-"
  ) {
    return "application/pdf";
  }

  if (
    file.length >= 8 &&
    file.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "image/png";
  }

  if (
    file.length >= 3 &&
    file[0] === 0xff &&
    file[1] === 0xd8 &&
    file[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    file.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(file.subarray(0, 6).toString("ascii"))
  ) {
    return "image/gif";
  }

  if (
    file.length >= 12 &&
    file.subarray(0, 4).toString("ascii") === "RIFF" &&
    file.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

export function validateFileSize(fileSize: number): boolean {
  return fileSize > 0 && fileSize <= MAX_FILE_SIZE;
}

export function generateStorageIdentifier(): string {
  return randomUUID();
}
