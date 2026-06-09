import { BriefcaseBusiness, CalendarDays, FileText, Mail, MapPin, Phone, ReceiptText, UserRound } from "lucide-react";

const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

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

function dateLabel(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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

function statusLabel(value) {
  return String(value || "unknown").replace(/_/g, " ");
}

function CustomerListRow({ customer, selected, onSelect }) {
  const address = customerAddressLines(customer);
  return (
    <button className={`customer-row ${selected ? "active" : ""}`} type="button" onClick={() => onSelect(customer)}>
      <span className="customer-row-initial">{String(customer.name || "?").slice(0, 1).toUpperCase()}</span>
      <span>
        <strong>{customer.name || "Unnamed customer"}</strong>
        <em>{[customer.customer_code ? `ID ${customer.customer_code}` : "", customer.contact_name].filter(Boolean).join(" / ") || "No customer ID"}</em>
      </span>
      <small>{address[0] || customer.email || customer.phone || "No contact details"}</small>
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
        <strong>{quote.quoteNumber || quote.quote_number}</strong>
        <em>{quote.jobName || quote.job_name || "No job name"}</em>
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
  const Icon = item.type === "quote" ? FileText : ReceiptText;
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

export default function CustomerWorkspace({ rows, selected, quotes = [], orders = [], jobTickets = [], loading = false, onSelect, onEdit, onDelete, onQuote }) {
  const address = customerAddressLines(selected);
  const quoteTotalValue = quotes.reduce((sum, quote) => sum + quoteTotal(quote), 0);
  const openOrders = orders.filter(orderOpen);
  const shippedUnits = orders.reduce((sum, order) => sum + Number(order.quantity_to_ship || 0), 0);
  const timeline = [
    ...quotes.map((quote) => ({
      type: "quote",
      date: quote.createdAt || quote.created_at,
      title: quote.quoteNumber || "Quote",
      detail: `${money(quoteTotal(quote))} / ${quote.jobName || "No job name"}`,
    })),
    ...orders.map((order) => ({
      type: "order",
      date: order.order_date || order.scheduled_date || order.updated_at,
      title: order.order_number || "Order",
      detail: `${statusLabel(order.status)} / ${order.job_name || "No job name"}`,
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
            <header className="customer-account-head">
              <div className="customer-account-title">
                <span>{selected.is_active === false ? "Inactive Customer" : "Active Customer"}</span>
                <h3>{selected.name}</h3>
                <p>{selected.customer_code ? `Customer ID ${selected.customer_code}` : "No Customer ID on file"}</p>
              </div>
              <div className="customer-account-actions">
                <button className="ghost-btn" type="button" onClick={() => onQuote?.(selected)}>Quote</button>
                <button className="primary-btn" type="button" onClick={() => onEdit(selected)}>Edit Customer</button>
                <button className="danger-btn" type="button" onClick={() => onDelete(selected)}>Delete</button>
              </div>
            </header>

            <div className="customer-contact-band">
              <div><UserRound size={15} /><span>{selected.contact_name || "No primary contact"}</span></div>
              <div><Mail size={15} /><span>{selected.email || "No email"}</span></div>
              <div><Phone size={15} /><span>{selected.phone || "No phone"}</span></div>
              <div><MapPin size={15} /><span>{address.join(" / ") || "No address"}</span></div>
            </div>

            <section className="customer-metric-grid">
              <Metric label="Quote Value" value={money(quoteTotalValue)} detail={`${quotes.length} saved quote${quotes.length === 1 ? "" : "s"}`} tone="money" />
              <Metric label="Open Orders" value={openOrders.length.toLocaleString()} detail={`${orders.length} total order${orders.length === 1 ? "" : "s"}`} tone={openOrders.length ? "watch" : ""} />
              <Metric label="Shipped Quantity" value={number(shippedUnits)} detail="labels scheduled to ship" />
              <Metric label="Job Tickets" value={jobTickets.length.toLocaleString()} detail="linked customer jobs" />
            </section>

            {selected.notes && (
              <section className="customer-notes">
                <strong>Account Notes</strong>
                <p>{selected.notes}</p>
              </section>
            )}

            <section className="customer-panels">
              <div>
                <header><FileText size={15} /><strong>Quotes</strong><span>{quotes.length}</span></header>
                <div className="customer-activity-list">
                  {quotes.slice(0, 8).map((quote) => <QuoteRow key={quote.id || quote.quoteNumber} quote={quote} />)}
                  {!quotes.length && <p>{loading ? "Loading quotes..." : "No quotes found for this customer."}</p>}
                </div>
              </div>

              <div>
                <header><ReceiptText size={15} /><strong>Orders Ran</strong><span>{orders.length}</span></header>
                <div className="customer-activity-list">
                  {orders.slice(0, 8).map((order) => <OrderRow key={order.id || order.order_number} order={order} />)}
                  {!orders.length && <p>{loading ? "Loading orders..." : "No orders found for this customer."}</p>}
                </div>
              </div>
            </section>

            <section className="customer-bottom-grid">
              <div>
                <header><BriefcaseBusiness size={15} /><strong>Job Tickets</strong><span>{jobTickets.length}</span></header>
                <div className="customer-ticket-list">
                  {jobTickets.slice(0, 10).map((ticket) => <TicketRow key={ticket.id} ticket={ticket} />)}
                  {!jobTickets.length && <p>{loading ? "Loading job tickets..." : "No job tickets linked yet."}</p>}
                </div>
              </div>
              <div>
                <header><CalendarDays size={15} /><strong>Timeline</strong><span>{timeline.length}</span></header>
                <div className="customer-timeline">
                  {timeline.map((item) => <TimelineRow key={`${item.type}-${item.title}-${item.date}`} item={item} />)}
                  {!timeline.length && <p>Quotes and orders will appear here as this account grows.</p>}
                </div>
              </div>
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
