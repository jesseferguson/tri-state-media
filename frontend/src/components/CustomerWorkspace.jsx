import { useMemo, useState } from "react";
import {
  AtSign,
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
  UserRound,
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

function sameId(a, b) {
  return String(a ?? "") === String(b ?? "");
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

function CustomerListRow({ customer, selected, onSelect }) {
  const stage = customer.crm_stage ? choiceLabel(CRM_STAGES, customer.crm_stage) : customer.is_active === false ? "Inactive" : "Active";
  return (
    <button className={`customer-row ${selected ? "active" : ""}`} type="button" onClick={() => onSelect(customer)}>
      <span className="customer-row-initial">{String(customer.name || "?").slice(0, 1).toUpperCase()}</span>
      <span>
        <strong>{customer.name || "Unnamed customer"}</strong>
        <em>{[customer.customer_code ? `ID ${customer.customer_code}` : "", customer.contact_name, stage].filter(Boolean).join(" / ") || "No customer ID"}</em>
      </span>
      <small>{customer.account_owner || customer.email || customer.phone || "Unassigned account"}</small>
    </button>
  );
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
    <section className="customer-crm-form">
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

export default function CustomerWorkspace({
  rows,
  selected,
  quotes = [],
  orders = [],
  jobTickets = [],
  interactions = [],
  currentUser,
  interactionSaving = false,
  loading = false,
  onSelect,
  onEdit,
  onDelete,
  onQuote,
  onAddInteraction,
}) {
  const address = customerAddressLines(selected);
  const quoteTotalValue = quotes.reduce((sum, quote) => sum + quoteTotal(quote), 0);
  const openOrders = orders.filter(orderOpen);
  const shippedUnits = orders.reduce((sum, order) => sum + Number(order.quantity_to_ship || 0), 0);
  const sortedInteractions = useMemo(() => (
    [...interactions].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      return new Date(b.occurred_at || b.created_at || 0) - new Date(a.occurred_at || a.created_at || 0);
    })
  ), [interactions]);
  const openFollowUps = sortedInteractions.filter((interaction) => interaction.follow_up_date && interaction.status !== "closed").length;
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
  ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 12);

  return (
    <section className="customer-workspace">
      <aside className="customer-directory">
        <div className="customer-directory-head">
          <span>{rows.length.toLocaleString()} accounts</span>
          <strong>Customer Directory</strong>
        </div>
        <div className="customer-row-list">
          {rows.map((customer) => (
            <CustomerListRow key={customer.id} customer={customer} selected={sameId(customer.id, selected?.id)} onSelect={onSelect} />
          ))}
          {!rows.length && <p>No customers match this search.</p>}
        </div>
      </aside>

      <section className="customer-account">
        {selected ? (
          <>
            <header className="customer-record-hero">
              <div className="customer-account-title">
                <span>{selected.is_active === false ? "Inactive Customer" : `${choiceLabel(CRM_STAGES, selected.crm_stage || "active")} Customer`}</span>
                <h3>{selected.name}</h3>
                <p>{selected.customer_code ? `Customer ID ${selected.customer_code}` : "No Customer ID on file"}</p>
              </div>
              <div className="customer-record-actions">
                <button className="ghost-btn" type="button" onClick={() => onQuote?.(selected)}>Quote</button>
                <button className="primary-btn" type="button" onClick={() => onEdit(selected)}>Edit Customer</button>
                <button className="danger-btn" type="button" onClick={() => onDelete(selected)}>Delete</button>
              </div>
              <section className="customer-metric-grid customer-highlight-grid">
                <Metric label="Open Orders" value={openOrders.length.toLocaleString()} detail={`${orders.length} total order${orders.length === 1 ? "" : "s"}`} tone={openOrders.length ? "watch" : ""} />
                <Metric label="Open Follow-Ups" value={openFollowUps.toLocaleString()} detail={`${sortedInteractions.length} CRM touch${sortedInteractions.length === 1 ? "" : "es"}`} />
                <Metric label="Quote Value" value={money(quoteTotalValue)} detail={`${quotes.length} saved quote${quotes.length === 1 ? "" : "s"}`} tone="money" />
                <Metric label="Job Tickets" value={jobTickets.length.toLocaleString()} detail={`${number(shippedUnits)} labels to ship`} />
              </section>
            </header>

            <section className="customer-record-layout">
              <aside className="customer-record-sidebar">
                <section className="customer-record-card">
                  <header>
                    <strong>Account Snapshot</strong>
                  </header>
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

                {selected.notes && (
                  <section className="customer-record-card customer-notes">
                    <header>
                      <strong>Account Notes</strong>
                    </header>
                    <p>{selected.notes}</p>
                  </section>
                )}
              </aside>

              <main className="customer-record-main">
                <CustomerInteractionComposer
                  key={selected.id}
                  selected={selected}
                  relationOptions={relationOptions}
                  currentUser={currentUser}
                  saving={interactionSaving}
                  onSubmit={onAddInteraction}
                />
                <section className="customer-crm-feed customer-primary-feed">
                  <header>
                    <div>
                      <strong>Activity Timeline</strong>
                      <span>{sortedInteractions.length} activit{sortedInteractions.length === 1 ? "y" : "ies"}</span>
                    </div>
                  </header>
                  <div className="customer-interaction-list">
                    {sortedInteractions.slice(0, 14).map((interaction) => <InteractionRow key={interaction.id} interaction={interaction} />)}
                    {!sortedInteractions.length && <p>{loading ? "Loading activity..." : "No CRM activity has been logged for this customer."}</p>}
                  </div>
                </section>
              </main>

              <aside className="customer-related-rail">
                <RelatedCard icon={ReceiptText} title="Orders" count={orders.length}>
                  <div className="customer-activity-list">
                    {orders.slice(0, 5).map((order) => <OrderRow key={order.id || order.order_number} order={order} />)}
                    {!orders.length && <p>{loading ? "Loading orders..." : "No orders found for this customer."}</p>}
                  </div>
                </RelatedCard>
                <RelatedCard icon={FileText} title="Quotes" count={quotes.length}>
                  <div className="customer-activity-list">
                    {quotes.slice(0, 5).map((quote) => <QuoteRow key={quote.id || quoteNumber(quote)} quote={quote} />)}
                    {!quotes.length && <p>{loading ? "Loading quotes..." : "No quotes found for this customer."}</p>}
                  </div>
                </RelatedCard>
                <RelatedCard icon={BriefcaseBusiness} title="Job Tickets" count={jobTickets.length}>
                  <div className="customer-ticket-list">
                    {jobTickets.slice(0, 6).map((ticket) => <TicketRow key={ticket.id} ticket={ticket} />)}
                    {!jobTickets.length && <p>{loading ? "Loading job tickets..." : "No job tickets linked yet."}</p>}
                  </div>
                </RelatedCard>
                <RelatedCard icon={CalendarDays} title="Recent Movement" count={timeline.length}>
                  <div className="customer-timeline">
                    {timeline.map((item) => <TimelineRow key={`${item.type}-${item.id}-${item.date}`} item={item} />)}
                    {!timeline.length && <p>Quotes, orders, and CRM activity will appear here as this account grows.</p>}
                  </div>
                </RelatedCard>
              </aside>
            </section>
          </>
        ) : (
          <div className="customer-empty">
            <UserRound size={28} />
            <strong>Select a customer</strong>
            <p>Choose an account to review its contact record, quote history, orders ran, and linked job tickets.</p>
          </div>
        )}
      </section>
    </section>
  );
}
