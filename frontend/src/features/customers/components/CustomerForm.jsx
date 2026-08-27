import { useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, Globe2, Mail, MapPin, Save, UserRound, X } from "lucide-react";

import { CRM_STAGES } from "../utils/customerChoices.js";

const emptyForm = {
  name: "",
  customer_code: "",
  account_owner: "",
  crm_stage: "active",
  next_follow_up: "",
  website: "",
  source_sheet_url: "",
  is_active: true,
  contactId: "",
  contact_first_name: "",
  contact_last_name: "",
  contact_role: "",
  contact_email: "",
  contact_phone: "",
  contact_company: "",
  contact_notes: "",
  addressId: "",
  address_label: "Primary",
  address_line_1: "",
  address_line_2: "",
  address_line_3: "",
  city: "",
  state: "",
  postal_code: "",
  country: "USA",
  address_notes: "",
  notes: "",
};

function splitContactName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  return {
    first: parts[0] || "",
    last: parts.slice(1).join(" "),
  };
}

function primaryContact(record) {
  const contacts = Array.isArray(record?.contacts) ? record.contacts : [];
  return contacts.find((contact) => contact.is_primary) || contacts[0] || null;
}

function primaryAddress(record) {
  const addresses = Array.isArray(record?.addresses) ? record.addresses : [];
  return addresses.find((address) => address.is_primary) || addresses[0] || null;
}

function clean(value) {
  return String(value ?? "").trim();
}

function hasContactInfo(form) {
  return Boolean(
    clean(form.contact_first_name) ||
    clean(form.contact_last_name) ||
    clean(form.contact_role) ||
    clean(form.contact_email) ||
    clean(form.contact_phone) ||
    clean(form.contact_company) ||
    clean(form.contact_notes)
  );
}

function hasAddressInfo(form) {
  return Boolean(
    clean(form.address_line_1) ||
    clean(form.address_line_2) ||
    clean(form.address_line_3) ||
    clean(form.city) ||
    clean(form.state) ||
    clean(form.postal_code)
  );
}

function buildInitialForm(record, defaults = {}) {
  const customer = { ...emptyForm, ...(record || {}), ...(defaults || {}) };
  const contact = primaryContact(record);
  const split = splitContactName(contact?.full_name || customer.contact_name);
  const address = primaryAddress(record);

  return {
    ...emptyForm,
    name: clean(customer.name),
    customer_code: clean(customer.customer_code),
    account_owner: clean(customer.account_owner),
    crm_stage: clean(customer.crm_stage) || "active",
    next_follow_up: customer.next_follow_up || "",
    website: clean(customer.website),
    source_sheet_url: clean(customer.source_sheet_url),
    is_active: customer.is_active !== false,
    contactId: contact?.id ? String(contact.id) : "",
    contact_first_name: clean(contact?.first_name || split.first),
    contact_last_name: clean(contact?.last_name || split.last),
    contact_role: clean(contact?.role),
    contact_email: clean(contact?.email || customer.email),
    contact_phone: clean(contact?.phone || customer.phone),
    contact_company: clean(contact?.company || customer.name),
    contact_notes: clean(contact?.notes),
    addressId: address?.id ? String(address.id) : "",
    address_label: clean(address?.label) || "Primary",
    address_line_1: clean(address?.address_line_1 || customer.address_line_1),
    address_line_2: clean(address?.address_line_2 || customer.address_line_2),
    address_line_3: clean(address?.address_line_3 || customer.address_line_3),
    city: clean(address?.city || customer.city),
    state: clean(address?.state || customer.state),
    postal_code: clean(address?.postal_code || customer.postal_code),
    country: clean(address?.country || customer.country) || "USA",
    address_notes: clean(address?.notes),
    notes: customer.notes || "",
  };
}

function errorMessage(error) {
  if (!error) return "";
  const message = typeof error === "string" ? error : error.message || String(error);
  try {
    const parsed = JSON.parse(message);
    if (!parsed || typeof parsed !== "object") return String(parsed ?? "");
    return Object.entries(parsed)
      .map(([key, value]) => `${String(key).replace(/_/g, " ")}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
      .join("\n");
  } catch {
    return message;
  }
}

function CustomerField({ label, children, wide = false }) {
  return (
    <label className={`customer-form-field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export default function CustomerForm({
  record = null,
  defaults = {},
  submitting = false,
  error = null,
  onSubmit,
  onCancel,
}) {
  const editing = Boolean(record?.id);
  const [form, setForm] = useState(() => buildInitialForm(record, defaults));
  const [localError, setLocalError] = useState("");
  const apiError = errorMessage(error);
  const resetKey = record?.id
    ? `edit:${record.id}`
    : `create:${JSON.stringify(defaults || {})}`;
  const contactName = useMemo(() => (
    [form.contact_first_name, form.contact_last_name].map(clean).filter(Boolean).join(" ")
  ), [form.contact_first_name, form.contact_last_name]);
  const contactReady = hasContactInfo(form);
  const addressReady = hasAddressInfo(form) && clean(form.address_line_1);

  useEffect(() => {
    setForm(buildInitialForm(record, defaults));
    setLocalError("");
  }, [resetKey]);

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setLocalError("");
  }

  function submit(event) {
    event.preventDefault();
    const customerName = clean(form.name);
    if (!customerName) {
      setLocalError("Customer name is required.");
      return;
    }

    const payload = {
      name: customerName,
      customer_code: clean(form.customer_code),
      account_owner: clean(form.account_owner),
      crm_stage: form.crm_stage || "active",
      next_follow_up: form.next_follow_up || null,
      website: clean(form.website),
      source_sheet_url: clean(form.source_sheet_url),
      contact_name: contactName,
      phone: clean(form.contact_phone),
      email: clean(form.contact_email),
      address_line_1: clean(form.address_line_1),
      address_line_2: clean(form.address_line_2),
      address_line_3: clean(form.address_line_3),
      city: clean(form.city),
      state: clean(form.state),
      postal_code: clean(form.postal_code),
      country: clean(form.country),
      notes: form.notes,
      is_active: Boolean(form.is_active),
    };

    if (contactReady) {
      payload.primary_contact = {
        id: form.contactId,
        first_name: clean(form.contact_first_name),
        last_name: clean(form.contact_last_name),
        role: clean(form.contact_role),
        email: clean(form.contact_email),
        phone: clean(form.contact_phone),
        company: clean(form.contact_company) || customerName,
        notes: clean(form.contact_notes),
        is_primary: true,
      };
    }

    if (hasAddressInfo(form)) {
      payload.primary_address = {
        id: form.addressId,
        label: clean(form.address_label) || "Primary",
        address_line_1: clean(form.address_line_1),
        address_line_2: clean(form.address_line_2),
        address_line_3: clean(form.address_line_3),
        city: clean(form.city),
        state: clean(form.state),
        postal_code: clean(form.postal_code),
        country: clean(form.country),
        notes: clean(form.address_notes),
        is_primary: true,
      };
    }

    onSubmit?.(payload);
  }

  return (
    <section className="customer-form-shell customer-page-card" aria-label={editing ? "Edit customer" : "Add customer"}>
      <header className="customer-form-header">
        <div>
          <span>Customer</span>
          <strong>{editing ? "Edit Customer" : "Add New Customer"}</strong>
        </div>
        <button type="button" onClick={onCancel} aria-label="Close customer form">
          <X size={17} />
        </button>
      </header>

      <form className="customer-form" onSubmit={submit}>
        <section className="customer-form-section">
          <header>
            <Building2 size={17} />
            <strong>Account</strong>
          </header>
          <div className="customer-form-grid">
            <CustomerField label="Customer Name" wide>
              <input value={form.name} onChange={(event) => update("name", event.target.value)} required autoFocus />
            </CustomerField>
            <CustomerField label="Customer ID">
              <input value={form.customer_code} onChange={(event) => update("customer_code", event.target.value)} />
            </CustomerField>
            <CustomerField label="Sales Person / Account Owner">
              <input value={form.account_owner} onChange={(event) => update("account_owner", event.target.value)} placeholder="Sales person responsible for this account" />
            </CustomerField>
            <CustomerField label="CRM Stage">
              <select value={form.crm_stage} onChange={(event) => update("crm_stage", event.target.value)}>
                {CRM_STAGES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </CustomerField>
            <CustomerField label="Next Follow-Up">
              <input type="date" value={form.next_follow_up || ""} onChange={(event) => update("next_follow_up", event.target.value)} />
            </CustomerField>
            <label className="customer-form-check">
              <input type="checkbox" checked={form.is_active} onChange={(event) => update("is_active", event.target.checked)} />
              <span>Active Customer</span>
            </label>
          </div>
        </section>

        <section className="customer-form-section">
          <header>
            <UserRound size={17} />
            <strong>Primary Contact</strong>
            <em>{contactReady ? contactName || form.contact_email || form.contact_phone : "Not set"}</em>
          </header>
          <div className="customer-form-grid">
            <CustomerField label="First Name">
              <input value={form.contact_first_name} onChange={(event) => update("contact_first_name", event.target.value)} />
            </CustomerField>
            <CustomerField label="Last Name">
              <input value={form.contact_last_name} onChange={(event) => update("contact_last_name", event.target.value)} />
            </CustomerField>
            <CustomerField label="Role">
              <input value={form.contact_role} onChange={(event) => update("contact_role", event.target.value)} placeholder="Buyer, shipping, AP..." />
            </CustomerField>
            <CustomerField label="Email">
              <input type="email" value={form.contact_email} onChange={(event) => update("contact_email", event.target.value)} />
            </CustomerField>
            <CustomerField label="Phone">
              <input value={form.contact_phone} onChange={(event) => update("contact_phone", event.target.value)} />
            </CustomerField>
            <CustomerField label="Company">
              <input value={form.contact_company} onChange={(event) => update("contact_company", event.target.value)} />
            </CustomerField>
            <CustomerField label="Contact Notes" wide>
              <textarea value={form.contact_notes} onChange={(event) => update("contact_notes", event.target.value)} rows={3} />
            </CustomerField>
          </div>
        </section>

        <section className="customer-form-section">
          <header>
            <MapPin size={17} />
            <strong>Primary Address</strong>
            <em>{addressReady ? [form.city, form.state].map(clean).filter(Boolean).join(", ") || clean(form.address_line_1) : "Not set"}</em>
          </header>
          <div className="customer-form-grid">
            <CustomerField label="Label">
              <input value={form.address_label} onChange={(event) => update("address_label", event.target.value)} />
            </CustomerField>
            <CustomerField label="Address Line 1" wide>
              <input value={form.address_line_1} onChange={(event) => update("address_line_1", event.target.value)} />
            </CustomerField>
            <CustomerField label="Address Line 2" wide>
              <input value={form.address_line_2} onChange={(event) => update("address_line_2", event.target.value)} />
            </CustomerField>
            <CustomerField label="Address Line 3" wide>
              <input value={form.address_line_3} onChange={(event) => update("address_line_3", event.target.value)} />
            </CustomerField>
            <CustomerField label="City">
              <input value={form.city} onChange={(event) => update("city", event.target.value)} />
            </CustomerField>
            <CustomerField label="State">
              <input value={form.state} onChange={(event) => update("state", event.target.value)} />
            </CustomerField>
            <CustomerField label="Postal Code">
              <input value={form.postal_code} onChange={(event) => update("postal_code", event.target.value)} />
            </CustomerField>
            <CustomerField label="Country">
              <input value={form.country} onChange={(event) => update("country", event.target.value)} />
            </CustomerField>
            <CustomerField label="Address Notes" wide>
              <textarea value={form.address_notes} onChange={(event) => update("address_notes", event.target.value)} rows={3} />
            </CustomerField>
          </div>
        </section>

        <section className="customer-form-section customer-form-section-wide">
          <header>
            <Globe2 size={17} />
            <strong>Links + Notes</strong>
          </header>
          <div className="customer-form-grid">
            <CustomerField label="Website">
              <input type="url" value={form.website} onChange={(event) => update("website", event.target.value)} placeholder="https://example.com" />
            </CustomerField>
            <CustomerField label="Source Sheet">
              <input type="url" value={form.source_sheet_url} onChange={(event) => update("source_sheet_url", event.target.value)} placeholder="https://..." />
            </CustomerField>
            <CustomerField label="Account Notes" wide>
              <textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} rows={4} />
            </CustomerField>
          </div>
        </section>

        {(localError || apiError) && <p className="customer-crm-error">{localError || apiError}</p>}

        <footer className="customer-form-actions">
          <span>
            {contactReady && <><Mail size={14} /> Contact saved</>}
            {addressReady && <><CheckCircle2 size={14} /> Address saved</>}
          </span>
          <div>
            <button className="ghost-btn" type="button" onClick={onCancel}>Cancel</button>
            <button className="primary-btn" type="submit" disabled={submitting}>
              <Save size={16} />
              {submitting ? "Saving..." : editing ? "Save Customer" : "Create Customer"}
            </button>
          </div>
        </footer>
      </form>
    </section>
  );
}
