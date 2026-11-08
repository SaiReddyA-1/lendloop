import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Outbox safety net: re-drive events stuck in `pending` (see maintenance.sweepStuckEvents).
crons.interval("sweep stuck automation events", { minutes: 10 }, internal.maintenance.sweepStuckEvents, {});

export default crons;
