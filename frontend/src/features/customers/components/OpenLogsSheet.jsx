import { useEffect, useMemo, useState } from "react";
import { INTERACTION_STATUSES, INTERACTION_TYPES } from "../utils/customerChoices.js";
import {
  choiceLabel,
  customerMatchesOwner,
  dateLabel,
  interactionCustomerId,
  interactionNotesWithoutAudit,
  interactionStatusTone,
  isOpenInteraction,
  sortDateValue,
} from "../utils/customerUtils.js";

function OpenLogRow({ interaction, customer, saving, onUpdate, onOpenCustomer }) {
  const cleanBody = interactionNotesWithoutAudit(interaction);
  const [form, setForm] = useState({
    interaction_type: interaction.interaction_type || "note",
    status: interaction.status || "open",
    body: cleanBody,
    follow_up_date: interaction.follow_up_date || "",
  });

  useEffect(() => {
    setForm({
      interaction_type: interaction.interaction_type || "note",
      status: interaction.status || "open",
      body: cleanBody,
      follow_up_date: interaction.follow_up_date || "",
    });
  }, [cleanBody, interaction.follow_up_date, interaction.id, interaction.interaction_type, interaction.status, interaction.updated_at]);

  const company = customer?.name || interaction.customer_name || "Unknown customer";
  const contact = customer?.contact_name || interaction.email_to || "--";
  const phone = customer?.phone || "--";
  const tone = interactionStatusTone(form.status);
  const lastActivity = interaction.updated_at || interaction.occurred_at || interaction.created_at;
  const dirty = (
    form.interaction_type !== (interaction.interaction_type || "note")
    || form.status !== (interaction.status || "open")
    || form.body !== cleanBody
    || form.follow_up_date !== (interaction.follow_up_date || "")
  );

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function actionSummary(nextStatus) {
    if (nextStatus === "closed") return "closed this follow-up";
    const changes = [];
    if (form.interaction_type !== (interaction.interaction_type || "note")) changes.push("changed contact type");
    if (form.status !== (interaction.status || "open")) changes.push(`changed status to ${choiceLabel(INTERACTION_STATUSES, form.status)}`);
    if (form.follow_up_date !== (interaction.follow_up_date || "")) changes.push("changed last follow-up");
    if (form.body !== cleanBody) changes.push("updated notes");
    return changes.length ? changes.join(", ") : "saved this follow-up";
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

export default function OpenLogsSheet({ interactions = [], customersById = new Map(), ownerScope, currentUser, saving, onUpdate, onOpenCustomer }) {
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
          <strong>Open Follow-Ups</strong>
          <span>{rows.length} item{rows.length === 1 ? "" : "s"} needing follow-up</span>
        </div>
      </header>
      <div className="customer-open-log-scroll">
        <div className="customer-log-table" role="table" aria-label="Open customer follow-ups">
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
              {ownerScope === "mine" ? "No open follow-ups for your accounts." : "No open customer follow-ups are waiting right now."}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
