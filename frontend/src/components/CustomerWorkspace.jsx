import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  AtSign,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Link2,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquarePlus,
  Phone,
  ReceiptText,
  Search,
  Send,
  UserRound,
  Users,
} from "lucide-react";

const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const CRM_STAGES = [
  ["active", "Active"],
  ["prospect", "Prospect"],
  ["onboarding", "Onboarding"],
  ["watch", "Watch"],
  ["inactive", "Inactive"],
];

const INTERACTION_TYPES = [
  ["note", "Note"],
  ["email", "Email"],
  ["call", "Call"],
  ["meeting", "Meeting"],
  ["task", "Task"],
  ["status", "Status Update"],
  ["job_comment", "Job Comment"],
];

const INTERACTION_STATUSES = [
  ["open", "Open"],
  ["waiting_customer", "Waiting on Customer"],
  ["waiting_internal", "Waiting Internally"],
  ["scheduled", "Scheduled"],
  ["closed", "Closed"],
];

const TYPE_ICON = {
  email: Mail,
  call: Phone,
  meeting: CalendarDays,
  task: CheckCircle2,
  status: Clock3,
  job_comment: BriefcaseBusiness,
  note: MessageCircle,
};

const CUSTOMER_PAGES = [
  ["overview", "Overview"],
  ["tickets", "Tickets"],
  ["activity", "Activity"],
  ["work", "Work"],
  ["team", "Team"],
];

function sameId(a, b) {
  return String(a ?? "") === String(b ?? "");
}

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

function userId(user) {
  return String(user?.id || user?.username || "").trim();
}

function userLabel(user) {
  return user?.name || user?.username || "User";
}

function customerMatchesOwner(customer, currentUser) {
  const owner = normalizedText(customer?.account_owner);
  const viewerNames = [currentUser?.name, currentUser?.username].map(normalizedText).filter(Boolean);
  if (!owner || !viewerNames.length) return false;
  return viewerNames.some((name) => owner === name || owner.includes(name) || name.includes(owner));
}

function interactionCustomerId(interaction) {
  return String(interaction?.customer || interaction?.customer_id || interaction?.customerId || "").trim();
}

function isOpenInteraction(interaction) {
  return String(interaction?.status || "open").toLowerCase() !== "closed";
}

function ticketTitle(interaction) {
  return interaction?.subject || interaction?.email_subject || choiceLabel(INTERACTION_TYPES, interaction?.interaction_type);
}

function ticketReference(interaction) {
  return interactionRelationLabel(interaction) || `CRM Ticket #${interaction?.id ?? ""}`.trim();
}

function sortDateValue(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function ticketSortValue(interaction) {
  return sortDateValue(interaction?.follow_up_date || interaction?.updated_at || interaction?.occurred_at || interaction?.created_at);
}

function isAuditLine(value) {
  return /^\[[^\]]+\]\s+.+/.test(String(value || "").trim());
}

function interactionAuditEntries(interaction) {
  return String(interaction?.body || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(isAuditLine);
}

function interactionNotesWithoutAudit(interaction) {
  return String(interaction?.body || "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block && !block.split(/\n+/).every(isAuditLine))
    .join("\n\n");
}

function money(value) {
  const number = Number(value || 0);
  return currencyFormatter.format(Number.isFinite(number) ? number : 0);
}

function number(value) {
  const safe = Number(value || 0);
  return numberFormatter.format(Number.isFinite(safe) ? safe : 0);
}

function statusLabel(value) {
  return String(value || "unknown").replace(/_/g, " ");
}

function choiceLabel(choices, value) {
  return choices.find(([choiceValue]) => String(choiceValue) === String(value))?.[1] || statusLabel(value);
}

function dateLabel(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function dateTimeLabel(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function dateTimeInputValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function isoFromDateTimeInput(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function externalUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function customerAddressLines(customer) {
  if (!customer) return [];
  return [
    customer.address_line_1,
    customer.address_line_2,
    customer.address_line_3,
    [customer.city, customer.state, customer.postal_code].filter(Boolean).join(", "),
    customer.country,
  ].map((line) => String(line || "").trim()).filter(Boolean);
}

function quoteNumber(quote) {
  return quote?.quoteNumber || quote?.quote_number || `Quote ${quote?.id ?? ""}`.trim();
}

function quoteJobName(quote) {
  return quote?.jobName || quote?.job_name || "No job name";
}

function quoteTotal(quote) {
  return Number(quote?.pricing?.sellPrice || quote?.pricing?.sell_price || 0);
}

function quoteQuantity(quote) {
  return Number(quote?.pricing?.quantity || quote?.form?.quantity || 0);
}

function orderQuantity(order) {
  return Number(order.quantity_to_ship || 0) + Number(order.quantity_to_stock || 0);
}

function orderOpen(order) {
  return !["complete", "cancelled", "schedule_removed"].includes(String(order.status || "").toLowerCase());
}

function interactionStatusTone(status) {
  const value = String(status || "").toLowerCase();
  if (value === "closed") return "good";
  if (value === "waiting_customer" || value === "waiting_internal") return "watch";
  if (value === "scheduled") return "info";
  return "open";
}

function interactionRelationLabel(interaction) {
  return [
    interaction.order_number ? `Order ${interaction.order_number}` : "",
    interaction.job_ticket_number ? `Job ${interaction.job_ticket_number}` : "",
    interaction.job_name && !interaction.job_ticket_number ? interaction.job_name : "",
    interaction.quote_number ? `Quote ${interaction.quote_number}` : "",
  ].filter(Boolean).join(" / ");
}

function relationOptionLabel(type, row) {
  if (type === "order") {
    return [
      row.order_number || `Order ${row.id}`,
      row.job_name,
      row.customer_po ? `PO ${row.customer_po}` : "",
    ].filter(Boolean).join(" / ");
  }
  if (type === "job") {
    return [
      row.ticket_number || row.product_code || `Job ${row.id}`,
      row.job_name,
      row.product_code && row.product_code !== row.ticket_number ? `TSM ${row.product_code}` : "",
    ].filter(Boolean).join(" / ");
  }
  return [quoteNumber(row), quoteJobName(row)].filter(Boolean).join(" / ");
}

function initialInteractionForm() {
  return {
    interaction_type: "note",
    status: "open",
    related_record: "",
    subject: "",
    body: "",
    email_from: "",
    email_to: "",
    email_url: "",
    follow_up_date: "",
    occurred_at: dateTimeInputValue(),
    pinned: false,
  };
}

function Metric({ label, value, detail, tone = "" }) {
  return (
    <div className={`customer-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <em>{detail}</em>}
    </div>
  );
}

function CustomerSearchInput({ value, onChange, count, total, autoFocus = false, onFocus }) {
  return (
    <label className="customer-search-field">
      <Search size={17} />
      <input
        autoFocus={autoFocus}
        value={value}
        onFocus={onFocus}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder="Search customer, contact, code, email, phone..."
      />
      <span>{count} / {total}</span>
    </label>
  );
}

function CustomerCard({ customer, selected, onSelect, notificationCount = 0 }) {
  const stage = choiceLabel(CRM_STAGES, customer.crm_stage || (customer.is_active === false ? "inactive" : "active"));
  return (
    <button className={`customer-search-card ${selected ? "active" : ""} ${notificationCount > 0 ? "has-notifications" : ""}`} type="button" onClick={() => onSelect(customer)}>
      <span className="customer-card-initial">{String(customer.name || "?").slice(0, 1).toUpperCase()}</span>
      <span>
        <strong>{customer.name || "Unnamed customer"}</strong>
        <em>{[customer.customer_code ? `ID ${customer.customer_code}` : "", customer.contact_name || customer.email || customer.phone].filter(Boolean).join(" / ") || "No contact on file"}</em>
      </span>
      <span className="customer-card-status">
        <b>{stage}</b>
        {notificationCount > 0 && <span className="customer-notification-badge" title={`${notificationCount} open notification${notificationCount === 1 ? "" : "s"}`}>{notificationCount}</span>}
      </span>
    </button>
  );
}

function QuoteRow({ quote }) {
  return (
    <article className="customer-activity-row">
      <div>
        <span>Quote</span>
        <strong>{quoteNumber(quote)}</strong>
        <em>{quoteJobName(quote)}</em>
      </div>
      <div>
        <strong>{money(quoteTotal(quote))}</strong>
        <em>{number(quoteQuantity(quote))} labels / {dateLabel(quote.createdAt || quote.created_at)}</em>
      </div>
    </article>
  );
}

function OrderRow({ order }) {
  return (
    <article className="customer-activity-row">
      <div>
        <span>{statusLabel(order.status)}</span>
        <strong>{order.order_number || "Order"}</strong>
        <em>{[order.customer_po ? `PO ${order.customer_po}` : "", order.job_name, order.product_code].filter(Boolean).join(" / ")}</em>
      </div>
      <div>
        <strong>{number(orderQuantity(order))}</strong>
        <em>Due {dateLabel(order.due_date)} / Scheduled {dateLabel(order.scheduled_date)}</em>
      </div>
    </article>
  );
}

function TicketRow({ ticket }) {
  return (
    <article className="customer-ticket-row">
      <strong>{ticket.job_name || ticket.product_code || ticket.ticket_number}</strong>
      <span>{[ticket.product_code ? `TSM ${ticket.product_code}` : "", ticket.ticket_number, ticket.material_master_type_code].filter(Boolean).join(" / ") || "No identifiers"}</span>
      <em>{[ticket.label_width_inches && ticket.label_length_inches ? `${ticket.label_width_inches}" x ${ticket.label_length_inches}"` : "", ticket.recipe_name].filter(Boolean).join(" / ")}</em>
    </article>
  );
}

function TimelineRow({ item }) {
  const Icon = item.type === "quote" ? FileText : item.type === "crm" ? (TYPE_ICON[item.interactionType] || MessageCircle) : ReceiptText;
  return (
    <div className="customer-timeline-row">
      <span><Icon size={14} /></span>
      <div>
        <strong>{item.title}</strong>
        <em>{item.detail}</em>
      </div>
      <time>{dateLabel(item.date)}</time>
    </div>
  );
}

function FactRow({ icon: Icon, label, value, href }) {
  const content = (
    <>
      <Icon size={14} />
      <span>{label}</span>
      <strong>{value || "--"}</strong>
    </>
  );
  if (href) {
    return (
      <a className="customer-fact-row" href={href} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>
        {content}
      </a>
    );
  }
  return <div className="customer-fact-row">{content}</div>;
}

function RelatedCard({ icon: Icon, title, count, children }) {
  return (
    <section className="customer-related-card">
      <header>
        <Icon size={15} />
        <strong>{title}</strong>
        <span>{count}</span>
      </header>
      {children}
    </section>
  );
}

function CustomerInteractionComposer({ selected, relationOptions, currentUser, saving, onSubmit }) {
  const [form, setForm] = useState(initialInteractionForm);
  const [localError, setLocalError] = useState("");
  const isEmail = form.interaction_type === "email";

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setLocalError("");
  }

  async function submit(event) {
    event.preventDefault();
    const subject = form.subject.trim();
    const body = form.body.trim();
    if (!subject && !body) {
      setLocalError("Add a subject or note before saving.");
      return;
    }
    const [relationType, relationId] = String(form.related_record || "").split(":");
    const payload = {
      customer: selected.id,
      customer_order: relationType === "order" && relationId ? Number(relationId) : null,
      job_ticket: relationType === "job" && relationId ? Number(relationId) : null,
      quote: relationType === "quote" && relationId ? Number(relationId) : null,
      interaction_type: form.interaction_type,
      status: form.status,
      subject: subject || choiceLabel(INTERACTION_TYPES, form.interaction_type),
      body,
      email_from: isEmail ? form.email_from.trim() : "",
      email_to: isEmail ? form.email_to.trim() : "",
      email_subject: isEmail ? subject : "",
      email_url: isEmail ? form.email_url.trim() : "",
      follow_up_date: form.follow_up_date || null,
      occurred_at: isoFromDateTimeInput(form.occurred_at) || new Date().toISOString(),
      pinned: form.pinned,
      created_by: currentUser?.name || currentUser?.username || "",
      updated_by: currentUser?.name || currentUser?.username || "",
    };
    await onSubmit?.(payload);
    setForm(initialInteractionForm());
  }

  return (
    <section className="customer-crm-form customer-page-card">
      <header>
        <div>
          <strong>Log Activity</strong>
          <span>{currentUser?.name || currentUser?.username || "Current user"}</span>
        </div>
      </header>
      <form onSubmit={submit}>
        <div className="customer-composer-typebar" role="group" aria-label="Activity type">
          {INTERACTION_TYPES.map(([value, label]) => {
            const Icon = TYPE_ICON[value] || MessageCircle;
            return (
              <button className={form.interaction_type === value ? "active" : ""} key={value} type="button" onClick={() => update("interaction_type", value)}>
                <Icon size={14} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
        <div className="customer-crm-fields">
          <label>
            <span>Status</span>
            <select value={form.status} onChange={(event) => update("status", event.target.value)}>
              {INTERACTION_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            <span>Follow-Up</span>
            <input type="date" value={form.follow_up_date} onChange={(event) => update("follow_up_date", event.target.value)} />
          </label>
          <label className="wide">
            <span>Link</span>
            <select value={form.related_record} onChange={(event) => update("related_record", event.target.value)}>
              {relationOptions.map((option) => <option key={option.value || "account"} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="wide">
            <span>Subject</span>
            <input value={form.subject} onChange={(event) => update("subject", event.target.value)} maxLength={180} placeholder="Account update, email subject, or job comment" />
          </label>
          {isEmail && (
            <>
              <label>
                <span>Email From</span>
                <input type="email" value={form.email_from} onChange={(event) => update("email_from", event.target.value)} />
              </label>
              <label>
                <span>Email To</span>
                <input value={form.email_to} onChange={(event) => update("email_to", event.target.value)} />
              </label>
              <label className="wide">
                <span>Email Link</span>
                <input type="url" value={form.email_url} onChange={(event) => update("email_url", event.target.value)} placeholder="https://..." />
              </label>
            </>
          )}
          <label className="wide">
            <span>Notes</span>
            <textarea value={form.body} onChange={(event) => update("body", event.target.value)} rows={5} />
          </label>
          <label>
            <span>Occurred</span>
            <input type="datetime-local" value={form.occurred_at} onChange={(event) => update("occurred_at", event.target.value)} />
          </label>
          <label className="customer-crm-check">
            <input type="checkbox" checked={form.pinned} onChange={(event) => update("pinned", event.target.checked)} />
            <span>Pinned</span>
          </label>
        </div>
        {localError && <p className="customer-crm-error">{localError}</p>}
        <div className="customer-crm-submit">
          <button className="primary-btn" type="submit" disabled={saving}>
            <MessageSquarePlus size={15} />
            {saving ? "Saving..." : "Save Activity"}
          </button>
        </div>
      </form>
    </section>
  );
}

function InteractionRow({ interaction }) {
  const Icon = TYPE_ICON[interaction.interaction_type] || MessageCircle;
  const status = interaction.status_label || choiceLabel(INTERACTION_STATUSES, interaction.status);
  const relation = interactionRelationLabel(interaction);
  const emailPeople = [
    interaction.email_from ? `From ${interaction.email_from}` : "",
    interaction.email_to ? `To ${interaction.email_to}` : "",
  ].filter(Boolean).join(" / ");
  return (
    <article className={`customer-interaction-row ${interaction.pinned ? "pinned" : ""}`}>
      <div className="customer-interaction-top">
        <span className="customer-interaction-icon"><Icon size={14} /></span>
        <div>
          <strong>{interaction.subject || interaction.email_subject || choiceLabel(INTERACTION_TYPES, interaction.interaction_type)}</strong>
          <em>{choiceLabel(INTERACTION_TYPES, interaction.interaction_type)} / {dateTimeLabel(interaction.occurred_at || interaction.created_at)}</em>
        </div>
        <span className={`customer-crm-status ${interactionStatusTone(interaction.status)}`}>{status}</span>
      </div>
      {interaction.body && <p>{interaction.body}</p>}
      <div className="customer-interaction-meta">
        {interaction.created_by && <span>{interaction.created_by}</span>}
        {relation && <span>{relation}</span>}
        {emailPeople && <span>{emailPeople}</span>}
        {interaction.follow_up_date && interaction.status !== "closed" && <span>Follow up {dateLabel(interaction.follow_up_date)}</span>}
        {interaction.pinned && <span>Pinned</span>}
      </div>
      {interaction.email_url && (
        <a className="customer-email-link" href={interaction.email_url} target="_blank" rel="noreferrer">
          <ExternalLink size={13} />
          Open Email
        </a>
      )}
    </article>
  );
}

function OpenLogRow({ interaction, customer, saving, onUpdate, onOpenCustomer }) {
  const [form, setForm] = useState({
    interaction_type: interaction.interaction_type || "note",
    status: interaction.status || "open",
    body: interaction.body || "",
    follow_up_date: interaction.follow_up_date || "",
  });

  useEffect(() => {
    setForm({
      interaction_type: interaction.interaction_type || "note",
      status: interaction.status || "open",
      body: interaction.body || "",
      follow_up_date: interaction.follow_up_date || "",
    });
  }, [interaction.body, interaction.follow_up_date, interaction.id, interaction.interaction_type, interaction.status, interaction.updated_at]);

  const company = customer?.name || interaction.customer_name || "Unknown customer";
  const contact = customer?.contact_name || interaction.email_to || "--";
  const phone = customer?.phone || "--";
  const tone = interactionStatusTone(form.status);
  const lastActivity = interaction.updated_at || interaction.occurred_at || interaction.created_at;
  const dirty = (
    form.interaction_type !== (interaction.interaction_type || "note")
    || form.status !== (interaction.status || "open")
    || form.body !== (interaction.body || "")
    || form.follow_up_date !== (interaction.follow_up_date || "")
  );

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function actionSummary(nextStatus) {
    if (nextStatus === "closed") return "closed this ticket";
    const changes = [];
    if (form.interaction_type !== (interaction.interaction_type || "note")) changes.push("changed contact type");
    if (form.status !== (interaction.status || "open")) changes.push(`changed status to ${choiceLabel(INTERACTION_STATUSES, form.status)}`);
    if (form.follow_up_date !== (interaction.follow_up_date || "")) changes.push("changed last follow-up");
    if (form.body !== (interaction.body || "")) changes.push("updated notes");
    return changes.length ? changes.join(", ") : "saved this ticket";
  }

  async function save(nextStatus = form.status) {
    await onUpdate?.({
      interaction,
      payload: {
        interaction_type: form.interaction_type,
        status: nextStatus,
        body: form.body,
        follow_up_date: form.follow_up_date || null,
      },
      actionSummary: actionSummary(nextStatus),
    });
    setForm((current) => ({ ...current, status: nextStatus }));
  }

  return (
    <div className={`customer-log-row ${tone}`} role="row">
      <div className="customer-log-cell company" role="cell">
        <button type="button" onClick={() => customer?.id && onOpenCustomer?.(customer)} disabled={!customer?.id}>
          <strong>{company}</strong>
          <span>{customer?.customer_code ? `ID ${customer.customer_code}` : customer?.account_owner || "Open account"}</span>
        </button>
      </div>
      <div className="customer-log-cell" role="cell">
        <strong>{contact}</strong>
        <span>{customer?.email || interaction.email_from || "--"}</span>
      </div>
      <div className="customer-log-cell compact" role="cell">
        <strong>{phone}</strong>
        <span>{customer?.account_owner || "Unassigned"}</span>
      </div>
      <label className="customer-log-cell editable" role="cell">
        <select value={form.interaction_type} onChange={(event) => update("interaction_type", event.target.value)}>
          {INTERACTION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="customer-log-cell notes" role="cell">
        <textarea value={form.body} onChange={(event) => update("body", event.target.value)} rows={3} placeholder="Add notes or next steps" />
      </label>
      <label className="customer-log-cell editable" role="cell">
        <input type="date" value={form.follow_up_date || ""} onChange={(event) => update("follow_up_date", event.target.value)} />
        <span>{lastActivity ? `Updated ${dateLabel(lastActivity)}` : "No update date"}</span>
      </label>
      <label className="customer-log-cell editable status" role="cell">
        <select value={form.status} onChange={(event) => update("status", event.target.value)}>
          {INTERACTION_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <span className={`customer-crm-status ${tone}`}>{choiceLabel(INTERACTION_STATUSES, form.status)}</span>
      </label>
      <div className="customer-log-actions" role="cell">
        <button className="ghost-btn xs" type="button" onClick={() => save()} disabled={saving || !onUpdate || !dirty}>Save</button>
        <button className="primary-btn xs" type="button" onClick={() => save("closed")} disabled={saving || !onUpdate}>Close</button>
      </div>
    </div>
  );
}

function OpenLogsSheet({ interactions = [], customersById = new Map(), ownerScope, currentUser, saving, onUpdate, onOpenCustomer }) {
  const rows = useMemo(() => (
    interactions
      .filter(isOpenInteraction)
      .map((interaction) => {
        const customer = customersById.get(interactionCustomerId(interaction)) || {
          id: interactionCustomerId(interaction),
          name: interaction.customer_name,
        };
        return { interaction, customer };
      })
      .filter(({ customer }) => ownerScope !== "mine" || !(currentUser?.name || currentUser?.username) || customerMatchesOwner(customer, currentUser))
      .sort((a, b) => {
        const dateDiff = sortDateValue(a.interaction.follow_up_date || a.interaction.occurred_at || a.interaction.created_at)
          - sortDateValue(b.interaction.follow_up_date || b.interaction.occurred_at || b.interaction.created_at);
        if (dateDiff) return dateDiff;
        return String(a.customer?.name || "").localeCompare(String(b.customer?.name || ""));
      })
  ), [customersById, currentUser, interactions, ownerScope]);

  return (
    <section className="customer-open-log-sheet customer-page-card">
      <header>
        <div>
          <strong>Open Tickets</strong>
          <span>{rows.length} item{rows.length === 1 ? "" : "s"} needing follow-up</span>
        </div>
      </header>
      <div className="customer-open-log-scroll">
        <div className="customer-log-table" role="table" aria-label="Open customer logs">
          <div className="customer-log-head" role="row">
            <span>Company</span>
            <span>Primary Contact</span>
            <span>Phone</span>
            <span>Contact Type</span>
            <span>Notes</span>
            <span>Last Follow-Up</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          {rows.map(({ interaction, customer }) => (
            <OpenLogRow
              key={interaction.id}
              interaction={interaction}
              customer={customer}
              saving={saving}
              onUpdate={onUpdate}
              onOpenCustomer={onOpenCustomer}
            />
          ))}
          {!rows.length && (
            <div className="customer-log-empty">
              {ownerScope === "mine" ? "No open tickets for your accounts." : "No open customer tickets are waiting right now."}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TicketQueueItem({ ticket, active, onSelect }) {
  const tone = interactionStatusTone(ticket.status);
  const Icon = TYPE_ICON[ticket.interaction_type] || MessageCircle;
  const reference = ticketReference(ticket);
  return (
    <button className={`customer-ticket-queue-item ${active ? "active" : ""} ${tone}`} type="button" onClick={() => onSelect?.(ticket)}>
      <span className="customer-ticket-icon"><Icon size={15} /></span>
      <span className="customer-ticket-copy">
        <strong>{ticketTitle(ticket)}</strong>
        <em>{reference}</em>
      </span>
      <span className="customer-ticket-side">
        <b>{dateLabel(ticket.follow_up_date || ticket.updated_at || ticket.occurred_at)}</b>
        <i>{choiceLabel(INTERACTION_STATUSES, ticket.status)}</i>
      </span>
    </button>
  );
}

function CustomerTicketPreview({ tickets, onOpenTicket, onViewAll, loading }) {
  return (
    <section className="customer-page-card customer-ticket-preview-card">
      <header>
        <strong>Open Tickets</strong>
        <span>{tickets.length}</span>
      </header>
      <div className="customer-ticket-preview-list">
        {tickets.slice(0, 4).map((ticket) => (
          <button type="button" key={ticket.id} onClick={() => onOpenTicket?.(ticket)}>
            <strong>{ticketTitle(ticket)}</strong>
            <span>{[choiceLabel(INTERACTION_STATUSES, ticket.status), ticket.follow_up_date ? `Follow up ${dateLabel(ticket.follow_up_date)}` : ""].filter(Boolean).join(" / ")}</span>
          </button>
        ))}
        {!tickets.length && <p>{loading ? "Loading tickets..." : "No open customer tickets."}</p>}
      </div>
      <footer>
        <button className="ghost-btn" type="button" onClick={onViewAll}>View Tickets</button>
      </footer>
    </section>
  );
}

function TicketChangeHistory({ ticket }) {
  const auditEntries = interactionAuditEntries(ticket);
  return (
    <div className="customer-ticket-history">
      <strong>Change History</strong>
      <div>
        {auditEntries.map((entry, index) => <span key={`${ticket.id}-audit-${index}`}>{entry}</span>)}
        {!auditEntries.length && <span>No saved changes have been logged yet.</span>}
      </div>
    </div>
  );
}

function CustomerTicketDetail({ ticket, saving, onUpdate, onNotifyTeam }) {
  const [form, setForm] = useState({
    subject: ticket?.subject || ticket?.email_subject || "",
    interaction_type: ticket?.interaction_type || "note",
    status: ticket?.status || "open",
    follow_up_date: ticket?.follow_up_date || "",
    body: interactionNotesWithoutAudit(ticket),
    pinned: Boolean(ticket?.pinned),
  });
  const [quickNote, setQuickNote] = useState("");
  const tone = interactionStatusTone(form.status);
  const relation = ticketReference(ticket);
  const createdLine = [ticket?.created_by, dateTimeLabel(ticket?.created_at || ticket?.occurred_at)].filter(Boolean).join(" / ");
  const updatedLine = [ticket?.updated_by, dateTimeLabel(ticket?.updated_at)].filter(Boolean).join(" / ");

  useEffect(() => {
    setForm({
      subject: ticket?.subject || ticket?.email_subject || "",
      interaction_type: ticket?.interaction_type || "note",
      status: ticket?.status || "open",
      follow_up_date: ticket?.follow_up_date || "",
      body: interactionNotesWithoutAudit(ticket),
      pinned: Boolean(ticket?.pinned),
    });
    setQuickNote("");
  }, [ticket?.body, ticket?.follow_up_date, ticket?.id, ticket?.interaction_type, ticket?.pinned, ticket?.status, ticket?.subject, ticket?.updated_at]);

  if (!ticket) {
    return (
      <section className="customer-ticket-detail customer-page-card">
        <div className="customer-ticket-empty">
          <CheckCircle2 size={22} />
          <strong>No open ticket selected</strong>
          <p>Open tickets for this customer will appear here when they need follow-up.</p>
        </div>
      </section>
    );
  }

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function changeSummary(nextStatus = form.status) {
    const changes = [];
    if ((form.subject.trim() || ticketTitle(ticket)) !== (ticket.subject || ticket.email_subject || "")) changes.push("updated title");
    if (form.interaction_type !== (ticket.interaction_type || "note")) changes.push("changed type");
    if (nextStatus !== (ticket.status || "open")) changes.push(`changed status to ${choiceLabel(INTERACTION_STATUSES, nextStatus)}`);
    if ((form.follow_up_date || "") !== (ticket.follow_up_date || "")) changes.push("changed follow-up date");
    if (form.body !== interactionNotesWithoutAudit(ticket)) changes.push("updated notes");
    if (form.pinned !== Boolean(ticket.pinned)) changes.push(form.pinned ? "pinned ticket" : "unpinned ticket");
    if (quickNote.trim()) changes.push("added update note");
    return changes.length ? changes.join(", ") : "reviewed ticket";
  }

  async function save(nextStatus = form.status) {
    const auditBlock = interactionAuditEntries(ticket).join("\n");
    const nextNotes = [form.body.trim(), quickNote.trim()].filter(Boolean).join("\n\n");
    await onUpdate?.({
      interaction: ticket,
      payload: {
        subject: form.subject.trim() || ticketTitle(ticket),
        interaction_type: form.interaction_type,
        status: nextStatus,
        follow_up_date: form.follow_up_date || null,
        body: [nextNotes, auditBlock].filter(Boolean).join("\n\n"),
        pinned: form.pinned,
      },
      actionSummary: changeSummary(nextStatus),
    });
    setQuickNote("");
    setForm((current) => ({ ...current, status: nextStatus, body: nextNotes }));
  }

  const dirty = (
    (form.subject.trim() || ticketTitle(ticket)) !== (ticket.subject || ticket.email_subject || "")
    || form.interaction_type !== (ticket.interaction_type || "note")
    || form.status !== (ticket.status || "open")
    || (form.follow_up_date || "") !== (ticket.follow_up_date || "")
    || form.body !== interactionNotesWithoutAudit(ticket)
    || form.pinned !== Boolean(ticket.pinned)
    || Boolean(quickNote.trim())
  );

  return (
    <section className="customer-ticket-detail customer-page-card">
      <header>
        <div>
          <strong>{ticketTitle(ticket)}</strong>
          <span>{relation}</span>
        </div>
        <span className={`customer-crm-status ${tone}`}>{choiceLabel(INTERACTION_STATUSES, form.status)}</span>
      </header>

      <div className="customer-ticket-detail-meta">
        <span>Created {createdLine || "--"}</span>
        <span>Updated {updatedLine || "--"}</span>
        {ticket.follow_up_date && <span>Follow up {dateLabel(ticket.follow_up_date)}</span>}
      </div>

      <form className="customer-ticket-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <label className="wide">
          <span>Ticket Title</span>
          <input value={form.subject} onChange={(event) => update("subject", event.target.value)} maxLength={180} placeholder="What needs to be handled?" />
        </label>
        <label>
          <span>Type</span>
          <select value={form.interaction_type} onChange={(event) => update("interaction_type", event.target.value)}>
            {INTERACTION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select value={form.status} onChange={(event) => update("status", event.target.value)}>
            {INTERACTION_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>Follow-Up</span>
          <input type="date" value={form.follow_up_date || ""} onChange={(event) => update("follow_up_date", event.target.value)} />
        </label>
        <label className="customer-ticket-check">
          <input type="checkbox" checked={form.pinned} onChange={(event) => update("pinned", event.target.checked)} />
          <span>Pinned</span>
        </label>
        <label className="wide">
          <span>Ticket Notes</span>
          <textarea value={form.body} onChange={(event) => update("body", event.target.value)} rows={7} placeholder="Current details, customer context, and next steps" />
        </label>
        <label className="wide">
          <span>Add Update</span>
          <textarea value={quickNote} onChange={(event) => setQuickNote(event.target.value)} rows={3} placeholder="Add what changed today" />
        </label>
        <div className="customer-ticket-actions">
          <button className="ghost-btn" type="button" onClick={onNotifyTeam}>Notify Team</button>
          <button className="ghost-btn" type="submit" disabled={saving || !onUpdate || !dirty}>{saving ? "Saving..." : "Save Changes"}</button>
          <button className="primary-btn" type="button" onClick={() => save("closed")} disabled={saving || !onUpdate}>{saving ? "Closing..." : "Close Ticket"}</button>
        </div>
      </form>

      <TicketChangeHistory ticket={ticket} />
    </section>
  );
}

function CustomerTicketWorkspace({ tickets, selectedTicketId, onSelectTicket, saving, onUpdate, onNotifyTeam, loading }) {
  const sortedTickets = useMemo(() => (
    [...tickets].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      const aDate = ticketSortValue(a);
      const bDate = ticketSortValue(b);
      if (aDate && bDate && aDate !== bDate) return aDate - bDate;
      if (aDate !== bDate) return aDate ? -1 : 1;
      return sortDateValue(b.updated_at || b.created_at) - sortDateValue(a.updated_at || a.created_at);
    })
  ), [tickets]);
  const selectedTicket = sortedTickets.find((ticket) => sameId(ticket.id, selectedTicketId)) || sortedTickets[0] || null;
  const waitingInternal = sortedTickets.filter((ticket) => String(ticket.status) === "waiting_internal").length;
  const waitingCustomer = sortedTickets.filter((ticket) => String(ticket.status) === "waiting_customer").length;

  return (
    <section className="customer-page-content customer-ticket-page">
      <section className="customer-ticket-queue customer-page-card">
        <header>
          <div>
            <strong>Ticket Queue</strong>
            <span>{sortedTickets.length} open</span>
          </div>
        </header>
        <div className="customer-ticket-mini-stats">
          <span><b>{waitingInternal}</b> Internal</span>
          <span><b>{waitingCustomer}</b> Customer</span>
        </div>
        <div className="customer-ticket-queue-list">
          {sortedTickets.map((ticket) => (
            <TicketQueueItem
              key={ticket.id}
              ticket={ticket}
              active={sameId(ticket.id, selectedTicket?.id)}
              onSelect={(row) => onSelectTicket?.(String(row.id))}
            />
          ))}
          {!sortedTickets.length && <p>{loading ? "Loading tickets..." : "No open tickets for this customer."}</p>}
        </div>
      </section>

      <CustomerTicketDetail
        ticket={selectedTicket}
        saving={saving}
        onUpdate={onUpdate}
        onNotifyTeam={onNotifyTeam}
      />
    </section>
  );
}

function TeamNotifyPanel({ customer, users = [], currentUser, relationOptions, saving, onNotify }) {
  const [recipientIds, setRecipientIds] = useState([]);
  const [relatedValue, setRelatedValue] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [localError, setLocalError] = useState("");
  const [sent, setSent] = useState("");
  const viewerId = userId(currentUser);
  const activeUsers = users.filter((user) => user?.active !== false && userId(user) && userId(user) !== viewerId);
  const relatedRecord = relationOptions.find((option) => option.value === relatedValue) || relationOptions[0];

  function toggleRecipient(id) {
    setRecipientIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setLocalError("");
    setSent("");
  }

  async function submit(event) {
    event.preventDefault();
    if (!recipientIds.length) {
      setLocalError("Choose at least one team member.");
      return;
    }
    if (!body.trim()) {
      setLocalError("Add a note for the team.");
      return;
    }
    await onNotify?.({
      customer,
      recipientIds,
      subject: subject.trim() || `${customer.name} follow-up`,
      body: body.trim(),
      relatedRecord,
    });
    setRecipientIds([]);
    setRelatedValue("");
    setSubject("");
    setBody("");
    setLocalError("");
    setSent("Team notification sent and logged on this customer.");
  }

  return (
    <section className="customer-team-panel customer-page-card">
      <header>
        <div>
          <strong>Notify Team</strong>
          <span>Create a message board linked to this customer.</span>
        </div>
      </header>
      <form onSubmit={submit}>
        <div className="customer-team-picker">
          {activeUsers.map((user) => {
            const id = userId(user);
            return (
              <button className={recipientIds.includes(id) ? "active" : ""} type="button" key={id} onClick={() => toggleRecipient(id)}>
                <span>{userLabel(user)}</span>
                <em>{user.role || "Team"}</em>
              </button>
            );
          })}
          {!activeUsers.length && <p>No active users are available to notify.</p>}
        </div>
        <div className="customer-crm-fields">
          <label className="wide">
            <span>Related Item</span>
            <select value={relatedValue} onChange={(event) => setRelatedValue(event.target.value)}>
              {relationOptions.map((option) => <option key={option.value || "account"} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="wide">
            <span>Subject</span>
            <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder={`${customer.name} follow-up`} />
          </label>
          <label className="wide">
            <span>Team Note</span>
            <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} placeholder="What should sales, production, art, or management know?" />
          </label>
        </div>
        {localError && <p className="customer-crm-error">{localError}</p>}
        {sent && <p className="customer-team-success">{sent}</p>}
        <div className="customer-crm-submit">
          <button className="primary-btn" type="submit" disabled={saving || !activeUsers.length}>
            <Send size={15} />
            {saving ? "Sending..." : "Notify Team"}
          </button>
        </div>
      </form>
    </section>
  );
}

export default function CustomerWorkspace({
  rows,
  allRows = rows,
  totalCount = 0,
  search = "",
  selected,
  quotes = [],
  orders = [],
  jobTickets = [],
  interactions = [],
  openInteractions = [],
  users = [],
  currentUser,
  interactionSaving = false,
  openLogSaving = false,
  notifyTeamSaving = false,
  loading = false,
  onSearchChange,
  onSelect,
  onEdit,
  onDelete,
  onQuote,
  onAddInteraction,
  onUpdateOpenLog,
  onNotifyTeam,
}) {
  const [activePage, setActivePage] = useState("overview");
  const [showInlineResults, setShowInlineResults] = useState(false);
  const [ownerScope, setOwnerScope] = useState("mine");
  const [showOpenLogs, setShowOpenLogs] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState("");
  const address = customerAddressLines(selected);
  const quoteTotalValue = quotes.reduce((sum, quote) => sum + quoteTotal(quote), 0);
  const openOrders = orders.filter(orderOpen);
  const shippedUnits = orders.reduce((sum, order) => sum + Number(order.quantity_to_ship || 0), 0);
  const customersById = useMemo(() => new Map(allRows.map((row) => [String(row.id), row])), [allRows]);
  const openInteractionRows = useMemo(() => openInteractions.filter(isOpenInteraction), [openInteractions]);
  const notificationCounts = useMemo(() => {
    const counts = new Map();
    for (const interaction of openInteractionRows) {
      const key = interactionCustomerId(interaction);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [openInteractionRows]);
  const ownerFilteredRows = useMemo(() => (
    ownerScope === "mine" && (currentUser?.name || currentUser?.username)
      ? rows.filter((row) => customerMatchesOwner(row, currentUser))
      : rows
  ), [currentUser, ownerScope, rows]);
  const sortedCustomerRows = useMemo(() => (
    [...ownerFilteredRows].sort((a, b) => {
      const notificationDiff = (notificationCounts.get(String(b.id)) || 0) - (notificationCounts.get(String(a.id)) || 0);
      if (notificationDiff) return notificationDiff;
      return String(a.name || "").localeCompare(String(b.name || ""));
    })
  ), [notificationCounts, ownerFilteredRows]);
  const visibleOpenLogCount = useMemo(() => (
    openInteractionRows.filter((interaction) => {
      if (ownerScope !== "mine" || !(currentUser?.name || currentUser?.username)) return true;
      const customer = customersById.get(interactionCustomerId(interaction));
      return customerMatchesOwner(customer, currentUser);
    }).length
  ), [customersById, currentUser, openInteractionRows, ownerScope]);
  const sortedInteractions = useMemo(() => (
    [...interactions].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      return new Date(b.occurred_at || b.created_at || 0) - new Date(a.occurred_at || a.created_at || 0);
    })
  ), [interactions]);
  const selectedNotificationCount = selected ? (notificationCounts.get(String(selected.id)) || 0) : 0;
  const customerOpenTickets = useMemo(() => (
    sortedInteractions
      .filter(isOpenInteraction)
      .sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
        const aDate = ticketSortValue(a);
        const bDate = ticketSortValue(b);
        if (aDate && bDate && aDate !== bDate) return aDate - bDate;
        if (aDate !== bDate) return aDate ? -1 : 1;
        return sortDateValue(b.updated_at || b.created_at) - sortDateValue(a.updated_at || a.created_at);
      })
  ), [sortedInteractions]);
  const ticketBadgeCount = customerOpenTickets.length || selectedNotificationCount;
  const openFollowUps = customerOpenTickets.length;
  const lastTouch = selected?.last_contacted_at || sortedInteractions.find((interaction) => ["email", "call", "meeting"].includes(interaction.interaction_type))?.occurred_at;
  const relationOptions = useMemo(() => [
    { value: "", label: "Account only" },
    ...orders.map((order) => ({ value: `order:${order.id}`, label: `Order - ${relationOptionLabel("order", order)}` })),
    ...jobTickets.map((ticket) => ({ value: `job:${ticket.id}`, label: `Job - ${relationOptionLabel("job", ticket)}` })),
    ...quotes.map((quote) => ({ value: `quote:${quote.id}`, label: `Quote - ${relationOptionLabel("quote", quote)}` })),
  ], [jobTickets, orders, quotes]);
  const timeline = [
    ...sortedInteractions.map((interaction) => ({
      type: "crm",
      interactionType: interaction.interaction_type,
      date: interaction.occurred_at || interaction.created_at,
      title: interaction.subject || interaction.email_subject || choiceLabel(INTERACTION_TYPES, interaction.interaction_type),
      detail: [interaction.status_label || statusLabel(interaction.status), interactionRelationLabel(interaction)].filter(Boolean).join(" / "),
      id: interaction.id,
    })),
    ...quotes.map((quote) => ({
      type: "quote",
      date: quote.createdAt || quote.created_at,
      title: quoteNumber(quote),
      detail: `${money(quoteTotal(quote))} / ${quoteJobName(quote)}`,
      id: quote.id || quoteNumber(quote),
    })),
    ...orders.map((order) => ({
      type: "order",
      date: order.order_date || order.scheduled_date || order.updated_at,
      title: order.order_number || "Order",
      detail: `${statusLabel(order.status)} / ${order.job_name || "No job name"}`,
      id: order.id || order.order_number,
    })),
  ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 10);
  const searchResults = sortedCustomerRows.slice(0, search.trim() ? 12 : 6);

  useEffect(() => {
    if (!selected?.id || !customerOpenTickets.length) {
      setSelectedTicketId("");
      return;
    }
    if (!customerOpenTickets.some((ticket) => sameId(ticket.id, selectedTicketId))) {
      setSelectedTicketId(String(customerOpenTickets[0].id));
    }
  }, [customerOpenTickets, selected?.id, selectedTicketId]);

  function selectCustomer(row) {
    setActivePage("overview");
    setShowInlineResults(false);
    setSelectedTicketId("");
    onSearchChange?.("");
    onSelect?.(row);
  }

  function backToSearch() {
    setActivePage("overview");
    setShowInlineResults(false);
    onSearchChange?.("");
    onSelect?.(null);
  }

  function updateSearch(value) {
    onSearchChange?.(value);
    setShowInlineResults(Boolean(String(value || "").trim()));
  }

  function openTicket(ticket) {
    setSelectedTicketId(String(ticket?.id || ""));
    setActivePage("tickets");
  }

  if (!selected) {
    return (
      <section className="customer-crm-page">
        <div className="customer-crm-home">
          <section className="customer-home-hero">
            <div>
              <span>Customer CRM</span>
              <h3>Customer Accounts</h3>
              <p>Search accounts, review open follow-ups, and keep customer notes, jobs, quotes, and team messages in one place.</p>
            </div>
            <div className="customer-home-search">
              <CustomerSearchInput value={search} onChange={updateSearch} count={sortedCustomerRows.length} total={totalCount || rows.length} autoFocus />
              <div className="customer-home-controls">
                <div className="customer-scope-toggle" role="group" aria-label="Customer account scope">
                  <button className={ownerScope === "mine" ? "active" : ""} type="button" onClick={() => setOwnerScope("mine")}>My Accounts</button>
                  <button className={ownerScope === "all" ? "active" : ""} type="button" onClick={() => setOwnerScope("all")}>All Accounts</button>
                </div>
                <button className={`customer-open-log-toggle ${showOpenLogs ? "active" : ""}`} type="button" onClick={() => setShowOpenLogs((value) => !value)}>
                  <Bell size={15} />
                  {showOpenLogs ? "Hide Open Tickets" : "Show Open Tickets"}
                  {visibleOpenLogCount > 0 && <span>{visibleOpenLogCount}</span>}
                </button>
              </div>
            </div>
          </section>

          <section className="customer-home-stats">
            <Metric label="Accounts" value={number(totalCount || rows.length)} detail="available customer records" />
            <Metric label={ownerScope === "mine" ? "My Results" : "Search Results"} value={number(sortedCustomerRows.length)} detail={search.trim() ? "matching this search" : ownerScope === "mine" ? "assigned to you" : "visible accounts"} />
            <Metric label="Open Tickets" value={number(visibleOpenLogCount)} detail="not closed yet" tone={visibleOpenLogCount ? "watch" : ""} />
          </section>

          {showOpenLogs && (
            <OpenLogsSheet
              interactions={openInteractionRows}
              customersById={customersById}
              ownerScope={ownerScope}
              currentUser={currentUser}
              saving={openLogSaving}
              onUpdate={onUpdateOpenLog}
              onOpenCustomer={selectCustomer}
            />
          )}

          <section className="customer-results-panel">
            <header>
              <strong>{search.trim() ? "Matching Accounts" : "Start Here"}</strong>
              <span>{search.trim() ? `${sortedCustomerRows.length} result${sortedCustomerRows.length === 1 ? "" : "s"}` : "Open logs are sorted to the top"}</span>
            </header>
            <div className="customer-search-grid">
              {searchResults.map((customer) => (
                <CustomerCard key={customer.id} customer={customer} notificationCount={notificationCounts.get(String(customer.id)) || 0} onSelect={selectCustomer} />
              ))}
              {!searchResults.length && <p>{loading ? "Loading customers..." : "No customers match this search."}</p>}
            </div>
          </section>
        </div>
      </section>
    );
  }

  return (
    <section className="customer-crm-page">
      <header className="customer-record-searchbar">
        <button className="customer-back-btn" type="button" onClick={backToSearch}>
          <ArrowLeft size={16} />
          Back
        </button>
        <CustomerSearchInput
          value={search}
          onChange={updateSearch}
          onFocus={() => setShowInlineResults(Boolean(search.trim()))}
          count={sortedCustomerRows.length}
          total={totalCount || rows.length}
        />
        {showInlineResults && search.trim() && (
          <div className="customer-inline-results">
            {sortedCustomerRows.slice(0, 6).map((customer) => (
              <CustomerCard
                key={customer.id}
                customer={customer}
                selected={sameId(customer.id, selected.id)}
                notificationCount={notificationCounts.get(String(customer.id)) || 0}
                onSelect={selectCustomer}
              />
            ))}
            {!sortedCustomerRows.length && <p>No customers match this search.</p>}
          </div>
        )}
      </header>

      <section className="customer-account-shell">
        <header className="customer-record-hero">
          <div className="customer-account-title">
            <span>{selected.is_active === false ? "Inactive Customer" : `${choiceLabel(CRM_STAGES, selected.crm_stage || "active")} Customer`}</span>
            <h3>{selected.name}</h3>
            <p>{selected.customer_code ? `Customer ID ${selected.customer_code}` : "No Customer ID on file"}</p>
            {selectedNotificationCount > 0 && (
              <button className="customer-record-alert" type="button" onClick={() => setActivePage("tickets")}>
                <Bell size={14} />
                {selectedNotificationCount} open ticket{selectedNotificationCount === 1 ? "" : "s"}
              </button>
            )}
          </div>
          <div className="customer-record-actions">
            <button className="ghost-btn" type="button" onClick={() => onQuote?.(selected)}>Quote</button>
            <button className="primary-btn" type="button" onClick={() => onEdit(selected)}>Edit Customer</button>
            <button className="danger-btn" type="button" onClick={() => onDelete(selected)}>Delete</button>
          </div>
        </header>

        <nav className="customer-page-tabs" aria-label="Customer pages">
          {CUSTOMER_PAGES.map(([key, label]) => (
            <button className={activePage === key ? "active" : ""} type="button" key={key} onClick={() => setActivePage(key)}>
              {label}
              {key === "tickets" && ticketBadgeCount > 0 && <span>{ticketBadgeCount}</span>}
              {key === "activity" && sortedInteractions.length > 0 && <span>{sortedInteractions.length}</span>}
            </button>
          ))}
        </nav>

        {activePage === "overview" && (
          <section className="customer-page-content customer-overview-page">
            <section className="customer-home-stats customer-overview-stats">
              <Metric label="Open Orders" value={openOrders.length.toLocaleString()} detail={`${orders.length} total order${orders.length === 1 ? "" : "s"}`} tone={openOrders.length ? "watch" : ""} />
              <Metric label="Open Tickets" value={openFollowUps.toLocaleString()} detail={`${sortedInteractions.length} CRM touch${sortedInteractions.length === 1 ? "" : "es"}`} tone={openFollowUps ? "watch" : ""} />
              <Metric label="Quote Value" value={money(quoteTotalValue)} detail={`${quotes.length} saved quote${quotes.length === 1 ? "" : "s"}`} tone="money" />
              <Metric label="Production Jobs" value={jobTickets.length.toLocaleString()} detail={`${number(shippedUnits)} labels to ship`} />
            </section>

            <div className="customer-overview-grid">
              <section className="customer-page-card">
                <header><strong>Account Snapshot</strong></header>
                <div className="customer-fact-list">
                  <FactRow icon={AtSign} label="Owner" value={selected.account_owner || "Unassigned"} />
                  <FactRow icon={CheckCircle2} label="Stage" value={choiceLabel(CRM_STAGES, selected.crm_stage || (selected.is_active === false ? "inactive" : "active"))} />
                  <FactRow icon={CalendarDays} label="Next Follow-Up" value={dateLabel(selected.next_follow_up)} />
                  <FactRow icon={Clock3} label="Last Touch" value={dateLabel(lastTouch)} />
                  <FactRow icon={UserRound} label="Contact" value={selected.contact_name || "No primary contact"} />
                  <FactRow icon={Mail} label="Email" value={selected.email || "No email"} href={selected.email ? `mailto:${selected.email}` : ""} />
                  <FactRow icon={Phone} label="Phone" value={selected.phone || "No phone"} href={selected.phone ? `tel:${selected.phone}` : ""} />
                  <FactRow icon={MapPin} label="Address" value={address.join(" / ") || "No address"} />
                  {selected.website && <FactRow icon={ExternalLink} label="Website" value={String(selected.website).replace(/^https?:\/\//i, "")} href={externalUrl(selected.website)} />}
                  {selected.source_sheet_url && <FactRow icon={Link2} label="Source Sheet" value="Open Sheet" href={externalUrl(selected.source_sheet_url)} />}
                </div>
              </section>

              <CustomerTicketPreview
                tickets={customerOpenTickets}
                loading={loading}
                onOpenTicket={openTicket}
                onViewAll={() => setActivePage("tickets")}
              />

              <section className="customer-page-card customer-notes">
                <header><strong>Account Notes</strong></header>
                <p>{selected.notes || "No account notes have been added yet."}</p>
              </section>
            </div>
          </section>
        )}

        {activePage === "tickets" && (
          <CustomerTicketWorkspace
            tickets={customerOpenTickets}
            selectedTicketId={selectedTicketId}
            onSelectTicket={setSelectedTicketId}
            saving={openLogSaving}
            onUpdate={onUpdateOpenLog}
            onNotifyTeam={() => setActivePage("team")}
            loading={loading}
          />
        )}

        {activePage === "activity" && (
          <section className="customer-page-content customer-activity-page">
            <CustomerInteractionComposer
              key={selected.id}
              selected={selected}
              relationOptions={relationOptions}
              currentUser={currentUser}
              saving={interactionSaving}
              onSubmit={onAddInteraction}
            />
            <section className="customer-crm-feed customer-page-card">
              <header>
                <div>
                  <strong>Activity Timeline</strong>
                  <span>{sortedInteractions.length} activit{sortedInteractions.length === 1 ? "y" : "ies"}</span>
                </div>
              </header>
              <div className="customer-interaction-list">
                {sortedInteractions.map((interaction) => <InteractionRow key={interaction.id} interaction={interaction} />)}
                {!sortedInteractions.length && <p>{loading ? "Loading activity..." : "No CRM activity has been logged for this customer."}</p>}
              </div>
            </section>
          </section>
        )}

        {activePage === "work" && (
          <section className="customer-page-content customer-work-page">
            <RelatedCard icon={ReceiptText} title="Orders" count={orders.length}>
              <div className="customer-activity-list">
                {orders.slice(0, 10).map((order) => <OrderRow key={order.id || order.order_number} order={order} />)}
                {!orders.length && <p>{loading ? "Loading orders..." : "No orders found for this customer."}</p>}
              </div>
            </RelatedCard>
            <RelatedCard icon={FileText} title="Quotes" count={quotes.length}>
              <div className="customer-activity-list">
                {quotes.slice(0, 10).map((quote) => <QuoteRow key={quote.id || quoteNumber(quote)} quote={quote} />)}
                {!quotes.length && <p>{loading ? "Loading quotes..." : "No quotes found for this customer."}</p>}
              </div>
            </RelatedCard>
            <RelatedCard icon={BriefcaseBusiness} title="Production Job Tickets" count={jobTickets.length}>
              <div className="customer-ticket-list">
                {jobTickets.slice(0, 12).map((ticket) => <TicketRow key={ticket.id} ticket={ticket} />)}
                {!jobTickets.length && <p>{loading ? "Loading job tickets..." : "No job tickets linked yet."}</p>}
              </div>
            </RelatedCard>
            <RelatedCard icon={Clock3} title="Recent Movement" count={timeline.length}>
              <div className="customer-timeline">
                {timeline.map((item) => <TimelineRow key={`${item.type}-${item.id}-${item.date}`} item={item} />)}
                {!timeline.length && <p>Quotes, orders, and CRM activity will appear here as this account grows.</p>}
              </div>
            </RelatedCard>
          </section>
        )}

        {activePage === "team" && (
          <section className="customer-page-content customer-team-page">
            <TeamNotifyPanel
              customer={selected}
              users={users}
              currentUser={currentUser}
              relationOptions={relationOptions}
              saving={notifyTeamSaving}
              onNotify={onNotifyTeam}
            />
            <section className="customer-page-card customer-team-info">
              <header>
                <Bell size={15} />
                <strong>How Team Messages Work</strong>
              </header>
              <p>Choose a sales, production, art, or management teammate, add the note, and this creates a message board linked to this customer. The note is also logged in the Activity page so the account history stays together.</p>
              <div>
                <Users size={18} />
                <strong>{users.filter((user) => user?.active !== false).length}</strong>
                <span>active team members</span>
              </div>
            </section>
          </section>
        )}
      </section>
    </section>
  );
}
