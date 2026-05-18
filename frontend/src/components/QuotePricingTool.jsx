import { AlertTriangle, CheckCircle2, CircleDollarSign, Download, FileText, Layers3, Pencil, Plus, Printer, Ruler, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchCollection } from "../api";
import {
  buildLayoutCandidates,
  calculateFinishedMaterialMsiCost,
  calculateQuotePricing,
  componentLabelForFinishedMaterial,
  finishedComponentSlots,
  finishedMaterialAdderFields,
  quoteExtraCostFields,
  rawComponentTypes,
  toQuoteNumber,
} from "../lib/quotePricing";

const materialWidthPresets = ["8", "8.75", "9", "12.75", "16.875"];
const materialLibraryStorageKey = "tsm_quote_material_library_v1";
const savedQuotesStorageKey = "tsm_quote_records_v1";

const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const unitCurrencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 });
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const percentFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

const initialForm = {
  selectedMaterialId: "manual",
  labelWidth: "4",
  labelLength: "2",
  repeat: "2.125",
  quantity: "10000",
  materialWidth: "8.75",
  gap: "0.125",
  sideTrim: "0.325",
  acrossMode: "auto",
  numberAcross: "",
  wastePercent: "10",
  msiCost: "0.443",
  setupCost: "0",
  printCost: "0",
  finishingCost: "0",
  packagingCost: "0",
  outsideCost: "0",
  pricingMode: "margin",
  pricingPercent: "35",
};

const emptyRawForm = {
  name: "",
  componentType: "face",
  msiCost: "",
  inventoryMsi: "",
  notes: "",
};

const emptyFinishedForm = {
  name: "",
  sourceType: "made",
  width_inches: "8.75",
  inventoryMsi: "",
  purchasedMsiCost: "",
  faceRawId: "",
  linerRawId: "",
  adhesiveRawId: "",
  siliconeRawId: "",
  inkRawId: "",
  laborMsiCost: "",
  coatingMsiCost: "",
  complexityMsiCost: "",
  otherMsiCost: "",
  notes: "",
};

const emptyQuoteInfo = {
  linkMode: "manual",
  jobTicketId: "",
  customerName: "",
  jobName: "",
  productCode: "",
  contactName: "",
  contactEmail: "",
  preparedBy: "",
  notes: "",
};

function money(value) {
  return currencyFormatter.format(Number.isFinite(value) ? value : 0);
}

function unitMoney(value) {
  return unitCurrencyFormatter.format(Number.isFinite(value) ? value : 0);
}

function number(value, suffix = "") {
  const safe = Number.isFinite(value) ? value : 0;
  return `${numberFormatter.format(safe)}${suffix}`;
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadMaterialLibrary() {
  if (typeof window === "undefined") return { rawMaterials: [], finishedMaterials: [] };
  try {
    const payload = JSON.parse(window.localStorage.getItem(materialLibraryStorageKey) || "{}");
    return {
      rawMaterials: Array.isArray(payload.rawMaterials) ? payload.rawMaterials : [],
      finishedMaterials: Array.isArray(payload.finishedMaterials) ? payload.finishedMaterials : [],
    };
  } catch {
    return { rawMaterials: [], finishedMaterials: [] };
  }
}

function loadSavedQuotes() {
  if (typeof window === "undefined") return [];
  try {
    const payload = JSON.parse(window.localStorage.getItem(savedQuotesStorageKey) || "[]");
    return Array.isArray(payload) ? payload : [];
  } catch {
    return [];
  }
}

function quoteNumber() {
  const stamp = new Date();
  const y = stamp.getFullYear();
  const m = String(stamp.getMonth() + 1).padStart(2, "0");
  const d = String(stamp.getDate()).padStart(2, "0");
  const tail = String(stamp.getTime()).slice(-5);
  return `Q-${y}${m}${d}-${tail}`;
}

function quoteDateLabel(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function jobTicketLabel(ticket) {
  if (!ticket) return "";
  return [
    ticket.ticket_number,
    ticket.customer_display || ticket.customer_name,
    ticket.job_name || ticket.product_name,
  ].filter(Boolean).join(" / ");
}

function dimensionInputValue(value) {
  const numberValue = toQuoteNumber(value, NaN);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return "";
  return String(Number(numberValue.toFixed(4))).replace(/\.0+$/, "");
}

function jobTicketQuoteDimensions(ticket) {
  if (!ticket) {
    return {
      width: "",
      length: "",
      gap: "",
      complete: false,
      hasAny: false,
      message: "",
    };
  }

  const widthNumber = toQuoteNumber(ticket.label_width_inches, NaN);
  const lengthNumber = toQuoteNumber(ticket.label_length_inches, NaN);
  const repeatNumber = toQuoteNumber(ticket.repeat_inches, NaN);
  const hasWidth = Number.isFinite(widthNumber) && widthNumber > 0;
  const hasLength = Number.isFinite(lengthNumber) && lengthNumber > 0;
  const hasRepeat = Number.isFinite(repeatNumber) && repeatNumber > 0;
  const canDeriveGap = hasLength && hasRepeat;
  const gapNumber = canDeriveGap ? Math.max(0, repeatNumber - lengthNumber) : NaN;
  const missing = [
    !hasWidth ? "label width" : "",
    !hasLength ? "label length" : "",
    !canDeriveGap ? "gap/repeat" : "",
  ].filter(Boolean);
  const complete = hasWidth && hasLength && canDeriveGap;
  const hasAny = hasWidth || hasLength || hasRepeat;

  return {
    width: hasWidth ? dimensionInputValue(widthNumber) : "",
    length: hasLength ? dimensionInputValue(lengthNumber) : "",
    gap: canDeriveGap ? String(Number(gapNumber.toFixed(4))).replace(/\.0+$/, "") : "",
    complete,
    hasAny,
    message: complete
      ? ""
      : hasAny
        ? `This job ticket is missing ${missing.join(", ")}. Enter or override the values below.`
        : "This job ticket does not contain any label size data. Enter the values below.",
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function quotePublicMaterialName(quote) {
  if (!quote?.materialName || quote.materialName === "Manual MSI Cost") return "As specified";
  return quote.materialName;
}

function quoteDescription(quote) {
  return quote.jobName || `${quote.form.labelWidth}" x ${quote.form.labelLength}" label`;
}

function quoteCustomerDetailRows(quote) {
  const rows = [
    ["Label Size", `${quote.form.labelWidth}" x ${quote.form.labelLength}"`],
    ["Finished Material", quotePublicMaterialName(quote)],
    ["Quantity", Number(quote.form.quantity || 0).toLocaleString()],
    ["Quote Number", quote.quoteNumber],
    ["Quote Date", quoteDateLabel(quote.createdAt)],
  ];
  if (quote.productCode) rows.splice(3, 0, ["TSM ID", quote.productCode]);
  return rows;
}

function quoteCustomerPriceRows(quote) {
  return [
    ["Quantity", Number(quote.form.quantity || 0).toLocaleString()],
    ["Price / M", money(quote.pricing.pricePerThousand)],
    ["Price / Label", unitMoney(quote.pricing.pricePerLabel)],
    ["Quoted Total", money(quote.pricing.sellPrice)],
  ];
}

function quoteIncludedServices(quote) {
  const services = quoteExtraCostFields
    .filter((field) => Number(quote.form?.[field.name] || 0) > 0)
    .map((field) => field.label);
  return services.length ? services : ["Labels produced to quoted specification"];
}

function percent(value) {
  return `${percentFormatter.format(Number.isFinite(value) ? value : 0)}%`;
}

function quotePricingModeLabel(quote) {
  const mode = quote.form?.pricingMode === "markup" ? "Markup" : "Margin";
  return `${mode} ${percentFormatter.format(Number(quote.form?.pricingPercent || quote.pricing?.pricingPercent || 0))}%`;
}

function quoteActualMargin(quote) {
  const sell = Number(quote.pricing?.sellPrice || 0);
  const profit = Number(quote.pricing?.profit || 0);
  return sell > 0 ? (profit / sell) * 100 : 0;
}

function quoteActualMarkup(quote) {
  const cost = Number(quote.pricing?.totalCost || 0);
  const profit = Number(quote.pricing?.profit || 0);
  return cost > 0 ? (profit / cost) * 100 : 0;
}

function quoteAddedCostRows(quote) {
  return quoteExtraCostFields.map((field) => [
    field.label,
    money(Number(quote.form?.[field.name] || 0)),
  ]);
}

function quoteInternalSections(quote) {
  if (!quote) return [];
  return [
    {
      title: "Quote Inputs",
      rows: [
        ["Customer", quote.customerName || "--"],
        ["Job Name", quote.jobName || "--"],
        ...(quote.productCode ? [["TSM ID", quote.productCode]] : []),
        ["Job Ticket", quote.jobTicketNumber || "Manual quote"],
        ["Contact", quote.contactName || quote.contactEmail || "--"],
        ["Prepared By", `${quotePreparedByName(quote)}${quotePreparedByRole(quote) ? ` / ${quotePreparedByRole(quote)}` : ""}`],
      ],
    },
    {
      title: "Material + Layout",
      rows: [
        ["Finished Material", quote.materialName || "Manual MSI Cost"],
        ["Material Source", quote.materialSource || "manual"],
        ["Components", quote.materialComponents || "--"],
        ["Material Width", number(Number(quote.form?.materialWidth || 0), '"')],
        ["Number Across", quote.pricing?.numberAcross || "--"],
        ["Layout Width", number(Number(quote.pricing?.totalLayoutWidth || 0), '"')],
        ["Unused Width", number(Number(quote.pricing?.widthDelta || 0), '"')],
        ["Web Usage", percent(Number(quote.pricing?.widthUsagePercent || 0))],
      ],
    },
    {
      title: "MSI Calculation",
      rows: [
        ["Label Size", `${quote.form?.labelWidth || 0}" x ${quote.form?.labelLength || 0}"`],
        ["Auto Repeat", number(Number(quote.pricing?.repeat || quote.form?.repeat || 0), '"')],
        ["Quantity", Number(quote.form?.quantity || 0).toLocaleString()],
        ["Finished Label MSI", number(Number(quote.pricing?.finishedMsi || 0))],
        ["Base Material MSI", number(Number(quote.pricing?.baseMaterialMsi || 0))],
        ["Waste Percent", percent(Number(quote.form?.wastePercent || 0))],
        ["Waste MSI", number(Number(quote.pricing?.wasteMsi || 0))],
        ["MSI With Waste", number(Number(quote.pricing?.materialMsiWithWaste || 0))],
      ],
    },
    {
      title: "Cost Build",
      rows: [
        ["MSI Cost", `${unitMoney(Number(quote.form?.msiCost || 0))} / MSI`],
        ["Material Cost", money(Number(quote.pricing?.materialCost || 0))],
        ...quoteAddedCostRows(quote),
        ["Added Costs Total", money(Number(quote.pricing?.extraCost || 0))],
        ["Total Internal Cost", money(Number(quote.pricing?.totalCost || 0))],
      ],
    },
    {
      title: "Sell Price",
      rows: [
        ["Pricing Method", quotePricingModeLabel(quote)],
        ["Sell Price", money(Number(quote.pricing?.sellPrice || 0))],
        ["Price / M", money(Number(quote.pricing?.pricePerThousand || 0))],
        ["Price / Label", unitMoney(Number(quote.pricing?.pricePerLabel || 0))],
        ["Profit Dollars", money(Number(quote.pricing?.profit || 0))],
        ["Actual Margin", percent(quoteActualMargin(quote))],
        ["Actual Markup", percent(quoteActualMarkup(quote))],
      ],
    },
    {
      title: "Form Snapshot",
      rows: [
        ["Gap", number(Number(quote.form?.gap || 0), '"')],
        ["Side Trim", number(Number(quote.form?.sideTrim || 0), '"')],
        ["Lane Mode", quote.form?.acrossMode || "auto"],
        ["Manual Across", quote.form?.numberAcross || "--"],
        ["Layout Fits", quote.pricing?.fits ? "Yes" : "No"],
        ["Notes", quote.notes || "--"],
      ],
    },
  ];
}

function pdfEscape(value) {
  return String(value ?? "")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function clipText(value, max = 70) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function quotePreparedByName(quote) {
  return quote?.preparedByName || quote?.preparedBy || "Unassigned";
}

function quotePreparedByRole(quote) {
  return quote?.preparedByRole || quote?.preparedByTitle || "";
}

function quoteSearchText(quote) {
  return [
    quote.quoteNumber,
    quote.customerName,
    quote.jobName,
    quote.productCode,
    quote.materialName,
    quotePreparedByName(quote),
    quotePreparedByRole(quote),
    quoteDateLabel(quote.createdAt),
    money(quote.pricing?.sellPrice),
  ].filter(Boolean).join(" ").toLowerCase();
}

function Field({ label, suffix, children }) {
  return (
    <label className="quote-field">
      <span>{label}</span>
      <div className={suffix ? "quote-input-with-suffix" : ""}>
        {children}
        {suffix && <em>{suffix}</em>}
      </div>
    </label>
  );
}

function Metric({ label, value, tone = "" }) {
  return (
    <div className={`quote-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BreakdownRow({ label, value }) {
  return (
    <div className="quote-breakdown-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TabButton({ active, icon: Icon, label, count, onClick }) {
  return (
    <button className={active ? "active" : ""} type="button" onClick={onClick}>
      <Icon size={16} />
      <span>{label}</span>
      {count !== undefined && <em>{count}</em>}
    </button>
  );
}

function RawMaterialForm({ form, update, submit, editing = false, onCancel }) {
  return (
    <form className="quote-library-form" onSubmit={submit}>
      <Field label="Name">
        <input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="40# SCK liner" />
      </Field>
      <Field label="Type">
        <select value={form.componentType} onChange={(event) => update("componentType", event.target.value)}>
          {rawComponentTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </Field>
      <Field label="MSI Cost" suffix="/ MSI">
        <input type="number" step="0.0001" value={form.msiCost} onChange={(event) => update("msiCost", event.target.value)} />
      </Field>
      <Field label="On Hand" suffix="MSI">
        <input type="number" step="0.001" value={form.inventoryMsi} onChange={(event) => update("inventoryMsi", event.target.value)} />
      </Field>
      <label className="quote-field quote-field-wide">
        <span>Notes</span>
        <textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Supplier, coating weight, or approval notes" />
      </label>
      <div className="quote-form-actions">
        <button className="primary-btn" type="submit">{editing ? <Pencil size={15} /> : <Plus size={15} />} {editing ? "Save Changes" : "Add Raw Material"}</button>
        {editing && <button className="ghost-btn" type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function FinishedMaterialForm({ form, rawMaterials, update, submit, editing = false, onCancel }) {
  function rawOptionsFor(slot) {
    return rawMaterials.filter((raw) => raw.componentType === slot.type);
  }

  return (
    <form className="quote-library-form" onSubmit={submit}>
      <Field label="Name">
        <input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="PM / 40# / Permanent" />
      </Field>
      <Field label="Source">
        <select value={form.sourceType} onChange={(event) => update("sourceType", event.target.value)}>
          <option value="made">Made In-House</option>
          <option value="purchased">Purchased Finished</option>
        </select>
      </Field>

      {form.sourceType === "purchased" ? (
        <Field label="Purchased Cost" suffix="/ MSI">
          <input type="number" step="0.0001" value={form.purchasedMsiCost} onChange={(event) => update("purchasedMsiCost", event.target.value)} />
        </Field>
      ) : (
        <>
          {finishedComponentSlots.map((slot) => (
            <Field label={slot.label} key={slot.name}>
              <select value={form[slot.name]} onChange={(event) => update(slot.name, event.target.value)}>
                <option value="">None</option>
                {rawOptionsFor(slot).map((raw) => (
                  <option value={raw.id} key={raw.id}>{raw.name} - {unitMoney(Number(raw.msiCost || 0))}/MSI</option>
                ))}
              </select>
            </Field>
          ))}
          {finishedMaterialAdderFields.map((field) => (
            <Field label={field.label} suffix="/ MSI" key={field.name}>
              <input type="number" step="0.0001" value={form[field.name]} onChange={(event) => update(field.name, event.target.value)} />
            </Field>
          ))}
        </>
      )}

      <label className="quote-field quote-field-wide">
        <span>Notes</span>
        <textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Hard coat, approved vendor, speed, or complexity notes" />
      </label>
      <div className="quote-form-actions">
        <button className="primary-btn" type="submit">{editing ? <Pencil size={15} /> : <Plus size={15} />} {editing ? "Save Changes" : "Add Finished Material"}</button>
        {editing && <button className="ghost-btn" type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function QuoteDocument({ quote }) {
  if (!quote) return <p className="quote-empty">Select a saved quote to view it.</p>;
  const detailRows = quoteCustomerDetailRows(quote);
  const priceRows = quoteCustomerPriceRows(quote);
  const includedServices = quoteIncludedServices(quote);

  return (
    <article className="quote-document">
      <header className="quote-doc-single-head">
        <div>
          <strong>Tri-State Media</strong>
          <span>Quote {quote.quoteNumber}</span>
          <em>{quoteDateLabel(quote.createdAt)}</em>
        </div>
        <div>
          <span>Total Quote</span>
          <strong>{money(quote.pricing.sellPrice)}</strong>
          <em>{money(quote.pricing.pricePerThousand)} / M</em>
        </div>
      </header>

      <section className="quote-doc-meta">
        <div>
          <span>Customer</span>
          <strong>{quote.customerName || "--"}</strong>
          <em>{quote.contactName || quote.contactEmail || ""}</em>
        </div>
        <div>
          <span>Job</span>
          <strong>{quote.jobName || "--"}</strong>
          <em>{quote.jobTicketNumber ? `Job Ticket ${quote.jobTicketNumber}` : quote.productCode || "Manual quote"}</em>
        </div>
        <div>
          <span>Prepared By</span>
          <strong>{quotePreparedByName(quote)}</strong>
          <em>{quotePreparedByRole(quote) || (quote.createdAt ? quoteDateLabel(quote.createdAt) : "")}</em>
        </div>
        <div>
          <span>Quote Date</span>
          <strong>{quoteDateLabel(quote.createdAt)}</strong>
          <em>{quote.quoteNumber}</em>
        </div>
      </section>

      <section className="quote-doc-line-item">
        <h3>Quoted Item</h3>
        <div className="quote-doc-item-table">
          <div><span>Quantity</span><strong>{Number(quote.form.quantity || 0).toLocaleString()}</strong></div>
          <div><span>Description</span><strong>{quoteDescription(quote)}</strong></div>
          <div><span>Price / M</span><strong>{money(quote.pricing.pricePerThousand)}</strong></div>
          <div><span>Total</span><strong>{money(quote.pricing.sellPrice)}</strong></div>
        </div>
      </section>

      <section className="quote-doc-compact-grid">
        <div>
          <h3>Quote Details</h3>
          {detailRows.map(([label, value]) => (
            <div className="quote-doc-row" key={label}><span>{label}</span><strong>{value}</strong></div>
          ))}
        </div>
        <div>
          <h3>Customer Pricing</h3>
          {priceRows.map(([label, value]) => (
            <div className="quote-doc-row" key={label}><span>{label}</span><strong>{value}</strong></div>
          ))}
        </div>
      </section>

      <section className="quote-doc-included">
        <h3>Included</h3>
        <div>
          {includedServices.map((service) => <span key={service}>{service}</span>)}
        </div>
      </section>

      {quote.notes && (
        <section className="quote-doc-notes">
          <h3>Notes</h3>
          <p>{quote.notes}</p>
        </section>
      )}
    </article>
  );
}

function InternalQuoteBreakdown({ quote }) {
  if (!quote) return <p className="quote-empty">Select a saved quote to view internal pricing.</p>;
  const sections = quoteInternalSections(quote);
  const msiUnitCost = Number(quote.form?.msiCost || 0);
  const materialMsi = Number(quote.pricing?.materialMsiWithWaste || 0);
  const materialCost = Number(quote.pricing?.materialCost || 0);
  const totalCost = Number(quote.pricing?.totalCost || 0);
  const sellPrice = Number(quote.pricing?.sellPrice || 0);
  const profit = Number(quote.pricing?.profit || 0);

  return (
    <article className="quote-internal-breakdown">
      <header className="quote-internal-head">
        <div>
          <span>Internal Pricing Review</span>
          <strong>{quote.quoteNumber}</strong>
          <em>{quote.customerName || "No customer"} / {quoteDescription(quote)}</em>
        </div>
        <div>
          <span>Actual Margin</span>
          <strong>{percent(quoteActualMargin(quote))}</strong>
          <em>{quotePricingModeLabel(quote)}</em>
        </div>
      </header>

      <section className="quote-internal-kpis">
        <Metric label="Sell Price" value={money(sellPrice)} />
        <Metric label="Total Cost" value={money(totalCost)} />
        <Metric label="Profit" value={money(profit)} tone="good" />
        <Metric label="MSI With Waste" value={number(materialMsi)} />
        <Metric label="Material Cost" value={money(materialCost)} />
        <Metric label="MSI Unit Cost" value={`${unitMoney(msiUnitCost)} / MSI`} />
      </section>

      <section className="quote-internal-formula">
        <span>Material formula</span>
        <code>
          ({quote.pricing?.repeat || quote.form?.repeat || 0} repeat x {Number(quote.form?.quantity || 0).toLocaleString()} labels x {quote.form?.materialWidth || 0}" web) / (1000 x {quote.pricing?.numberAcross || 0} across) x {number(Number(quote.pricing?.wasteMultiplier || 1))} waste x {unitMoney(msiUnitCost)}
        </code>
      </section>

      <section className="quote-internal-sections">
        {sections.map((section) => (
          <div className="quote-internal-section" key={section.title}>
            <h3>{section.title}</h3>
            {section.rows.map(([label, value]) => (
              <div className="quote-internal-row" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        ))}
      </section>
    </article>
  );
}

export default function QuotePricingTool({ currentUser }) {
  const storedLibrary = useMemo(loadMaterialLibrary, []);
  const storedQuotes = useMemo(loadSavedQuotes, []);
  const [activeTab, setActiveTab] = useState("pricing");
  const [savedQuoteView, setSavedQuoteView] = useState("customer");
  const [form, setForm] = useState(initialForm);
  const [quoteInfo, setQuoteInfo] = useState(emptyQuoteInfo);
  const [quoteSearch, setQuoteSearch] = useState("");
  const [rawForm, setRawForm] = useState(emptyRawForm);
  const [finishedForm, setFinishedForm] = useState(emptyFinishedForm);
  const [editingRawId, setEditingRawId] = useState(null);
  const [editingFinishedId, setEditingFinishedId] = useState(null);
  const [rawMaterials, setRawMaterials] = useState(storedLibrary.rawMaterials);
  const [finishedMaterials, setFinishedMaterials] = useState(storedLibrary.finishedMaterials);
  const [savedQuotes, setSavedQuotes] = useState(storedQuotes);
  const [selectedQuoteId, setSelectedQuoteId] = useState(storedQuotes[0]?.id ?? null);
  const [jobTickets, setJobTickets] = useState([]);
  const [jobTicketLoadState, setJobTicketLoadState] = useState("idle");

  const materialOptions = useMemo(() => {
    return finishedMaterials.map((material) => ({
      ...material,
      calculatedMsiCost: calculateFinishedMaterialMsiCost(material, rawMaterials),
      componentLabel: componentLabelForFinishedMaterial(material, rawMaterials),
    }));
  }, [finishedMaterials, rawMaterials]);

  const selectedMaterial = materialOptions.find((material) => String(material.id) === String(form.selectedMaterialId));
  const selectedJobTicket = jobTickets.find((ticket) => String(ticket.id) === String(quoteInfo.jobTicketId));
  const selectedJobTicketDimensions = useMemo(() => jobTicketQuoteDimensions(selectedJobTicket), [selectedJobTicket]);
  const selectedQuote = savedQuotes.find((quote) => quote.id === selectedQuoteId) ?? savedQuotes[0] ?? null;
  const filteredSavedQuotes = useMemo(() => {
    const search = quoteSearch.trim().toLowerCase();
    if (!search) return savedQuotes;
    return savedQuotes.filter((quote) => quoteSearchText(quote).includes(search));
  }, [quoteSearch, savedQuotes]);
  const groupedSavedQuotes = useMemo(() => {
    const groups = new Map();
    filteredSavedQuotes.forEach((quote) => {
      const key = quote.preparedByUserId || quotePreparedByName(quote);
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name: quotePreparedByName(quote),
          role: quotePreparedByRole(quote),
          quotes: [],
        });
      }
      groups.get(key).quotes.push(quote);
    });
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredSavedQuotes]);
  const pricing = useMemo(() => calculateQuotePricing(form), [form]);
  const candidates = useMemo(() => buildLayoutCandidates(form), [form]);
  const fitTone = pricing.fits ? "ready" : "bad";
  const FitIcon = pricing.fits ? CheckCircle2 : AlertTriangle;
  const manualMaterialWidth = !materialWidthPresets.includes(form.materialWidth);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(materialLibraryStorageKey, JSON.stringify({ rawMaterials, finishedMaterials }));
  }, [rawMaterials, finishedMaterials]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(savedQuotesStorageKey, JSON.stringify(savedQuotes));
  }, [savedQuotes]);

  useEffect(() => {
    if (!currentUser?.name) return;
    setQuoteInfo((prev) => ({ ...prev, preparedBy: currentUser.name }));
  }, [currentUser?.id, currentUser?.name]);

  useEffect(() => {
    let alive = true;
    setJobTicketLoadState("loading");
    fetchCollection("job-tickets", { pageSize: 500 })
      .then((payload) => {
        if (!alive) return;
        setJobTickets(payload.results ?? []);
        setJobTicketLoadState("ready");
      })
      .catch(() => {
        if (!alive) return;
        setJobTickets([]);
        setJobTicketLoadState("error");
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedMaterial) return;
    setForm((prev) => ({
      ...prev,
      msiCost: String(selectedMaterial.calculatedMsiCost),
      materialWidth: selectedMaterial.width_inches || prev.materialWidth,
    }));
  }, [selectedMaterial?.id, selectedMaterial?.calculatedMsiCost, selectedMaterial?.width_inches]);

  useEffect(() => {
    if (quoteInfo.linkMode !== "ticket" || !selectedJobTicket) return;
    const dimensions = jobTicketQuoteDimensions(selectedJobTicket);
    setForm((prev) => ({
      ...prev,
      labelWidth: dimensions.width,
      labelLength: dimensions.length,
      gap: dimensions.gap,
    }));
  }, [quoteInfo.linkMode, selectedJobTicket?.id]);

  function updateField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function updateQuoteInfo(name, value) {
    setQuoteInfo((prev) => ({ ...prev, [name]: value }));
  }

  function updateMaterialSelection(value) {
    const material = materialOptions.find((item) => String(item.id) === String(value));
    setForm((prev) => ({
      ...prev,
      selectedMaterialId: value,
      msiCost: material ? String(material.calculatedMsiCost) : prev.msiCost,
      materialWidth: material?.width_inches ? String(material.width_inches) : prev.materialWidth,
    }));
  }

  function useCandidate(numberAcross) {
    setForm((prev) => ({ ...prev, acrossMode: "manual", numberAcross: String(numberAcross) }));
  }

  function buildQuoteRecord() {
    const ticket = quoteInfo.linkMode === "ticket" ? selectedJobTicket : null;
    const customerName = ticket?.customer_display || ticket?.customer_name || quoteInfo.customerName;
    const jobName = ticket?.job_name || ticket?.product_name || quoteInfo.jobName;
    const productCode = ticket?.product_code || "";
    const preparedBy = currentUser?.name || quoteInfo.preparedBy;
    const record = {
      id: makeId("quote"),
      quoteNumber: quoteNumber(),
      createdAt: new Date().toISOString(),
      preparedByUserId: currentUser?.id || "",
      preparedByUsername: currentUser?.username || "",
      preparedByName: preparedBy,
      preparedByRole: currentUser?.role || "",
      jobTicketId: ticket?.id ?? null,
      jobTicketNumber: ticket?.ticket_number ?? "",
      customerName,
      jobName,
      productCode,
      contactName: quoteInfo.contactName,
      contactEmail: quoteInfo.contactEmail,
      preparedBy,
      notes: quoteInfo.notes,
      materialName: selectedMaterial?.name || "Manual MSI Cost",
      materialSource: selectedMaterial?.sourceType || "manual",
      materialComponents: selectedMaterial?.componentLabel || "",
      form: { ...form, repeat: String(pricing.repeat) },
      pricing: { ...pricing },
    };
    return record;
  }

  function generateQuote() {
    const record = buildQuoteRecord();
    setSavedQuotes((prev) => [record, ...prev]);
    setSelectedQuoteId(record.id);
    setActiveTab("quotes");
  }

  function deleteQuote(id) {
    setSavedQuotes((prev) => prev.filter((quote) => quote.id !== id));
    setSelectedQuoteId((current) => current === id ? null : current);
  }

  function printQuote(quote) {
    if (!quote) return;
    const detailRows = quoteCustomerDetailRows(quote);
    const priceRows = quoteCustomerPriceRows(quote);
    const includedServices = quoteIncludedServices(quote);
    const html = `<!doctype html>
<html>
<head>
<title>${escapeHtml(quote.quoteNumber)}</title>
<style>
@page{size:letter;margin:.35in}
body{margin:0;background:#f3f4f6;color:#111827;font-family:Arial,sans-serif}
.page{width:8.5in;min-height:11in;margin:0 auto;background:#fff;padding:.42in;box-sizing:border-box}
.head{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #111827;padding-bottom:12px}
.head div:last-child{text-align:right}.head strong{display:block;font-size:20px}.head span,.head em,.meta span,.item span,.row span{display:block;color:#667085;font-size:10px;text-transform:uppercase;font-weight:700;font-style:normal}
.head h1{margin:4px 0 0;font-size:30px}.head div:last-child strong{font-size:30px}
.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}.meta div{border:1px solid #e5e7eb;padding:8px}.meta strong{display:block;margin-top:2px;font-size:12px}.meta em{display:block;color:#667085;font-size:10px;font-style:normal;margin-top:2px}
.item{margin-top:12px}.item h2,.grid h2,.included h2,.notes h2{font-size:13px;margin:0 0 6px}.item-table{display:grid;grid-template-columns:1fr 2fr 1fr 1fr;border:1px solid #111827}.item-table div{padding:9px;border-left:1px solid #e5e7eb}.item-table div:first-child{border-left:0}.item strong{font-size:13px}.item-table div:last-child strong{font-size:16px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.box,.included,.notes{border:1px solid #e5e7eb;padding:9px}.row{display:flex;justify-content:space-between;gap:12px;border-top:1px solid #eef2f7;padding:5px 0}.row:first-of-type{border-top:0}.row strong{text-align:right;font-size:11px}.included{margin-top:12px}.included div{display:flex;flex-wrap:wrap;gap:6px}.included span{padding:5px 7px;border:1px solid #e5e7eb;border-radius:999px;color:#344054;font-size:10px}.notes{margin-top:12px}.notes p{margin:0;font-size:11px;line-height:1.3;white-space:pre-wrap}
@media print{body{background:white}.page{margin:0;width:auto;min-height:auto;padding:0}.no-print{display:none}}
</style>
</head>
<body>
<main class="page">
<section class="head"><div><strong>Tri-State Media</strong><span>Quote ${escapeHtml(quote.quoteNumber)}</span><em>${escapeHtml(quoteDateLabel(quote.createdAt))}</em></div><div><span>Total Quote</span><strong>${escapeHtml(money(quote.pricing.sellPrice))}</strong><em>${escapeHtml(money(quote.pricing.pricePerThousand))} / M</em></div></section>
<section class="meta">
<div><span>Customer</span><strong>${escapeHtml(clipText(quote.customerName || "--", 32))}</strong><em>${escapeHtml(clipText(quote.contactName || quote.contactEmail || "", 36))}</em></div>
<div><span>Job</span><strong>${escapeHtml(clipText(quote.jobName || "--", 32))}</strong><em>${escapeHtml(clipText(quote.jobTicketNumber ? `Job Ticket ${quote.jobTicketNumber}` : quote.productCode || "Manual quote", 36))}</em></div>
<div><span>Prepared By</span><strong>${escapeHtml(clipText(quotePreparedByName(quote), 32))}</strong><em>${escapeHtml(quotePreparedByRole(quote) || quoteDateLabel(quote.createdAt))}</em></div>
<div><span>Quote Date</span><strong>${escapeHtml(quoteDateLabel(quote.createdAt))}</strong><em>${escapeHtml(quote.quoteNumber)}</em></div>
</section>
<section class="item"><h2>Quoted Item</h2><div class="item-table">
<div><span>Quantity</span><strong>${escapeHtml(Number(quote.form.quantity || 0).toLocaleString())}</strong></div>
<div><span>Description</span><strong>${escapeHtml(clipText(quoteDescription(quote), 52))}</strong></div>
<div><span>Price / M</span><strong>${escapeHtml(money(quote.pricing.pricePerThousand))}</strong></div>
<div><span>Total</span><strong>${escapeHtml(money(quote.pricing.sellPrice))}</strong></div>
</div>
</section>
<section class="grid">
<div class="box"><h2>Quote Details</h2>
${detailRows.map(([label, value]) => `<div class="row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
</div>
<div class="box"><h2>Customer Pricing</h2>
${priceRows.map(([label, value]) => `<div class="row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
</div>
</section>
<section class="included"><h2>Included</h2><div>${includedServices.map((service) => `<span>${escapeHtml(service)}</span>`).join("")}</div></section>
${quote.notes ? `<section class="notes"><h2>Notes</h2><p>${escapeHtml(quote.notes)}</p></section>` : ""}
</main>
<script>window.print();</script>
</body>
</html>`;
    const popup = window.open("", "_blank");
    if (!popup) {
      window.alert("Could not open print window. Please allow pop-ups for this page.");
      return;
    }
    popup.document.write(html);
    popup.document.close();
  }

  function downloadQuotePdf(quote) {
    if (!quote) return;
    const details = quoteCustomerDetailRows(quote);
    const prices = quoteCustomerPriceRows(quote);
    const includedServices = quoteIncludedServices(quote);
    const commands = [];

    function text(x, y, size, value, font = "F1") {
      commands.push(`BT /${font} ${size} Tf ${x} ${y} Td (${pdfEscape(value)}) Tj ET`);
    }

    function line(x1, y1, x2, y2) {
      commands.push(`${x1} ${y1} m ${x2} ${y2} l S`);
    }

    function box(x, y, w, h) {
      commands.push(`${x} ${y} ${w} ${h} re S`);
    }

    commands.push("0.08 w");
    text(42, 748, 18, "Tri-State Media", "F2");
    text(42, 731, 9, `Quote ${quote.quoteNumber}`);
    text(42, 718, 9, quoteDateLabel(quote.createdAt));
    text(410, 748, 9, "Total Quote", "F2");
    text(410, 724, 26, money(quote.pricing.sellPrice), "F2");
    text(410, 708, 10, `${money(quote.pricing.pricePerThousand)} / M`);
    line(42, 694, 570, 694);

    const meta = [
      ["Customer", quote.customerName || "--", quote.contactName || quote.contactEmail || ""],
      ["Job", quote.jobName || "--", quote.jobTicketNumber ? `Job Ticket ${quote.jobTicketNumber}` : quote.productCode || "Manual quote"],
      ["Prepared By", quotePreparedByName(quote), quotePreparedByRole(quote) || quoteDateLabel(quote.createdAt)],
      ["Quote Date", quoteDateLabel(quote.createdAt), quote.quoteNumber],
    ];
    meta.forEach(([label, value, sub], index) => {
      const x = 42 + index * 132;
      box(x, 630, 122, 48);
      text(x + 7, 665, 7, label, "F2");
      text(x + 7, 650, 10, clipText(value, 22), "F2");
      text(x + 7, 637, 7, clipText(sub, 25));
    });

    text(42, 606, 12, "Quoted Item", "F2");
    box(42, 558, 528, 38);
    text(52, 581, 7, "Quantity", "F2");
    text(52, 567, 11, Number(quote.form.quantity || 0).toLocaleString(), "F2");
    text(150, 581, 7, "Description", "F2");
    text(150, 567, 11, clipText(quoteDescription(quote), 46), "F2");
    text(420, 581, 7, "Price / M", "F2");
    text(420, 567, 11, money(quote.pricing.pricePerThousand), "F2");
    text(500, 581, 7, "Total", "F2");
    text(500, 567, 11, money(quote.pricing.sellPrice), "F2");

    text(42, 532, 12, "Quote Details", "F2");
    text(314, 532, 12, "Customer Pricing", "F2");
    box(42, 342, 240, 178);
    box(314, 342, 256, 178);

    details.forEach(([label, value], index) => {
      const y = 502 - index * 20;
      text(54, y, 7, label, "F2");
      text(166, y, 8, clipText(value, 28));
      if (index < details.length - 1) line(54, y - 8, 270, y - 8);
    });

    prices.forEach(([label, value], index) => {
      const y = 502 - index * 20;
      text(326, y, 7, label, "F2");
      text(488, y, 8, clipText(value, 20));
      if (index < prices.length - 1) line(326, y - 8, 558, y - 8);
    });

    text(42, 314, 12, "Included", "F2");
    box(42, 286, 528, 18);
    text(54, 292, 8, clipText(includedServices.join(", "), 115));

    if (quote.notes) {
      text(42, 260, 12, "Notes", "F2");
      box(42, 190, 528, 58);
      const note = clipText(quote.notes.replace(/\s+/g, " "), 170);
      const chunks = note.match(/.{1,86}(\s|$)/g) || [note];
      chunks.slice(0, 3).forEach((chunk, index) => text(54, 232 - index * 14, 8, chunk.trim()));
    }

    text(42, 42, 7, "Generated from the Tri-State Media quoting tool.");

    const stream = commands.join("\n");
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => {
      pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

    const blob = new Blob([pdf], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${quote.quoteNumber}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function submitRaw(event) {
    event.preventDefault();
    const name = rawForm.name.trim();
    if (!name) return;
    const next = {
      ...emptyRawForm,
      ...rawForm,
      id: editingRawId || makeId("raw"),
      name,
    };
    setRawMaterials((prev) => {
      if (!editingRawId) return [next, ...prev];
      return prev.map((raw) => raw.id === editingRawId ? next : raw);
    });
    setRawForm(emptyRawForm);
    setEditingRawId(null);
  }

  function submitFinished(event) {
    event.preventDefault();
    const name = finishedForm.name.trim();
    if (!name) return;
    const next = {
      ...emptyFinishedForm,
      ...finishedForm,
      id: editingFinishedId || makeId("finished"),
      name,
    };
    delete next.calculatedMsiCost;
    delete next.componentLabel;

    setFinishedMaterials((prev) => {
      if (!editingFinishedId) return [next, ...prev];
      return prev.map((material) => material.id === editingFinishedId ? next : material);
    });
    setForm((prev) => ({
      ...prev,
      selectedMaterialId: next.id,
      msiCost: String(calculateFinishedMaterialMsiCost(next, rawMaterials)),
      materialWidth: next.width_inches || prev.materialWidth,
    }));
    setFinishedForm(emptyFinishedForm);
    setEditingFinishedId(null);
    setActiveTab("pricing");
  }

  function deleteRaw(id) {
    setRawMaterials((prev) => prev.filter((raw) => raw.id !== id));
    setFinishedMaterials((prev) => prev.map((material) => {
      const next = { ...material };
      finishedComponentSlots.forEach((slot) => {
        if (next[slot.name] === id) next[slot.name] = "";
      });
      return next;
    }));
    if (editingRawId === id) {
      setEditingRawId(null);
      setRawForm(emptyRawForm);
    }
  }

  function deleteFinished(id) {
    setFinishedMaterials((prev) => prev.filter((material) => material.id !== id));
    setForm((prev) => prev.selectedMaterialId === id ? { ...prev, selectedMaterialId: "manual" } : prev);
    if (editingFinishedId === id) {
      setEditingFinishedId(null);
      setFinishedForm(emptyFinishedForm);
    }
  }

  function useFinishedMaterial(material) {
    setForm((prev) => ({
      ...prev,
      selectedMaterialId: material.id,
      msiCost: String(material.calculatedMsiCost),
      materialWidth: material.width_inches || prev.materialWidth,
    }));
    setActiveTab("pricing");
  }

  function editFinishedMaterial(material) {
    const { calculatedMsiCost, componentLabel, ...editable } = material;
    setEditingFinishedId(material.id);
    setFinishedForm({ ...emptyFinishedForm, ...editable });
    setActiveTab("finished");
  }

  function cancelFinishedEdit() {
    setEditingFinishedId(null);
    setFinishedForm(emptyFinishedForm);
  }

  function editRawMaterial(raw) {
    setEditingRawId(raw.id);
    setRawForm({ ...emptyRawForm, ...raw });
    setActiveTab("raw");
  }

  function cancelRawEdit() {
    setEditingRawId(null);
    setRawForm(emptyRawForm);
  }

  return (
    <section className="quote-tool">
      <nav className="quote-tabs" aria-label="Quote calculator sections">
        <TabButton active={activeTab === "pricing"} icon={CircleDollarSign} label="Pricing Tool" onClick={() => setActiveTab("pricing")} />
        <TabButton active={activeTab === "quotes"} icon={FileText} label="Saved Quotes" count={savedQuotes.length} onClick={() => setActiveTab("quotes")} />
        <TabButton active={activeTab === "finished"} icon={Layers3} label="Finished Inventory" count={finishedMaterials.length} onClick={() => setActiveTab("finished")} />
        <TabButton active={activeTab === "raw"} icon={Ruler} label="Raw Inventory" count={rawMaterials.length} onClick={() => setActiveTab("raw")} />
      </nav>

      {activeTab === "pricing" && (
        <>
          <div className="quote-layout">
            <form className="quote-panel quote-input-panel" onSubmit={(event) => event.preventDefault()}>
              <section className="quote-section quote-primary-section">
                <div className="quote-section-head">
                  <FileText size={16} />
                  <strong>Quote Info</strong>
                </div>
                <div className="quote-segmented compact">
                  <button className={quoteInfo.linkMode === "ticket" ? "active" : ""} type="button" onClick={() => updateQuoteInfo("linkMode", "ticket")}>Use Job Ticket</button>
                  <button className={quoteInfo.linkMode === "manual" ? "active" : ""} type="button" onClick={() => updateQuoteInfo("linkMode", "manual")}>Manual Entry</button>
                </div>
                {quoteInfo.linkMode === "ticket" ? (
                  <div className="quote-simple-grid quote-info-grid quote-ticket-grid">
                    <Field label="Job Ticket">
                      <select value={quoteInfo.jobTicketId} onChange={(event) => updateQuoteInfo("jobTicketId", event.target.value)}>
                        <option value="">{jobTicketLoadState === "loading" ? "Loading job tickets..." : "Select job ticket..."}</option>
                        {jobTickets.map((ticket) => <option value={ticket.id} key={ticket.id}>{jobTicketLabel(ticket)}</option>)}
                      </select>
                    </Field>
                    {selectedJobTicket && selectedJobTicketDimensions.message && (
                      <p className="quote-ticket-warning">{selectedJobTicketDimensions.message}</p>
                    )}
                    {jobTicketLoadState === "error" && <p className="quote-help-text">Job tickets could not load. Use manual entry for this quote.</p>}
                  </div>
                ) : (
                  <div className="quote-simple-grid quote-info-grid">
                    <Field label="Customer">
                      <input value={quoteInfo.customerName} onChange={(event) => updateQuoteInfo("customerName", event.target.value)} />
                    </Field>
                    <Field label="Job Name">
                      <input value={quoteInfo.jobName} onChange={(event) => updateQuoteInfo("jobName", event.target.value)} />
                    </Field>
                  </div>
                )}
              </section>

              <section className="quote-section quote-primary-section">
                <div className="quote-section-head">
                  <CircleDollarSign size={16} />
                  <strong>Quote Details</strong>
                </div>
                <div className="quote-top-grid">
                  <Field label="Finished Material">
                    <select value={form.selectedMaterialId} onChange={(event) => updateMaterialSelection(event.target.value)}>
                      <option value="manual">Manual MSI Cost</option>
                      {materialOptions.map((material) => (
                        <option value={material.id} key={material.id}>{material.name} - {unitMoney(material.calculatedMsiCost)}/MSI</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Quantity" suffix="labels">
                    <input type="number" step="1" value={form.quantity} onChange={(event) => updateField("quantity", event.target.value)} />
                  </Field>
                  <Field label={form.pricingMode === "markup" ? "Markup" : "Margin"} suffix="%">
                    <input type="number" step="0.01" value={form.pricingPercent} onChange={(event) => updateField("pricingPercent", event.target.value)} />
                  </Field>
                </div>

                <div className="quote-simple-grid">
                  <Field label="Label Width" suffix="in">
                    <input type="number" step="0.0001" value={form.labelWidth} onChange={(event) => updateField("labelWidth", event.target.value)} />
                  </Field>
                  <Field label="Label Length" suffix="in">
                    <input type="number" step="0.0001" value={form.labelLength} onChange={(event) => updateField("labelLength", event.target.value)} />
                  </Field>
                  <Field label="Gap" suffix="in">
                    <input type="number" step="0.0001" value={form.gap} onChange={(event) => updateField("gap", event.target.value)} />
                  </Field>
                  {manualMaterialWidth && (
                    <Field label="Material Width" suffix="in">
                      <input type="number" step="0.0001" value={form.materialWidth} onChange={(event) => updateField("materialWidth", event.target.value)} />
                    </Field>
                  )}
                  <Field label="MSI Cost" suffix="/ MSI">
                    <input type="number" step="0.0001" value={form.msiCost} readOnly={form.selectedMaterialId !== "manual"} onChange={(event) => updateField("msiCost", event.target.value)} />
                  </Field>
                  <Field label="Waste" suffix="%">
                    <input type="number" step="0.01" value={form.wastePercent} onChange={(event) => updateField("wastePercent", event.target.value)} />
                  </Field>
                </div>

                <div className="quote-chip-row">
                  {materialWidthPresets.map((width) => (
                    <button className={form.materialWidth === width ? "active" : ""} type="button" key={width} onClick={() => updateField("materialWidth", width)}>
                      {width}"
                    </button>
                  ))}
                  <button className={!materialWidthPresets.includes(form.materialWidth) ? "active" : ""} type="button" onClick={() => updateField("materialWidth", "")}>
                    Manual
                  </button>
                </div>

                <div className="quote-auto-repeat">
                  <Ruler size={15} />
                  <span>Repeat is calculated automatically from label length plus gap.</span>
                  <strong>{number(pricing.repeat, '"')}</strong>
                </div>
              </section>

              <details className="quote-advanced-panel">
                <summary>
                  <span>Layout Options</span>
                  <em>Side trim, lanes, margin mode</em>
                </summary>
                <div className="quote-field-grid">
                  <Field label="Side Trim" suffix="in">
                    <input type="number" step="0.0001" value={form.sideTrim} onChange={(event) => updateField("sideTrim", event.target.value)} />
                  </Field>
                  <div className="quote-control-block">
                    <span>Lane Mode</span>
                    <div className="quote-segmented compact">
                      <button className={form.acrossMode === "auto" ? "active" : ""} type="button" onClick={() => updateField("acrossMode", "auto")}>Auto</button>
                      <button className={form.acrossMode === "manual" ? "active" : ""} type="button" onClick={() => updateField("acrossMode", "manual")}>Manual</button>
                    </div>
                  </div>
                  {form.acrossMode === "manual" && (
                    <Field label="Number Across">
                      <input type="number" step="1" min="1" value={form.numberAcross} onChange={(event) => updateField("numberAcross", event.target.value)} />
                    </Field>
                  )}
                  <div className="quote-control-block">
                    <span>Pricing Mode</span>
                    <div className="quote-segmented compact">
                      <button className={form.pricingMode === "margin" ? "active" : ""} type="button" onClick={() => updateField("pricingMode", "margin")}>Margin</button>
                      <button className={form.pricingMode === "markup" ? "active" : ""} type="button" onClick={() => updateField("pricingMode", "markup")}>Markup</button>
                    </div>
                  </div>
                </div>
              </details>

              <details className="quote-advanced-panel">
                <summary>
                  <span>Added Costs</span>
                  <em>Setup, print, finishing, packaging, outside service</em>
                </summary>
                <div className="quote-field-grid compact-costs">
                  {quoteExtraCostFields.map((field) => (
                    <Field label={field.label} suffix="$" key={field.name}>
                      <input type="number" step="0.01" value={form[field.name]} onChange={(event) => updateField(field.name, event.target.value)} />
                    </Field>
                  ))}
                  <label className="quote-field quote-field-wide">
                    <span>Quote Notes</span>
                    <textarea value={quoteInfo.notes} onChange={(event) => updateQuoteInfo("notes", event.target.value)} />
                  </label>
                </div>
              </details>
            </form>

            <aside className="quote-panel quote-result-panel">
              <div className={`quote-fit-state ${fitTone}`}>
                <FitIcon size={18} />
                <div>
                  <strong>{pricing.fits ? "Layout Fits" : "Layout Does Not Fit"}</strong>
                  <span>{pricing.fits ? `${pricing.numberAcross} across on ${number(pricing.materialWidth, '"')} web` : `${pricing.numberAcross || "--"} across exceeds selected width`}</span>
                </div>
              </div>

              <div className="quote-total-card">
                <span>Estimated Quote</span>
                <strong>{money(pricing.sellPrice)}</strong>
                <em>{money(pricing.pricePerThousand)} / M</em>
              </div>

              <div className="quote-metric-grid">
                <Metric label="Material Cost" value={money(pricing.materialCost)} />
                <Metric label="Total Cost" value={money(pricing.totalCost)} />
                <Metric label="Profit" value={money(pricing.profit)} tone="good" />
                <Metric label="Price / Label" value={unitMoney(pricing.pricePerLabel)} />
              </div>

              <div className="quote-breakdown">
                <BreakdownRow label="Auto Repeat" value={number(pricing.repeat, '"')} />
                <BreakdownRow label="Number Across" value={pricing.numberAcross || "--"} />
                <BreakdownRow label="Unused Width" value={pricing.widthDelta >= 0 ? number(pricing.widthDelta, '"') : `Over ${number(Math.abs(pricing.widthDelta), '"')}`} />
                <BreakdownRow label="Base Material MSI" value={number(pricing.baseMaterialMsi)} />
                <BreakdownRow label="Waste MSI" value={number(pricing.wasteMsi)} />
                <BreakdownRow label="MSI With Waste" value={number(pricing.materialMsiWithWaste)} />
                <BreakdownRow label="Extra Costs" value={money(pricing.extraCost)} />
              </div>

              <button className="primary-btn quote-generate-btn" type="button" onClick={generateQuote} disabled={!pricing.fits || pricing.sellPrice <= 0}>
                <FileText size={16} /> Generate Quote
              </button>
            </aside>
          </div>

          <section className="quote-panel quote-candidates">
            <div className="quote-section-head">
              <Ruler size={16} />
              <strong>Lane Options</strong>
            </div>
            {candidates.length ? (
              <div className="quote-candidate-table">
                <div className="quote-candidate-head">
                  <span>Across</span>
                  <span>Layout Width</span>
                  <span>Unused</span>
                  <span>Web Usage</span>
                  <span>Material Cost</span>
                  <span />
                </div>
                {candidates.map((candidate) => (
                  <div className={candidate.numberAcross === pricing.numberAcross ? "active" : ""} key={candidate.numberAcross}>
                    <strong>{candidate.numberAcross}</strong>
                    <span>{number(candidate.totalLayoutWidth, '"')}</span>
                    <span>{number(candidate.widthDelta, '"')}</span>
                    <span>{percentFormatter.format(candidate.widthUsagePercent)}%</span>
                    <span>{money(candidate.materialCost)}</span>
                    <button type="button" onClick={() => useCandidate(candidate.numberAcross)}>Use</button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="quote-empty">No lane option fits the current label and material width.</p>
            )}
          </section>
        </>
      )}

      {activeTab === "quotes" && (
        <section className="quote-record-page">
          <div className="quote-record-list quote-panel">
            <div className="quote-section-head">
              <FileText size={16} />
              <strong>Saved Quotes</strong>
            </div>
            <label className="quote-record-search">
              <Search size={15} />
              <input value={quoteSearch} onChange={(event) => setQuoteSearch(event.target.value)} placeholder="Search quote, customer, job, material, or person..." />
              <span>{filteredSavedQuotes.length}</span>
            </label>
            <div className="quote-record-rows">
              {groupedSavedQuotes.length ? groupedSavedQuotes.map((group) => (
                <section className="quote-record-group" key={group.key}>
                  <header>
                    <strong>{group.name}</strong>
                    <em>{group.role ? `${group.role} / ${group.quotes.length}` : `${group.quotes.length} quote${group.quotes.length === 1 ? "" : "s"}`}</em>
                  </header>
                  {group.quotes.map((quote) => (
                    <button className={selectedQuote?.id === quote.id ? "active" : ""} type="button" key={quote.id} onClick={() => setSelectedQuoteId(quote.id)}>
                      <strong>{quote.quoteNumber}</strong>
                      <span>{quote.customerName || "No customer"} / {quote.jobName || "No job"}</span>
                      <em>{quoteDateLabel(quote.createdAt)} / {money(quote.pricing.sellPrice)}</em>
                    </button>
                  ))}
                </section>
              )) : (
                <p className="quote-empty">{savedQuotes.length ? "No quotes match that search." : "No saved quotes yet. Generate one from the Pricing Tool tab."}</p>
              )}
            </div>
          </div>

          <div className="quote-record-view quote-panel">
            <div className="quote-record-actions">
              <div className="quote-section-head">
                <FileText size={16} />
                <strong>{selectedQuote ? selectedQuote.quoteNumber : "Quote Preview"}</strong>
              </div>
              <div>
                <div className="quote-segmented compact quote-view-switch">
                  <button className={savedQuoteView === "customer" ? "active" : ""} type="button" onClick={() => setSavedQuoteView("customer")}>Customer View</button>
                  <button className={savedQuoteView === "internal" ? "active" : ""} type="button" onClick={() => setSavedQuoteView("internal")}>Internal Data</button>
                </div>
                <button className="ghost-btn" type="button" onClick={() => printQuote(selectedQuote)} disabled={!selectedQuote}><Printer size={15} /> Print / PDF</button>
                <button className="ghost-btn" type="button" onClick={() => downloadQuotePdf(selectedQuote)} disabled={!selectedQuote}><Download size={15} /> Download PDF</button>
                <button className="danger-btn" type="button" onClick={() => selectedQuote && deleteQuote(selectedQuote.id)} disabled={!selectedQuote}><Trash2 size={15} /> Delete</button>
              </div>
            </div>
            {savedQuoteView === "internal" ? <InternalQuoteBreakdown quote={selectedQuote} /> : <QuoteDocument quote={selectedQuote} />}
          </div>
        </section>
      )}

      {activeTab === "finished" && (
        <section className="quote-inventory-page">
          <div className="quote-inventory-head">
            <div>
              <h3>Finished Inventory</h3>
              <p>Finished materials can be purchased stock or made from raw components.</p>
            </div>
            <Metric label="Materials" value={finishedMaterials.length} />
          </div>

          <div className="quote-material-library">
            <div className="quote-library-panel quote-panel">
              <div className="quote-section-head">
                <Plus size={16} />
                <strong>{editingFinishedId ? "Edit Finished Material" : "Add Finished Material"}</strong>
              </div>
              <FinishedMaterialForm
                form={finishedForm}
                rawMaterials={rawMaterials}
                update={(name, value) => setFinishedForm((prev) => ({ ...prev, [name]: value }))}
                submit={submitFinished}
                editing={Boolean(editingFinishedId)}
                onCancel={cancelFinishedEdit}
              />
            </div>

            <div className="quote-library-panel quote-panel quote-finished-list">
              <div className="quote-section-head">
                <Layers3 size={16} />
                <strong>Finished List</strong>
              </div>
              <div className="quote-library-list">
                {materialOptions.length ? materialOptions.map((material) => (
                  <article className={`quote-library-row ${form.selectedMaterialId === material.id ? "active" : ""}`} key={material.id}>
                    <div>
                      <strong>{material.name}</strong>
                      <span>{material.sourceType === "purchased" ? "Purchased" : "Made in-house"} / {material.componentLabel}</span>
                    </div>
                    <em>{unitMoney(material.calculatedMsiCost)}/MSI</em>
                    <span>{material.width_inches ? `${material.width_inches}"` : "--"}</span>
                    <button className="ghost-btn xs" type="button" onClick={() => useFinishedMaterial(material)}>Use</button>
                    <button className="ghost-btn xs" type="button" onClick={() => editFinishedMaterial(material)}><Pencil size={13} /></button>
                    <button className="ghost-btn xs" type="button" onClick={() => deleteFinished(material.id)}><Trash2 size={13} /></button>
                  </article>
                )) : (
                  <p className="quote-empty">No finished materials yet.</p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === "raw" && (
        <section className="quote-inventory-page">
          <div className="quote-inventory-head">
            <div>
              <h3>Raw Inventory</h3>
              <p>Raw components feed the finished material MSI cost.</p>
            </div>
            <Metric label="Raw Items" value={rawMaterials.length} />
          </div>

          <div className="quote-material-library">
            <div className="quote-library-panel quote-panel">
              <div className="quote-section-head">
                <Plus size={16} />
                <strong>{editingRawId ? "Edit Raw Material" : "Add Raw Material"}</strong>
              </div>
              <RawMaterialForm
                form={rawForm}
                update={(name, value) => setRawForm((prev) => ({ ...prev, [name]: value }))}
                submit={submitRaw}
                editing={Boolean(editingRawId)}
                onCancel={cancelRawEdit}
              />
            </div>

            <div className="quote-library-panel quote-panel">
              <div className="quote-section-head">
                <Layers3 size={16} />
                <strong>Raw List</strong>
              </div>
              <div className="quote-library-list">
                {rawMaterials.length ? rawMaterials.map((raw) => (
                  <article className="quote-library-row" key={raw.id}>
                    <div>
                      <strong>{raw.name}</strong>
                      <span>{rawComponentTypes.find(([value]) => value === raw.componentType)?.[1] || raw.componentType} / {unitMoney(Number(raw.msiCost || 0))}/MSI</span>
                    </div>
                    <em>{raw.inventoryMsi ? `${number(Number(raw.inventoryMsi), " MSI")}` : "No on hand"}</em>
                    <button className="ghost-btn xs" type="button" onClick={() => editRawMaterial(raw)}><Pencil size={13} /></button>
                    <button className="ghost-btn xs" type="button" onClick={() => deleteRaw(raw.id)}><Trash2 size={13} /></button>
                  </article>
                )) : (
                  <p className="quote-empty">No raw materials yet.</p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
    </section>
  );
}
