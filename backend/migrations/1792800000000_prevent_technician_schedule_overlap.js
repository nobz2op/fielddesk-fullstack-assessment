export const up = (pgm) => {
  // Enables GiST indexes to compare UUID technician IDs.
  pgm.sql("CREATE EXTENSION IF NOT EXISTS btree_gist");

  // Reject overlapping scheduled intervals for the same technician.
  // PostgreSQL checks this constraint even for concurrent transactions.
  pgm.sql(`
    ALTER TABLE work_orders
    ADD CONSTRAINT work_orders_no_technician_schedule_overlap
    EXCLUDE USING gist (
      assigned_technician_id WITH =,
      tstzrange(scheduled_start, scheduled_end, '[)') WITH &&
    )
    WHERE (
      assigned_technician_id IS NOT NULL
      AND scheduled_start IS NOT NULL
      AND scheduled_end IS NOT NULL
      AND status NOT IN ('COMPLETED', 'CANCELLED')
    )
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE work_orders
    DROP CONSTRAINT IF EXISTS
      work_orders_no_technician_schedule_overlap
  `);
};
