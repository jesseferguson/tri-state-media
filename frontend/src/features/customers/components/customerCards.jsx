import { FileText, MessageCircle, MessageSquarePlus, ReceiptText, Search } from "lucide-react";
import { CRM_STAGES, TYPE_ICON } from "../utils/customerChoices.js";
import {
  choiceLabel,
  dateLabel,
  money,
  number,
  orderQuantity,
  quoteJobName,
  quoteNumber,
  quoteQuantity,
  quoteTotal,
  statusLabel,
} from "../utils/customerUtils.js";

export function Metric({ label, value, detail, tone = "" }) {
  return (
    <div className={`customer-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <em>{detail}</em>}
    </div>
  );
}

export function CustomerSearchInput({ value, onChange, count, total, autoFocus = false, onFocus }) {
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

export function CustomerCard({ customer, selected, onSelect, notificationCount = 0 }) {
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

export function QuoteRow({ quote, onFollowUp }) {
  return (
    <article className={`customer-activity-row ${onFollowUp ? "with-action" : ""}`}>
      <div>
        <span>Quote</span>
        <strong>{quoteNumber(quote)}</strong>
        <em>{quoteJobName(quote)}</em>
      </div>
      <div>
        <strong>{money(quoteTotal(quote))}</strong>
        <em>{number(quoteQuantity(quote))} labels / {dateLabel(quote.createdAt || quote.created_at)}</em>
      </div>
      {onFollowUp && (
        <button className="customer-row-action" type="button" onClick={() => onFollowUp(quote)}>
          <MessageSquarePlus size={14} />
          Follow Up
        </button>
      )}
    </article>
  );
}

export function OrderRow({ order }) {
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

export function TicketRow({ ticket, onFollowUp }) {
  return (
    <article className={`customer-ticket-row ${onFollowUp ? "with-action" : ""}`}>
      <div>
        <strong>{ticket.job_name || ticket.product_code || ticket.ticket_number}</strong>
        <span>{[ticket.product_code ? `TSM ${ticket.product_code}` : "", ticket.ticket_number, ticket.material_master_type_code].filter(Boolean).join(" / ") || "No identifiers"}</span>
        <em>{[ticket.label_width_inches && ticket.label_length_inches ? `${ticket.label_width_inches}" x ${ticket.label_length_inches}"` : "", ticket.recipe_name].filter(Boolean).join(" / ")}</em>
      </div>
      {onFollowUp && (
        <button className="customer-row-action" type="button" onClick={() => onFollowUp(ticket)}>
          <MessageSquarePlus size={14} />
          Follow Up
        </button>
      )}
    </article>
  );
}

export function TimelineRow({ item }) {
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

export function FactRow({ icon: Icon, label, value, href }) {
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

export function RelatedCard({ icon: Icon, title, count, children }) {
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
