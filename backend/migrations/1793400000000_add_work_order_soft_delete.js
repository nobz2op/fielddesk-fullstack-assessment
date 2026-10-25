exports.up = (pgm) => {
  pgm.addColumn("work_orders", {
    deleted_at: {
      type: "timestamptz",
    },
  });

  pgm.dropConstraint(
    "work_order_activities",
    "work_order_activities_action_check",
  );
  pgm.addConstraint(
    "work_order_activities",
    "work_order_activities_action_check",
    {
      check:
        "action IN ('CREATED', 'UPDATED', 'ASSIGNED', 'STATUS_CHANGED', 'ATTACHMENT_ADDED', 'NOTE_ADDED', 'LOCATION_UPDATED', 'EVENT_SUBMITTED', 'DELETED')",
    },
  );
};

exports.down = (pgm) => {
  pgm.dropConstraint(
    "work_order_activities",
    "work_order_activities_action_check",
  );
  pgm.addConstraint(
    "work_order_activities",
    "work_order_activities_action_check",
    {
      check:
        "action IN ('CREATED', 'UPDATED', 'ASSIGNED', 'STATUS_CHANGED', 'ATTACHMENT_ADDED', 'NOTE_ADDED', 'LOCATION_UPDATED', 'EVENT_SUBMITTED')",
    },
  );
  pgm.dropColumn("work_orders", "deleted_at");
};
