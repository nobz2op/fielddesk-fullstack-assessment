exports.up = (pgm) => {
  pgm.createTable("notification_deliveries", {
    id: {
      type: "uuid",
      primaryKey: true,
    },
    job_id: {
      type: "varchar(255)",
      notNull: true,
      unique: true,
    },
    organization_id: {
      type: "uuid",
      notNull: true,
      references: '"organizations"',
      onDelete: "RESTRICT",
    },
    work_order_id: {
      type: "uuid",
      notNull: true,
    },
    technician_id: {
      type: "uuid",
      notNull: true,
    },
    status: {
      type: "varchar(20)",
      notNull: true,
    },
    attempt_count: {
      type: "integer",
      notNull: true,
    },
    attempt_history: {
      type: "jsonb",
      notNull: true,
      default: pgm.func("'[]'::jsonb"),
    },
    last_error: {
      type: "text",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    completed_at: {
      type: "timestamptz",
    },
  });

  pgm.addConstraint("notification_deliveries", "notification_deliveries_status_check", {
    check: "status IN ('RETRYING', 'DELIVERED', 'FAILED')",
  });
  pgm.addConstraint("notification_deliveries", "notification_deliveries_attempt_count_check", {
    check: "attempt_count > 0",
  });
  pgm.addConstraint("notification_deliveries", "notification_deliveries_work_order_org_fk", {
    foreignKeys: {
      columns: ["organization_id", "work_order_id"],
      references: "work_orders(organization_id, id)",
      onDelete: "RESTRICT",
    },
  });
  pgm.addConstraint("notification_deliveries", "notification_deliveries_technician_org_fk", {
    foreignKeys: {
      columns: ["organization_id", "technician_id"],
      references: "users(organization_id, id)",
      onDelete: "RESTRICT",
    },
  });
  pgm.createIndex("notification_deliveries", ["organization_id", "created_at"]);
  pgm.createIndex("notification_deliveries", ["organization_id", "work_order_id", "created_at"]);
};

exports.down = (pgm) => {
  pgm.dropTable("notification_deliveries");
};
