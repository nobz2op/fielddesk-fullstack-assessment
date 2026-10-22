
import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("organizations", {
    id: {
      type: "uuid",
      primaryKey: true,
    },
    name: {
      type: "varchar(150)",
      notNull: true,
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createTable("users", {
    id: {
      type: "uuid",
      primaryKey: true,
    },
    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "RESTRICT",
    },
    name: {
      type: "varchar(150)",
      notNull: true,
    },
    email: {
      type: "varchar(255)",
      notNull: true,
    },
    password_hash: {
      type: "text",
      notNull: true,
    },
    role: {
      type: "varchar(20)",
      notNull: true,
    },
    is_active: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.addConstraint("users", "users_role_check", {
    check: "role IN ('OWNER', 'DISPATCHER', 'TECHNICIAN')",
  });

  pgm.addConstraint("users", "users_org_email_unique", {
    unique: ["organization_id", "email"],
  });

  pgm.addConstraint("users", "users_org_id_unique", {
    unique: ["organization_id", "id"],
  });

  pgm.createIndex("users", ["organization_id", "role"], {
    name: "idx_users_organization_role",
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("users");
  pgm.dropTable("organizations");
}
