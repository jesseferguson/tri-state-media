function generatedJobTicketNumber(payload = {}, currentTicket = null) {
  const existing = String(payload.ticket_number || "").trim();
  if (existing) return existing;
  const current = String(currentTicket?.ticket_number || "").trim();
  if (current) return current;
  const tsmId = String(payload.product_code || "").trim();
  if (tsmId) return tsmId;
  return `JT-${Date.now().toString(36).toUpperCase()}`;
}

function autoImageName(slot, ticket = {}) {
  const label = {
    general: "General",
    spec: "Spec",
    finishing: "Finishing",
  }[slot] || "Image";
  const job = String(ticket.job_name || ticket.product_code || ticket.ticket_number || "Job").trim().replace(/\s+/g, "-");
  return `${label}-${job}`;
}

function scheduleDefaultsForTicket(ticket, currentUser) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    job_ticket: ticket?.id || "",
    customer: ticket?.customer || "",
    customer_po: "",
    priority: "normal",
    order_date: today,
    due_date: "",
    quantity_to_ship: 0,
    quantity_to_stock: 0,
    notes: "",
    scheduled_by: currentUser?.name || "",
    last_updated_by: currentUser?.name || "",
    status: "unscheduled",
  };
}

export { autoImageName, generatedJobTicketNumber, scheduleDefaultsForTicket };
