exports.up = (pgm) => {
  pgm.createTable("attachments", {
    id: {
      type: "uuid",
      primaryKey: true,
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
    uploaded_by: {
      type: "uuid",
      notNull: true,
      references: '"users"',
      onDelete: "RESTRICT",
    },
    storage_identifier: {
      type: "varchar(255)",
      notNull: true,
      unique: true,
    },
    original_filename: {
      type: "varchar(255)",
      notNull: true,
    },
    file_type: {
      type: "varchar(50)",
      notNull: true,
    },
    file_size: {
      type: "bigint",
      notNull: true,
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // Ensure organization isolation
  pgm.addConstraint(
    "attachments",
    "attachments_org_id_unique",
    {
      unique: ["organization_id", "id"],
    },
  );

  pgm.addConstraint(
    "attachments",
    "attachments_work_order_org_fk",
    {
      foreignKeys: {
        columns: ["organization_id", "work_order_id"],
        references: "work_orders(organization_id, id)",
        onDelete: "RESTRICT",
      },
    },
  );

  pgm.addConstraint(
    "attachments",
    "attachments_uploaded_by_org_fk",
    {
      foreignKeys: {
        columns: ["organization_id", "uploaded_by"],
        references: "users(organization_id, id)",
        onDelete: "RESTRICT",
      },
    },
  );

  pgm.addConstraint(
    "attachments",
    "attachments_file_type_check",
    {
      check: "file_type IN ('image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf')",
    },
  );

  pgm.createIndex(
    "attachments",
    ["organization_id", "work_order_id", "created_at"],
  );

  pgm.createIndex(
    "attachments",
    ["storage_identifier"],
  );
};

exports.down = (pgm) => {
  pgm.dropTable("attachments");
};
