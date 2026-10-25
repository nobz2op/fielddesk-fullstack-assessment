exports.up = (pgm) => {
  pgm.addColumn("notification_deliveries", {
    actor_type: {
      type: "varchar(20)",
      notNull: true,
      default: "SYSTEM",
    },
    action: {
      type: "varchar(40)",
      notNull: true,
      default: "NOTIFICATION_OUTCOME",
    },
  });
  pgm.addConstraint("notification_deliveries", "notification_deliveries_actor_type_check", {
    check: "actor_type = 'SYSTEM'",
  });
  pgm.addConstraint("notification_deliveries", "notification_deliveries_action_check", {
    check: "action = 'NOTIFICATION_OUTCOME'",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("notification_deliveries", "notification_deliveries_action_check");
  pgm.dropConstraint("notification_deliveries", "notification_deliveries_actor_type_check");
  pgm.dropColumn("notification_deliveries", ["action", "actor_type"]);
};
