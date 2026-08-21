/**
 * What each screen is for, in one place.
 *
 * This used to be prose printed onto the pages themselves — useful once, then
 * clutter, and inconsistent about which screens got any at all. It lives here
 * instead, keyed by route, so it is reviewable in a diff and a page can carry
 * a paragraph of guidance without wearing it permanently.
 *
 * Bodies are markdown, rendered by lib/markdown.tsx. Keys are route-shaped so
 * they read like the URL bar and can be found by grep; object pages use
 * `object:<name>` and `object:<name>:record`, falling back to the generic
 * `object:list` / `object:record` so no icon ever opens an empty popup.
 *
 * What belongs here: what the screen is, how it fits the rest of the app, and
 * the things that are not obvious from looking at it. What does not: hints
 * that belong under the field they describe, and warnings about your actual
 * data — those stay on the page, where they can be acted on.
 */

export interface HelpTopic {
  title: string;
  /** Markdown. See lib/markdown.tsx for the supported subset. */
  body: string;
}

const FUNCTIONS_BASE = "https://ndzvqldluzfstowhhkvd.supabase.co/functions/v1";

export const HELP: Record<string, HelpTopic> = {
  /* ---------- Dashboards and tools ---------- */

  "/": {
    title: "Dashboard",
    body: `
      Where the day starts: what is open, what is overdue, and what moved
      recently across the whole workspace.

      Every tile is a live count — clicking through takes you to the same
      records filtered the same way, so nothing here is a separate report that
      can disagree with the lists.

      ## If a number looks wrong
      The tiles read the same tables the lists do. A figure that surprises you
      is usually data rather than arithmetic — [Maintenance](/settings/maintenance)
      runs the health checks that find the usual causes: entries with no
      monthly summary, timers left running, invoices past their due date.
    `,
  },

  "/financial": {
    title: "Financial",
    body: `
      Money owed and money collected. **Outstanding** and the ageing buckets
      are built from each invoice's *balance*, not its total, so a partly-paid
      invoice shows only what is still owed.

      **Collected** is grouped by the date a payment was recorded rather than
      the date an invoice was marked paid — a payment lands in the month it
      actually arrived.

      ## Generating an invoice
      Invoices are billed per **account and month**, not per project: one
      month's work usually spans several projects and the client expects one
      invoice. Generate Invoice here picks the account and month and builds
      from the [monthly summary](/monthly_summaries).
    `,
  },

  "/monthly": {
    title: "Monthly Ops",
    body: `
      Team output and budget health for one month at a time. Hours come from
      time entries; budget health compares them against each project's rate
      and budget.

      This screen reports — it changes nothing. Billing happens on the
      [monthly summary](/monthly_summaries), which is the record an invoice is
      generated from.
    `,
  },

  "/currency": {
    title: "Currency",
    body: `
      Converts between currencies using daily rates, fetched once a day and
      cached in this browser.

      When the rate service cannot be reached the last cached rates are used
      and the page says so. Figures are indicative — an invoice always keeps
      the currency it was issued in, and nothing here rewrites a stored amount.
    `,
  },

  "/pipeline": {
    title: "Pipeline",
    body: `
      Open opportunities as a board, one column per stage. Dragging a card
      moves the deal and stamps the stage's default **probability**.

      Two totals are shown: the raw sum of open deals, and the **weighted**
      total — each deal multiplied by its probability. The weighted figure is
      the one worth forecasting against.

      Closing a deal as won lets you create a [project](/projects) from it,
      carrying the account and budget across.
    `,
  },

  "/tasks/board": {
    title: "Task Board",
    body: `
      Tasks by status. Dragging a card changes its status; everything else
      about a task is edited on the task itself.

      The same tasks appear as a list under [Tasks](/tasks) — the board is a
      different view of one set of records, not a separate place they live.
    `,
  },

  "/time_entries": {
    title: "Time Tracking",
    body: `
      Every hour logged, and where it gets billed.

      An entry inherits its **rate from the project**, so changing a project's
      rate does not rewrite hours already logged. The **billable** flag decides
      whether an entry reaches an invoice; non-billable hours are still
      tracked, and still count toward a project's budget.

      ## How hours become money
      Each entry belongs to a **monthly summary** — one per account per month.
      Totals roll up automatically in the database, so a summary can never
      disagree with the entries beneath it. From the summary you generate a
      single invoice covering every project that month.

      Entries filed under a month they fall outside of are kept as filed: the
      summary is what was billed, and the calendar month is only what the
      billing period line says.

      ## Export PDF
      Produces the client-facing hours breakdown — billable items only. The
      same document is attached to the invoice email, so what you export and
      what the client receives are the same file.
    `,
  },

  /* ---------- Setup ---------- */

  "/settings/workspace": {
    title: "Workspace Settings",
    body: `
      Branding and the defaults new records inherit — workspace name, PDF
      accent colour and footer text, default rate and currency.

      The PDF accent and footer text reach both client-facing documents: the
      monthly hours breakdown and the invoice.

      Legal identity for tax invoices lives on
      [Tax Invoicing](/settings/invoicing) instead, because that is compliance
      rather than branding.

      ## AI insights
      When an insight is requested, that record's CRM data — and closely
      related records — is sent to Anthropic's API. Nothing is sent otherwise.
      Removing the key stops insights; it deletes nothing already generated.
    `,
  },

  "/settings/invoicing": {
    title: "Tax Invoicing",
    body: `
      Everything needed to issue a legally-formed Israeli tax invoice: the VAT
      rate, who is issuing, and the provider that allocates the number.

      These details appear on every invoice PDF and are sent to the provider
      when a document is issued.

      ## Business type
      An *Osek Patur* issues receipts, not tax invoices. The setting decides
      which document type is requested, so it has to match your actual
      registration.

      ## Connecting Green Invoice
      Issuing through Green Invoice gives each invoice a legal document number
      and an allocation number (מספר הקצאה). Create an API key under
      **Settings → Developer Tools** in your Green Invoice account, then paste
      the key ID and secret here.

      Credentials are stored server-side and are never sent back to the
      browser. **Test** only exchanges them for a token — it issues nothing.
      **Preview** sends the real document payload and gets back a watermarked
      copy, which is how you check an invoice before a number is allocated to
      it.

      Once a document is issued the invoice is frozen: amounts and line items
      can no longer change, because a tax document has already been reported
      against them.
    `,
  },

  "/settings/email": {
    title: "Email Settings",
    body: `
      How the monthly invoice email goes out: who it comes from, what it says,
      and the Gmail account that sends it.

      Kept apart from [Tax Invoicing](/settings/invoicing) because this is
      correspondence rather than compliance — and because it holds a password,
      it is admin-only.

      ## Sender
      The person a client sees and replies to. Deliberately separate from the
      issuer identity on Tax Invoicing, which is the legal entity.

      ## Template
      The starting point, not the last word — the subject and body are filled
      in and still editable in the send window. A placeholder that resolves to
      nothing blocks the send, so an invoice email can never go out reading
      "Amount:  + VAT".

      ## Gmail
      Sends as your own mailbox, so replies land where you expect and Google
      signs the message. It needs an **app password** — a normal Google
      password will not work. The password is stored server-side and is never
      sent back to the browser.

      Gmail does not file SMTP messages in Sent, so the BCC copy is your
      archive, and your proof the message really went.

      ## Deliverability
      SPF, DKIM and DMARC are DNS records. This app can tell you exactly what
      is missing and hand you the value to paste, but only your DNS host can
      publish them. A newly published record can take up to an hour to show —
      resolvers remember a missing record for a while.

      Passing all three removes one reason for a mail server to reject you. It
      does not guarantee the inbox.
    `,
  },

  "/settings/slack": {
    title: "Slack Integration",
    body: `
      Posts CRM events into Slack, and answers \`/crm\` slash commands.

      ## Setup
      1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
         — "From scratch", then pick your workspace.
      2. Under **OAuth & Permissions** add the bot scope \`chat:write\`, click
         **Install to Workspace**, and copy the **Bot User OAuth Token**
         (\`xoxb-…\`) into the field on this page.
      3. Invite the bot to your channel with \`/invite @YourApp\`. The channel
         ID is in the channel's details panel and starts with \`C\`.
      4. For slash commands, create \`/crm\` under **Slash Commands** with the
         request URL \`${FUNCTIONS_BASE}/slack-commands\`, then copy the app's
         **Signing Secret** from Basic Information into the field on this page.
      5. Save, then hit **Send Test**.

      ## Commands
      \`/crm search acme\` · \`/crm pipeline\` · \`/crm my-tasks\` ·
      \`/crm log 2 Acme integration work\` · \`/crm timer start\`

      ## Notifications
      These fire from the database rather than from the browser, so they happen
      whether or not anyone has the app open: new leads, stage changes, invoice
      status changes and task assignments — plus an hourly check for timers
      running over eight hours and invoices past their due date.

      Per-event channel overrides are optional; anything left empty falls back
      to the default channel.
    `,
  },

  "/settings/custom-fields": {
    title: "Custom Fields",
    body: `
      Add fields to any object without a database migration. Values are stored
      separately from the object's own columns, which is why no schema change
      is needed and why a custom field can be removed again cleanly.

      A field appears in the record form, the detail view and the list's column
      picker as soon as it is created. **Help Text** is shown under the control
      in forms — that is the place for a note about one field, rather than this
      popup.

      Deleting a field deletes its values everywhere, and that cannot be undone.

      Where fields *sit* on the page is decided on
      [Page Layouts](/settings/layouts).
    `,
  },

  "/settings/layouts": {
    title: "Page Layouts",
    body: `
      Controls the arrangement of a record page: which sections exist, which
      fields are in them, and in what order. Drag from the palette onto the
      canvas, and click a field to configure it.

      A layout saved here replaces the default arrangement that comes from the
      object registry. **Reset to default** discards it and goes back to that
      arrangement.

      Removing a section returns its fields to the palette rather than deleting
      anything — no data is affected by anything on this screen.
    `,
  },

  "/settings/automations": {
    title: "Automations",
    body: `
      Rules that react to record changes, and the endpoints they deliver to.

      A rule is a trigger, optional conditions, and one or more actions —
      create a task, post to Slack, call a webhook, update a field, or raise an
      in-app notification. With no conditions, a rule runs on every matching
      event.

      Rules are evaluated in the database, not the browser, so they fire for
      changes made by anyone or anything — including Slack commands and
      scheduled jobs.

      ## Webhooks
      Every payload is signed with HMAC-SHA256 in the \`X-AACRM-Signature\`
      header, so a receiver can verify it came from here. The signing secret is
      shown once, when the endpoint is created.

      **Deliveries** records every attempt with its status code and duration —
      the first place to look when a scenario did not run.
    `,
  },

  "/settings/users": {
    title: "Users & Roles",
    body: `
      Who can sign in, and what they can reach.

      New users are created in the Supabase dashboard under **Auth → Invite**.
      Once someone signs in and has a profile, they appear here as a member.

      **Admins** see the Setup section — settings, integrations, layouts,
      maintenance and the audit log. **Members** do not. Everything else in the
      app is available to both.
    `,
  },

  "/settings/audit": {
    title: "Audit Log",
    body: `
      A record of administrative actions: who did what, to which record, and
      when.

      Written by the app rather than reconstructed afterwards, so it captures
      intent — an issued invoice, a sent email, a bulk fix, a deleted field —
      rather than raw row changes.

      Entries are not editable, and are deliberately kept when the record they
      refer to is deleted.
    `,
  },

  "/settings/maintenance": {
    title: "Maintenance",
    body: `
      Health checks over the data, each with a bulk fix where a fix can be
      applied safely.

      The checks look for the things that quietly break billing: timers left
      running, completed hours not linked to any monthly summary, invoices
      still marked sent after their due date, tasks past due.

      Where a fix needs human judgement it is not offered as a bulk action —
      rescheduling overdue tasks would falsify planning data, so those are
      listed for you to handle individually.

      Every bulk fix is recorded in the [audit log](/settings/audit), and
      summary totals recompute themselves afterwards.

      ## Deleted records
      Deleting a record flags it rather than removing it, so it disappears from
      lists and lookups but can be restored here. A permanent purge is
      intentionally not offered.
    `,
  },

  /* ---------- Object pages ---------- */

  "object:list": {
    title: "Lists",
    body: `
      Every record of one type, with the columns you choose.

      **Search** matches the fields that identify a record. **Filters** stack —
      each one narrows what the previous one left. Clicking a column header
      sorts by it, and lookup columns sort by the name you can see rather than
      the id underneath.

      Columns and saved views are per person and stored in this browser, so
      changing them affects nobody else.

      Some cells can be edited in place: click the pencil that appears on
      hover. Anything computed by the database is read-only here and edited
      wherever it comes from.
    `,
  },

  "object:record": {
    title: "Records",
    body: `
      One record, its fields, and everything related to it.

      Sections and their order come from
      [Page Layouts](/settings/layouts); the fields themselves come from the
      object's definition plus any [custom fields](/settings/custom-fields).

      Related lists below show the records that point at this one. Adding a row
      there creates a real record with the link already made.

      Deleting flags the record rather than erasing it — it leaves lists and
      lookups, and an admin can restore it from
      [Maintenance](/settings/maintenance).
    `,
  },

  "object:leads": {
    title: "Leads",
    body: `
      Someone who might become a client, before they are one.

      Converting a lead creates — or links to — an **account**, creates a
      **contact** and an **opportunity**, then marks the lead converted. Where
      an account with a similar name already exists you are offered the match,
      so converting twice does not produce two companies.

      Source and rating carry across the conversion, which is what makes
      attribution reporting possible later.
    `,
  },

  "object:accounts": {
    title: "Accounts",
    body: `
      A company you do work for. Everything else hangs off it: contacts,
      opportunities, projects, monthly summaries and invoices.

      ## Fields that matter downstream
      **Legal name** and **tax ID** appear on tax invoices. **VAT exempt**
      forces the VAT rate to zero for this client. **Country** must be a
      two-letter ISO code — the invoicing provider rejects anything else.

      **Short name** is the Latin name used on the client-facing PDF when the
      account's own name is in Hebrew, which the PDF fonts cannot render.
    `,
  },

  "object:contacts": {
    title: "Contacts",
    body: `
      A person at an account. Contacts are who invoice email goes to, and who
      activities are logged against.

      A contact marked primary is offered first when composing the monthly
      invoice email.
    `,
  },

  "object:opportunities": {
    title: "Opportunities",
    body: `
      A deal in progress. The amount rolls up from its line items in the
      database, so a deal and its own lines cannot disagree.

      **Probability** is set from the stage and drives the weighted total on
      the [pipeline](/pipeline). A won opportunity can become a
      [project](/projects) or a [quote](/quotes), carrying its account and
      values across.
    `,
  },

  "object:quotes": {
    title: "Quotes",
    body: `
      A priced proposal. Totals are computed in the database from the line
      items — edit the lines, not the totals.

      Accepting a quote creates a **draft invoice** from its line items and
      links the two, so what was quoted and what was billed stay connected.
    `,
  },

  "object:projects": {
    title: "Projects",
    body: `
      A body of work for an account. A project carries the **hourly rate** that
      time entries inherit, and the budget they are measured against.

      A project cannot produce an invoice on its own: a month's work usually
      spans several projects and the client gets one invoice, so billing
      happens on the [monthly summary](/monthly_summaries) instead.
    `,
  },

  "object:tasks": {
    title: "Tasks",
    body: `
      A unit of work, optionally assigned to someone and due on a date.

      Assigning a task notifies the assignee, in-app and in Slack. Time entries
      reference the task they were logged against, which is what puts a subject
      line on each row of the client's hours breakdown.

      The same records are available as a board under
      [Task Board](/tasks/board).
    `,
  },

  "object:invoices": {
    title: "Invoices",
    body: `
      What a client owes, and what they have paid.

      ## The totals are not typed
      Subtotal, discount, VAT, total and balance are all computed by the
      database from the line items. Edit a line and the totals follow; there is
      nothing to keep in sync by hand.

      ## Payments
      Recording a payment updates the amount paid and the balance, and flips
      the status to paid once nothing is outstanding. Partial payments are
      normal — the invoice stays sent, with a smaller balance.

      ## Issuing
      An invoice becomes a legal tax document only when it is issued through
      the provider, which allocates its number. **Preview** checks the payload
      first and allocates nothing. After issuing, amounts and line items are
      frozen.
    `,
  },

  "object:recurring_invoices": {
    title: "Retainers",
    body: `
      A fixed monthly fee that generates its own invoice on a schedule.

      An hourly job picks up any schedule whose next run date has passed,
      creates the invoice, and advances the date. Generated invoices are always
      **drafts** — nothing reaches a client without a person.

      Generate Now bills outside the schedule and still advances the next run
      date, so the scheduled run cannot produce a duplicate.
    `,
  },

  "object:monthly_summaries": {
    title: "Monthly Summaries",
    body: `
      **The billing unit: one account, one month.** Time entries across every
      project attach to it, and its totals roll up from them in the database.

      ## What you do here
      **Generate Invoice** creates one draft invoice for the month's billable
      hours across all projects, marks those entries billed, and moves the
      summary to Invoiced so it cannot be billed twice.

      **Export PDF** produces the client-facing hours breakdown and files a
      copy against this record. **Send to Client** emails that breakdown
      together with the issued tax invoice.

      ## Why one invoice, not one per project
      A month's work usually spans four to six projects. The client expects a
      single invoice, and the tax document has to reconcile with it to the
      cent — so the summary bills once, listing the projects it covered.
    `,
  },

  "object:services": {
    title: "Services",
    body: `
      The things you sell, with a default rate. Adding a service to a quote or
      an invoice copies its rate onto the line rather than referencing it, so
      changing a price here never rewrites a document that has already gone
      out.
    `,
  },

  "object:time_entries:record": {
    title: "Time Entry",
    body: `
      One logged block of work.

      The **rate** comes from the project and is read-only here. The
      **billable** flag decides whether these hours reach an invoice. The
      **monthly summary** is what ties the entry to a month's billing — an
      entry with none is invisible to billing roll-ups, which is one of the
      checks [Maintenance](/settings/maintenance) looks for.

      Editing hours that are already on an invoice moves this summary's totals
      but not the invoice's, so the two can disagree. The app asks before
      letting that happen.
    `,
  },
};

/**
 * The topic for a key, or null when there is none.
 *
 * Object keys fall back to the generic list/record topics, so every object
 * page resolves to something useful without needing bespoke copy first — an
 * icon that opens nothing is worse than no icon.
 */
export function helpFor(key: string): HelpTopic | null {
  const exact = HELP[key];
  if (exact) return exact;
  if (key.startsWith("object:")) {
    return HELP[key.endsWith(":record") ? "object:record" : "object:list"] ?? null;
  }
  return null;
}
