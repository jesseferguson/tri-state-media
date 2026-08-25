import { INTERACTION_TYPES } from "./customerChoices.js";

const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function sameId(a, b) {
  return String(a ?? "") === String(b ?? "");
}

export function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

export function userId(user) {
  return String(user?.id || user?.username || "").trim();
}

export function userLabel(user) {
  return user?.name || user?.username || "User";
}

export function customerMatchesOwner(customer, currentUser) {
  const owner = normalizedText(customer?.account_owner);
  const viewerNames = [currentUser?.name, currentUser?.username].map(normalizedText).filter(Boolean);
  if (!owner || !viewerNames.length) return false;
  return viewerNames.some((name) => owner === name || owner.includes(name) || name.includes(owner));
}

export function interactionCustomerId(interaction) {
  return String(interaction?.customer || interaction?.customer_id || interaction?.customerId || "").trim();
}

export function isOpenInteraction(interaction) {
  return String(interaction?.status || "open").toLowerCase() !== "closed";
}

export function ticketTitle(interaction) {
  if (!interaction) return "Ticket";
  return interaction?.subject || interaction?.email_subject || choiceLabel(INTERACTION_TYPES, interaction?.interaction_type);
}

export function ticketReference(interaction) {
  if (!interaction) return "";
  return interactionRelationLabel(interaction) || `CRM Ticket #${interaction.id ?? ""}`.trim();
}

export function sortDateValue(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function ticketSortValue(interaction) {
  return sortDateValue(interaction?.follow_up_date || interaction?.updated_at || interaction?.occurred_at || interaction?.created_at);
}

export function isAuditLine(value) {
  return /^\[[^\]]+\]\s+.+/.test(String(value || "").trim());
}

export function interactionAuditEntries(interaction) {
  return String(interaction?.body || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(isAuditLine);
}

export function interactionHistoryEntries(interaction) {
  const savedEntries = Array.isArray(interaction?.history_entries)
    ? interaction.history_entries.map((entry) => ({
      id: entry.id,
      summary: entry.summary || entry.action || "updated follow-up",
      performed_by: entry.performed_by || "",
      created_at: entry.created_at || "",
      changes: entry.changes || {},
    }))
    : [];
  const legacyEntries = interactionAuditEntries(interaction).map((entry, index) => ({
    id: `legacy-${interaction?.id ?? "follow-up"}-${index}`,
    summary: entry,
    performed_by: "",
    created_at: "",
    changes: {},
  }));
  return [...savedEntries, ...legacyEntries];
}

export function interactionNotesWithoutAudit(interaction) {
  return String(interaction?.body || "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block && !block.split(/\n+/).every(isAuditLine))
    .join("\n\n");
}

export function money(value) {
  const number = Number(value || 0);
  return currencyFormatter.format(Number.isFinite(number) ? number : 0);
}

export function number(value) {
  const safe = Number(value || 0);
  return numberFormatter.format(Number.isFinite(safe) ? safe : 0);
}

export function statusLabel(value) {
  return String(value || "unknown").replace(/_/g, " ");
}

export function choiceLabel(choices, value) {
  return choices.find(([choiceValue]) => String(choiceValue) === String(value))?.[1] || statusLabel(value);
}

export function dateLabel(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function dateTimeLabel(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function dateTimeInputValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function isoFromDateTimeInput(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function externalUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

export function customerAddressLines(customer) {
  if (!customer) return [];
  return [
    customer.address_line_1,
    customer.address_line_2,
    customer.address_line_3,
    [customer.city, customer.state, customer.postal_code].filter(Boolean).join(", "),
    customer.country,
  ].map((line) => String(line || "").trim()).filter(Boolean);
}

export function quoteNumber(quote) {
  return quote?.quoteNumber || quote?.quote_number || `Quote ${quote?.id ?? ""}`.trim();
}

export function quoteJobName(quote) {
  return quote?.jobName || quote?.job_name || "No job name";
}

export function quoteTotal(quote) {
  return Number(quote?.pricing?.sellPrice || quote?.pricing?.sell_price || 0);
}

export function quoteQuantity(quote) {
  return Number(quote?.pricing?.quantity || quote?.form?.quantity || 0);
}

export function quoteRecordId(quote) {
  return String(quote?.id ?? quote?.external_id ?? quote?.pk ?? "").trim();
}

export function linkedJobTicketIds(interaction) {
  const ids = [
    interaction?.job_ticket,
    ...(Array.isArray(interaction?.related_job_tickets) ? interaction.related_job_tickets : []),
    ...(Array.isArray(interaction?.related_job_ticket_details) ? interaction.related_job_ticket_details.map((ticket) => ticket.id) : []),
  ];
  return [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

export function linkedQuoteIds(interaction) {
  const ids = [
    interaction?.quote,
    ...(Array.isArray(interaction?.related_quotes) ? interaction.related_quotes : []),
    ...(Array.isArray(interaction?.related_quote_details) ? interaction.related_quote_details.map((quote) => quote.id ?? quote.pk) : []),
  ];
  return [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

export function orderQuantity(order) {
  return Number(order.quantity_to_ship || 0) + Number(order.quantity_to_stock || 0);
}

export function orderOpen(order) {
  return !["complete", "cancelled", "schedule_removed"].includes(String(order.status || "").toLowerCase());
}

export function interactionStatusTone(status) {
  const value = String(status || "").toLowerCase();
  if (value === "closed") return "good";
  if (value === "waiting_customer" || value === "waiting_internal") return "watch";
  if (value === "scheduled") return "info";
  return "open";
}

export function interactionRelationLabel(interaction) {
  if (!interaction) return "";
  const relatedJobs = Array.isArray(interaction.related_job_ticket_details)
    ? interaction.related_job_ticket_details.map((ticket) => [
      ticket.ticket_number ? `Job ${ticket.ticket_number}` : "",
      ticket.job_name && !ticket.ticket_number ? ticket.job_name : "",
    ].filter(Boolean).join(" / "))
    : [];
  const relatedQuotes = Array.isArray(interaction.related_quote_details)
    ? interaction.related_quote_details.map((quote) => quote.quote_number ? `Quote ${quote.quote_number}` : "")
    : [];
  return [...new Set([
    interaction.order_number ? `Order ${interaction.order_number}` : "",
    interaction.job_ticket_number ? `Job ${interaction.job_ticket_number}` : "",
    interaction.job_name && !interaction.job_ticket_number ? interaction.job_name : "",
    interaction.quote_number ? `Quote ${interaction.quote_number}` : "",
    ...relatedJobs,
    ...relatedQuotes,
  ].filter(Boolean))].join(" / ");
}

export function relationOptionLabel(type, row) {
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

export function initialInteractionForm() {
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
