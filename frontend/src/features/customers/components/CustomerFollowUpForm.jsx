import { useEffect, useMemo, useState } from "react";
import {
  BriefcaseBusiness,
  CheckCircle2,
  FileText,
  Home,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquarePlus,
  Phone,
  Search,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";

import { INTERACTION_STATUSES, INTERACTION_TYPES } from "../utils/customerChoices.js";
import {
  choiceLabel,
  dateTimeInputValue,
  interactionNotesWithoutAudit,
  isoFromDateTimeInput,
  linkedJobTicketIds,
  linkedQuoteIds,
  quoteJobName,
  quoteNumber,
  quoteRecordId,
  relationOptionLabel,
  sameId,
} from "../utils/customerUtils.js";

function splitContactName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  return {
    first: parts[0] || "",
    last: parts.slice(1).join(" "),
  };
}

function uniqueIds(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function selectedJobIds(followUp, seed) {
  return uniqueIds([...(seed?.jobTicketIds || []), ...linkedJobTicketIds(followUp)]);
}

function selectedQuoteIds(followUp, seed) {
  return uniqueIds([...(seed?.quoteIds || []), ...linkedQuoteIds(followUp)]);
}

function savedContacts(customer) {
  return Array.isArray(customer?.contacts) ? customer.contacts : [];
}

function savedAddresses(customer) {
  return Array.isArray(customer?.addresses) ? customer.addresses : [];
}

function contactName(contact) {
  return [contact?.first_name || contact?.firstName, contact?.last_name || contact?.lastName].filter(Boolean).join(" ")
    || contact?.full_name
    || contact?.name
    || contact?.email
    || "Contact";
}

function contactPayload(contact = {}, fallbackCompany = "") {
  const split = splitContactName(contact.full_name || contact.name || "");
  return {
    contact_first_name: contact.first_name || contact.firstName || split.first || "",
    contact_last_name: contact.last_name || contact.lastName || split.last || "",
    contact_role: contact.role || contact.title || "",
    contact_email: contact.email || "",
    contact_phone: contact.phone || "",
    contact_company: contact.company || fallbackCompany || "",
  };
}

function primaryContactRecord(customer) {
  return savedContacts(customer).find((contact) => contact.is_primary) || savedContacts(customer)[0] || null;
}

function primaryContactPayload(customer) {
  const saved = primaryContactRecord(customer);
  if (saved) return { id: String(saved.id), ...contactPayload(saved, customer?.name || "") };
  const split = splitContactName(customer?.contact_name);
  return {
    id: "",
    contact_first_name: split.first,
    contact_last_name: split.last,
    contact_role: "",
    contact_email: customer?.email || "",
    contact_phone: customer?.phone || "",
    contact_company: customer?.name || "",
  };
}

function hasContactInfo(contact) {
  return Boolean(
    contact?.contact_first_name ||
    contact?.contact_last_name ||
    contact?.contact_email ||
    contact?.contact_phone
  );
}

function addressSummary(address) {
  return [
    address?.address_line_1,
    address?.address_line_2,
    address?.address_line_3,
    [address?.city, address?.state, address?.postal_code].filter(Boolean).join(", "),
    address?.country,
  ].map((line) => String(line || "").trim()).filter(Boolean).join(" / ");
}

function addressPayload(address = {}) {
  return {
    address_label: address.label || "",
    address_line_1: address.address_line_1 || "",
    address_line_2: address.address_line_2 || "",
    address_line_3: address.address_line_3 || "",
    city: address.city || "",
    state: address.state || "",
    postal_code: address.postal_code || "",
    country: address.country || "",
  };
}

function primaryAddressRecord(customer) {
  return savedAddresses(customer).find((address) => address.is_primary) || savedAddresses(customer)[0] || null;
}

function primaryAddressPayload(customer) {
  const saved = primaryAddressRecord(customer);
  if (saved) return { id: String(saved.id), ...addressPayload(saved) };
  return {
    id: "",
    address_label: "Primary",
    address_line_1: customer?.address_line_1 || "",
    address_line_2: customer?.address_line_2 || "",
    address_line_3: customer?.address_line_3 || "",
    city: customer?.city || "",
    state: customer?.state || "",
    postal_code: customer?.postal_code || "",
    country: customer?.country || "",
  };
}

function hasAddressInfo(address) {
  return Boolean(
    address?.address_line_1 ||
    address?.address_line_2 ||
    address?.city ||
    address?.state ||
    address?.postal_code ||
    address?.country
  );
}

function followUpContactPayload(followUp) {
  return {
    contact_first_name: followUp?.contact_first_name || "",
    contact_last_name: followUp?.contact_last_name || "",
    contact_role: followUp?.contact_role || "",
    contact_email: followUp?.contact_email || followUp?.email_to || "",
    contact_phone: followUp?.contact_phone || "",
    contact_company: followUp?.contact_company || followUp?.customer_name || "",
  };
}

function followUpAddressPayload(followUp) {
  return {
    address_label: followUp?.address_label || "",
    address_line_1: followUp?.address_line_1 || "",
    address_line_2: followUp?.address_line_2 || "",
    address_line_3: followUp?.address_line_3 || "",
    city: followUp?.city || "",
    state: followUp?.state || "",
    postal_code: followUp?.postal_code || "",
    country: followUp?.country || "",
  };
}

function buildInitialForm(customer, followUp, seed) {
  const jobTicketIds = selectedJobIds(followUp, seed);
  const quoteIds = selectedQuoteIds(followUp, seed);
  const primaryContact = primaryContactPayload(customer);
  const existingContactId = String(followUp?.customer_contact || followUp?.customer_contact_detail?.id || primaryContact.id || "");
  const contactFromFollowUp = followUpContactPayload(followUp);
  const contactMode = followUp?.contact_matches_customer === false
    ? "new"
    : existingContactId
      ? "saved"
      : hasContactInfo(primaryContact)
        ? "primary"
        : "new";
  const contact = contactMode === "new" ? { contact_company: customer?.name || "", ...contactFromFollowUp } : primaryContact;
  const primaryAddress = primaryAddressPayload(customer);
  const existingAddressId = String(followUp?.customer_address || followUp?.customer_address_detail?.id || primaryAddress.id || "");
  const addressFromFollowUp = followUpAddressPayload(followUp);
  const addressMode = followUp?.address_matches_customer === false
    ? "new"
    : existingAddressId
      ? "saved"
      : "primary";
  const address = addressMode === "new" ? addressFromFollowUp : primaryAddress;

  return {
    referenceMode: jobTicketIds.length || quoteIds.length ? "work" : "account",
    contactMode,
    addressMode,
    selectedContactId: existingContactId,
    selectedAddressId: existingAddressId,
    jobSearch: "",
    quoteSearch: "",
    jobTicketIds,
    quoteIds,
    interaction_type: followUp?.interaction_type || "call",
    status: followUp?.status || "open",
    subject: followUp?.subject || followUp?.email_subject || seed?.subject || "",
    ...contact,
    ...address,
    occurred_at: dateTimeInputValue(followUp?.occurred_at || new Date()),
    follow_up_date: followUp?.follow_up_date || "",
    body: interactionNotesWithoutAudit(followUp) || seed?.body || "",
    pinned: Boolean(followUp?.pinned),
  };
}

function filterByQuery(items, query, labelFor) {
  const cleanQuery = String(query || "").trim().toLowerCase();
  if (!cleanQuery) return items;
  return items.filter((item) => labelFor(item).toLowerCase().includes(cleanQuery));
}

function MultiRecordPicker({ title, icon: Icon, items, selectedIds, search, onSearchChange, onToggle, labelFor, metaFor, emptyText }) {
  const visibleItems = filterByQuery(items, search, (item) => `${labelFor(item)} ${metaFor(item)}`);
  return (
    <section className="customer-followup-picker">
      <header>
        <div>
          <Icon size={15} />
          <strong>{title}</strong>
        </div>
        <span>{selectedIds.length} selected</span>
      </header>
      <label>
        <Search size={15} />
        <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={`Search ${title.toLowerCase()}...`} />
      </label>
      <div>
        {visibleItems.slice(0, 12).map((item) => {
          const id = String(item.id ?? item.pk ?? "");
          const active = selectedIds.some((value) => sameId(value, id));
          return (
            <button className={active ? "active" : ""} type="button" key={id} onClick={() => onToggle(id)}>
              <CheckCircle2 size={15} />
              <span>
                <strong>{labelFor(item)}</strong>
                <em>{metaFor(item)}</em>
              </span>
            </button>
          );
        })}
        {!visibleItems.length && <p>{emptyText}</p>}
      </div>
    </section>
  );
}

function ContactSummary({ contact }) {
  const name = [contact.contact_first_name, contact.contact_last_name].filter(Boolean).join(" ") || "No name";
  return (
    <div className="customer-followup-selected">
      <span><UserRound size={14} /> {name}</span>
      <span>{contact.contact_role || "No role"}</span>
      <span><Mail size={14} /> {contact.contact_email || "No email"}</span>
      <span><Phone size={14} /> {contact.contact_phone || "No phone"}</span>
      <span>{contact.contact_company || "No company"}</span>
    </div>
  );
}

function AddressSummary({ address }) {
  return (
    <div className="customer-followup-selected">
      <span><MapPin size={14} /> {address.address_label || "Address"}</span>
      <span>{addressSummary(address) || "No address on file"}</span>
    </div>
  );
}

export default function CustomerFollowUpForm({
  customer,
  currentUser,
  jobTickets = [],
  quotes = [],
  followUp = null,
  seed = null,
  saving = false,
  onSubmit,
  onCancel,
}) {
  const editing = Boolean(followUp?.id);
  const [form, setForm] = useState(() => buildInitialForm(customer, followUp, seed));
  const [localError, setLocalError] = useState("");
  const userName = currentUser?.name || currentUser?.username || "";
  const isEmail = form.interaction_type === "email";
  const contacts = savedContacts(customer);
  const addresses = savedAddresses(customer);
  const primaryContact = primaryContactPayload(customer);
  const primaryAddress = primaryAddressPayload(customer);
  const canUsePrimaryContact = hasContactInfo(primaryContact);

  useEffect(() => {
    setForm(buildInitialForm(customer, followUp, seed));
    setLocalError("");
  }, [customer?.id, followUp?.id, followUp?.updated_at, seed?.id]);

  const selectedJobs = useMemo(() => (
    jobTickets.filter((ticket) => form.jobTicketIds.some((id) => sameId(id, ticket.id)))
  ), [form.jobTicketIds, jobTickets]);
  const selectedQuotes = useMemo(() => (
    quotes.filter((quote) => form.quoteIds.some((id) => sameId(id, quoteRecordId(quote))))
  ), [form.quoteIds, quotes]);

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setLocalError("");
  }

  function applyContact(mode, contact = null) {
    const selected = contact || (mode === "saved" ? contacts[0] : null);
    const nextContact = mode === "primary"
      ? primaryContact
      : mode === "saved" && selected
        ? { id: String(selected.id), ...contactPayload(selected, customer?.name || "") }
        : {
            contact_first_name: "",
            contact_last_name: "",
            contact_role: "",
            contact_email: "",
            contact_phone: "",
            contact_company: customer?.name || "",
          };
    setForm((current) => ({
      ...current,
      contactMode: mode,
      selectedContactId: nextContact.id || "",
      ...nextContact,
    }));
    setLocalError("");
  }

  function applyAddress(mode, address = null) {
    const selected = address || (mode === "saved" ? addresses[0] : null);
    const nextAddress = mode === "primary"
      ? primaryAddress
      : mode === "saved" && selected
        ? { id: String(selected.id), ...addressPayload(selected) }
        : {
            address_label: "",
            address_line_1: "",
            address_line_2: "",
            address_line_3: "",
            city: "",
            state: "",
            postal_code: "",
            country: "",
          };
    setForm((current) => ({
      ...current,
      addressMode: mode,
      selectedAddressId: nextAddress.id || "",
      ...nextAddress,
    }));
    setLocalError("");
  }

  function toggleId(name, value) {
    setForm((current) => {
      const values = current[name] || [];
      const exists = values.some((id) => sameId(id, value));
      return {
        ...current,
        [name]: exists ? values.filter((id) => !sameId(id, value)) : [...values, value],
      };
    });
    setLocalError("");
  }

  function defaultSubject() {
    const contactLabel = [form.contact_first_name, form.contact_last_name].filter(Boolean).join(" ");
    const workLabels = [
      ...selectedJobs.map((ticket) => ticket.ticket_number || ticket.job_name || `Job ${ticket.id}`),
      ...selectedQuotes.map(quoteNumber),
    ];
    if (workLabels.length) return `${customer?.name || "Customer"} follow-up: ${workLabels.slice(0, 2).join(", ")}`;
    return `${contactLabel || customer?.contact_name || customer?.name || "Customer"} follow-up`;
  }

  function actionSummary() {
    if (!editing) return "created follow-up";
    const changes = [];
    if (form.status !== (followUp.status || "open")) changes.push(`changed status to ${choiceLabel(INTERACTION_STATUSES, form.status)}`);
    if ((form.follow_up_date || "") !== (followUp.follow_up_date || "")) changes.push("changed follow-up date");
    if (form.body !== interactionNotesWithoutAudit(followUp)) changes.push("updated notes");
    if (form.jobTicketIds.join("|") !== linkedJobTicketIds(followUp).join("|") || form.quoteIds.join("|") !== linkedQuoteIds(followUp).join("|")) changes.push("updated linked work");
    if (form.contactMode === "new" || form.contact_role !== (followUp.contact_role || "") || form.contact_phone !== (followUp.contact_phone || "")) changes.push("updated contact");
    if (form.addressMode === "new" || form.address_line_1 !== (followUp.address_line_1 || "")) changes.push("updated address");
    return [...new Set(changes)].length ? [...new Set(changes)].join(", ") : "edited follow-up";
  }

  async function submit(event) {
    event.preventDefault();
    const body = form.body.trim();
    const subject = form.subject.trim() || defaultSubject();
    const jobIds = form.referenceMode === "work" ? form.jobTicketIds.map(Number).filter((id) => Number.isFinite(id)) : [];
    const quoteIds = form.referenceMode === "work" ? form.quoteIds : [];
    if (form.referenceMode === "work" && !jobIds.length && !quoteIds.length) {
      setLocalError("Select at least one job or quote, or switch this follow-up to account only.");
      return;
    }
    if (form.contactMode === "new" && !hasContactInfo(form)) {
      setLocalError("Add a name, email, or phone for the new contact.");
      return;
    }
    if (form.addressMode === "new" && !hasAddressInfo(form)) {
      setLocalError("Add the address details or switch back to the customer address.");
      return;
    }
    if (!body) {
      setLocalError("Add notes before saving this follow-up.");
      return;
    }

    const contactId = form.contactMode === "new" ? "" : form.selectedContactId;
    const addressId = form.addressMode === "new" ? "" : form.selectedAddressId;
    const summary = actionSummary();
    const payload = {
      customer: customer.id,
      job_ticket: jobIds[0] || null,
      related_job_tickets: jobIds,
      quote: quoteIds[0] || null,
      related_quotes: quoteIds,
      customer_contact: contactId ? Number(contactId) : null,
      customer_address: addressId ? Number(addressId) : null,
      contact_matches_customer: form.contactMode !== "new",
      address_matches_customer: form.addressMode !== "new",
      interaction_type: form.interaction_type,
      status: form.status,
      subject,
      body,
      contact_first_name: form.contact_first_name.trim(),
      contact_last_name: form.contact_last_name.trim(),
      contact_role: form.contact_role.trim(),
      contact_email: form.contact_email.trim(),
      contact_phone: form.contact_phone.trim(),
      contact_company: form.contact_company.trim() || customer?.name || "",
      address_label: form.address_label.trim(),
      address_line_1: form.address_line_1.trim(),
      address_line_2: form.address_line_2.trim(),
      address_line_3: form.address_line_3.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      postal_code: form.postal_code.trim(),
      country: form.country.trim(),
      email_from: isEmail ? userName : "",
      email_to: isEmail ? form.contact_email.trim() : "",
      email_subject: isEmail ? subject : "",
      email_url: followUp?.email_url || "",
      follow_up_date: form.follow_up_date || null,
      occurred_at: isoFromDateTimeInput(form.occurred_at) || new Date().toISOString(),
      pinned: form.pinned,
      updated_by: userName,
      action_summary: summary,
    };
    if (!editing) payload.created_by = userName;
    await onSubmit?.(payload, summary);
    if (!editing) setForm(buildInitialForm(customer, null, null));
  }

  return (
    <section className="customer-followup-form customer-page-card">
      <header>
        <div>
          <strong>{editing ? "Edit Follow-Up" : "New Follow-Up"}</strong>
          <span>{customer?.name || "Customer account"}</span>
        </div>
        {onCancel && (
          <button type="button" onClick={onCancel} aria-label="Close follow-up form">
            <X size={17} />
          </button>
        )}
      </header>
      <form onSubmit={submit}>
        <fieldset className="customer-followup-question">
          <legend>Is this follow-up tied to job or quote work?</legend>
          <div role="group" aria-label="Follow-up reference type">
            <button className={form.referenceMode === "account" ? "active" : ""} type="button" onClick={() => update("referenceMode", "account")}>
              <MessageCircle size={15} />
              Account Only
            </button>
            <button className={form.referenceMode === "work" ? "active" : ""} type="button" onClick={() => update("referenceMode", "work")}>
              <BriefcaseBusiness size={15} />
              Link Jobs / Quotes
            </button>
          </div>
        </fieldset>

        {form.referenceMode === "work" && (
          <div className="customer-followup-link-grid">
            <MultiRecordPicker
              title="All Job Tickets"
              icon={BriefcaseBusiness}
              items={jobTickets}
              selectedIds={form.jobTicketIds}
              search={form.jobSearch}
              onSearchChange={(value) => update("jobSearch", value)}
              onToggle={(id) => toggleId("jobTicketIds", id)}
              labelFor={(ticket) => relationOptionLabel("job", ticket)}
              metaFor={(ticket) => [ticket.customer_display || ticket.customer_name || ticket.customerName, ticket.customer_po ? `PO ${ticket.customer_po}` : "", ticket.status, ticket.recipe_name].filter(Boolean).join(" / ")}
              emptyText="No job tickets match that search."
            />
            <MultiRecordPicker
              title="Quotes"
              icon={FileText}
              items={quotes.map((quote) => ({ ...quote, id: quoteRecordId(quote) }))}
              selectedIds={form.quoteIds}
              search={form.quoteSearch}
              onSearchChange={(value) => update("quoteSearch", value)}
              onToggle={(id) => toggleId("quoteIds", id)}
              labelFor={(quote) => `${quoteNumber(quote)} / ${quoteJobName(quote)}`}
              metaFor={(quote) => [quote.customerName || quote.customer_name, quote.createdAt || quote.created_at].filter(Boolean).join(" / ")}
              emptyText="No quotes match that search."
            />
          </div>
        )}

        <fieldset className="customer-followup-question">
          <legend>Is this the same customer contact information?</legend>
          <div role="group" aria-label="Follow-up contact source">
            {canUsePrimaryContact && (
              <button className={form.contactMode === "primary" ? "active" : ""} type="button" onClick={() => applyContact("primary")}>
                <UserRound size={15} />
                Primary Contact
              </button>
            )}
            {contacts.length > 0 && (
              <button className={form.contactMode === "saved" ? "active" : ""} type="button" onClick={() => applyContact("saved")}>
                <CheckCircle2 size={15} />
                Saved Contact
              </button>
            )}
            <button className={form.contactMode === "new" ? "active" : ""} type="button" onClick={() => applyContact("new")}>
              <UserPlus size={15} />
              New Contact
            </button>
          </div>

          {form.contactMode === "saved" && contacts.length > 0 && (
            <div className="customer-followup-option-list">
              {contacts.map((contact) => (
                <button className={sameId(contact.id, form.selectedContactId) ? "active" : ""} type="button" key={contact.id} onClick={() => applyContact("saved", contact)}>
                  <span>
                    <strong>{contactName(contact)}</strong>
                    <em>{[contact.role, contact.email, contact.phone].filter(Boolean).join(" / ") || "No contact details"}</em>
                  </span>
                </button>
              ))}
            </div>
          )}

          {form.contactMode === "new" ? (
            <div className="customer-followup-fields customer-followup-subfields">
              <label>
                <span>First Name</span>
                <input value={form.contact_first_name} onChange={(event) => update("contact_first_name", event.target.value)} />
              </label>
              <label>
                <span>Last Name</span>
                <input value={form.contact_last_name} onChange={(event) => update("contact_last_name", event.target.value)} />
              </label>
              <label>
                <span>Role</span>
                <input value={form.contact_role} onChange={(event) => update("contact_role", event.target.value)} placeholder="Buyer, shipping, AP..." />
              </label>
              <label>
                <span>Email</span>
                <input type="email" value={form.contact_email} onChange={(event) => update("contact_email", event.target.value)} />
              </label>
              <label>
                <span>Phone</span>
                <input value={form.contact_phone} onChange={(event) => update("contact_phone", event.target.value)} />
              </label>
              <label>
                <span>Company</span>
                <input value={form.contact_company} onChange={(event) => update("contact_company", event.target.value)} />
              </label>
            </div>
          ) : (
            <ContactSummary contact={form} />
          )}
        </fieldset>

        <fieldset className="customer-followup-question">
          <legend>Does this contact use the same customer address?</legend>
          <div role="group" aria-label="Follow-up address source">
            <button className={form.addressMode === "primary" ? "active" : ""} type="button" onClick={() => applyAddress("primary")}>
              <Home size={15} />
              Customer Address
            </button>
            {addresses.length > 0 && (
              <button className={form.addressMode === "saved" ? "active" : ""} type="button" onClick={() => applyAddress("saved")}>
                <CheckCircle2 size={15} />
                Saved Address
              </button>
            )}
            <button className={form.addressMode === "new" ? "active" : ""} type="button" onClick={() => applyAddress("new")}>
              <MapPin size={15} />
              Different Address
            </button>
          </div>

          {form.addressMode === "saved" && addresses.length > 0 && (
            <div className="customer-followup-option-list">
              {addresses.map((address) => (
                <button className={sameId(address.id, form.selectedAddressId) ? "active" : ""} type="button" key={address.id} onClick={() => applyAddress("saved", address)}>
                  <span>
                    <strong>{address.label || "Address"}</strong>
                    <em>{addressSummary(address) || "No address details"}</em>
                  </span>
                </button>
              ))}
            </div>
          )}

          {form.addressMode === "new" ? (
            <div className="customer-followup-fields customer-followup-subfields">
              <label>
                <span>Label</span>
                <input value={form.address_label} onChange={(event) => update("address_label", event.target.value)} placeholder="Warehouse, billing, office..." />
              </label>
              <label className="wide">
                <span>Address Line 1</span>
                <input value={form.address_line_1} onChange={(event) => update("address_line_1", event.target.value)} />
              </label>
              <label className="wide">
                <span>Address Line 2</span>
                <input value={form.address_line_2} onChange={(event) => update("address_line_2", event.target.value)} />
              </label>
              <label className="wide">
                <span>Address Line 3</span>
                <input value={form.address_line_3} onChange={(event) => update("address_line_3", event.target.value)} />
              </label>
              <label>
                <span>City</span>
                <input value={form.city} onChange={(event) => update("city", event.target.value)} />
              </label>
              <label>
                <span>State</span>
                <input value={form.state} onChange={(event) => update("state", event.target.value)} />
              </label>
              <label>
                <span>Postal Code</span>
                <input value={form.postal_code} onChange={(event) => update("postal_code", event.target.value)} />
              </label>
              <label>
                <span>Country</span>
                <input value={form.country} onChange={(event) => update("country", event.target.value)} />
              </label>
            </div>
          ) : (
            <AddressSummary address={form} />
          )}
        </fieldset>

        <div className="customer-followup-fields">
          <label>
            <span>Form of Contact</span>
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
            <span>Contact Date</span>
            <input type="datetime-local" value={form.occurred_at} onChange={(event) => update("occurred_at", event.target.value)} />
          </label>
          <label>
            <span>Next Follow-Up</span>
            <input type="date" value={form.follow_up_date} onChange={(event) => update("follow_up_date", event.target.value)} />
          </label>
          <label className="wide">
            <span>Subject</span>
            <input value={form.subject} onChange={(event) => update("subject", event.target.value)} maxLength={180} placeholder={defaultSubject()} />
          </label>
          <label className="wide">
            <span>Notes</span>
            <textarea value={form.body} onChange={(event) => update("body", event.target.value)} rows={5} placeholder="What happened, what needs to happen next, and who owns it?" />
          </label>
          <label className="customer-followup-pin">
            <input type="checkbox" checked={form.pinned} onChange={(event) => update("pinned", event.target.checked)} />
            <span>Pinned</span>
          </label>
        </div>
        {localError && <p className="customer-crm-error">{localError}</p>}
        <div className="customer-followup-actions">
          <button className="primary-btn" type="submit" disabled={saving}>
            <MessageSquarePlus size={15} />
            {saving ? "Saving..." : editing ? "Save Follow-Up" : "Create Follow-Up"}
          </button>
        </div>
      </form>
    </section>
  );
}
