import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, MapPin, MessageCircle, MessageSquarePlus, Pencil, Phone, UserRound } from "lucide-react";

import CustomerFollowUpForm from "./CustomerFollowUpForm.jsx";
import { INTERACTION_STATUSES, INTERACTION_TYPES, TYPE_ICON } from "../utils/customerChoices.js";
import {
  choiceLabel,
  dateLabel,
  dateTimeLabel,
  interactionHistoryEntries,
  interactionNotesWithoutAudit,
  interactionRelationLabel,
  interactionStatusTone,
  isOpenInteraction,
  sameId,
  sortDateValue,
  ticketReference,
  ticketSortValue,
  ticketTitle,
} from "../utils/customerUtils.js";

function FollowUpQueueItem({ followUp, active, onSelect }) {
  const tone = interactionStatusTone(followUp.status);
  const Icon = TYPE_ICON[followUp.interaction_type] || MessageCircle;
  return (
    <button className={`customer-followup-queue-item ${active ? "active" : ""} ${tone}`} type="button" onClick={() => onSelect?.(followUp)}>
      <span className="customer-ticket-icon"><Icon size={15} /></span>
      <span className="customer-ticket-copy">
        <strong>{ticketTitle(followUp)}</strong>
        <em>{ticketReference(followUp)}</em>
      </span>
      <span className="customer-ticket-side">
        <b>{dateLabel(followUp.follow_up_date || followUp.updated_at || followUp.occurred_at)}</b>
        <i>{choiceLabel(INTERACTION_STATUSES, followUp.status)}</i>
      </span>
    </button>
  );
}

export function CustomerFollowUpPreview({ followUps, onOpenFollowUp, onViewAll, loading }) {
  return (
    <section className="customer-page-card customer-ticket-preview-card">
      <header>
        <strong>Open Follow-Ups</strong>
        <span>{followUps.length}</span>
      </header>
      <div className="customer-ticket-preview-list">
        {followUps.slice(0, 4).map((followUp) => (
          <button type="button" key={followUp.id} onClick={() => onOpenFollowUp?.(followUp)}>
            <strong>{ticketTitle(followUp)}</strong>
            <span>{[choiceLabel(INTERACTION_STATUSES, followUp.status), followUp.follow_up_date ? `Next ${dateLabel(followUp.follow_up_date)}` : ""].filter(Boolean).join(" / ")}</span>
          </button>
        ))}
        {!followUps.length && <p>{loading ? "Loading follow-ups..." : "No open follow-ups."}</p>}
      </div>
      <footer>
        <button className="ghost-btn" type="button" onClick={onViewAll}>View Follow-Ups</button>
      </footer>
    </section>
  );
}

function FollowUpHistory({ followUp }) {
  const entries = interactionHistoryEntries(followUp);
  return (
    <div className="customer-ticket-history customer-followup-history">
      <strong>Follow-Up History</strong>
      <div>
        {entries.map((entry) => (
          <span key={entry.id}>
            {entry.created_at ? `${dateTimeLabel(entry.created_at)} / ` : ""}
            {entry.performed_by ? `${entry.performed_by}: ` : ""}
            {entry.summary}
          </span>
        ))}
        {!entries.length && <span>No edit history has been logged yet.</span>}
      </div>
    </div>
  );
}

function FollowUpDetail({ followUp, saving, onEdit, onCloseFollowUp }) {
  if (!followUp) {
    return (
      <section className="customer-ticket-detail customer-page-card">
        <div className="customer-ticket-empty">
          <CheckCircle2 size={22} />
          <strong>No follow-up selected</strong>
          <p>Create a follow-up or choose one from the list.</p>
        </div>
      </section>
    );
  }

  const Icon = TYPE_ICON[followUp.interaction_type] || MessageCircle;
  const tone = interactionStatusTone(followUp.status);
  const relation = interactionRelationLabel(followUp);
  const contactName = [followUp.contact_first_name, followUp.contact_last_name].filter(Boolean).join(" ") || followUp.email_to || "--";
  const address = [
    followUp.address_line_1,
    followUp.address_line_2,
    followUp.address_line_3,
    [followUp.city, followUp.state, followUp.postal_code].filter(Boolean).join(", "),
    followUp.country,
  ].map((line) => String(line || "").trim()).filter(Boolean).join(" / ");
  const notes = interactionNotesWithoutAudit(followUp);

  return (
    <section className="customer-ticket-detail customer-followup-detail customer-page-card">
      <header>
        <div>
          <strong>{ticketTitle(followUp)}</strong>
          <span>{relation || "Account only"}</span>
        </div>
        <span className={`customer-crm-status ${tone}`}>{choiceLabel(INTERACTION_STATUSES, followUp.status)}</span>
      </header>

      <div className="customer-followup-summary">
        <span><Icon size={14} /> {choiceLabel(INTERACTION_TYPES, followUp.interaction_type)}</span>
        <span><UserRound size={14} /> {contactName}</span>
        <span>{followUp.contact_role || "No role"}</span>
        <span>{followUp.contact_email || followUp.email_to || "--"}</span>
        <span><Phone size={14} /> {followUp.contact_phone || "--"}</span>
        <span>{followUp.contact_company || followUp.customer_name || "--"}</span>
        <span><MapPin size={14} /> {address || "Customer address"}</span>
        <span>Contact {dateTimeLabel(followUp.occurred_at || followUp.created_at)}</span>
        <span>Next {dateLabel(followUp.follow_up_date)}</span>
      </div>

      <div className="customer-followup-notes">
        <strong>Notes</strong>
        <p>{notes || "No notes have been added yet."}</p>
      </div>

      <div className="customer-ticket-actions">
        <button className="ghost-btn" type="button" onClick={onEdit}>
          <Pencil size={15} />
          Edit Follow-Up
        </button>
        {isOpenInteraction(followUp) && (
          <button className="primary-btn" type="button" onClick={onCloseFollowUp} disabled={saving}>
            {saving ? "Closing..." : "Close Follow-Up"}
          </button>
        )}
      </div>

      <FollowUpHistory followUp={followUp} />
    </section>
  );
}

export default function CustomerFollowUps({
  customer,
  followUps = [],
  selectedFollowUpId,
  jobTickets = [],
  quotes = [],
  currentUser,
  draftSeed,
  saving,
  loading,
  onSelectFollowUp,
  onCreate,
  onUpdate,
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingFollowUp, setEditingFollowUp] = useState(null);

  const sortedFollowUps = useMemo(() => (
    [...followUps].sort((a, b) => {
      if (isOpenInteraction(a) !== isOpenInteraction(b)) return isOpenInteraction(a) ? -1 : 1;
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      const aDate = ticketSortValue(a);
      const bDate = ticketSortValue(b);
      if (aDate && bDate && aDate !== bDate) return aDate - bDate;
      if (aDate !== bDate) return aDate ? -1 : 1;
      return sortDateValue(b.updated_at || b.created_at) - sortDateValue(a.updated_at || a.created_at);
    })
  ), [followUps]);
  const selectedFollowUp = sortedFollowUps.find((followUp) => sameId(followUp.id, selectedFollowUpId)) || sortedFollowUps[0] || null;
  const openFollowUps = sortedFollowUps.filter(isOpenInteraction);
  const waitingInternal = openFollowUps.filter((followUp) => String(followUp.status) === "waiting_internal").length;
  const waitingCustomer = openFollowUps.filter((followUp) => String(followUp.status) === "waiting_customer").length;

  useEffect(() => {
    if (!draftSeed?.id) return;
    setEditingFollowUp(null);
    setFormOpen(true);
  }, [draftSeed?.id]);

  async function createFollowUp(payload) {
    const saved = await onCreate?.(payload);
    setFormOpen(false);
    setEditingFollowUp(null);
    if (saved?.id) onSelectFollowUp?.(String(saved.id));
  }

  async function updateFollowUp(payload, summary) {
    const target = editingFollowUp || selectedFollowUp;
    const saved = await onUpdate?.({ interaction: target, payload, actionSummary: summary });
    setFormOpen(false);
    setEditingFollowUp(null);
    if (saved?.id) onSelectFollowUp?.(String(saved.id));
  }

  async function closeFollowUp() {
    if (!selectedFollowUp) return;
    await onUpdate?.({
      interaction: selectedFollowUp,
      payload: { status: "closed" },
      actionSummary: "closed follow-up",
    });
  }

  return (
    <section className="customer-page-content customer-ticket-page customer-followup-page">
      <section className="customer-ticket-queue customer-page-card">
        <header>
          <div>
            <strong>Follow-Ups</strong>
            <span>{openFollowUps.length} open / {sortedFollowUps.length} total</span>
          </div>
          <button className="primary-btn xs" type="button" onClick={() => { setEditingFollowUp(null); setFormOpen(true); }}>
            <MessageSquarePlus size={14} />
            New
          </button>
        </header>
        <div className="customer-ticket-mini-stats">
          <span><b>{waitingInternal}</b> Internal</span>
          <span><b>{waitingCustomer}</b> Customer</span>
        </div>
        <div className="customer-ticket-queue-list">
          {sortedFollowUps.map((followUp) => (
            <FollowUpQueueItem
              key={followUp.id}
              followUp={followUp}
              active={sameId(followUp.id, selectedFollowUp?.id)}
              onSelect={(row) => onSelectFollowUp?.(String(row.id))}
            />
          ))}
          {!sortedFollowUps.length && <p>{loading ? "Loading follow-ups..." : "No follow-ups for this customer yet."}</p>}
        </div>
      </section>

      <div className="customer-followup-main">
        {formOpen && (
          <CustomerFollowUpForm
            customer={customer}
            currentUser={currentUser}
            jobTickets={jobTickets}
            quotes={quotes}
            followUp={editingFollowUp}
            seed={editingFollowUp ? null : draftSeed}
            saving={saving}
            onCancel={() => { setFormOpen(false); setEditingFollowUp(null); }}
            onSubmit={editingFollowUp ? updateFollowUp : createFollowUp}
          />
        )}

        <FollowUpDetail
          followUp={selectedFollowUp}
          saving={saving}
          onEdit={() => {
            setEditingFollowUp(selectedFollowUp);
            setFormOpen(true);
          }}
          onCloseFollowUp={closeFollowUp}
        />
      </div>
    </section>
  );
}
