# Calendar and service schedules

A confirmed service schedule creates dated visits before the previous visit is done. The worker keeps a 90-day window current and catches up from the last recorded date. A week or month outside that window can be read without creating visits. The database worker runs daily at 09:00 UTC and calls reconciliation directly.

Each booking UUID remains the saved visit's identity. `occurrence_on` is its current cadence slot. `original_occurrence_on` records its original date, falling back to `occurrence_on` for older rows. Several visits can share an original date after a series moves. Virtual visits use the agreement, revision, and cadence date together. A stale revision returns a conflict before an action can resolve the slot.

A single move changes the actual date. Moving the whole plan remaps eligible cadence slots, carrying individually moved and skipped visits with their saved actual dates and states. A collision with a protected visit stops the change. A schedule template price applies when the next new visit is created. Saved visit amounts and received payments stay attached to their booking IDs.

The first rollout starts generation on or after the Austin cutover date. Existing confirmed past visits stay overdue until staff records what happened. Existing monthly schedules keep their month-end clamp. A plan with no dated, identity-matched source or priced template remains available for staff review. Preferred-date requests wait for confirmation before generating future work.

Staff calendar range and attention reads use private server RPCs. Today and Next 7 Days read their date ranges directly. The customer portal uses its existing ownership policy to show the nearest upcoming visit and reads completed and pending visits separately.

Use `npm run check` in the isolated local worktree. The schedule tests cover annual and temporary periods, leap-month dates, cutover preservation, missed worker runs, series shifts, stale revisions, and access grants. The native database test checks the registered worker command. The planner's slice 2 replaces the Jobs list and uses the range and attention APIs.
