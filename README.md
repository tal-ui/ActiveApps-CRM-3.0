# ActiveApps CRM 3.0

Salesforce-inspired CRM for ActiveApps, built with React + Vite + Tailwind on Supabase, styled with the ActiveApps "Dark Command Center" design system.

## What's included (Sprints 1–4)

- **Login** — Supabase email/password auth (all data is protected by Row Level Security)
- **Dashboard** — open pipeline value, open leads, active projects, hours this month, pipeline-by-stage bars, recent activity
- **List views** with search, sort, and pagination for: Leads, Accounts, Contacts, Opportunities, Projects, Tasks, Time Entries, Invoices, Services
- **Record detail pages** — highlights panel, field sections, related lists (e.g., Contacts/Opportunities/Projects/Invoices under an Account), inline "Add" on related lists
- **Create / Edit / Delete** for every object with typed field inputs (currency, date, picklist, lookup, toggle, etc.)
- **Lead conversion** — one click creates Account + Contact + optional Opportunity and marks the lead converted
- **Activity timeline** — log notes, calls, emails, and meetings on Leads, Accounts, Contacts, Opportunities, and Projects
- **Global timer** (Sprint 3) — start/stop from the sticky header on any page; live HH:MM:SS counter; server-persisted (survives refresh and device switches); one active timer per user; stop modal lets you relate the entry to an existing task or quick-create one
- **Time Tracking page** (Sprint 3) — month / project / billable filters, totals (hours, billable, billable value), hours-by-project bars, manual time logging
- **Monthly hours PDF** (Sprint 3) — branded report (print variant: navy + mint on white) with summary boxes and a detail table grouped by project with subtotals; respects the active filters
- **Custom fields** (Sprint 4) — Settings → Custom Fields: add fields of 14 types (text, currency, picklists, multi-select, date/time, checkbox, lookup relationships, etc.) to any object with no database changes (EAV pattern). They appear automatically in create/edit forms and on record pages, with required validation, help text, and picklist option config
- **Page layout builder** (Sprint 4) — Settings → Page Layouts: Salesforce-style drag-and-drop builder. Drag fields from the palette onto sections, reorder and move between sections, add/rename/reorder/delete sections, set 1 or 2 columns, configure per-field required/read-only/visible/width, and order or hide related lists. Saved layouts drive how record pages render

## Run locally

```bash
cd crm-app
npm install
npm run dev
```

Then open http://localhost:5173 and sign in with your CRM account (tal@activeapps.io).

## Backend

- Supabase project: **AA CRM** (`ndzvqldluzfstowhhkvd`)
- 15 CRM tables + profiles/integrations/webhooks/audit extras already in place
- The app connects with the publishable anon key; every query requires an authenticated session (RLS)

## Deploy

`vercel.json` is included (SPA rewrites). Deploy the `crm-app` folder to Vercel or any static host:

```bash
npm run build   # outputs to dist/
```

## Next sprints (from the build plan)

- Sprint 5: financial dashboards + invoice generation from time entries
- Sprint 6: Slack integration
