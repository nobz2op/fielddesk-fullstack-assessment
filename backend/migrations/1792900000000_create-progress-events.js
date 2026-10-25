exports.up = (pgm) => {
  pgm.createTable("progress_events", {
    id: {
      type: "uuid",
      primaryKey: true,
    },
    event_id: {
      type: "varchar(100)",
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
    submitted_by: {
      type: "uuid",
      notNull: true,
      references: '"users"',
      onDelete: "RESTRICT",
    },
    event_type: {
      type: "varchar(50)",
      notNull: true,
    },
    occurred_at: {
      type: "timestamptz",
      notNull: true,
    },
    payload: {
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

  // Ensure event_id is unique per work order for idempotency
  pgm.addConstraint(
    "progress_events",
    "progress_events_work_order_event_id_unique",
    {
      unique: ["work_order_id", "event_id"],
    },
  );

  // Ensure organization isolation
  pgm.addConstraint(
    "progress_events",
    "progress_events_org_id_unique",
    {
      unique: ["organization_id", "id"],
    },
  );

  pgm.addConstraint(
    "progress_events",
    "progress_events_work_order_org_fk",
    {
      foreignKeys: {
        columns: ["organization_id", "work_order_id"],
        references: "work_orders(organization_id, id)",
        onDelete: "RESTRICT",
      },
    },
  );

  pgm.addConstraint(
    "progress_events",
    "progress_events_submitted_by_org_fk",
    {
      foreignKeys: {
        columns: ["organization_id", "submitted_by"],
        references: "users(organization_id, id)",
        onDelete: "RESTRICT",
      },
    },
  );

  pgm.addConstraint(
    "progress_events",
    "progress_events_event_type_check",
    {
      check: "event_type IN ('status_changed', 'note_added', 'location_updated', 'custom')",
    },
  );

  pgm.createIndex(
    "progress_events",
    ["organization_id", "work_order_id", "created_at"],
  );
};

exports.down = (pgm) => {
  pgm.dropTable("progress_events");
};
