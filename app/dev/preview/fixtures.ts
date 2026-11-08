// DEV-ONLY fixture data for /dev/preview. Never imported by production routes.
import { addDays, format } from "date-fns";
import type { Id, TableNames } from "@/convex/_generated/dataModel";
import type { AutomationEvent } from "@/components/loans/automation-timeline";
import type {
  AdminLoan,
  AdminTool,
  AdminUser,
  AuditRow,
  WorkflowErrorRow,
} from "@/components/admin/panels";
import type { IncomingLoan } from "@/components/loans/incoming-loans";
import type { MyRequest } from "@/components/loans/my-requests";
import type { BoardTool } from "@/components/tools/tool-card";

const id = <T extends TableNames>(s: string) => s as unknown as Id<T>;
const day = (offset: number) => format(addDays(new Date(), offset), "yyyy-MM-dd");
const ago = (minutes: number) => Date.now() - minutes * 60_000;
const MIN = { hour: 60, day: 24 * 60 };

export const boardTools: BoardTool[] = [
  {
    _id: id("t1"),
    name: "Cordless drill 18V",
    category: "power_tools",
    condition: "good",
    description: "Two batteries and a charger. Great for furniture and shelves.",
    ownerName: "Maria Alvarez",
    ownerTrustedLender: true,
    isMine: false,
    availability: "available",
  },
  {
    _id: id("t2"),
    name: "Extension ladder (3 m)",
    category: "hand_tools",
    condition: "fair",
    description: "Sturdy aluminium ladder. Bring a strap, it is longer than it looks.",
    ownerName: "Jonas Weber",
    ownerTrustedLender: false,
    isMine: false,
    availability: "on_loan",
  },
  {
    _id: id("t3"),
    name: "Lawn aerator with a very long name that needs to wrap nicely on small screens",
    category: "garden",
    condition: "like_new",
    description: "",
    ownerName: "You",
    ownerTrustedLender: true,
    isMine: true,
    availability: "available",
  },
  {
    _id: id("t4"),
    name: "Two-person tent",
    category: "camping",
    condition: "worn",
    description: "Packs small. A little worn but dry.",
    ownerName: "Priya Nair",
    ownerTrustedLender: false,
    isMine: false,
    availability: "available",
  },
];

export const myRequests: MyRequest[] = [
  {
    _id: id("l1"),
    toolName: "Cordless drill 18V",
    toolCategory: "power_tools",
    ownerName: "Maria Alvarez",
    startDate: day(1),
    endDate: day(3),
    status: "pending",
    displayStatus: "pending",
    createdAt: ago(3),
  },
  {
    _id: id("l2"),
    toolName: "Extension ladder (3 m)",
    toolCategory: "hand_tools",
    ownerName: "Jonas Weber",
    startDate: day(-2),
    endDate: day(2),
    status: "approved",
    displayStatus: "active",
    createdAt: ago(2 * MIN.day),
  },
  {
    _id: id("l3"),
    toolName: "Pressure washer",
    toolCategory: "cleaning",
    ownerName: "Sam Okafor",
    startDate: day(-9),
    endDate: day(-6),
    status: "approved",
    displayStatus: "overdue",
    createdAt: ago(10 * MIN.day),
  },
  {
    _id: id("l4"),
    toolName: "Two-person tent",
    toolCategory: "camping",
    ownerName: "Priya Nair",
    startDate: day(-20),
    endDate: day(-18),
    status: "returned",
    displayStatus: "returned",
    createdAt: ago(22 * MIN.day),
  },
  {
    _id: id("l5"),
    toolName: "Stand mixer",
    toolCategory: "kitchen",
    ownerName: "Jonas Weber",
    startDate: day(5),
    endDate: day(6),
    status: "declined",
    displayStatus: "declined",
    createdAt: ago(4 * MIN.day),
  },
  {
    _id: id("l6"),
    toolName: "Hedge trimmer",
    toolCategory: "garden",
    ownerName: "Maria Alvarez",
    startDate: day(7),
    endDate: day(8),
    status: "cancelled",
    displayStatus: "cancelled",
    createdAt: ago(5 * MIN.day),
  },
];

const ev = (
  type: AutomationEvent["type"],
  status: AutomationEvent["status"],
  attempts: number,
  minutesAgo: number,
): AutomationEvent => ({ type, status, attempts, createdAt: ago(minutesAgo), updatedAt: ago(minutesAgo) });

/** Timelines keyed by loan id, covering every sentence variant. */
export const automationByLoan: Record<string, AutomationEvent[]> = {
  l1: [ev("request_created", "delivered", 1, 2)],
  l2: [
    ev("request_approved", "delivered", 1, MIN.day * 2),
    ev("request_created", "delivered", 1, MIN.day * 2 + 30),
  ],
  l3: [
    ev("overdue_reminder", "delivered", 1, MIN.day * 2),
    ev("overdue_reminder", "delivered", 1, MIN.day * 3),
    ev("request_approved", "failed", 5, MIN.day * 9),
    ev("request_created", "pending", 2, MIN.day * 10),
  ],
  l4: [ev("loan_returned", "delivered", 1, MIN.day * 18), ev("workflow_error", "failed", 0, MIN.day * 18 + 5)],
  l5: [ev("request_declined", "duplicate", 1, MIN.day * 4)],
};

const incoming = (
  n: string,
  toolName: string,
  borrowerName: string,
  trusted: boolean,
  start: number,
  end: number,
  status: IncomingLoan["status"],
  displayStatus: IncomingLoan["displayStatus"],
): IncomingLoan => ({
  _id: id(n),
  toolName,
  borrowerName,
  borrowerTrustedLender: trusted,
  startDate: day(start),
  endDate: day(end),
  status,
  displayStatus,
  createdAt: ago(MIN.day),
});

export const incomingLoans: IncomingLoan[] = [
  incoming("l1", "Cordless drill 18V", "Alex Chen", true, 1, 3, "pending", "pending"),
  incoming("l5", "Pressure washer", "Dana Whitfield", false, 4, 5, "pending", "pending"),
  incoming("l3", "Pressure washer", "Sam Okafor", false, -9, -6, "approved", "overdue"),
  incoming("l2", "Extension ladder (3 m)", "Priya Nair", false, -2, 2, "approved", "active"),
  incoming("l4", "Two-person tent", "Jonas Weber", true, -20, -18, "returned", "returned"),
  incoming("l6", "Hedge trimmer", "Maria Alvarez", false, 7, 8, "declined", "declined"),
];

const user = (
  n: string,
  name: string,
  role: AdminUser["role"],
  trustedLender: boolean,
  activeToolCount: number,
  daysAgo: number,
): AdminUser => ({ _id: id(n), name, role, trustedLender, activeToolCount, createdAt: ago(daysAgo * MIN.day) });

export const ME_ID = id<"users">("u1");

export const adminUsers: AdminUser[] = [
  user("u1", "Robin Hale", "admin", true, 2, 120),
  user("u2", "Maria Alvarez", "user", true, 5, 90),
  user("u3", "Jonas Weber", "user", false, 1, 40),
  user("u4", "Priya Nair", "user", false, 0, 3),
];

export const adminTools: AdminTool[] = [
  { _id: id("t1"), name: "Cordless drill 18V", category: "power_tools", status: "active", ownerName: "Maria Alvarez", createdAt: ago(30 * MIN.day) },
  { _id: id("t2"), name: "Extension ladder (3 m)", category: "hand_tools", status: "active", ownerName: "Jonas Weber", createdAt: ago(12 * MIN.day) },
  { _id: id("t7"), name: "Suspicious listing", category: "other", status: "removed", ownerName: "Priya Nair", createdAt: ago(8 * MIN.day), removedAt: ago(2 * MIN.day) },
];

export const adminLoans: AdminLoan[] = [
  { _id: id("l1"), toolName: "Cordless drill 18V", ownerName: "Maria Alvarez", borrowerName: "Alex Chen", startDate: day(1), endDate: day(3), status: "pending", displayStatus: "pending", createdAt: ago(3) },
  { _id: id("l3"), toolName: "Pressure washer", ownerName: "Sam Okafor", borrowerName: "Robin Hale", startDate: day(-9), endDate: day(-6), status: "approved", displayStatus: "overdue", createdAt: ago(10 * MIN.day) },
  { _id: id("l4"), toolName: "Two-person tent", ownerName: "Priya Nair", borrowerName: "Jonas Weber", startDate: day(-20), endDate: day(-18), status: "returned", displayStatus: "returned", createdAt: ago(22 * MIN.day) },
];

export const auditRows: AuditRow[] = [
  { _id: id("a1"), createdAt: ago(40), actorLabel: "admin", actorName: "Robin Hale", action: "tool.remove", targetType: "tool", targetLabel: "Suspicious listing", reason: "Not a tool: it was an advertisement for a paid service." },
  { _id: id("a2"), createdAt: ago(MIN.day), actorLabel: "admin", actorName: "Robin Hale", action: "user.trusted.grant", targetType: "user", targetLabel: "Maria Alvarez", reason: "Lent 20 tools without a single issue." },
  { _id: id("a3"), createdAt: ago(3 * MIN.day), actorLabel: "system:cli", action: "user.role.promote", targetType: "user", targetLabel: "Robin Hale" },
];

export const workflowErrors: WorkflowErrorRow[] = [
  { _id: id("e1"), createdAt: ago(25), workflowName: "LendLoop: loan notifications", executionId: "1042", nodeName: "Send email", message: "Error: connect ETIMEDOUT smtp.example.test:587 (the SMTP server did not answer within 10 seconds, so the workflow stopped)" },
  { _id: id("e2"), createdAt: ago(2 * MIN.day), workflowName: "LendLoop: overdue reminders", executionId: "1007", message: "Request failed with status code 401" },
];
