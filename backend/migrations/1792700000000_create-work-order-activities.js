exports.up = (pgm) => {
  pgm.createTable("work_order_activities", {
    id: {
      type: "uuid",
      primaryKey: true,
      notNull: true,
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
      references: '"work_orders"',
      onDelete: "RESTRICT",
    },
    actor_user_id: {
      type: "uuid",
      notNull: true,
      references: '"users"',
      onDelete: "RESTRICT",
    },
    action: {
      type: "varchar(50)",
      notNull: true,
    },
    details: {
      type: "jsonb",
      notNull: true,
      default: pgm.func("'{}'::jsonb"),
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.addConstraint(
    "work_order_activities",
    "work_order_activities_action_check",
    {
      check: "action IN ('CREATED', 'UPDATED', 'ASSIGNED', 'STATUS_CHANGED')",
    },
  );

  pgm.addConstraint(
    "work_order_activities",
    "work_order_activities_org_id_unique",
    {
      unique: ["organization_id", "id"],
    },
  );

  pgm.addConstraint(
    "work_order_activities",
    "work_order_activities_work_order_org_fk",
    {
      foreignKeys: {
        columns: ["organization_id", "work_order_id"],
        references: "work_orders(organization_id, id)",
        onDelete: "RESTRICT",
      },
    },
  );

  pgm.createIndex(
    "work_order_activities",
    ["organization_id", "work_order_id", "created_at"],
  );
};

exports.down = (pgm) => {
  pgm.dropTable("work_order_activities");
};
