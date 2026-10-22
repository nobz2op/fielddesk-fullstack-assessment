
/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Create the work_orders table.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const up = (pgm) => {
  pgm.createTable("work_orders", {
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
    title: {
      type: "varchar(200)",
      notNull: true,
    },
    description: {
      type: "text",
    },
    customer_name: {
      type: "varchar(150)",
      notNull: true,
    },
    customer_email: {
      type: "varchar(255)",
    },
    customer_phone: {
      type: "varchar(30)",
    },
    service_address: {
      type: "text",
      notNull: true,
    },
    assigned_technician_id: {
      type: "uuid",
    },
    priority: {
      type: "varchar(20)",
      notNull: true,
      default: "MEDIUM",
    },
    status: {
      type: "varchar(30)",
      notNull: true,
      default: "OPEN",
    },
    scheduled_start: {
      type: "timestamptz",
    },
    scheduled_end: {
      type: "timestamptz",
    },
    created_by: {
      type: "uuid",
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

  pgm.addConstraint("work_orders", "work_orders_priority_check", {
    check: "priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')",
  });

  pgm.addConstraint("work_orders", "work_orders_status_check", {
    check: "status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')",
  });

  pgm.addConstraint("work_orders", "work_orders_schedule_check", {
    check: "scheduled_end IS NULL OR scheduled_start IS NULL OR scheduled_end > scheduled_start",
  });

  // Ensure assigned technicians belong to the same organization.
  pgm.addConstraint("work_orders", "work_orders_org_id_id_unique", {
    unique: ["organization_id", "id"],
  });

  pgm.addConstraint("work_orders", "work_orders_technician_same_org_fk", {
    foreignKeys: {
      columns: ["organization_id", "assigned_technician_id"],
      references: "users(organization_id, id)",
    },
  });

  // Ensure the creator belongs to the same organization.
  pgm.addConstraint("work_orders", "work_orders_creator_same_org_fk", {
    foreignKeys: {
      columns: ["organization_id", "created_by"],
      references: "users(organization_id, id)",
    },
  });

  pgm.createIndex("work_orders", ["organization_id", "status"], {
    name: "idx_work_orders_org_status",
  });

  pgm.createIndex("work_orders", ["organization_id", "priority"], {
    name: "idx_work_orders_org_priority",
  });

  pgm.createIndex("work_orders", ["organization_id", "scheduled_start"], {
    name: "idx_work_orders_org_schedule",
  });

  pgm.createIndex("work_orders", ["organization_id", "assigned_technician_id"], {
    name: "idx_work_orders_org_technician",
  });
};

/**
 * Roll back the work_orders table.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const down = (pgm) => {
  pgm.dropTable("work_orders");
};
