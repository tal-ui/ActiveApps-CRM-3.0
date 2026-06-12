import {
  Building2,
  Users,
  Target,
  TrendingUp,
  FolderKanban,
  CheckSquare,
  Clock,
  FileText,
  Package,
  Flag,
  ListOrdered,
  type LucideIcon,
} from "lucide-react";

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "currency"
  | "picklist"
  | "date"
  | "boolean"
  | "lookup"
  | "url"
  | "email"
  | "phone";

export interface PicklistOption {
  value: string;
  label: string;
}

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: PicklistOption[];
  lookup?: string; // target object name
  section: string;
  showInList?: boolean;
  hidden?: boolean; // never shown in forms or detail
  defaultValue?: string | number | boolean;
}

export interface RelatedListDef {
  object: string;
  foreignKey: string;
  title?: string;
  columns: string[];
}

export interface ObjectDef {
  name: string; // table name
  singular: string;
  plural: string;
  icon: LucideIcon;
  titleFields: string[]; // joined with space for record title
  highlightFields: string[]; // shown in the highlights panel
  fields: FieldDef[];
  searchFields: string[];
  relatedLists?: RelatedListDef[];
  activityType?: string; // related_to_type value if activities supported
  inNav?: boolean;
  ownerFields?: string[]; // auto-filled with current profile id on create
}

const opts = (...vals: string[]): PicklistOption[] =>
  vals.map((v) => ({
    value: v,
    label: v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  }));

export const OBJECTS: Record<string, ObjectDef> = {
  leads: {
    name: "leads",
    singular: "Lead",
    plural: "Leads",
    icon: Target,
    titleFields: ["first_name", "last_name"],
    highlightFields: ["company", "status", "rating", "source"],
    searchFields: ["first_name", "last_name", "company", "email"],
    activityType: "lead",
    inNav: true,
    ownerFields: ["owner_id", "created_by_id"],
    fields: [
      { name: "first_name", label: "First Name", type: "text", section: "Lead Information", showInList: true },
      { name: "last_name", label: "Last Name", type: "text", required: true, section: "Lead Information", showInList: true },
      { name: "company", label: "Company", type: "text", section: "Lead Information", showInList: true },
      { name: "title", label: "Title", type: "text", section: "Lead Information" },
      { name: "email", label: "Email", type: "email", section: "Contact Details", showInList: true },
      { name: "phone", label: "Phone", type: "phone", section: "Contact Details" },
      { name: "source", label: "Source", type: "picklist", section: "Qualification", options: opts("website", "referral", "linkedin", "conference", "cold_outreach", "partner", "other"), showInList: true },
      { name: "status", label: "Status", type: "picklist", required: true, defaultValue: "new", section: "Qualification", options: opts("new", "contacted", "qualified", "unqualified", "converted"), showInList: true },
      { name: "rating", label: "Rating", type: "picklist", section: "Qualification", options: opts("hot", "warm", "cold") },
      { name: "description", label: "Description", type: "textarea", section: "Notes" },
    ],
  },

  accounts: {
    name: "accounts",
    singular: "Account",
    plural: "Accounts",
    icon: Building2,
    titleFields: ["name"],
    highlightFields: ["type", "status", "industry", "website"],
    searchFields: ["name", "industry", "city", "email"],
    activityType: "account",
    inNav: true,
    ownerFields: ["owner_id", "created_by_id"],
    fields: [
      { name: "name", label: "Account Name", type: "text", required: true, section: "Account Information", showInList: true },
      { name: "type", label: "Type", type: "picklist", required: true, defaultValue: "prospect", section: "Account Information", options: opts("prospect", "customer", "partner", "vendor", "other"), showInList: true },
      { name: "status", label: "Status", type: "picklist", required: true, defaultValue: "active", section: "Account Information", options: opts("active", "inactive", "churned"), showInList: true },
      { name: "industry", label: "Industry", type: "text", section: "Account Information", showInList: true },
      { name: "website", label: "Website", type: "url", section: "Contact Details" },
      { name: "phone", label: "Phone", type: "phone", section: "Contact Details" },
      { name: "email", label: "Email", type: "email", section: "Contact Details" },
      { name: "address", label: "Address", type: "textarea", section: "Address" },
      { name: "city", label: "City", type: "text", section: "Address", showInList: true },
      { name: "country", label: "Country", type: "text", section: "Address" },
      { name: "annual_revenue", label: "Annual Revenue", type: "currency", section: "Profile" },
      { name: "employee_count", label: "Employees", type: "number", section: "Profile" },
      { name: "description", label: "Description", type: "textarea", section: "Notes" },
      { name: "slack_channel", label: "Slack Channel", type: "text", section: "Profile" },
    ],
    relatedLists: [
      { object: "contacts", foreignKey: "account_id", columns: ["first_name", "last_name", "email", "title"] },
      { object: "opportunities", foreignKey: "account_id", columns: ["name", "stage", "amount", "close_date"] },
      { object: "projects", foreignKey: "account_id", columns: ["name", "status", "start_date", "budget_hours"] },
      { object: "invoices", foreignKey: "account_id", columns: ["invoice_number", "status", "total_amount", "due_date"] },
    ],
  },

  contacts: {
    name: "contacts",
    singular: "Contact",
    plural: "Contacts",
    icon: Users,
    titleFields: ["first_name", "last_name"],
    highlightFields: ["account_id", "title", "email", "phone"],
    searchFields: ["first_name", "last_name", "email", "title"],
    activityType: "contact",
    inNav: true,
    ownerFields: ["owner_id", "created_by_id"],
    fields: [
      { name: "account_id", label: "Account", type: "lookup", lookup: "accounts", required: true, section: "Contact Information", showInList: true },
      { name: "first_name", label: "First Name", type: "text", required: true, section: "Contact Information", showInList: true },
      { name: "last_name", label: "Last Name", type: "text", required: true, section: "Contact Information", showInList: true },
      { name: "title", label: "Title", type: "text", section: "Contact Information", showInList: true },
      { name: "department", label: "Department", type: "text", section: "Contact Information" },
      { name: "role", label: "Buying Role", type: "picklist", section: "Contact Information", options: opts("decision_maker", "influencer", "champion", "end_user", "other") },
      { name: "is_primary", label: "Primary Contact", type: "boolean", section: "Contact Information" },
      { name: "email", label: "Email", type: "email", section: "Reach", showInList: true },
      { name: "phone", label: "Phone", type: "phone", section: "Reach" },
      { name: "mobile", label: "Mobile", type: "phone", section: "Reach" },
      { name: "linkedin_url", label: "LinkedIn", type: "url", section: "Reach" },
      { name: "description", label: "Notes", type: "textarea", section: "Notes" },
    ],
    relatedLists: [
      { object: "opportunities", foreignKey: "contact_id", columns: ["name", "stage", "amount", "close_date"] },
    ],
  },

  opportunities: {
    name: "opportunities",
    singular: "Opportunity",
    plural: "Opportunities",
    icon: TrendingUp,
    titleFields: ["name"],
    highlightFields: ["account_id", "stage", "amount", "close_date"],
    searchFields: ["name"],
    activityType: "opportunity",
    inNav: true,
    ownerFields: ["owner_id", "created_by_id"],
    fields: [
      { name: "name", label: "Opportunity Name", type: "text", required: true, section: "Deal Information", showInList: true },
      { name: "account_id", label: "Account", type: "lookup", lookup: "accounts", required: true, section: "Deal Information", showInList: true },
      { name: "contact_id", label: "Primary Contact", type: "lookup", lookup: "contacts", section: "Deal Information" },
      { name: "stage", label: "Stage", type: "picklist", required: true, defaultValue: "discovery", section: "Deal Information", options: opts("discovery", "qualification", "proposal", "negotiation", "closed_won", "closed_lost"), showInList: true },
      { name: "type", label: "Type", type: "picklist", section: "Deal Information", options: opts("new_business", "expansion", "renewal", "other") },
      { name: "amount", label: "Amount", type: "currency", section: "Financials", showInList: true },
      { name: "currency", label: "Currency", type: "text", defaultValue: "USD", section: "Financials" },
      { name: "probability", label: "Probability (%)", type: "number", section: "Financials" },
      { name: "close_date", label: "Close Date", type: "date", section: "Timeline", showInList: true },
      { name: "actual_close_date", label: "Actual Close Date", type: "date", section: "Timeline" },
      { name: "lost_reason", label: "Lost Reason", type: "text", section: "Timeline" },
      { name: "description", label: "Description", type: "textarea", section: "Notes" },
    ],
    relatedLists: [
      { object: "opportunity_line_items", foreignKey: "opportunity_id", title: "Line Items", columns: ["service_id", "quantity", "unit_price", "total_price"] },
      { object: "projects", foreignKey: "opportunity_id", columns: ["name", "status", "start_date", "budget_amount"] },
    ],
  },

  opportunity_line_items: {
    name: "opportunity_line_items",
    singular: "Line Item",
    plural: "Line Items",
    icon: ListOrdered,
    titleFields: ["id"],
    highlightFields: ["service_id", "quantity", "unit_price", "total_price"],
    searchFields: [],
    fields: [
      { name: "opportunity_id", label: "Opportunity", type: "lookup", lookup: "opportunities", required: true, section: "Line Item" },
      { name: "service_id", label: "Service", type: "lookup", lookup: "services", required: true, section: "Line Item", showInList: true },
      { name: "description", label: "Description", type: "textarea", section: "Line Item" },
      { name: "quantity", label: "Quantity", type: "number", required: true, defaultValue: 1, section: "Pricing", showInList: true },
      { name: "unit_price", label: "Unit Price", type: "currency", required: true, section: "Pricing", showInList: true },
      { name: "discount", label: "Discount (%)", type: "number", defaultValue: 0, section: "Pricing" },
      { name: "total_price", label: "Total", type: "currency", section: "Pricing", showInList: true },
    ],
  },

  projects: {
    name: "projects",
    singular: "Project",
    plural: "Projects",
    icon: FolderKanban,
    titleFields: ["name"],
    highlightFields: ["account_id", "status", "budget_hours", "end_date"],
    searchFields: ["name"],
    activityType: "project",
    inNav: true,
    ownerFields: ["owner_id", "created_by_id"],
    fields: [
      { name: "name", label: "Project Name", type: "text", required: true, section: "Project Information", showInList: true },
      { name: "account_id", label: "Account", type: "lookup", lookup: "accounts", required: true, section: "Project Information", showInList: true },
      { name: "opportunity_id", label: "Source Opportunity", type: "lookup", lookup: "opportunities", section: "Project Information" },
      { name: "status", label: "Status", type: "picklist", required: true, defaultValue: "planning", section: "Project Information", options: opts("planning", "in_progress", "on_hold", "completed", "cancelled"), showInList: true },
      { name: "start_date", label: "Start Date", type: "date", section: "Timeline", showInList: true },
      { name: "end_date", label: "End Date", type: "date", section: "Timeline", showInList: true },
      { name: "budget_hours", label: "Budget (Hours)", type: "number", section: "Budget" },
      { name: "budget_amount", label: "Budget (Amount)", type: "currency", section: "Budget" },
      { name: "hourly_rate", label: "Hourly Rate", type: "currency", section: "Budget" },
      { name: "currency", label: "Currency", type: "text", defaultValue: "USD", section: "Budget" },
      { name: "description", label: "Scope & Notes", type: "textarea", section: "Notes" },
    ],
    relatedLists: [
      { object: "tasks", foreignKey: "project_id", columns: ["name", "status", "priority", "due_date"] },
      { object: "milestones", foreignKey: "project_id", columns: ["name", "status", "due_date"] },
      { object: "time_entries", foreignKey: "project_id", columns: ["date", "duration", "is_billable", "description"] },
      { object: "invoices", foreignKey: "project_id", columns: ["invoice_number", "status", "total_amount", "due_date"] },
    ],
  },

  milestones: {
    name: "milestones",
    singular: "Milestone",
    plural: "Milestones",
    icon: Flag,
    titleFields: ["name"],
    highlightFields: ["project_id", "status", "due_date"],
    searchFields: ["name"],
    fields: [
      { name: "project_id", label: "Project", type: "lookup", lookup: "projects", required: true, section: "Milestone" },
      { name: "name", label: "Milestone Name", type: "text", required: true, section: "Milestone", showInList: true },
      { name: "status", label: "Status", type: "picklist", required: true, defaultValue: "pending", section: "Milestone", options: opts("pending", "in_progress", "completed"), showInList: true },
      { name: "due_date", label: "Due Date", type: "date", section: "Milestone", showInList: true },
      { name: "sort_order", label: "Sort Order", type: "number", defaultValue: 0, section: "Milestone" },
      { name: "description", label: "Description", type: "textarea", section: "Notes" },
    ],
  },

  tasks: {
    name: "tasks",
    singular: "Task",
    plural: "Tasks",
    icon: CheckSquare,
    titleFields: ["name"],
    highlightFields: ["project_id", "status", "priority", "due_date"],
    searchFields: ["name"],
    inNav: true,
    ownerFields: ["owner_id", "created_by_id"],
    fields: [
      { name: "name", label: "Task Name", type: "text", required: true, section: "Task Information", showInList: true },
      { name: "project_id", label: "Project", type: "lookup", lookup: "projects", required: true, section: "Task Information", showInList: true },
      { name: "milestone_id", label: "Milestone", type: "lookup", lookup: "milestones", section: "Task Information" },
      { name: "status", label: "Status", type: "picklist", required: true, defaultValue: "todo", section: "Task Information", options: opts("todo", "in_progress", "in_review", "done", "blocked"), showInList: true },
      { name: "priority", label: "Priority", type: "picklist", section: "Task Information", options: opts("low", "medium", "high", "urgent"), showInList: true },
      { name: "due_date", label: "Due Date", type: "date", section: "Planning", showInList: true },
      { name: "estimated_hours", label: "Estimated Hours", type: "number", section: "Planning" },
      { name: "description", label: "Details", type: "textarea", section: "Notes" },
    ],
    relatedLists: [
      { object: "time_entries", foreignKey: "task_id", columns: ["date", "duration", "is_billable", "description"] },
    ],
  },

  time_entries: {
    name: "time_entries",
    singular: "Time Entry",
    plural: "Time Entries",
    icon: Clock,
    titleFields: ["description"],
    highlightFields: ["project_id", "date", "duration", "is_billable"],
    searchFields: ["description"],
    inNav: true,
    ownerFields: ["user_id"],
    fields: [
      { name: "project_id", label: "Project", type: "lookup", lookup: "projects", required: true, section: "Work", showInList: true },
      { name: "task_id", label: "Task", type: "lookup", lookup: "tasks", section: "Work", showInList: true },
      { name: "date", label: "Date", type: "date", required: true, section: "Work", showInList: true },
      { name: "duration", label: "Hours", type: "number", required: true, section: "Work", showInList: true },
      { name: "is_billable", label: "Billable", type: "boolean", defaultValue: true, section: "Billing", showInList: true },
      { name: "hourly_rate", label: "Hourly Rate", type: "currency", section: "Billing" },
      { name: "description", label: "What was done", type: "textarea", section: "Notes" },
      { name: "is_running", label: "Running", type: "boolean", hidden: true, defaultValue: false, section: "Billing" },
    ],
  },

  invoices: {
    name: "invoices",
    singular: "Invoice",
    plural: "Invoices",
    icon: FileText,
    titleFields: ["invoice_number"],
    highlightFields: ["account_id", "status", "total_amount", "due_date"],
    searchFields: ["invoice_number"],
    inNav: true,
    ownerFields: ["created_by_id"],
    fields: [
      { name: "invoice_number", label: "Invoice #", type: "text", required: true, section: "Invoice Information", showInList: true },
      { name: "account_id", label: "Account", type: "lookup", lookup: "accounts", required: true, section: "Invoice Information", showInList: true },
      { name: "project_id", label: "Project", type: "lookup", lookup: "projects", section: "Invoice Information" },
      { name: "status", label: "Status", type: "picklist", required: true, defaultValue: "draft", section: "Invoice Information", options: opts("draft", "sent", "paid", "overdue", "cancelled"), showInList: true },
      { name: "issue_date", label: "Issue Date", type: "date", required: true, section: "Dates", showInList: true },
      { name: "due_date", label: "Due Date", type: "date", required: true, section: "Dates", showInList: true },
      { name: "paid_date", label: "Paid Date", type: "date", section: "Dates" },
      { name: "subtotal", label: "Subtotal", type: "currency", defaultValue: 0, section: "Amounts" },
      { name: "tax_rate", label: "Tax Rate (%)", type: "number", defaultValue: 0, section: "Amounts" },
      { name: "tax_amount", label: "Tax Amount", type: "currency", defaultValue: 0, section: "Amounts" },
      { name: "total_amount", label: "Total", type: "currency", defaultValue: 0, section: "Amounts", showInList: true },
      { name: "currency", label: "Currency", type: "text", defaultValue: "USD", section: "Amounts" },
      { name: "notes", label: "Notes", type: "textarea", section: "Notes" },
    ],
    relatedLists: [
      { object: "invoice_line_items", foreignKey: "invoice_id", title: "Line Items", columns: ["description", "quantity", "unit_price", "total_price"] },
    ],
  },

  invoice_line_items: {
    name: "invoice_line_items",
    singular: "Invoice Line",
    plural: "Invoice Lines",
    icon: ListOrdered,
    titleFields: ["description"],
    highlightFields: ["quantity", "unit_price", "total_price"],
    searchFields: ["description"],
    fields: [
      { name: "invoice_id", label: "Invoice", type: "lookup", lookup: "invoices", required: true, section: "Line" },
      { name: "description", label: "Description", type: "text", required: true, section: "Line", showInList: true },
      { name: "quantity", label: "Quantity", type: "number", required: true, defaultValue: 1, section: "Line", showInList: true },
      { name: "unit_price", label: "Unit Price", type: "currency", required: true, section: "Line", showInList: true },
      { name: "total_price", label: "Total", type: "currency", section: "Line", showInList: true },
    ],
  },

  services: {
    name: "services",
    singular: "Service",
    plural: "Services",
    icon: Package,
    titleFields: ["name"],
    highlightFields: ["category", "rate_type", "default_rate", "is_active"],
    searchFields: ["name", "category"],
    inNav: true,
    fields: [
      { name: "name", label: "Service Name", type: "text", required: true, section: "Service Information", showInList: true },
      { name: "category", label: "Category", type: "picklist", required: true, defaultValue: "consulting", section: "Service Information", options: opts("consulting", "implementation", "integration", "support", "training", "managed_service"), showInList: true },
      { name: "rate_type", label: "Rate Type", type: "picklist", required: true, defaultValue: "hourly", section: "Pricing", options: opts("hourly", "fixed", "monthly", "per_unit"), showInList: true },
      { name: "default_rate", label: "Default Rate", type: "currency", section: "Pricing", showInList: true },
      { name: "is_active", label: "Active", type: "boolean", defaultValue: true, section: "Pricing", showInList: true },
      { name: "description", label: "Description", type: "textarea", section: "Notes" },
    ],
  },
};

export const NAV_OBJECTS = [
  "leads",
  "accounts",
  "contacts",
  "opportunities",
  "projects",
  "tasks",
  "time_entries",
  "invoices",
  "services",
];

export function getObject(name: string): ObjectDef | undefined {
  return OBJECTS[name];
}

export function recordTitle(def: ObjectDef, record: Record<string, unknown>): string {
  const parts = def.titleFields
    .map((f) => (record[f] != null ? String(record[f]) : ""))
    .filter(Boolean);
  const title = parts.join(" ").trim();
  return title || def.singular;
}

// Badge tone mapping for picklist values
export function badgeTone(value: string): "mint" | "neutral" | "warn" | "danger" {
  const mint = ["active", "customer", "qualified", "closed_won", "done", "completed", "paid", "hot", "in_progress"];
  const danger = ["churned", "closed_lost", "unqualified", "blocked", "overdue", "cancelled", "urgent"];
  const warn = ["on_hold", "negotiation", "in_review", "warm", "high", "sent", "contacted"];
  if (mint.includes(value)) return "mint";
  if (danger.includes(value)) return "danger";
  if (warn.includes(value)) return "warn";
  return "neutral";
}
