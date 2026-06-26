import { AlertTriangle, CheckCircle2, CircleDollarSign, Copy, Download, FileText, Image as ImageIcon, Layers3, Mail, MoreHorizontal, Pencil, Plus, Printer, Ruler, Search, SlidersHorizontal, Trash2, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRecord, deleteRecord, fetchCollection, requestApi, updateRecord } from "../api";
import { PdfPreview, isPdfUrl } from "./FilePreview";
import { quoteCompanyForKey, quoteCompanyForQuote } from "../lib/quoteBranding";
import {
  buildLayoutCandidates,
  calculateBestMaterialWidth,
  calculateFinishedMaterialMsiCost,
  calculateQuotePricing,
  componentLabelForFinishedMaterial,
  finishedComponentSlots,
  finishedMaterialAdderFields,
  quoteExtraCostFields,
  quoteRateDefaults,
  rateCost,
  rawComponentTypes,
  toQuoteNumber,
} from "../lib/quotePricing";

const materialWidthPresets = ["8.75", "9", "12.75", "13.875", "16.875", "18.5", "21.75"];
const materialLibraryStorageKey = "tsm_quote_material_library_v1";
const savedQuotesStorageKey = "tsm_quote_records_v1";
const quotePreferencesStorageKey = "tsm_quote_preferences_v1";

const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const unitCurrencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 });
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const percentFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const quoteDefaultExpirationDays = 30;
const quoteDefaultUnitOfMeasure = "M";
const quoteThankYouMessage = "Thank you for the opportunity to serve...";
const quoteUnitTypeChoices = [
  ["label", "Label"],
  ["tag", "Tag"],
];
const quoteFinishingTypeChoices = [
  ["rolls", "Rolls"],
  ["fanfold", "Fanfold"],
  ["sheeted", "Sheeted"],
];
const quoteCoreSizeChoices = ["", "0.75", "1", "1.5", "3", "4", "5"];
const quoteCoreMarkupSurchargePercent = 15;
const quoteApprovalStates = [
  ["pending", "Needs Approval"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
];
const quoteApprovalSortOrder = { pending: 0, rejected: 1, approved: 2 };
const quoteWorkflowStates = [
  ["active", "Active"],
  ["processed", "Processed"],
];
const quoteWorkflowSortOrder = { active: 0, processed: 1 };
const wasteRecommendationFieldNames = new Set([
  "quantity",
  "labelWidth",
  "labelLength",
  "gap",
  "materialWidth",
  "sideTrim",
  "acrossMode",
  "numberAcross",
  "colorCount",
]);

const initialForm = {
  selectedMaterialId: "manual",
  unitType: "label",
  itemNote: "",
  labelWidth: "4",
  labelLength: "2",
  repeat: "2.125",
  quantity: "10000",
  materialWidth: "8.75",
  gap: "0.125",
  sideTrim: "0.325",
  finishingType: "rolls",
  coreSize: "",
  labelsPerUnit: "",
  labelsPerCarton: "",
  acrossMode: "auto",
  numberAcross: "",
  wastePercent: "7",
  msiCost: "0.443",
  colorCount: "0",
  coatingCount: "0",
  colorMsiCost: "0.03",
  coatingMsiCost: "0",
  setupCost: "0",
  printCost: "0",
  finishingCost: "0",
  packagingCost: "0",
  outsideCost: "0",
  pricingMode: "markup",
  pricingPercent: "0",
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
  unitType: "label",
  materialMasterTypeId: "",
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
  baseMarkupPercent: "",
  targetMarkupPercent: "",
  notes: "",
};

const emptyQuoteInfo = {
  linkMode: "manual",
  jobTicketId: "",
  customerCleared: false,
  customerId: "",
  customerCode: "",
  customerName: "",
  itemName: "",
  jobName: "",
  productCode: "",
  contactName: "",
  contactEmail: "",
  clientPo: "",
  customerAddress: "",
  quoteExpirationDate: "",
  unitOfMeasure: quoteDefaultUnitOfMeasure,
  preparedBy: "",
  notes: "",
};

const emptyCustomerDraft = {
  name: "",
  customer_code: "",
  contact_name: "",
  phone: "",
  email: "",
  address_line_1: "",
  address_line_2: "",
  address_line_3: "",
  city: "",
  state: "",
  postal_code: "",
  country: "",
  quotation_address: "",
  is_active: true,
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

function choiceLabel(choices, value, fallback = "") {
  return choices.find(([choiceValue]) => choiceValue === value)?.[1] || fallback || value || "";
}

function quoteUnitType(value = "label") {
  return value === "tag" ? "tag" : "label";
}

function quoteUnitLabel(value, plural = false) {
  const unit = quoteUnitType(value);
  if (unit === "tag") return plural ? "tags" : "tag";
  return plural ? "labels" : "label";
}

function quoteUnitTitle(value, plural = false) {
  const label = quoteUnitLabel(value, plural);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function quoteFinishingLabel(value = "rolls") {
  return choiceLabel(quoteFinishingTypeChoices, value, "Rolls");
}

function quoteFinishingContainer(value = "rolls") {
  if (value === "fanfold") return "stack";
  if (value === "sheeted") return "sheet";
  return "roll";
}

function quoteCoreLabel(value) {
  const size = toQuoteNumber(value, NaN);
  if (!Number.isFinite(size) || size <= 0) return "";
  return `${String(Number(size.toFixed(3)))}" core`;
}

function materialMasterTypeOptionLabel(type) {
  if (!type) return "";
  return [type.code, type.name].filter(Boolean).join(" - ") || `Material Type ${type.id}`;
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

function quotePreferenceKey(user) {
  return user?.id || user?.username || user?.name || "default";
}

function loadQuotePreference(user) {
  if (typeof window === "undefined") return {};
  try {
    const payload = JSON.parse(window.localStorage.getItem(quotePreferencesStorageKey) || "{}");
    return payload[quotePreferenceKey(user)] || {};
  } catch {
    return {};
  }
}

function saveQuotePreference(user, patch) {
  if (typeof window === "undefined") return;
  try {
    const payload = JSON.parse(window.localStorage.getItem(quotePreferencesStorageKey) || "{}");
    const key = quotePreferenceKey(user);
    payload[key] = { ...(payload[key] || {}), ...patch };
    window.localStorage.setItem(quotePreferencesStorageKey, JSON.stringify(payload));
  } catch {
    // Preferences are helpful, not required.
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

function quoteDateObject(value) {
  if (!value) return new Date(NaN);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

function quoteDateLabel(value) {
  if (!value) return "--";
  const date = quoteDateObject(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function quoteLongDateLabel(value) {
  if (!value) return "--";
  const date = quoteDateObject(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function quoteDocumentDateLabel(value) {
  return quoteDateLabel(value);
}

function quoteDateInputValue(value) {
  if (!value) return "";
  const date = quoteDateObject(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function quoteFutureDateInput(value, days = quoteDefaultExpirationDays) {
  const date = value ? quoteDateObject(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return quoteDateInputValue(date);
}

function jobTicketLabel(ticket) {
  if (!ticket) return "";
  return jobTicketPartNumber(ticket);
}

function jobTicketPartNumber(ticket) {
  if (!ticket) return "";
  return ticket.job_name || ticket.product_name || ticket.product_code || ticket.ticket_number || "Untitled job";
}

function jobTicketCustomer(ticket) {
  return ticket?.customer_display || ticket?.customer_name || "No customer";
}

function jobTicketMetaLine(ticket) {
  const parts = [
    ticket?.product_code ? `TSM ${ticket.product_code}` : "",
    ticket?.ticket_number ? `Ticket ${ticket.ticket_number}` : "",
  ].filter(Boolean);
  return parts.join(" / ");
}

function jobTicketSizeLine(ticket) {
  const width = dimensionInputValue(ticket?.label_width_inches);
  const length = dimensionInputValue(ticket?.label_length_inches);
  const quantity = quantityInputValue(ticket?.units_per_carton || ticket?.labels_per_carton);
  return [
    width && length ? `${width}" x ${length}"` : "",
    quantity ? `${Number(quantity).toLocaleString()} / carton` : "",
  ].filter(Boolean).join(" / ");
}

function jobTicketSearchText(ticket) {
  return [
    jobTicketPartNumber(ticket),
    jobTicketCustomer(ticket),
    ticket?.ticket_number,
    ticket?.product_code,
    ticket?.description,
    ticket?.material_master_type_code,
    ticket?.material_spec_master_type_code,
    ticket?.recipe_name,
  ].filter(Boolean).join(" ").toLowerCase();
}

function customerAddressLines(customer) {
  if (!customer) return [];
  return [
    customer.address_line_1,
    customer.address_line_2,
    customer.address_line_3,
    [customer.city, customer.state, customer.postal_code].filter(Boolean).join(", ").replace(", ,", ","),
    customer.country,
  ].map((line) => String(line || "").trim()).filter(Boolean);
}

function customerQuoteAddress(customer) {
  return customerAddressLines(customer).join("\n");
}

function customerSearchText(customer) {
  return [
    customer.name,
    customer.customer_code,
    customer.contact_name,
    customer.phone,
    customer.email,
    customer.address_line_1,
    customer.city,
    customer.state,
    customer.postal_code,
  ].filter(Boolean).join(" ").toLowerCase();
}

function customerPickerLabel(customer) {
  if (!customer) return "No customer";
  return [customer.customer_code, customer.name].filter(Boolean).join(" / ") || customer.name || `Customer ${customer.id}`;
}

function mergeJobTicketRows(existing = [], next = []) {
  const byId = new Map(existing.map((row) => [String(row.id), row]));
  next.forEach((row) => byId.set(String(row.id), { ...(byId.get(String(row.id)) ?? {}), ...row }));
  return Array.from(byId.values());
}

function jobTicketRecipeId(ticket) {
  return ticket?.recipe ?? ticket?.recipe_id ?? "";
}

function jobTicketPrimaryImage(ticket) {
  const images = Array.isArray(ticket?.job_images) ? ticket.job_images : [];
  return (
    images.find((image) => image.slot === "general" && image.url) ||
    images.find((image) => image.url) ||
    null
  );
}

function JobTicketThumb({ ticket }) {
  const image = jobTicketPrimaryImage(ticket);
  const isDocument = image?.isDocument || isPdfUrl(image?.url);
  return (
    <span className="quote-ticket-thumb">
      {image?.url && !isDocument ? (
        <img src={image.url} alt={jobTicketPartNumber(ticket)} />
      ) : image?.url ? (
        <PdfPreview url={image.url} title={jobTicketPartNumber(ticket)} compact />
      ) : (
        <ImageIcon size={18} />
      )}
    </span>
  );
}

function dimensionInputValue(value) {
  const numberValue = toQuoteNumber(value, NaN);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return "";
  return String(Number(numberValue.toFixed(4))).replace(/\.0+$/, "");
}

function quantityInputValue(value) {
  const numberValue = toQuoteNumber(value, NaN);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return "";
  return String(Math.round(numberValue));
}

function moneyInput(value) {
  return value === "" || value === null || value === undefined ? "0" : String(value);
}

function percentInputValue(value) {
  const numberValue = toQuoteNumber(value, NaN);
  if (!Number.isFinite(numberValue)) return "";
  return String(Number(numberValue.toFixed(2))).replace(/\.0+$/, "");
}

function quoteApprovalStatus(quote) {
  const status = String(quote?.approvalStatus || quote?.approval_status || "pending").toLowerCase();
  return quoteApprovalStates.some(([value]) => value === status) ? status : "pending";
}

function quoteWorkflowStatus(quote) {
  const status = String(quote?.quoteWorkflowStatus || quote?.workflowStatus || quote?.workflow_status || "active").toLowerCase();
  return quoteWorkflowStates.some(([value]) => value === status) ? status : "active";
}

function quoteApprovalLabel(quoteOrStatus) {
  const status = typeof quoteOrStatus === "string" ? quoteOrStatus : quoteApprovalStatus(quoteOrStatus);
  return quoteApprovalStates.find(([value]) => value === status)?.[1] || "Needs Approval";
}

function quoteWorkflowLabel(quoteOrStatus) {
  const status = typeof quoteOrStatus === "string" ? quoteOrStatus : quoteWorkflowStatus(quoteOrStatus);
  return quoteWorkflowStates.find(([value]) => value === status)?.[1] || "Active";
}

function quoteApprovalSummary(quote) {
  const status = quoteApprovalStatus(quote);
  const reviewer = quote?.approvalByName || quote?.approval_by_name || "";
  const reviewedAt = quote?.approvalAt || quote?.approval_at || "";
  const parts = [quoteApprovalLabel(status)];
  if (reviewer) parts.push(`by ${reviewer}`);
  if (reviewedAt) parts.push(quoteDateLabel(reviewedAt));
  return parts.join(" / ");
}

function quoteLastEditedSummary(quote) {
  const editedAt = quote?.lastEditedAt || quote?.last_edited_at || "";
  if (!editedAt) return "";
  const editor = quote?.lastEditedByName || quote?.last_edited_by_name || "Unknown user";
  const count = Number(quote?.editCount || quote?.edit_count || 0);
  return `Edited by ${editor} on ${quoteDateLabel(editedAt)}${count > 1 ? ` / revision ${count}` : ""}`;
}

function quoteProcessedSummary(quote) {
  const processedAt = quote?.processedAt || quote?.processed_at || "";
  if (!processedAt) return "";
  const processor = quote?.processedByName || quote?.processed_by_name || "Unknown user";
  return `Processed by ${processor} on ${quoteDateLabel(processedAt)}`;
}

function sortQuotesForApproval(quotes = []) {
  return [...quotes].sort((a, b) => {
    const workflowDelta = (quoteWorkflowSortOrder[quoteWorkflowStatus(a)] ?? 9) - (quoteWorkflowSortOrder[quoteWorkflowStatus(b)] ?? 9);
    if (workflowDelta) return workflowDelta;
    const statusDelta = (quoteApprovalSortOrder[quoteApprovalStatus(a)] ?? 9) - (quoteApprovalSortOrder[quoteApprovalStatus(b)] ?? 9);
    if (statusDelta) return statusDelta;
    const bTime = quoteDateObject(b.createdAt).getTime();
    const aTime = quoteDateObject(a.createdAt).getTime();
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });
}

function rawMaterialPayload(raw) {
  return {
    id: raw.id || makeId("raw"),
    name: raw.name || "",
    componentType: raw.componentType || "face",
    msiCost: moneyInput(raw.msiCost),
    inventoryMsi: moneyInput(raw.inventoryMsi),
    notes: raw.notes || "",
  };
}

function quoteCostRatePayload(rate) {
  return {
    key: rate.key,
    label: rate.label || rate.key,
    msiCost: moneyInput(rate.msiCost),
    notes: rate.notes || "",
    locked: Boolean(rate.locked),
  };
}

function finishedMaterialPayload(material) {
  return {
    id: material.id || makeId("finished"),
    name: material.name || "",
    unitType: material.unitType || "label",
    materialMasterTypeId: material.materialMasterTypeId || null,
    sourceType: material.sourceType || "made",
    purchasedMsiCost: moneyInput(material.purchasedMsiCost),
    faceRawId: material.faceRawId || "",
    linerRawId: material.linerRawId || "",
    adhesiveRawId: material.adhesiveRawId || "",
    siliconeRawId: material.siliconeRawId || "",
    inkRawId: material.inkRawId || "",
    laborMsiCost: moneyInput(material.laborMsiCost),
    coatingMsiCost: moneyInput(material.coatingMsiCost),
    complexityMsiCost: moneyInput(material.complexityMsiCost),
    otherMsiCost: moneyInput(material.otherMsiCost),
    baseMarkupPercent: moneyInput(material.baseMarkupPercent),
    targetMarkupPercent: moneyInput(material.targetMarkupPercent ?? material.targetMarginPercent),
    notes: material.notes || "",
  };
}

function quoteRecordPayload(quote) {
  return {
    ...quote,
    customerId: quote.customerId || null,
    jobTicketId: quote.jobTicketId || null,
    contactEmail: quote.contactEmail || "",
    approvalStatus: quoteApprovalStatus(quote),
    approvalAt: quote.approvalAt || quote.approval_at || null,
    approvalByUserId: quote.approvalByUserId || quote.approval_by_user_id || "",
    approvalByName: quote.approvalByName || quote.approval_by_name || "",
    approvalByRole: quote.approvalByRole || quote.approval_by_role || "",
    approvalNote: quote.approvalNote || quote.approval_note || "",
    quoteWorkflowStatus: quoteWorkflowStatus(quote),
    processedAt: quote.processedAt || quote.processed_at || null,
    processedByUserId: quote.processedByUserId || quote.processed_by_user_id || "",
    processedByName: quote.processedByName || quote.processed_by_name || "",
    processedByRole: quote.processedByRole || quote.processed_by_role || "",
    lastEditedAt: quote.lastEditedAt || quote.last_edited_at || null,
    lastEditedByUserId: quote.lastEditedByUserId || quote.last_edited_by_user_id || "",
    lastEditedByName: quote.lastEditedByName || quote.last_edited_by_name || "",
    lastEditedByRole: quote.lastEditedByRole || quote.last_edited_by_role || "",
    editCount: Number(quote.editCount || quote.edit_count || 0),
  };
}

function jobTicketQuoteQuantity(ticket) {
  if (!ticket) return { quantity: "", complete: false, message: "" };
  const unitsPerCarton = toQuoteNumber(ticket.units_per_carton, NaN);
  const labelsPerCarton = toQuoteNumber(ticket.labels_per_carton, NaN);
  const hasUnitsPerCarton = Number.isFinite(unitsPerCarton) && unitsPerCarton > 0;
  const hasLabelsPerCarton = Number.isFinite(labelsPerCarton) && labelsPerCarton > 0;

  if (hasUnitsPerCarton) {
    return {
      quantity: quantityInputValue(unitsPerCarton),
      complete: true,
      message: "",
    };
  }

  if (hasLabelsPerCarton) {
    return {
      quantity: quantityInputValue(labelsPerCarton),
      complete: true,
      message: "",
    };
  }

  return {
    quantity: "",
    complete: false,
    message: "This job ticket does not contain units per carton. Enter the quote quantity below.",
  };
}

function jobTicketMasterTypeId(ticket) {
  return ticket?.material_master_type || ticket?.material_spec_master_type || "";
}

function jobTicketMasterTypeLabel(ticket) {
  return [
    ticket?.material_master_type_code || ticket?.material_spec_master_type_code,
    ticket?.material_master_type_name || ticket?.material_spec_master_type_name,
  ].filter(Boolean).join(" / ");
}

function materialMatchesJobTicket(material, ticket) {
  if (!material || !ticket) return false;
  const masterTypeId = jobTicketMasterTypeId(ticket);
  if (masterTypeId && String(material.materialMasterTypeId || "") === String(masterTypeId)) return true;

  const candidates = [
    ticket.material_master_type_code,
    ticket.material_spec_master_type_code,
    ticket.material_master_type_name,
    ticket.material_spec_master_type_name,
    ticket.material_spec_family,
    ticket.material_spec_name,
  ].filter(Boolean).map((value) => String(value).trim().toLowerCase());
  const materialText = [
    material.name,
    material.materialMasterTypeCode,
    material.materialMasterTypeName,
  ].filter(Boolean).join(" ").toLowerCase();

  return candidates.some((value) => value && (materialText === value || materialText.includes(value)));
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
  const form = quote?.form || {};
  return quote?.jobName || `${form.labelWidth || 0}" x ${form.labelLength || 0}" ${quoteUnitLabel(form.unitType)}`;
}

function quoteItemUnitType(item, quote = {}) {
  return quoteUnitType(item?.form?.unitType || quote?.form?.unitType || "label");
}

function quoteItemUnitLabel(item, quote = {}, plural = false) {
  return quoteUnitLabel(quoteItemUnitType(item, quote), plural);
}

function quoteItemUnitTitle(item, quote = {}, plural = false) {
  return quoteUnitTitle(quoteItemUnitType(item, quote), plural);
}

function quoteItemContainerLabel(form = {}, plural = false) {
  const container = quoteFinishingContainer(form.finishingType);
  if (!plural) return container;
  return container === "stack" ? "stacks" : `${container}s`;
}

function quoteLineMaterialDescription(item, quote) {
  const materialName = item?.materialName && item.materialName !== "Manual MSI Cost"
    ? item.materialName
    : quotePublicMaterialName(quote);
  return materialName === "As specified" ? "" : materialName;
}

function quoteLinePrimaryDescription(item, quote) {
  const form = item?.form || quote?.form || {};
  const unitType = quoteItemUnitType(item, quote);
  const size = form.labelWidth && form.labelLength ? `${form.labelWidth} x ${form.labelLength}` : "";
  const materialDescription = quoteLineMaterialDescription(item, quote);
  const materialHasUnit = new RegExp(`\\b${quoteUnitLabel(unitType)}s?\\b`, "i").test(materialDescription);
  const productDescription = [
    materialDescription,
    materialHasUnit ? "" : quoteItemUnitTitle(item, quote),
  ].filter(Boolean).join(" ");
  const finishing = form.finishingType ? quoteFinishingLabel(form.finishingType).replace(/s$/, "") : "";
  return [
    [size, productDescription].filter(Boolean).join(" "),
    finishing,
  ].filter(Boolean).join(", ") || quoteDescription(quote);
}

function quoteLinePackagingRow(item, quote) {
  const form = item?.form || quote?.form || {};
  const unitType = quoteItemUnitType(item, quote);
  const rows = [];
  const coreLabel = quoteCoreLabel(form.coreSize);
  if (coreLabel) rows.push(coreLabel);
  const labelsPerUnit = toQuoteNumber(form.labelsPerUnit, NaN);
  if (Number.isFinite(labelsPerUnit) && labelsPerUnit > 0) {
    rows.push(`${Math.round(labelsPerUnit).toLocaleString()} ${quoteUnitLabel(unitType, true)}/${quoteItemContainerLabel(form)}`);
  }
  const labelsPerCarton = toQuoteNumber(form.labelsPerCarton, NaN);
  if (Number.isFinite(labelsPerCarton) && labelsPerCarton > 0) {
    rows.push(`${Math.round(labelsPerCarton).toLocaleString()} ${quoteUnitLabel(unitType, true)}/carton`);
  }
  return rows.join(", ");
}

function quoteCompactUnitMoney(value) {
  const safe = Number.isFinite(value) ? value : 0;
  if (safe >= 1) return money(safe);
  const fixed = safe.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `$${fixed || "0"}`;
}

function quoteLinePriceSummary(item, quote) {
  const unitType = quoteItemUnitType(item, quote);
  const pricePerItem = Number(item?.pricing?.pricePerLabel || 0);
  const pricePerThousand = Number(item?.pricing?.pricePerThousand || 0);
  const labelsPerCarton = toQuoteNumber(item?.form?.labelsPerCarton, NaN);
  const parts = [
    `${quoteCompactUnitMoney(pricePerItem)}/${quoteUnitLabel(unitType)}`,
    `${money(pricePerThousand)}/thousand`,
  ];
  if (Number.isFinite(labelsPerCarton) && labelsPerCarton > 0) {
    parts.push(`${money(pricePerItem * labelsPerCarton)}/carton`);
  }
  return parts.join(" or ");
}

function quoteItems(quote) {
  const items = quote?.pricing?.items || quote?.form?.items;
  if (Array.isArray(items) && items.length) return items;
  if (!quote) return [];
  return [{
    id: quote.id || "quote-item",
    itemName: quote.jobName || "Quoted Item",
    materialName: quote.materialName || "Manual MSI Cost",
    materialSource: quote.materialSource || "manual",
    materialComponents: quote.materialComponents || "",
    form: quote.form || {},
    pricing: quote.pricing || {},
  }];
}

function quoteTotals(quote) {
  const items = quoteItems(quote);
  if (items.length <= 1 && quote?.pricing && Number.isFinite(Number(quote.pricing.sellPrice))) return quote.pricing;
  const quantity = items.reduce((sum, item) => sum + Number(item.form?.quantity || item.pricing?.quantity || 0), 0);
  const sellPrice = items.reduce((sum, item) => sum + Number(item.pricing?.sellPrice || 0), 0);
  const totalCost = items.reduce((sum, item) => sum + Number(item.pricing?.totalCost || 0), 0);
  const productionCost = items.reduce((sum, item) => sum + Number(item.pricing?.productionCost || 0), 0);
  const extraCost = items.reduce((sum, item) => sum + Number(item.pricing?.extraCost || 0), 0);
  const markedUpProductionSellPrice = items.reduce((sum, item) => sum + Number(item.pricing?.markedUpProductionSellPrice || 0), 0);
  const materialCost = items.reduce((sum, item) => sum + Number(item.pricing?.materialCost || 0), 0);
  const materialMsiWithWaste = items.reduce((sum, item) => sum + Number(item.pricing?.materialMsiWithWaste || 0), 0);
  const runFootage = items.reduce((sum, item) => sum + Number(item.pricing?.runFootage || 0), 0);
  const profit = sellPrice - totalCost;
  return {
    quantity,
    sellPrice,
    totalCost,
    productionCost,
    extraCost,
    markedUpProductionSellPrice,
    materialCost,
    materialMsiWithWaste,
    runFootage,
    profit,
    pricePerThousand: quantity > 0 ? sellPrice / (quantity / 1000) : 0,
    pricePerLabel: quantity > 0 ? sellPrice / quantity : 0,
  };
}

function quoteCoreMarkupSurchargeForQuote(quote) {
  const surcharges = quoteItems(quote).map((item) => Number(item.pricing?.coreMarkupSurchargePercent || 0));
  surcharges.push(Number(quote?.pricing?.coreMarkupSurchargePercent || 0));
  return Math.max(0, ...surcharges.filter(Number.isFinite));
}

function quoteItemDescription(item, quote) {
  const form = item.form || {};
  return item.itemName || quote.jobName || `${form.labelWidth || 0}" x ${form.labelLength || 0}" ${quoteItemUnitLabel(item, quote)}`;
}

function quoteSalesInfo(quote) {
  const salesQuote = quote?.form?.salesQuote || {};
  return {
    quoteCompany: quoteCompanyForKey(quote?.quoteCompany || salesQuote.quoteCompany).key,
    customerId: quote.customerId || salesQuote.customerId || "",
    customerCode: quote.customerCode || salesQuote.customerCode || "",
    clientPo: salesQuote.clientPo || "",
    customerAddress: salesQuote.customerAddress || "",
    quoteExpirationDate: salesQuote.quoteExpirationDate || quoteFutureDateInput(quote?.createdAt),
    unitOfMeasure: salesQuote.unitOfMeasure || quoteDefaultUnitOfMeasure,
  };
}

function quoteForLines(quote) {
  const salesInfo = quoteSalesInfo(quote);
  return [
    quote.customerName || "",
    quote.contactName || "",
    ...String(salesInfo.customerAddress || "").split(/\r?\n/),
  ].map((line) => line.trim()).filter(Boolean);
}

function quoteCustomerIdLabel(salesInfo) {
  return String(salesInfo?.customerCode || salesInfo?.customerId || "").trim();
}

function quoteDocumentDateRows(quote) {
  const salesInfo = quoteSalesInfo(quote);
  const rows = [["Date", quoteDocumentDateLabel(quote.createdAt)]];
  const customerId = quoteCustomerIdLabel(salesInfo);
  if (customerId) rows.push(["Customer ID", customerId]);
  if (salesInfo.quoteExpirationDate) rows.push(["Expiration", quoteDocumentDateLabel(salesInfo.quoteExpirationDate)]);
  return rows;
}

function compactQuoteTerms() {
  return [
    "Prices exclude shipping, handling, freight, and tax unless noted.",
    "FOB Origin. Claims for mis-shipments must be made within 5 days.",
    "Quote is valid for the quantity shown and the expiration date above.",
  ];
}

function quoteLinePartNumber(item, quote) {
  return item.itemName || quote.jobName || quote.jobTicketNumber || quote.quoteNumber;
}

function quoteLineDescriptionRows(item, quote) {
  const form = item.form || {};
  return [
    quoteLinePrimaryDescription(item, quote),
    quote.productCode ? `TSM ID ${quote.productCode}` : "",
    form.itemNote,
    quoteLinePackagingRow(item, quote),
    quoteLinePriceSummary(item, quote),
  ].filter(Boolean);
}

function quoteTableQuantity(item, unitOfMeasure = quoteDefaultUnitOfMeasure) {
  const quantity = Number(item.form?.quantity || item.pricing?.quantity || 0);
  if (unitOfMeasure === "M") return Number.isFinite(quantity) ? (quantity / 1000).toFixed(3) : "0.000";
  return Number.isFinite(quantity) ? Math.round(quantity).toLocaleString() : "0";
}

function quoteTableUnitPrice(item, unitOfMeasure = quoteDefaultUnitOfMeasure) {
  if (unitOfMeasure === "M") return money(Number(item.pricing?.pricePerThousand || 0));
  return unitMoney(Number(item.pricing?.pricePerLabel || 0));
}

function quoteTableUomLabel(unitOfMeasure = quoteDefaultUnitOfMeasure) {
  return unitOfMeasure === "EA" ? "EA" : "M";
}

function quoteTerms(quote) {
  const customer = quote.customerName || "this customer";
  return [
    "Price does not include shipping & handling, freight, or tax unless specified. Price is valid only for the quantity shown.",
    "FOB Terms: Origin/Shipping Point unless otherwise specified.",
    "All claims for mis-shipments must be made within 5 days of receipt.",
    `This quote was created specifically for ${customer}. Please respect the relationship and do not share this pricing with others.`,
  ];
}

function loadQuoteLogoForPdf(logoSrc) {
  if (typeof window === "undefined" || typeof Image === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
        const payload = dataUrl.split(",")[1] || "";
        const binary = window.atob(payload);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        resolve({ width: canvas.width, height: canvas.height, bytes });
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = logoSrc || quoteCompanyForKey().logo;
  });
}

function quoteCustomerDetailRows(quote) {
  const items = quoteItems(quote);
  const singleItem = items.length === 1 ? items[0] : null;
  const rows = [
    ["Item Size", items.length > 1 ? "Multiple items" : `${quote.form.labelWidth}" x ${quote.form.labelLength}" ${quoteItemUnitLabel(singleItem, quote)}`],
    ["Item Type", items.length > 1 ? "Multiple item types" : quoteItemUnitTitle(singleItem, quote)],
    ["Finished Material", items.length > 1 ? "Multiple materials" : quotePublicMaterialName(quote)],
    ["Finishing", items.length > 1 ? "Multiple finishings" : quoteFinishingLabel(singleItem?.form?.finishingType || quote.form?.finishingType)],
    ["Quantity", Number(quoteTotals(quote).quantity || quote.form.quantity || 0).toLocaleString()],
    ["Quote Number", quote.quoteNumber],
    ["Quote Date", quoteDateLabel(quote.createdAt)],
  ];
  if (quote.productCode) rows.splice(3, 0, ["TSM ID", quote.productCode]);
  return rows;
}

function quoteCustomerPriceRows(quote) {
  const totals = quoteTotals(quote);
  const items = quoteItems(quote);
  const singleItem = items.length === 1 ? items[0] : null;
  const unitTitle = quoteItemUnitTitle(singleItem, quote);
  return [
    ["Quantity", Number(totals.quantity || quote.form.quantity || 0).toLocaleString()],
    ["Price / M", money(totals.pricePerThousand)],
    [`Price / ${unitTitle}`, unitMoney(totals.pricePerLabel)],
    ["Quoted Total", money(totals.sellPrice)],
  ];
}

function quoteIncludedServices(quote) {
  const services = new Set();
  quoteItems(quote).forEach((item) => {
    quoteExtraCostFields
      .filter((field) => Number(item.form?.[field.name] || 0) > 0)
      .forEach((field) => services.add(field.label));
  });
  if (quoteItems(quote).some((item) => Number(item.form?.colorCount || 0) > 0)) services.add("Colors");
  if (quoteItems(quote).some((item) => Number(item.form?.coatingCount || 0) > 0)) services.add("Coatings");
  if (services.size) return Array.from(services);
  const hasTags = quoteItems(quote).some((item) => quoteItemUnitType(item, quote) === "tag");
  return [`${hasTags ? "Tags" : "Labels"} produced to quoted specification`];
}

function percent(value) {
  return `${percentFormatter.format(Number.isFinite(value) ? value : 0)}%`;
}

function quotePricingModeLabel(quote) {
  const mode = quote.form?.pricingMode === "markup" ? "Markup" : "Margin";
  return `${mode} ${percentFormatter.format(Number(quote.form?.pricingPercent || quote.pricing?.pricingPercent || 0))}%`;
}

function quoteActualMargin(quote) {
  const totals = quoteTotals(quote);
  const sell = Number(totals.sellPrice || totals.markedUpProductionSellPrice || 0);
  const cost = Number(totals.totalCost || totals.productionCost || 0);
  const profit = sell - cost;
  return sell > 0 ? (profit / sell) * 100 : 0;
}

function costPriceMarkupPercent(cost, sell) {
  if (cost <= 0) return 0;
  const profit = sell - cost;
  return Math.abs(profit) < 0.005 ? 0 : (profit / cost) * 100;
}

function quoteActualMarkup(quote) {
  const totals = quoteTotals(quote);
  const cost = Number(totals.totalCost || totals.productionCost || 0);
  const sell = Number(totals.sellPrice || totals.markedUpProductionSellPrice || 0);
  return costPriceMarkupPercent(cost, sell);
}

function pricingActualMargin(pricing) {
  const sell = Number(pricing?.sellPrice || pricing?.markedUpProductionSellPrice || 0);
  const cost = Number(pricing?.totalCost || pricing?.productionCost || 0);
  const profit = sell - cost;
  return sell > 0 ? (profit / sell) * 100 : 0;
}

function pricingActualMarkup(pricing) {
  const cost = Number(pricing?.totalCost || pricing?.productionCost || 0);
  const sell = Number(pricing?.sellPrice || pricing?.markedUpProductionSellPrice || 0);
  return costPriceMarkupPercent(cost, sell);
}

function markupToMargin(markupPercent) {
  const markup = Math.max(0, toQuoteNumber(markupPercent));
  return markup > 0 ? (markup / (100 + markup)) * 100 : 0;
}

function marginToMarkup(marginPercent) {
  const margin = Math.min(95, Math.max(0, toQuoteNumber(marginPercent)));
  return margin > 0 ? (margin / (1 - margin / 100)) : 0;
}

function quoteCoreHasMarkupSurcharge(value) {
  const size = toQuoteNumber(value, NaN);
  return Number.isFinite(size) && size > 0 && Math.abs(size - 3) > 0.000001;
}

function applyMarkupPointDelta(value, pricingMode, delta) {
  if (!delta) return percentInputValue(value);
  const currentMarkup = pricingMode === "margin" ? marginToMarkup(value) : Math.max(0, toQuoteNumber(value));
  const nextMarkup = Math.max(0, currentMarkup + delta);
  return percentInputValue(pricingMode === "margin" ? markupToMargin(nextMarkup) : nextMarkup);
}

function coreMarkupDelta(previousCoreSize, nextCoreSize) {
  return (quoteCoreHasMarkupSurcharge(nextCoreSize) ? quoteCoreMarkupSurchargePercent : 0)
    - (quoteCoreHasMarkupSurcharge(previousCoreSize) ? quoteCoreMarkupSurchargePercent : 0);
}

function pricingPercentWithCoreSurcharge(value, pricingMode, coreSize) {
  return applyMarkupPointDelta(value, pricingMode, quoteCoreHasMarkupSurcharge(coreSize) ? quoteCoreMarkupSurchargePercent : 0);
}

function convertPricingPercent(value, fromMode, toMode) {
  if (fromMode === toMode) return percentInputValue(value);
  return percentInputValue(toMode === "margin" ? markupToMargin(value) : marginToMarkup(value));
}

function materialTargetMarkup(material) {
  if (!material) return 0;
  const minimumMarkup = Math.max(0, toQuoteNumber(material.baseMarkupPercent, 0));
  const targetMarkup = Math.max(0, toQuoteNumber(material.targetMarkupPercent ?? material.targetMarginPercent, 0));
  return Math.max(minimumMarkup, targetMarkup);
}

function materialTargetPricingPercent(material, pricingMode) {
  const targetMarkup = materialTargetMarkup(material);
  if (targetMarkup <= 0) return "";
  return percentInputValue(pricingMode === "margin" ? markupToMargin(targetMarkup) : targetMarkup);
}

function profitHealth(pricing, material, displayMode = "margin") {
  const currentMarkup = pricingActualMarkup(pricing);
  const currentMargin = pricingActualMargin(pricing);
  const baseMarkup = Math.max(0, toQuoteNumber(material?.baseMarkupPercent, 0));
  const targetMarkup = materialTargetMarkup(material);
  const baseMargin = markupToMargin(baseMarkup);
  const targetMargin = markupToMargin(targetMarkup);
  const displayIsMarkup = displayMode === "markup";
  const displayCurrent = displayIsMarkup ? currentMarkup : currentMargin;
  const displayTarget = displayIsMarkup ? targetMarkup : targetMargin;
  const displayBase = displayIsMarkup ? baseMarkup : baseMargin;
  const displayLabel = displayIsMarkup ? "Markup" : "Margin";
  const secondaryLabel = displayIsMarkup
    ? `Current margin ${percent(currentMargin)}`
    : `Equivalent markup ${percent(currentMarkup)}`;
  if (!material || targetMarkup <= 0) {
    return { className: "neutral", currentMarkup, currentMargin, baseMarkup, targetMarkup, displayCurrent, displayTarget, displayBase, displayLabel, secondaryLabel, progress: 0 };
  }
  if (currentMarkup <= baseMarkup) return { className: "bad", currentMarkup, currentMargin, baseMarkup, targetMarkup, displayCurrent, displayTarget, displayBase, displayLabel, secondaryLabel, progress: 0 };
  if (currentMarkup >= targetMarkup) return { className: "strong", currentMarkup, currentMargin, baseMarkup, targetMarkup, displayCurrent, displayTarget, displayBase, displayLabel, secondaryLabel, progress: 1 };
  const progress = (currentMarkup - baseMarkup) / Math.max(1, targetMarkup - baseMarkup);
  return { className: progress > 0.66 ? "good" : "watch", currentMarkup, currentMargin, baseMarkup, targetMarkup, displayCurrent, displayTarget, displayBase, displayLabel, secondaryLabel, progress };
}

function quoteAddedCostRows(quote) {
  return quoteExtraCostFields.map((field) => [
    field.label,
    money(Number(quote.form?.[field.name] || 0)),
  ]);
}

function quoteInternalSections(quote) {
  if (!quote) return [];
  const items = quoteItems(quote);
  const totals = quoteTotals(quote);
  if (items.length > 1) {
    return [
      {
        title: "Quote Inputs",
        rows: [
          ["Customer", quote.customerName || "--"],
          ["Job Number", quote.jobName || "--"],
          ...(quote.productCode ? [["TSM ID", quote.productCode]] : []),
          ["Job Ticket", quote.jobTicketNumber || "Manual quote"],
          ["Contact", quote.contactName || quote.contactEmail || "--"],
          ["Prepared By", `${quotePreparedByName(quote)}${quotePreparedByRole(quote) ? ` / ${quotePreparedByRole(quote)}` : ""}`],
          ["Approval", quoteApprovalSummary(quote)],
        ],
      },
      {
        title: "Multi-Item Totals",
        rows: [
          ["Items", items.length],
          ["Total Quantity", Number(totals.quantity || 0).toLocaleString()],
          ["Total MSI With Waste", number(Number(totals.materialMsiWithWaste || 0))],
          ["Material Cost", money(Number(totals.materialCost || 0))],
          ["Total Internal Cost", money(Number(totals.totalCost || 0))],
          ["Sell Price", money(Number(totals.sellPrice || 0))],
          ["Profit Dollars", money(Number(totals.profit || 0))],
          ["Actual Margin", percent(quoteActualMargin(quote))],
        ],
      },
    ];
  }
  return [
    {
      title: "Quote Inputs",
      rows: [
        ["Customer", quote.customerName || "--"],
        ["Item Name", quoteLinePartNumber(items[0], quote) || "--"],
        ["Job Number", quote.jobName || "--"],
        ...(quote.productCode ? [["TSM ID", quote.productCode]] : []),
        ["Job Ticket", quote.jobTicketNumber || "Manual quote"],
        ["Contact", quote.contactName || quote.contactEmail || "--"],
        ["Prepared By", `${quotePreparedByName(quote)}${quotePreparedByRole(quote) ? ` / ${quotePreparedByRole(quote)}` : ""}`],
        ["Approval", quoteApprovalSummary(quote)],
      ],
    },
    {
      title: "Material + Layout",
      rows: [
        ["Item Type", quoteItemUnitTitle(items[0], quote)],
        ["Proof Note", quote.form?.itemNote || "--"],
        ["Finished Material", quote.materialName || "Manual MSI Cost"],
        ["Material Source", quote.materialSource || "manual"],
        ["Components", quote.materialComponents || "--"],
        ["Finishing", quoteFinishingLabel(quote.form?.finishingType)],
        ["Core", quoteCoreLabel(quote.form?.coreSize) || "--"],
        [`${quoteItemUnitTitle(items[0], quote, true)} / ${quoteItemContainerLabel(quote.form || {})}`, quote.form?.labelsPerUnit || "--"],
        [`${quoteItemUnitTitle(items[0], quote, true)} / Carton`, quote.form?.labelsPerCarton || "--"],
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
        ["Item Size", `${quote.form?.labelWidth || 0}" x ${quote.form?.labelLength || 0}" ${quoteItemUnitLabel(items[0], quote)}`],
        ["Auto Repeat", number(Number(quote.pricing?.repeat || quote.form?.repeat || 0), '"')],
        ["Run Footage", number(Number(quote.pricing?.runFootage || 0), " ft")],
        ["Quantity", Number(quote.form?.quantity || 0).toLocaleString()],
        ["Finished Item MSI", number(Number(quote.pricing?.finishedMsi || 0))],
        ["Base Material MSI", number(Number(quote.pricing?.baseMaterialMsi || 0))],
        ["Waste Percent", percent(Number(quote.form?.wastePercent || 0))],
        ["Recommended Waste", percent(Number(quote.pricing?.recommendedWastePercent || 0))],
        ["Waste MSI", number(Number(quote.pricing?.wasteMsi || 0))],
        ["MSI With Waste", number(Number(quote.pricing?.materialMsiWithWaste || 0))],
      ],
    },
    {
      title: "Cost Build",
      rows: [
        ["MSI Cost", `${unitMoney(Number(quote.form?.msiCost || 0))} / MSI`],
        ["Material Cost", money(Number(quote.pricing?.materialCost || 0))],
        ["Color Count", Number(quote.form?.colorCount || 0)],
        ["Coating Count", Number(quote.form?.coatingCount || 0)],
        ["Color / Coating Cost", money(Number(quote.pricing?.processMsiCost || 0))],
        ["Production Cost", money(Number(quote.pricing?.productionCost || 0))],
        ...quoteAddedCostRows(quote),
        ["Added Costs Total", `${money(Number(quote.pricing?.extraCost || 0))} included in cost base`],
        ["Total Internal Cost", money(Number(quote.pricing?.totalCost || 0))],
      ],
    },
    {
      title: "Sell Price",
      rows: [
        ["Pricing Method", quotePricingModeLabel(quote)],
        ...(quoteCoreMarkupSurchargeForQuote(quote) > 0
          ? [["Core Markup", `+${percent(quoteCoreMarkupSurchargeForQuote(quote))} included for non-3" core`]]
          : []),
        ["Sell Price", money(Number(quote.pricing?.sellPrice || 0))],
        ["Price / M", money(Number(quote.pricing?.pricePerThousand || 0))],
        [`Price / ${quoteItemUnitTitle(items[0], quote)}`, unitMoney(Number(quote.pricing?.pricePerLabel || 0))],
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

function quoteCompanyTeamName(quoteCompany) {
  return quoteCompany?.teamName || quoteCompany?.label || "Team Tri-State";
}

function quotePersonKey(quote) {
  if (quote?.preparedByUserId) return `user:${quote.preparedByUserId}`;
  return `name:${quotePreparedByName(quote).toLowerCase()}`;
}

function currentUserQuoteKey(user) {
  if (user?.id) return `user:${user.id}`;
  if (user?.name) return `name:${user.name.toLowerCase()}`;
  return "all";
}

function quoteBelongsToPerson(quote, personKey, user) {
  if (personKey === "all") return true;
  if (quotePersonKey(quote) === personKey) return true;
  const currentKey = currentUserQuoteKey(user);
  return (
    personKey === currentKey &&
    user?.name &&
    quotePreparedByName(quote).toLowerCase() === user.name.toLowerCase()
  );
}

function quoteSearchText(quote) {
  return [
    quote.quoteNumber,
    quote.customerName,
    quote.customerCode,
    quote.form?.salesQuote?.customerCode,
    quote.form?.itemName,
    quoteItems(quote).map((item) => item.itemName).join(" "),
    quote.jobName,
    quote.productCode,
    quote.materialName,
    quoteItems(quote).map((item) => quoteFinishingLabel(item.form?.finishingType)).join(" "),
    quotePreparedByName(quote),
    quotePreparedByRole(quote),
    quoteApprovalLabel(quote),
    quoteWorkflowLabel(quote),
    quote.approvalByName,
    quote.approvalNote,
    quote.processedByName,
    quote.lastEditedByName,
    quoteLastEditedSummary(quote),
    quoteProcessedSummary(quote),
    quoteDateLabel(quote.createdAt),
    money(quote.pricing?.sellPrice),
  ].filter(Boolean).join(" ").toLowerCase();
}

function quoteEmailSubject(quote) {
  return `Approval Needed: ${quote?.quoteNumber || "Quote"}`;
}

function quoteEmailBody(quote, quoteLink) {
  const items = quoteItems(quote);
  const itemRows = items.map((item) => {
    const unit = quoteUnitLabel(quoteItemUnitType(item, quote));
    const price = quoteCompactUnitMoney(Number(item?.pricing?.pricePerLabel || 0));
    return {
      description: quoteLinePrimaryDescription(item, quote),
      price: `${price}/${unit}`,
      unit,
    };
  });
  const singleItem = itemRows.length === 1 ? itemRows[0] : null;
  return [
    `QUOTE APPROVAL REQUEST`,
    ``,
    `Please review this quote for approval:`,
    ``,
    `============================================================`,
    `CLICK THIS LINK TO OPEN THE QUOTE FOR APPROVAL:`,
    quoteLink,
    `============================================================`,
    ``,
    `Quote: ${quote?.quoteNumber || "--"}`,
    `Customer: ${quote?.customerName || "No customer"}`,
    singleItem ? `Item: ${singleItem.description}` : `Items:`,
    ...(singleItem ? [] : itemRows.map((item) => `- ${item.description}`)),
    singleItem ? `Price / ${singleItem.unit}: ${singleItem.price}` : `Price per unit:`,
    ...(singleItem ? [] : itemRows.map((item) => `- ${item.price}`)),
    `Status: ${quoteApprovalLabel(quote)}`,
    ``,
    `Thank you,`,
    quotePreparedByName(quote),
  ].join("\n");
}

function findCurrentMaterial(item, materialOptions = []) {
  if (!item || !materialOptions.length) return null;
  const byId = materialOptions.find((material) => String(material.id) === String(item.materialId || item.form?.selectedMaterialId || ""));
  if (byId) return byId;
  if (!item.materialName || item.materialName === "Manual MSI Cost") return null;
  return materialOptions.find((material) => material.name === item.materialName) || null;
}

function currentMsiForItem(item, materialOptions = []) {
  const material = findCurrentMaterial(item, materialOptions);
  if (material) return Number(material.calculatedMsiCost || 0);
  return Number(item?.form?.msiCost || 0);
}

function quoteCurrentMsiSummary(quote, materialOptions = []) {
  const items = quoteItems(quote);
  if (!items.length) return "";
  if (items.length === 1) {
    return `Current MSI ${unitMoney(currentMsiForItem(items[0], materialOptions))}`;
  }
  const current = items.reduce((sum, item) => sum + currentMsiForItem(item, materialOptions), 0);
  return `Current MSI ${unitMoney(current)} combined`;
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

function FinishedMaterialForm({ form, rawMaterials, materialMasterTypes = [], update, submit, editing = false, onCancel }) {
  function rawOptionsFor(slot) {
    return rawMaterials.filter((raw) => raw.componentType === slot.type);
  }

  return (
    <form className="quote-library-form" onSubmit={submit}>
      <Field label="Name">
        <input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="PM / 40# / Permanent" />
      </Field>
      <Field label="Material Type">
        <select value={form.materialMasterTypeId || ""} onChange={(event) => update("materialMasterTypeId", event.target.value)}>
          <option value="">No material type link</option>
          {materialMasterTypes.map((type) => (
            <option value={type.id} key={type.id}>{materialMasterTypeOptionLabel(type)}</option>
          ))}
        </select>
      </Field>
      <Field label="Material Unit">
        <select value={form.unitType} onChange={(event) => update("unitType", event.target.value)}>
          {quoteUnitTypeChoices.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </Field>
      <Field label="Source">
        <select value={form.sourceType} onChange={(event) => update("sourceType", event.target.value)}>
          <option value="made">Made In-House</option>
          <option value="purchased">Purchased Finished</option>
        </select>
      </Field>
      <Field label="Minimum Markup" suffix="%">
        <input type="number" step="0.01" value={form.baseMarkupPercent} onChange={(event) => update("baseMarkupPercent", event.target.value)} />
      </Field>
      <Field label="Target Markup" suffix="%">
        <input type="number" step="0.01" value={form.targetMarkupPercent} onChange={(event) => update("targetMarkupPercent", event.target.value)} />
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
  const items = quoteItems(quote);
  const totals = quoteTotals(quote);
  const salesInfo = quoteSalesInfo(quote);
  const quoteCompany = quoteCompanyForQuote(quote);
  const quoteLines = quoteForLines(quote);
  const dateRows = quoteDocumentDateRows(quote);
  const terms = compactQuoteTerms();

  return (
    <article className="quote-document">
      <header className="quote-doc-sales-head">
        <div className="quote-doc-brand" style={{ "--quote-logo-width": quoteCompany.logoWidth }}>
          <img src={quoteCompany.logo} alt={quoteCompany.label} />
        </div>
        <div className="quote-doc-title-block">
          <span>Sales Quote</span>
          <strong>{quote.quoteNumber}</strong>
          <em>Total in US$</em>
          <b>{money(totals.sellPrice)}</b>
        </div>
      </header>

      <section className={`quote-doc-sales-meta ${quoteLines.length > 0 ? "" : "quote-doc-sales-meta-date-only"}`.trim()}>
        {quoteLines.length > 0 && (
          <div className="quote-doc-quote-for">
            <span>Quotation for:</span>
            {quoteLines.map((line, index) => (
              index === 0 ? <strong key={`${line}-${index}`}>{line}</strong> : <em key={`${line}-${index}`}>{line}</em>
            ))}
          </div>
        )}
        <div className="quote-doc-date-card">
          {dateRows.map(([label, value]) => (
            <div key={label}><span>{label}:</span><strong>{value}</strong></div>
          ))}
        </div>
      </section>

      <section className="quote-doc-line-item">
        <table className="quote-doc-sales-table">
          <thead>
            <tr>
              <th>Part Number &amp; Description</th>
              <th>Qty</th>
              <th>UoM</th>
              <th>Per Unit US$</th>
              <th>Extended US$</th>
            </tr>
          </thead>
          <tbody>
          {items.map((item) => (
            <tr key={item.id || quoteItemDescription(item, quote)}>
              <td>
                <strong>{quoteLinePartNumber(item, quote)}</strong>
                {quoteLineDescriptionRows(item, quote).map((line, lineIndex) => <span key={`${line}-${lineIndex}`}>{line}</span>)}
              </td>
              <td>{quoteTableQuantity(item, salesInfo.unitOfMeasure)}</td>
              <td>{quoteTableUomLabel(salesInfo.unitOfMeasure)}</td>
              <td>{quoteTableUnitPrice(item, salesInfo.unitOfMeasure)}</td>
              <td>{money(Number(item.pricing?.sellPrice || 0))}</td>
            </tr>
          ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan="4">Total in US$</td>
              <td>{money(totals.sellPrice)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="quote-doc-signature-grid">
        <div className="quote-doc-signature">
          <div className="quote-doc-sign-row"><span>Client P.O.</span><strong>{salesInfo.clientPo || ""}</strong></div>
          <div className="quote-doc-sign-row"><span>Authorized Signature</span><strong /></div>
          <div className="quote-doc-sign-row"><span>Printed Name</span><strong /></div>
          <div className="quote-doc-sign-row"><span>Title</span><strong /></div>
          <div className="quote-doc-sign-row"><span>Date</span><strong /></div>
          <strong>**Please provide both the Bill To and Ship To addresses when submitting your order.**</strong>
        </div>
        <div className="quote-doc-contact-card">
          <strong>{quoteThankYouMessage}</strong>
          <span>{quoteCompanyTeamName(quoteCompany)}</span>
          {quote.contactEmail && <em>{quote.contactEmail}</em>}
        </div>
      </section>

      <section className="quote-doc-terms">
      {quote.notes && (
          <p>{quote.notes}</p>
      )}
        <ul>
          {terms.map((term) => <li key={term}>{term}</li>)}
        </ul>
      </section>
    </article>
  );
}

function InternalQuoteBreakdown({ quote, materialOptions = [] }) {
  if (!quote) return <p className="quote-empty">Select a saved quote to view internal pricing.</p>;
  const sections = quoteInternalSections(quote);
  const items = quoteItems(quote);
  const totals = quoteTotals(quote);
  const msiUnitCost = items.length === 1 ? Number(items[0].form?.msiCost || 0) : 0;
  const currentMsiUnitCost = items.length === 1 ? currentMsiForItem(items[0], materialOptions) : 0;
  const materialMsi = Number(totals.materialMsiWithWaste || 0);
  const materialCost = Number(totals.materialCost || 0);
  const totalCost = Number(totals.totalCost || 0);
  const sellPrice = Number(totals.sellPrice || 0);
  const profit = Number(totals.profit || 0);

  return (
    <article className="quote-internal-breakdown">
      <header className="quote-internal-head">
        <div>
          <span>Internal Pricing Review</span>
          <strong>{quote.quoteNumber}</strong>
          <em>{quote.customerName || "No customer"} / {items.length > 1 ? `${items.length} quoted items` : quoteDescription(quote)}</em>
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
        <Metric label="Current MSI" value={items.length === 1 ? `${unitMoney(currentMsiUnitCost)} / MSI` : "Multiple"} />
      </section>

      {items.length === 1 ? (
        <>
          <section className="quote-internal-formula">
            <span>Material formula</span>
            <code>
              ({quote.pricing?.repeat || quote.form?.repeat || 0} repeat x {Number(quote.form?.quantity || 0).toLocaleString()} {quoteItemUnitLabel(items[0], quote, true)} x {quote.form?.materialWidth || 0}" web) / (1000 x {quote.pricing?.numberAcross || 0} across) x {number(Number(quote.pricing?.wasteMultiplier || 1))} waste x {unitMoney(msiUnitCost)}
            </code>
          </section>
          <section className="quote-current-msi-note">
            <BreakdownRow label="Quoted MSI Cost" value={`${unitMoney(msiUnitCost)} / MSI`} />
            <BreakdownRow label="Current MSI Cost" value={`${unitMoney(currentMsiUnitCost)} / MSI`} />
          </section>
        </>
      ) : (
        <section className="quote-internal-items">
          {items.map((item, index) => (
            <article key={item.id || index}>
              <header>
                <strong>{quoteItemDescription(item, quote)}</strong>
                <span>{item.materialName || "Manual MSI Cost"}</span>
              </header>
              <div>
                <BreakdownRow label="Quantity" value={Number(item.form?.quantity || 0).toLocaleString()} />
                <BreakdownRow label="Quoted MSI Cost" value={`${unitMoney(Number(item.form?.msiCost || 0))} / MSI`} />
                <BreakdownRow label="Current MSI Cost" value={`${unitMoney(currentMsiForItem(item, materialOptions))} / MSI`} />
                <BreakdownRow label="MSI With Waste" value={number(Number(item.pricing?.materialMsiWithWaste || 0))} />
                <BreakdownRow label="Color / Coating Cost" value={money(Number(item.pricing?.processMsiCost || 0))} />
                <BreakdownRow label="Total Cost" value={money(Number(item.pricing?.totalCost || 0))} />
                <BreakdownRow label="Sell Price" value={money(Number(item.pricing?.sellPrice || 0))} />
              </div>
            </article>
          ))}
        </section>
      )}

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

export default function QuotePricingTool({ currentUser, initialJobTicketId = "", initialCustomerId = "", canManageQuoteMaterials = false, canApproveQuotes = false }) {
  const storedLibrary = useMemo(loadMaterialLibrary, []);
  const storedQuotes = useMemo(loadSavedQuotes, []);
  const [activeTab, setActiveTab] = useState("pricing");
  const [savedQuoteView, setSavedQuoteView] = useState("customer");
  const [form, setForm] = useState(initialForm);
  const [wasteManuallyEdited, setWasteManuallyEdited] = useState(false);
  const [quoteInfo, setQuoteInfo] = useState(emptyQuoteInfo);
  const [quoteSearch, setQuoteSearch] = useState("");
  const [quoteWorkflowFilter, setQuoteWorkflowFilter] = useState("active");
  const [quoteStatusFilter, setQuoteStatusFilter] = useState("all");
  const [quotePersonFilter, setQuotePersonFilter] = useState(() => currentUserQuoteKey(currentUser));
  const [approvalSavingId, setApprovalSavingId] = useState("");
  const [quoteActionError, setQuoteActionError] = useState("");
  const [quoteActionNotice, setQuoteActionNotice] = useState("");
  const [quoteEditContext, setQuoteEditContext] = useState(null);
  const [quoteConfirm, setQuoteConfirm] = useState(null);
  const [rawForm, setRawForm] = useState(emptyRawForm);
  const [finishedForm, setFinishedForm] = useState(emptyFinishedForm);
  const [editingRawId, setEditingRawId] = useState(null);
  const [editingFinishedId, setEditingFinishedId] = useState(null);
  const [rawMaterials, setRawMaterials] = useState(storedLibrary.rawMaterials);
  const [finishedMaterials, setFinishedMaterials] = useState(storedLibrary.finishedMaterials);
  const [materialMasterTypes, setMaterialMasterTypes] = useState([]);
  const [quoteRates, setQuoteRates] = useState(quoteRateDefaults);
  const [quoteItemsDraft, setQuoteItemsDraft] = useState([]);
  const [savedQuotes, setSavedQuotes] = useState(storedQuotes);
  const [selectedQuoteId, setSelectedQuoteId] = useState(storedQuotes[0]?.id ?? null);
  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerCreateOpen, setCustomerCreateOpen] = useState(false);
  const [customerSaving, setCustomerSaving] = useState(false);
  const [customerDraft, setCustomerDraft] = useState(emptyCustomerDraft);
  const [jobTickets, setJobTickets] = useState([]);
  const [jobTicketSearch, setJobTicketSearch] = useState("");
  const [jobTicketPickerOpen, setJobTicketPickerOpen] = useState(false);
  const [jobTicketLoadState, setJobTicketLoadState] = useState("idle");
  const [jobPrintPlates, setJobPrintPlates] = useState([]);
  const [jobPrintStations, setJobPrintStations] = useState([]);
  const [jobPrintState, setJobPrintState] = useState("idle");
  const [quoteDataState, setQuoteDataState] = useState("loading");
  const [quoteDataError, setQuoteDataError] = useState("");
  const quoteDataReadyRef = useRef(false);
  const quoteRouteAppliedRef = useRef("");
  const initialJobTicketAppliedRef = useRef("");
  const initialCustomerAppliedRef = useRef("");
  const jobTicketRequestRef = useRef(0);
  const selectedJobTicketRequestRef = useRef("");

  const materialOptions = useMemo(() => {
    return finishedMaterials.map((material) => {
      const masterType = materialMasterTypes.find((type) => String(type.id) === String(material.materialMasterTypeId || ""));
      return {
        ...material,
        calculatedMsiCost: calculateFinishedMaterialMsiCost(material, rawMaterials, quoteRates),
        componentLabel: componentLabelForFinishedMaterial(material, rawMaterials),
        masterTypeLabel: [
          material.materialMasterTypeCode || masterType?.code,
          material.materialMasterTypeName || masterType?.name,
        ].filter(Boolean).join(" / "),
      };
    });
  }, [finishedMaterials, rawMaterials, quoteRates, materialMasterTypes]);
  const visibleQuoteTabs = useMemo(() => {
    const tabs = ["pricing", "quotes"];
    if (canManageQuoteMaterials) tabs.push("finished", "raw");
    return tabs;
  }, [canManageQuoteMaterials]);

  const selectedMaterial = materialOptions.find((material) => String(material.id) === String(form.selectedMaterialId));
  const selectedJobTicket = jobTickets.find((ticket) => String(ticket.id) === String(quoteInfo.jobTicketId));
  const selectedCustomer = quoteInfo.customerCleared
    ? null
    : customers.find((customer) => String(customer.id) === String(quoteInfo.customerId || selectedJobTicket?.customer || ""));
  const matchingCustomers = useMemo(() => {
    const search = customerSearch.trim().toLowerCase();
    const activeCustomers = [...customers].filter((customer) => customer.is_active !== false);
    const sorted = activeCustomers.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true }));
    if (!search) return sorted.slice(0, 18);
    const tokens = search.split(/\s+/).filter(Boolean);
    return sorted.filter((customer) => {
      const haystack = customerSearchText(customer);
      return tokens.every((token) => haystack.includes(token));
    }).slice(0, 24);
  }, [customers, customerSearch]);
  const showJobTicketResults = jobTicketPickerOpen;
  const matchingJobTickets = useMemo(() => {
    const search = jobTicketSearch.trim().toLowerCase();
    const sorted = [...jobTickets].sort((a, b) => jobTicketPartNumber(a).localeCompare(jobTicketPartNumber(b), undefined, { numeric: true }));
    if (!search) return sorted;
    const tokens = search.split(/\s+/).filter(Boolean);
    return sorted.filter((ticket) => {
      const haystack = jobTicketSearchText(ticket);
      return tokens.every((token) => haystack.includes(token));
    });
  }, [jobTickets, jobTicketSearch]);
  const visibleJobTickets = useMemo(() => matchingJobTickets.slice(0, jobTicketSearch.trim() ? 36 : 18), [matchingJobTickets, jobTicketSearch]);
  const selectedJobTicketDimensions = useMemo(() => jobTicketQuoteDimensions(selectedJobTicket), [selectedJobTicket]);
  const selectedJobTicketQuantity = useMemo(() => jobTicketQuoteQuantity(selectedJobTicket), [selectedJobTicket]);
  const selectedJobTicketMasterTypeId = jobTicketMasterTypeId(selectedJobTicket);
  const selectedJobTicketMasterTypeLabel = jobTicketMasterTypeLabel(selectedJobTicket);
  const jobTicketMaterialMatch = useMemo(() => {
    if (!selectedJobTicket) return null;
    return materialOptions.find((material) => materialMatchesJobTicket(material, selectedJobTicket)) || null;
  }, [materialOptions, selectedJobTicket, selectedJobTicketMasterTypeId]);
  const activePrintStations = useMemo(
    () => jobPrintStations.filter((station) => station.is_active !== false),
    [jobPrintStations]
  );
  const jobPrintColorCount = activePrintStations.length;
  const jobPrintColorSummary = useMemo(() => {
    return activePrintStations
      .map((station) => station.pms_color || station.color_type || `Station ${station.station_number}`)
      .filter(Boolean)
      .slice(0, 6)
      .join(", ");
  }, [activePrintStations]);
  const sortedSavedQuotes = useMemo(() => sortQuotesForApproval(savedQuotes), [savedQuotes]);
  const quoteWorkflowCounts = useMemo(() => {
    return savedQuotes.reduce((acc, quote) => {
      const status = quoteWorkflowStatus(quote);
      acc.all += 1;
      acc[status] += 1;
      return acc;
    }, { all: 0, active: 0, processed: 0 });
  }, [savedQuotes]);
  const workflowFilteredQuotes = useMemo(() => {
    return sortedSavedQuotes.filter((quote) => quoteWorkflowStatus(quote) === quoteWorkflowFilter);
  }, [quoteWorkflowFilter, sortedSavedQuotes]);
  const quoteStatusCounts = useMemo(() => {
    return workflowFilteredQuotes.reduce((acc, quote) => {
      const status = quoteApprovalStatus(quote);
      acc.all += 1;
      acc[status] += 1;
      return acc;
    }, { all: 0, pending: 0, approved: 0, rejected: 0 });
  }, [workflowFilteredQuotes]);
  const quotePersonTabs = useMemo(() => {
    const groups = new Map();
    if (currentUser?.name) {
      groups.set(currentUserQuoteKey(currentUser), {
        key: currentUserQuoteKey(currentUser),
        name: currentUser.name,
        role: currentUser.role || "",
        count: 0,
        isCurrentUser: true,
      });
    }
    const currentKey = currentUserQuoteKey(currentUser);
    const currentName = currentUser?.name?.toLowerCase();
    workflowFilteredQuotes.forEach((quote) => {
      const preparedName = quotePreparedByName(quote).toLowerCase();
      const rawKey = quotePersonKey(quote);
      const key = rawKey === currentKey || (currentName && preparedName === currentName) ? currentKey : rawKey;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name: key === currentKey && currentUser?.name ? currentUser.name : quotePreparedByName(quote),
          role: key === currentKey && currentUser?.role ? currentUser.role : quotePreparedByRole(quote),
          count: 0,
          isCurrentUser: key === currentKey,
        });
      }
      groups.get(key).count += 1;
    });
    return Array.from(groups.values()).sort((a, b) => {
      if (a.key === currentUserQuoteKey(currentUser)) return -1;
      if (b.key === currentUserQuoteKey(currentUser)) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [currentUser?.id, currentUser?.name, currentUser?.role, workflowFilteredQuotes]);
  const searchedSavedQuotes = useMemo(() => {
    const search = quoteSearch.trim().toLowerCase();
    if (!search) return workflowFilteredQuotes;
    return workflowFilteredQuotes.filter((quote) => quoteSearchText(quote).includes(search));
  }, [quoteSearch, workflowFilteredQuotes]);
  const statusFilteredSavedQuotes = useMemo(() => {
    if (quoteStatusFilter === "all") return searchedSavedQuotes;
    return searchedSavedQuotes.filter((quote) => quoteApprovalStatus(quote) === quoteStatusFilter);
  }, [quoteStatusFilter, searchedSavedQuotes]);
  const filteredSavedQuotes = useMemo(() => {
    if (quotePersonFilter === "all") return statusFilteredSavedQuotes;
    return statusFilteredSavedQuotes.filter((quote) => quoteBelongsToPerson(quote, quotePersonFilter, currentUser));
  }, [quotePersonFilter, statusFilteredSavedQuotes, currentUser?.id, currentUser?.name]);
  const groupedSavedQuotes = useMemo(() => {
    const groups = new Map(quoteApprovalStates.map(([key, label]) => [key, { key, name: label, quotes: [] }]));
    filteredSavedQuotes.forEach((quote) => {
      groups.get(quoteApprovalStatus(quote))?.quotes.push(quote);
    });
    return Array.from(groups.values()).filter((group) => group.quotes.length);
  }, [filteredSavedQuotes]);
  const selectedQuote = filteredSavedQuotes.find((quote) => quote.id === selectedQuoteId)
    ?? filteredSavedQuotes[0]
    ?? null;
  const pricing = useMemo(() => calculateQuotePricing(form), [form]);
  const candidates = useMemo(() => buildLayoutCandidates(form), [form]);
  const bestPresetWidth = useMemo(() => calculateBestMaterialWidth(form, materialWidthPresets), [
    form.labelWidth,
    form.labelLength,
    form.quantity,
    form.gap,
    form.sideTrim,
    form.msiCost,
    form.colorCount,
    form.coatingCount,
    form.colorMsiCost,
    form.coatingMsiCost,
  ]);
  const currentProfitHealth = useMemo(() => profitHealth(pricing, selectedMaterial, form.pricingMode), [pricing, selectedMaterial, form.pricingMode]);
  const fitTone = pricing.fits ? "ready" : "bad";
  const FitIcon = pricing.fits ? CheckCircle2 : AlertTriangle;
  const manualMaterialWidth = !materialWidthPresets.includes(form.materialWidth);
  const wasteMatchesRecommendation = Math.abs(toQuoteNumber(form.wastePercent) - toQuoteNumber(pricing.recommendedWastePercent)) < 0.01;
  const selectedQuoteIsMine = selectedQuote ? quoteBelongsToPerson(selectedQuote, currentUserQuoteKey(currentUser), currentUser) : false;
  const selectedQuoteWorkflowStatus = selectedQuote ? quoteWorkflowStatus(selectedQuote) : "active";
  const visibleQuoteExpirationDate = quoteInfo.quoteExpirationDate || quoteFutureDateInput(quoteEditContext?.createdAt);

  useEffect(() => {
    if (visibleQuoteTabs.includes(activeTab)) return;
    setActiveTab("pricing");
  }, [activeTab, visibleQuoteTabs]);

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
    const preference = loadQuotePreference(currentUser);
    if (preference.pricingMode === "markup" || preference.pricingMode === "margin") {
      setForm((prev) => {
        if (prev.pricingMode === preference.pricingMode) return prev;
        return {
          ...prev,
          pricingMode: preference.pricingMode,
          pricingPercent: convertPricingPercent(prev.pricingPercent, prev.pricingMode, preference.pricingMode),
        };
      });
    }
  }, [currentUser?.id, currentUser?.name]);

  useEffect(() => {
    if (activeTab !== "quotes") return;
    setQuotePersonFilter(canApproveQuotes ? "all" : currentUserQuoteKey(currentUser));
  }, [activeTab, canApproveQuotes, currentUser?.id, currentUser?.name]);

  useEffect(() => {
    if (!filteredSavedQuotes.length) {
      setSelectedQuoteId(null);
      return;
    }
    setSelectedQuoteId((current) => filteredSavedQuotes.some((quote) => quote.id === current) ? current : filteredSavedQuotes[0].id);
  }, [filteredSavedQuotes]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const linkedQuoteId = params.get("quoteId");
    const wantsSavedQuotes = window.location.hash === "#saved-quotes" || params.get("quoteView") === "savedQuotes";
    const routeKey = linkedQuoteId ? `quote:${linkedQuoteId}` : wantsSavedQuotes ? "saved-quotes" : "";
    if (!routeKey || quoteRouteAppliedRef.current === routeKey) return;

    if (!linkedQuoteId) {
      setActiveTab("quotes");
      quoteRouteAppliedRef.current = routeKey;
      return;
    }

    if (!savedQuotes.length) return;
    const linkedQuote = savedQuotes.find((quote) => String(quote.id) === String(linkedQuoteId));
    if (!linkedQuote) return;
    setActiveTab("quotes");
    setQuoteWorkflowFilter(quoteWorkflowStatus(linkedQuote));
    setSelectedQuoteId(linkedQuote.id);
    quoteRouteAppliedRef.current = routeKey;
  }, [savedQuotes]);

  useEffect(() => {
    if (!bestPresetWidth || manualMaterialWidth) return;
    setForm((prev) => prev.materialWidth === bestPresetWidth ? prev : { ...prev, materialWidth: bestPresetWidth });
  }, [bestPresetWidth, manualMaterialWidth]);

  useEffect(() => {
    if (wasteManuallyEdited || pricing.recommendedWastePercent <= 0) return;
    const recommended = percentInputValue(pricing.recommendedWastePercent);
    if (!recommended) return;
    setForm((prev) => prev.wastePercent === recommended ? prev : { ...prev, wastePercent: recommended });
  }, [pricing.recommendedWastePercent, wasteManuallyEdited]);

  useEffect(() => {
    let alive = true;

    async function loadSharedQuoteData({ quiet = false } = {}) {
      if (!quiet) {
        setQuoteDataState("loading");
        setQuoteDataError("");
      }
      try {
        let [rawPayload, finishedPayload, quotePayload, ratePayload, customerPayload, materialTypePayload] = await Promise.all([
          fetchCollection("quote-raw-materials", { pageSize: 1000, fetchAll: true }),
          fetchCollection("quote-finished-materials", { pageSize: 1000, fetchAll: true }),
          fetchCollection("quote-records", { ordering: "-created_at", pageSize: 1000, fetchAll: true }),
          fetchCollection("quote-cost-rates", { pageSize: 1000, fetchAll: true }),
          fetchCollection("customers", { ordering: "name", pageSize: 1000, fetchAll: true }),
          fetchCollection("material-master-types", { ordering: "code,name", pageSize: 1000, fetchAll: true }),
        ]);

        let rawResults = rawPayload.results ?? [];
        let finishedResults = finishedPayload.results ?? [];
        let quoteResults = quotePayload.results ?? [];
        let rateResults = ratePayload.results ?? [];
        let customerResults = customerPayload.results ?? [];
        const materialTypeResults = materialTypePayload.results ?? [];

        if (!rawResults.length && storedLibrary.rawMaterials.length) {
          rawResults = await Promise.all(storedLibrary.rawMaterials.map((raw) => createRecord("quote-raw-materials", rawMaterialPayload(raw))));
        }

        if (!finishedResults.length && storedLibrary.finishedMaterials.length) {
          finishedResults = await Promise.all(storedLibrary.finishedMaterials.map((material) => createRecord("quote-finished-materials", finishedMaterialPayload(material))));
        }

        if (!quoteResults.length && storedQuotes.length) {
          quoteResults = await Promise.all(storedQuotes.map((quote) => createRecord("quote-records", quoteRecordPayload(quote))));
        }

        if (!rateResults.length) {
          rateResults = await Promise.all(quoteRateDefaults.map((rate) => createRecord("quote-cost-rates", quoteCostRatePayload(rate))));
        }

        if (!alive) return;
        setRawMaterials(rawResults);
        setFinishedMaterials(finishedResults);
        setQuoteRates(rateResults);
        setSavedQuotes(quoteResults);
        setCustomers(customerResults);
        setMaterialMasterTypes(materialTypeResults);
        setSelectedQuoteId((current) => current && quoteResults.some((quote) => quote.id === current) ? current : quoteResults[0]?.id ?? null);
        quoteDataReadyRef.current = true;
        setQuoteDataState("ready");
        setQuoteDataError("");
      } catch (error) {
        if (!alive) return;
        if (quiet && quoteDataReadyRef.current) return;
        setQuoteDataError(error.message || "Could not load shared quote data.");
        setQuoteDataState("error");
      }
    }

    loadSharedQuoteData();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      loadSharedQuoteData({ quiet: true });
    }, 60_000);
    return () => {
      alive = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!initialJobTicketId) {
      initialJobTicketAppliedRef.current = "";
      return;
    }
    const nextJobTicketId = String(initialJobTicketId);
    if (initialJobTicketAppliedRef.current === nextJobTicketId) return;
    initialJobTicketAppliedRef.current = nextJobTicketId;
    setActiveTab("pricing");
    setWasteManuallyEdited(false);
    setQuoteInfo((prev) => ({
      ...prev,
      linkMode: "ticket",
      jobTicketId: nextJobTicketId,
    }));
    setJobTicketPickerOpen(false);
  }, [initialJobTicketId]);

  useEffect(() => {
    if (!initialCustomerId) {
      initialCustomerAppliedRef.current = "";
      return;
    }
    const nextCustomerId = String(initialCustomerId);
    if (initialCustomerAppliedRef.current === nextCustomerId || !customers.length) return;
    const customer = customers.find((item) => String(item.id) === nextCustomerId);
    if (!customer) return;
    initialCustomerAppliedRef.current = nextCustomerId;
    setActiveTab("pricing");
    setQuoteInfo((prev) => ({
      ...prev,
      linkMode: prev.jobTicketId ? prev.linkMode : "manual",
    }));
    selectCustomer(customer);
  }, [initialCustomerId, customers.length]);

  useEffect(() => {
    let alive = true;
    const ticketId = String(quoteInfo.jobTicketId || "");
    if (!ticketId || jobTickets.some((ticket) => String(ticket.id) === ticketId)) return undefined;
    if (selectedJobTicketRequestRef.current === ticketId) return undefined;
    selectedJobTicketRequestRef.current = ticketId;
    if (!jobTickets.length) setJobTicketLoadState("loading");
    requestApi(`job-tickets/${ticketId}`)
      .then((ticket) => {
        if (!alive) return;
        setJobTickets((prev) => mergeJobTicketRows(prev, ticket ? [ticket] : []));
        setJobTicketLoadState("ready");
      })
      .catch(() => {
        if (!alive) return;
        selectedJobTicketRequestRef.current = "";
        setJobTicketLoadState("error");
      });
    return () => {
      alive = false;
    };
  }, [quoteInfo.jobTicketId, jobTickets]);

  useEffect(() => {
    if (!jobTicketPickerOpen) return undefined;
    let alive = true;
    const requestId = jobTicketRequestRef.current + 1;
    jobTicketRequestRef.current = requestId;
    const timerId = window.setTimeout(() => {
      setJobTicketLoadState("loading");
      fetchCollection("job-tickets", {
        search: jobTicketSearch.trim(),
        ordering: "job_name,ticket_number",
        pageSize: 50,
        fetchAll: false,
      })
        .then((payload) => {
          if (!alive || jobTicketRequestRef.current !== requestId) return;
          setJobTickets((prev) => mergeJobTicketRows(prev, payload.results ?? []));
          setJobTicketLoadState("ready");
        })
        .catch(() => {
          if (!alive || jobTicketRequestRef.current !== requestId) return;
          setJobTicketLoadState("error");
        });
    }, jobTicketSearch.trim() ? 220 : 0);

    return () => {
      alive = false;
      window.clearTimeout(timerId);
    };
  }, [jobTicketPickerOpen, jobTicketSearch]);

  useEffect(() => {
    if (!selectedMaterial) return;
    setForm((prev) => ({
      ...prev,
      msiCost: String(selectedMaterial.calculatedMsiCost),
      unitType: selectedMaterial.unitType || prev.unitType,
    }));
  }, [selectedMaterial?.id, selectedMaterial?.calculatedMsiCost, selectedMaterial?.unitType, selectedMaterial?.width_inches]);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      colorMsiCost: String(rateCost(quoteRates, "color")),
      coatingMsiCost: String(rateCost(quoteRates, "coating")),
    }));
  }, [quoteRates]);

  useEffect(() => {
    const recipeId = jobTicketRecipeId(selectedJobTicket);
    if (!recipeId) {
      setJobPrintPlates([]);
      setJobPrintStations([]);
      setJobPrintState(selectedJobTicket ? "ready" : "idle");
      return undefined;
    }

    let alive = true;
    setJobPrintState("loading");
    Promise.all([
      fetchCollection("print-plates", { filters: { recipe: recipeId }, pageSize: 100, fetchAll: true }),
      fetchCollection("print-stations", { filters: { recipe: recipeId }, pageSize: 250, fetchAll: true }),
    ])
      .then(([platePayload, stationPayload]) => {
        if (!alive) return;
        setJobPrintPlates(platePayload.results ?? []);
        setJobPrintStations(stationPayload.results ?? []);
        setJobPrintState("ready");
      })
      .catch(() => {
        if (!alive) return;
        setJobPrintPlates([]);
        setJobPrintStations([]);
        setJobPrintState("error");
      });

    return () => {
      alive = false;
    };
  }, [selectedJobTicket?.id, selectedJobTicket?.recipe]);

  useEffect(() => {
    if (quoteInfo.linkMode !== "ticket" || !selectedJobTicket) return;
    const dimensions = jobTicketQuoteDimensions(selectedJobTicket);
    const quantity = jobTicketQuoteQuantity(selectedJobTicket);
    const material = jobTicketMaterialMatch;
    setForm((prev) => {
      const nextCoreSize = dimensionInputValue(selectedJobTicket.core_size_inches) || prev.coreSize;
      const materialTargetPercent = material ? materialTargetPricingPercent(material, prev.pricingMode) : "";
      return {
        ...prev,
        labelWidth: dimensions.width,
        labelLength: dimensions.length,
        gap: dimensions.gap,
        quantity: quantity.quantity,
        unitType: selectedJobTicket.unit_type || material?.unitType || prev.unitType,
        finishingType: selectedJobTicket.finishing_type || prev.finishingType,
        coreSize: nextCoreSize,
        labelsPerUnit: quantityInputValue(selectedJobTicket.labels_per_unit) || prev.labelsPerUnit,
        labelsPerCarton: quantityInputValue(selectedJobTicket.labels_per_carton || selectedJobTicket.units_per_carton) || prev.labelsPerCarton,
        selectedMaterialId: material?.id || prev.selectedMaterialId,
        msiCost: material ? String(material.calculatedMsiCost) : prev.msiCost,
        pricingPercent: material && materialTargetPercent
          ? pricingPercentWithCoreSurcharge(materialTargetPercent, prev.pricingMode, nextCoreSize)
          : applyMarkupPointDelta(prev.pricingPercent, prev.pricingMode, coreMarkupDelta(prev.coreSize, nextCoreSize)),
        colorCount: jobPrintState === "ready" ? String(jobPrintColorCount) : prev.colorCount,
      };
    });
  }, [
    quoteInfo.linkMode,
    selectedJobTicket?.id,
    jobTicketMaterialMatch?.id,
    jobTicketMaterialMatch?.calculatedMsiCost,
    jobTicketMaterialMatch?.unitType,
    jobTicketMaterialMatch?.baseMarkupPercent,
    jobTicketMaterialMatch?.targetMarkupPercent,
    jobPrintState,
    jobPrintColorCount,
  ]);

  useEffect(() => {
    if (quoteInfo.linkMode !== "ticket" || !selectedJobTicket) return;
    const linkedCustomer = customers.find((customer) => String(customer.id) === String(selectedJobTicket.customer || ""));
    const customerName = linkedCustomer?.name || selectedJobTicket.customer_display || selectedJobTicket.customer_name || "";
    setQuoteInfo((prev) => ({
      ...prev,
      itemName: prev.itemName || jobTicketPartNumber(selectedJobTicket),
      jobName: selectedJobTicket.job_name || prev.jobName,
      productCode: selectedJobTicket.product_code || prev.productCode,
      customerId: prev.customerCleared ? "" : linkedCustomer?.id ? String(linkedCustomer.id) : prev.customerId,
      customerCode: prev.customerCleared ? "" : linkedCustomer?.customer_code || prev.customerCode,
      customerName: prev.customerCleared ? "" : customerName || prev.customerName,
      contactName: prev.customerCleared ? "" : linkedCustomer?.contact_name || prev.contactName,
      contactEmail: prev.customerCleared ? "" : linkedCustomer?.email || prev.contactEmail,
      customerAddress: prev.customerCleared ? "" : linkedCustomer ? customerQuoteAddress(linkedCustomer) : prev.customerAddress,
    }));
    if (linkedCustomer && !quoteInfo.customerCleared) setCustomerSearch(customerPickerLabel(linkedCustomer));
  }, [quoteInfo.linkMode, quoteInfo.customerCleared, selectedJobTicket?.id, selectedJobTicket?.customer, customers.length]);

  useEffect(() => {
    if (!selectedJobTicket || jobTicketPickerOpen || jobTicketSearch) return;
    setJobTicketSearch(jobTicketPartNumber(selectedJobTicket));
  }, [selectedJobTicket?.id, jobTicketPickerOpen, jobTicketSearch]);

  function updateField(name, value) {
    if (name === "pricingMode") {
      saveQuotePreference(currentUser, { pricingMode: value });
    }
    if (name === "wastePercent") {
      setWasteManuallyEdited(true);
    } else if (wasteRecommendationFieldNames.has(name)) {
      setWasteManuallyEdited(false);
    }
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      if (name === "pricingMode") {
        next.pricingPercent = convertPricingPercent(prev.pricingPercent, prev.pricingMode, value);
      }
      if (name === "coreSize") {
        next.pricingPercent = applyMarkupPointDelta(
          prev.pricingPercent,
          prev.pricingMode,
          coreMarkupDelta(prev.coreSize, value)
        );
      }
      return next;
    });
  }

  function updateQuoteInfo(name, value) {
    if (name === "jobTicketId" || name === "linkMode") {
      setWasteManuallyEdited(false);
    }
    if (name === "linkMode") {
      if (value === "manual") setJobTicketPickerOpen(false);
      if (value === "ticket") setCustomerPickerOpen(false);
    }
    setQuoteInfo((prev) => ({ ...prev, [name]: value }));
  }

  function selectCustomer(customer) {
    if (!customer) return;
    setQuoteInfo((prev) => ({
      ...prev,
      customerCleared: false,
      customerId: String(customer.id),
      customerCode: customer.customer_code || "",
      customerName: customer.name || prev.customerName,
      contactName: customer.contact_name || prev.contactName,
      contactEmail: customer.email || prev.contactEmail,
      customerAddress: customerQuoteAddress(customer) || prev.customerAddress,
    }));
    setCustomerSearch(customerPickerLabel(customer));
    setCustomerPickerOpen(false);
  }

  function clearCustomerSelection() {
    setQuoteInfo((prev) => ({
      ...prev,
      customerCleared: true,
      customerId: "",
      customerCode: "",
      customerName: "",
      contactName: "",
      contactEmail: "",
      customerAddress: "",
    }));
    setCustomerSearch("");
    setCustomerPickerOpen(false);
  }

  function updateCustomerDraft(name, value) {
    setCustomerDraft((prev) => ({ ...prev, [name]: value }));
  }

  async function createQuoteCustomer() {
    const name = customerDraft.name.trim();
    if (!name || customerSaving) return;
    setCustomerSaving(true);
    try {
      const quoteAddress = customerDraft.quotation_address.trim();
      const saved = await createRecord("customers", {
        is_active: customerDraft.is_active !== false,
        name,
        customer_code: customerDraft.customer_code.trim(),
        contact_name: customerDraft.contact_name.trim(),
        phone: customerDraft.phone.trim(),
        email: customerDraft.email.trim(),
        address_line_1: customerDraft.address_line_1.trim(),
        address_line_2: customerDraft.address_line_2.trim(),
        address_line_3: customerDraft.address_line_3.trim(),
        city: customerDraft.city.trim(),
        state: customerDraft.state.trim(),
        postal_code: customerDraft.postal_code.trim(),
        country: customerDraft.country.trim(),
      });
      setCustomers((prev) => [saved, ...prev.filter((customer) => String(customer.id) !== String(saved.id))]);
      selectCustomer(saved);
      if (quoteAddress) setQuoteInfo((prev) => ({ ...prev, customerAddress: quoteAddress }));
      setCustomerDraft(emptyCustomerDraft);
      setCustomerCreateOpen(false);
    } catch (error) {
      window.alert(`Could not create customer: ${error.message}`);
    } finally {
      setCustomerSaving(false);
    }
  }

  function selectJobTicket(ticket) {
    setWasteManuallyEdited(false);
    setQuoteInfo((prev) => ({
      ...prev,
      customerCleared: false,
      jobTicketId: String(ticket.id),
      itemName: jobTicketPartNumber(ticket),
      jobName: ticket.job_name || ticket.product_name || "",
      productCode: ticket.product_code || "",
    }));
    setJobTicketSearch(jobTicketPartNumber(ticket));
    setJobTicketPickerOpen(false);
  }

  function openJobTicketSearch() {
    setJobTicketPickerOpen(true);
  }

  function changeJobTicketSearch() {
    setJobTicketSearch("");
    setJobTicketPickerOpen(true);
  }

  function applyRecommendedWaste() {
    setWasteManuallyEdited(false);
    setForm((prev) => ({ ...prev, wastePercent: percentInputValue(pricing.recommendedWastePercent) }));
  }

  async function updateQuoteRate(key, field, value) {
    const current = quoteRates.find((rate) => rate.key === key) || quoteRateDefaults.find((rate) => rate.key === key);
    const next = { ...current, [field]: value };
    const saved = next.id
      ? await updateRecord("quote-cost-rates", next.id, quoteCostRatePayload(next))
      : await createRecord("quote-cost-rates", quoteCostRatePayload(next));
    setQuoteRates((prev) => {
      const exists = prev.some((rate) => rate.key === key);
      return exists ? prev.map((rate) => rate.key === key ? saved : rate) : [...prev, saved];
    });
  }

  function updateQuoteRateLocal(key, field, value) {
    setQuoteRates((prev) => {
      const current = prev.find((rate) => rate.key === key) || quoteRateDefaults.find((rate) => rate.key === key);
      const next = { ...current, [field]: value };
      return prev.some((rate) => rate.key === key)
        ? prev.map((rate) => rate.key === key ? next : rate)
        : [...prev, next];
    });
  }

  function updateMaterialSelection(value) {
    const material = materialOptions.find((item) => String(item.id) === String(value));
    const materialTargetPercent = material ? materialTargetPricingPercent(material, form.pricingMode) : "";
    setForm((prev) => ({
      ...prev,
      selectedMaterialId: value,
      unitType: material?.unitType || prev.unitType,
      msiCost: material ? String(material.calculatedMsiCost) : prev.msiCost,
      pricingPercent: material && materialTargetPercent
        ? pricingPercentWithCoreSurcharge(materialTargetPercent, prev.pricingMode, prev.coreSize)
        : prev.pricingPercent,
    }));
  }

  function useCandidate(numberAcross) {
    setForm((prev) => ({ ...prev, acrossMode: "manual", numberAcross: String(numberAcross) }));
  }

  function buildCurrentQuoteItem(itemId = "") {
    const itemName = quoteInfo.itemName.trim() || (quoteInfo.linkMode === "ticket"
      ? selectedJobTicket?.job_name || selectedJobTicket?.product_name || "Job ticket item"
      : quoteInfo.jobName || "Manual quote item");
    return {
      id: itemId || makeId("item"),
      itemName,
      materialName: selectedMaterial?.name || "Manual MSI Cost",
      materialId: selectedMaterial?.id || "",
      materialSource: selectedMaterial?.sourceType || "manual",
      materialComponents: selectedMaterial?.componentLabel || "",
      form: { ...form, repeat: String(pricing.repeat) },
      pricing: { ...pricing },
    };
  }

  function addQuoteItem() {
    if (!pricing.fits || pricing.sellPrice <= 0) return;
    setQuoteItemsDraft((prev) => [...prev, buildCurrentQuoteItem()]);
  }

  function removeQuoteItem(id) {
    setQuoteItemsDraft((prev) => prev.filter((item) => item.id !== id));
  }

  function buildQuoteRecord() {
    const ticket = quoteInfo.linkMode === "ticket" ? selectedJobTicket : null;
    const ticketCustomer = quoteInfo.customerCleared
      ? null
      : customers.find((customer) => String(customer.id) === String(ticket?.customer || ""));
    const recordCustomer = selectedCustomer || ticketCustomer || null;
    const customerName = recordCustomer?.name || (quoteInfo.customerCleared ? "" : ticket?.customer_display || ticket?.customer_name) || quoteInfo.customerName;
    const jobName = quoteInfo.jobName || ticket?.job_name || ticket?.product_name || quoteInfo.itemName;
    const productCode = quoteInfo.productCode || ticket?.product_code || "";
    const preparedBy = currentUser?.name || quoteInfo.preparedBy;
    const quoteCompany = quoteCompanyForKey(currentUser?.quoteCompany);
    const items = quoteEditContext?.id
      ? [buildCurrentQuoteItem(quoteEditContext.primaryItemId), ...quoteItemsDraft]
      : quoteItemsDraft.length ? quoteItemsDraft : [buildCurrentQuoteItem()];
    const totals = quoteTotals({ form: { items }, pricing: { items } });
    const createdAt = quoteEditContext?.createdAt || new Date().toISOString();
    const salesQuote = {
      customerId: recordCustomer?.id ? String(recordCustomer.id) : quoteInfo.customerId,
      customerCode: recordCustomer?.customer_code || quoteInfo.customerCode,
      clientPo: quoteInfo.clientPo.trim(),
      customerAddress: quoteInfo.customerAddress.trim() || customerQuoteAddress(recordCustomer),
      quoteExpirationDate: quoteInfo.quoteExpirationDate || quoteFutureDateInput(createdAt),
      unitOfMeasure: quoteInfo.unitOfMeasure || quoteDefaultUnitOfMeasure,
      quoteCompany: quoteCompany.key,
    };
    const record = {
      id: makeId("quote"),
      quoteNumber: quoteNumber(),
      createdAt,
      preparedByUserId: currentUser?.id || "",
      preparedByUsername: currentUser?.username || "",
      preparedByName: preparedBy,
      preparedByRole: currentUser?.role || "",
      quoteCompany: quoteCompany.key,
      customerId: recordCustomer?.id || quoteInfo.customerId || null,
      jobTicketId: ticket?.id ?? null,
      jobTicketNumber: ticket?.ticket_number ?? "",
      customerName,
      jobName,
      productCode,
      contactName: quoteInfo.contactName || recordCustomer?.contact_name || "",
      contactEmail: quoteInfo.contactEmail || recordCustomer?.email || "",
      preparedBy,
      approvalStatus: "pending",
      approvalAt: null,
      approvalByUserId: "",
      approvalByName: "",
      approvalByRole: "",
      approvalNote: "",
      quoteWorkflowStatus: "active",
      processedAt: null,
      processedByUserId: "",
      processedByName: "",
      processedByRole: "",
      lastEditedAt: null,
      lastEditedByUserId: "",
      lastEditedByName: "",
      lastEditedByRole: "",
      editCount: 0,
      notes: quoteInfo.notes,
      materialName: items.length === 1 ? items[0].materialName : "Multiple materials",
      materialSource: items.length === 1 ? items[0].materialSource : "multiple",
      materialComponents: items.length === 1 ? items[0].materialComponents : `${items.length} quoted items`,
      form: { ...form, itemName: quoteInfo.itemName.trim(), repeat: String(pricing.repeat), items, salesQuote },
      pricing: { ...totals, items },
    };
    return record;
  }

  async function generateQuote() {
    const record = buildQuoteRecord();
    if (quoteEditContext?.id) {
      const previous = savedQuotes.find((quote) => String(quote.id) === String(quoteEditContext.id)) || {};
      const editedAt = new Date().toISOString();
      const nextRecord = {
        ...previous,
        ...record,
        id: quoteEditContext.id,
        quoteNumber: quoteEditContext.quoteNumber || previous.quoteNumber || record.quoteNumber,
        createdAt: previous.createdAt || record.createdAt,
        preparedByUserId: previous.preparedByUserId || record.preparedByUserId,
        preparedByUsername: previous.preparedByUsername || record.preparedByUsername,
        preparedByName: previous.preparedByName || record.preparedByName,
        preparedByRole: previous.preparedByRole || record.preparedByRole,
        preparedBy: previous.preparedBy || record.preparedBy,
        approvalStatus: "pending",
        approvalAt: null,
        approvalByUserId: "",
        approvalByName: "",
        approvalByRole: "",
        approvalNote: `Edited by ${currentUser?.name || "user"} and ready for manager review.`,
        quoteWorkflowStatus: "active",
        processedAt: null,
        processedByUserId: "",
        processedByName: "",
        processedByRole: "",
        lastEditedAt: editedAt,
        lastEditedByUserId: currentUser?.id || "",
        lastEditedByName: currentUser?.name || "",
        lastEditedByRole: currentUser?.role || "",
        editCount: Number(previous.editCount || previous.edit_count || 0) + 1,
      };
      const saved = await updateRecord("quote-records", quoteEditContext.id, quoteRecordPayload(nextRecord));
      setSavedQuotes((prev) => prev.map((quote) => String(quote.id) === String(saved.id) ? saved : quote));
      setSelectedQuoteId(saved.id);
      setQuoteWorkflowFilter("active");
      setQuoteStatusFilter("pending");
      setQuotePersonFilter(currentUserQuoteKey(currentUser));
      setQuoteEditContext(null);
      setQuoteItemsDraft([]);
      setActiveTab("quotes");
      return;
    }

    const saved = await createRecord("quote-records", quoteRecordPayload(record));
    setSavedQuotes((prev) => [saved, ...prev]);
    setSelectedQuoteId(saved.id);
    setQuoteWorkflowFilter("active");
    setQuotePersonFilter(currentUserQuoteKey(currentUser));
    setQuoteItemsDraft([]);
    setActiveTab("quotes");
  }

  function quoteLinkFor(quote) {
    if (typeof window === "undefined") return quote?.quoteNumber || "Saved Quotes";
    const url = new URL(window.location.href);
    url.searchParams.delete("quoteId");
    url.searchParams.delete("quoteView");
    url.hash = "saved-quotes";
    return url.toString();
  }

  async function copyApprovalLink(quote, { quiet = false } = {}) {
    if (!quote || typeof navigator === "undefined" || !navigator.clipboard) {
      if (!quiet) setQuoteActionError("This browser could not copy the approval link automatically.");
      return false;
    }
    const link = quoteLinkFor(quote);
    try {
      await navigator.clipboard.writeText(link);
      if (!quiet) {
        setQuoteActionError("");
        setQuoteActionNotice("Approval link copied.");
      }
      return true;
    } catch {
      if (!quiet) setQuoteActionError("This browser blocked copying. Select the link in the email and copy it manually.");
      return false;
    }
  }

  function requestQuoteAction(type, quote, target = "") {
    if (!quote) return;
    const workflowLabel = target === "processed" ? "Move to Processed" : "Reopen Active";
    const copy = {
      approve: {
        title: "Approve Quote?",
        message: `${quote.quoteNumber} will be marked approved and ready to use.`,
        confirmLabel: "Approve Quote",
        tone: "good",
      },
      reject: {
        title: "Reject Quote?",
        message: `${quote.quoteNumber} will be marked rejected so it can be corrected and resubmitted.`,
        confirmLabel: "Reject Quote",
        tone: "warning",
      },
      workflow: {
        title: `${workflowLabel}?`,
        message: target === "processed"
          ? `${quote.quoteNumber} will leave the active quote queue and move into Processed.`
          : `${quote.quoteNumber} will move back into the active quote queue.`,
        confirmLabel: workflowLabel,
        tone: target === "processed" ? "good" : "warning",
      },
      delete: {
        title: "Delete Quote?",
        message: `${quote.quoteNumber} will be permanently removed from saved quotes.`,
        confirmLabel: "Delete Quote",
        tone: "danger",
      },
      email: {
        title: "Request Quote Approval?",
        message: `Your email app will open a clean approval request for ${quote.quoteNumber} with the quote link clearly shown in the body.`,
        confirmLabel: "Open Approval Email",
        tone: "good",
      },
    }[type];
    if (!copy) return;
    setQuoteConfirm({ type, quoteId: quote.id, target, ...copy });
  }

  async function runConfirmedQuoteAction() {
    if (!quoteConfirm) return;
    const action = quoteConfirm;
    const quote = savedQuotes.find((item) => String(item.id) === String(action.quoteId)) || selectedQuote;
    setQuoteConfirm(null);
    if (!quote) return;
    if (action.type === "approve") {
      await updateQuoteApproval(quote, "approved");
      return;
    }
    if (action.type === "reject") {
      await updateQuoteApproval(quote, "rejected");
      return;
    }
    if (action.type === "workflow") {
      await updateQuoteWorkflow(quote, action.target);
      return;
    }
    if (action.type === "delete") {
      await deleteQuote(quote.id);
      return;
    }
    if (action.type === "email") {
      await emailQuote(quote);
    }
  }

  async function updateQuoteApproval(quote, approvalStatus) {
    if (!quote || !canApproveQuotes || approvalSavingId) return;
    setQuoteActionError("");
    setApprovalSavingId(quote.id);
    const actionLabel = approvalStatus === "approved" ? "Approved" : "Rejected";
    const nextQuote = {
      ...quote,
      approvalStatus,
      approvalAt: new Date().toISOString(),
      approvalByUserId: currentUser?.id || "",
      approvalByName: currentUser?.name || "",
      approvalByRole: currentUser?.role || "",
      approvalNote: `${actionLabel} by ${currentUser?.name || "authorized user"}.`,
    };
    try {
      const saved = await updateRecord("quote-records", quote.id, quoteRecordPayload(nextQuote));
      setSavedQuotes((prev) => prev.map((item) => String(item.id) === String(saved.id) ? saved : item));
      setSelectedQuoteId(saved.id);
    } catch (error) {
      setQuoteActionError(error.message || "Could not update quote approval.");
    } finally {
      setApprovalSavingId("");
    }
  }

  async function updateQuoteWorkflow(quote, workflowStatus) {
    if (!quote || approvalSavingId) return;
    setQuoteActionError("");
    setApprovalSavingId(quote.id);
    const processed = workflowStatus === "processed";
    const nextQuote = {
      ...quote,
      quoteWorkflowStatus: workflowStatus,
      processedAt: processed ? new Date().toISOString() : null,
      processedByUserId: processed ? currentUser?.id || "" : "",
      processedByName: processed ? currentUser?.name || "" : "",
      processedByRole: processed ? currentUser?.role || "" : "",
    };
    try {
      const saved = await updateRecord("quote-records", quote.id, quoteRecordPayload(nextQuote));
      setSavedQuotes((prev) => prev.map((item) => String(item.id) === String(saved.id) ? saved : item));
      setSelectedQuoteId(saved.id);
      setQuoteWorkflowFilter("active");
    } catch (error) {
      setQuoteActionError(error.message || "Could not update quote workflow.");
    } finally {
      setApprovalSavingId("");
    }
  }

  function loadQuoteForEdit(quote) {
    if (!quote) return;
    const items = quoteItems(quote);
    const primaryItem = items[0] || null;
    const sourceForm = primaryItem?.form || quote.form || {};
    const sourcePricing = primaryItem?.pricing || quote.pricing || {};
    const salesInfo = quoteSalesInfo(quote);
    const nextForm = {
      ...initialForm,
      ...sourceForm,
      selectedMaterialId: sourceForm.selectedMaterialId || primaryItem?.materialId || "manual",
      repeat: sourceForm.repeat || initialForm.repeat,
    };
    if (
      quoteCoreHasMarkupSurcharge(nextForm.coreSize) &&
      Number(sourcePricing.coreMarkupSurchargePercent || 0) > 0 &&
      !sourcePricing.coreMarkupSurchargeAppliedToInput
    ) {
      nextForm.pricingPercent = pricingPercentWithCoreSurcharge(nextForm.pricingPercent, nextForm.pricingMode, nextForm.coreSize);
    }
    const linkMode = quote.jobTicketId ? "ticket" : "manual";

    setQuoteActionError("");
    setQuoteEditContext({
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      primaryItemId: primaryItem?.id || "",
      createdAt: quote.createdAt || "",
      loadedAt: new Date().toISOString(),
      editCount: Number(quote.editCount || quote.edit_count || 0),
    });
    setWasteManuallyEdited(true);
    setForm(nextForm);
    setQuoteItemsDraft(items.slice(1).map((item) => ({ ...item, id: item.id || makeId("item") })));
    setQuoteInfo({
      ...emptyQuoteInfo,
      linkMode,
      jobTicketId: quote.jobTicketId ? String(quote.jobTicketId) : "",
      customerId: salesInfo.customerId ? String(salesInfo.customerId) : quote.customerId ? String(quote.customerId) : "",
      customerCode: salesInfo.customerCode || quote.customerCode || "",
      customerName: quote.customerName || "",
      itemName: primaryItem?.itemName || quote.form?.itemName || quote.jobName || "",
      jobName: quote.jobName || "",
      productCode: quote.productCode || "",
      contactName: quote.contactName || "",
      contactEmail: quote.contactEmail || "",
      clientPo: salesInfo.clientPo || "",
      customerAddress: salesInfo.customerAddress || "",
      quoteExpirationDate: salesInfo.quoteExpirationDate || quoteFutureDateInput(quote.createdAt),
      unitOfMeasure: salesInfo.unitOfMeasure || quoteDefaultUnitOfMeasure,
      preparedBy: currentUser?.name || quoteInfo.preparedBy,
      notes: quote.notes || "",
    });
    setCustomerSearch(quote.customerName || salesInfo.customerCode || "");
    setJobTicketSearch(quote.jobTicketNumber || quote.jobName || "");
    setCustomerPickerOpen(false);
    setJobTicketPickerOpen(false);
    setActiveTab("pricing");
  }

  function cancelQuoteEdit() {
    setQuoteEditContext(null);
    setQuoteItemsDraft([]);
  }

  async function emailQuote(quote) {
    if (!quote) return;
    setQuoteActionError("");
    if (typeof window === "undefined") return;
    const link = quoteLinkFor(quote);
    await copyApprovalLink(quote, { quiet: true });
    const subject = encodeURIComponent(quoteEmailSubject(quote));
    const body = encodeURIComponent(quoteEmailBody(quote, link));
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  async function deleteQuote(id) {
    await deleteRecord("quote-records", id);
    setSavedQuotes((prev) => prev.filter((quote) => quote.id !== id));
    setSelectedQuoteId((current) => current === id ? null : current);
  }

  function printQuote(quote) {
    if (!quote) return;
    const items = quoteItems(quote);
    const totals = quoteTotals(quote);
    const salesInfo = quoteSalesInfo(quote);
    const quoteCompany = quoteCompanyForQuote(quote);
    const quoteLines = quoteForLines(quote);
    const dateRows = quoteDocumentDateRows(quote);
    const terms = compactQuoteTerms();
    const html = `<!doctype html>
<html>
<head>
<title>${escapeHtml(quote.quoteNumber)}</title>
<style>
@page{size:letter;margin:.35in}
*{box-sizing:border-box}
body{margin:0;background:#f3f4f6;color:#111827;font-family:Arial,sans-serif}
.page{width:8.5in;min-height:11in;margin:0 auto;background:#fff;padding:.34in;box-sizing:border-box}
.head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;border-bottom:2px solid #0b1f5e;padding-bottom:10px}
.brand{min-width:0;flex:1}.brand img{max-width:${quoteCompany.printLogoWidth};height:auto;display:block}.title{text-align:right;min-width:1.75in}.title span{display:block;color:#111827;font-size:16px;font-weight:700}.title strong{display:block;margin-top:4px;font-size:12px;color:#344054}.title em{display:block;margin-top:18px;color:#667085;font-size:12px;font-style:normal;font-weight:700;text-transform:uppercase}.title b{display:block;margin-top:3px;font-size:18px}
.meta{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,1fr);gap:14px;margin-top:18px}.meta.date-only{grid-template-columns:minmax(280px,.62fr);justify-content:end}.quote-for{min-height:84px}.quote-for span,.date-card span{display:block;color:#344054;font-size:12px;font-weight:700}.quote-for strong{display:block;margin-top:10px;font-size:13px}.quote-for em{display:block;margin-top:3px;color:#111827;font-size:12px;font-style:normal}.date-card{border:1.4px solid #111827}.date-card div{display:grid;grid-template-columns:104px minmax(0,1fr);border-top:1px solid #111827;min-height:28px}.date-card div:first-child{border-top:0}.date-card span{padding:6px 7px;border-right:1px solid #111827}.date-card strong{min-width:0;padding:6px 7px;font-size:12px;overflow-wrap:anywhere}
.item{margin-top:18px}.sales-table{width:100%;border-collapse:collapse;table-layout:fixed;border:1px solid #111827}.sales-table th{background:#111827;color:#fff;font-size:10.5px;text-align:left;padding:7px 6px;line-height:1.15}.sales-table th:nth-child(n+2),.sales-table td:nth-child(n+2){text-align:right}.sales-table td{vertical-align:top;border-top:1px solid #111827;border-left:1px solid #d1d5db;padding:8px 6px;font-size:10.5px;line-height:1.28;overflow-wrap:anywhere;word-break:break-word}.sales-table td:first-child{border-left:0}.sales-table td:nth-child(n+2){overflow-wrap:normal;word-break:normal}.sales-table th:nth-child(1){width:47%}.sales-table th:nth-child(2){width:11%}.sales-table th:nth-child(3){width:7%}.sales-table th:nth-child(4){width:17%}.sales-table th:nth-child(5){width:18%}.sales-table strong{display:block;font-size:11px;line-height:1.22;overflow-wrap:anywhere}.sales-table span{display:block;margin-top:4px;font-size:10.5px;line-height:1.25;overflow-wrap:anywhere}.sales-table tfoot td{background:#f3f4f6;font-weight:700}.sales-table tfoot td:first-child{text-align:right}
.signature{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:18px}.sig-box{padding:10px 12px}.sig-row{display:grid;grid-template-columns:128px 1fr;align-items:end;gap:10px;min-height:26px;margin-bottom:8px;font-size:12px}.sig-row span{font-weight:700;white-space:nowrap}.sig-row b{display:block;min-height:18px;border-bottom:1.2px solid #111827;font-size:12px}.sig-box strong{display:block;margin-top:8px;font-size:12px;line-height:1.35}.contact{border:1.3px solid #111827;background:#f2f2f2;padding:16px 14px;text-align:right}.contact strong,.contact span,.contact em{display:block}.contact strong{font-size:12px;line-height:1.35}.contact span{margin-top:16px;font-size:12px;font-weight:700}.contact em{margin-top:8px;font-size:12px;font-style:normal}
.terms{margin-top:16px;border-top:1px solid #d1d5db;padding-top:10px}.terms p{margin:0 0 8px;font-size:12px;line-height:1.35;white-space:pre-wrap}.terms ul{margin:0;padding-left:14px}.terms li{margin:0 0 5px;font-size:12px;line-height:1.32}
@media print{body{background:white;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{width:auto;max-width:7.8in;min-height:auto;margin:0 auto;padding:0}.no-print{display:none}}
</style>
</head>
<body>
<main class="page">
<section class="head"><div class="brand"><img src="${escapeHtml(quoteCompany.logo)}" alt="${escapeHtml(quoteCompany.label)}"></div><div class="title"><span>Sales Quote</span><strong>${escapeHtml(quote.quoteNumber)}</strong><em>Total in US$</em><b>${escapeHtml(money(totals.sellPrice))}</b></div></section>
<section class="meta ${quoteLines.length ? "" : "date-only"}">
${quoteLines.length ? `<div class="quote-for"><span>Quotation for:</span>${quoteLines.map((line, index) => index === 0 ? `<strong>${escapeHtml(line)}</strong>` : `<em>${escapeHtml(line)}</em>`).join("")}</div>` : ""}
<div class="date-card">${dateRows.map(([label, value]) => `<div><span>${escapeHtml(label)}:</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>
</section>
<section class="item"><table class="sales-table"><thead><tr><th>Part Number &amp; Description</th><th>Qty</th><th>UoM</th><th>Per Unit US$</th><th>Extended US$</th></tr></thead><tbody>
${items.map((item) => `<tr><td><strong>${escapeHtml(clipText(quoteLinePartNumber(item, quote), 52))}</strong>${quoteLineDescriptionRows(item, quote).map((line) => `<span>${escapeHtml(clipText(line, 86))}</span>`).join("")}</td><td>${escapeHtml(quoteTableQuantity(item, salesInfo.unitOfMeasure))}</td><td>${escapeHtml(quoteTableUomLabel(salesInfo.unitOfMeasure))}</td><td>${escapeHtml(quoteTableUnitPrice(item, salesInfo.unitOfMeasure))}</td><td>${escapeHtml(money(Number(item.pricing?.sellPrice || 0)))}</td></tr>`).join("")}
</tbody><tfoot><tr><td colspan="4">Total in US$</td><td>${escapeHtml(money(totals.sellPrice))}</td></tr></tfoot></table>
</section>
<section class="signature"><div class="sig-box"><div class="sig-row"><span>Client P.O.</span><b>${escapeHtml(salesInfo.clientPo || "")}</b></div><div class="sig-row"><span>Authorized Signature</span><b></b></div><div class="sig-row"><span>Printed Name</span><b></b></div><div class="sig-row"><span>Title</span><b></b></div><div class="sig-row"><span>Date</span><b></b></div><strong>**Please provide both the Bill To and Ship To addresses when submitting your order.**</strong></div><div class="contact"><strong>${escapeHtml(quoteThankYouMessage)}</strong><span>${escapeHtml(quoteCompanyTeamName(quoteCompany))}</span>${quote.contactEmail ? `<em>${escapeHtml(quote.contactEmail)}</em>` : ""}</div></section>
<section class="terms">${quote.notes ? `<p>${escapeHtml(quote.notes)}</p>` : ""}<ul>${terms.map((term) => `<li>${escapeHtml(term)}</li>`).join("")}</ul></section>
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

  async function downloadQuotePdf(quote) {
    if (!quote) return;
    const items = quoteItems(quote);
    const totals = quoteTotals(quote);
    const salesInfo = quoteSalesInfo(quote);
    const quoteCompany = quoteCompanyForQuote(quote);
    const quoteLines = quoteForLines(quote);
    const dateRows = quoteDocumentDateRows(quote);
    const terms = compactQuoteTerms();
    const logoImage = await loadQuoteLogoForPdf(quoteCompany.logo);
    const commands = [];

    function pdfTextSize(size, minSize = 12) {
      return Math.max(minSize, size);
    }

    function estimatePdfTextWidth(value, size, font = "F1", minSize = 12) {
      const readableSize = pdfTextSize(size, minSize);
      const weight = font === "F2" ? 0.57 : 0.53;
      return String(value ?? "").length * readableSize * weight;
    }

    function fitPdfText(value, maxWidth, size, font = "F1", minSize = 12) {
      const textValue = String(value ?? "").replace(/\s+/g, " ").trim();
      if (!maxWidth || estimatePdfTextWidth(textValue, size, font, minSize) <= maxWidth) return textValue;
      const ellipsis = "...";
      let next = textValue;
      while (next.length > 0 && estimatePdfTextWidth(`${next}${ellipsis}`, size, font, minSize) > maxWidth) {
        next = next.slice(0, -1);
      }
      return next ? `${next.trimEnd()}${ellipsis}` : "";
    }

    function wrapPdfText(value, maxWidth, size, font = "F1", maxLines = 2, minSize = 12) {
      const words = String(value ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
      if (!words.length) return [];
      const lines = [];
      let current = "";
      words.forEach((word) => {
        const candidate = current ? `${current} ${word}` : word;
        if (estimatePdfTextWidth(candidate, size, font, minSize) <= maxWidth) {
          current = candidate;
          return;
        }
        if (current) lines.push(current);
        current = word;
      });
      if (current) lines.push(current);
      if (lines.length <= maxLines) return lines.map((lineText) => fitPdfText(lineText, maxWidth, size, font, minSize));
      const kept = lines.slice(0, maxLines);
      kept[maxLines - 1] = fitPdfText(lines.slice(maxLines - 1).join(" "), maxWidth, size, font, minSize);
      return kept;
    }

    function text(x, y, size, value, font = "F1", gray = 0, options = {}) {
      const readableSize = pdfTextSize(size, options.minSize ?? 12);
      const textValue = options.maxWidth ? fitPdfText(value, options.maxWidth, size, font, options.minSize ?? 12) : String(value ?? "");
      commands.push(`BT /${font} ${readableSize} Tf ${gray} g ${x} ${y} Td (${pdfEscape(textValue)}) Tj ET`);
    }

    function textRight(xRight, y, size, value, font = "F1", gray = 0, maxWidth = 80, minSize = 12) {
      const fitted = fitPdfText(value, maxWidth, size, font, minSize);
      const width = estimatePdfTextWidth(fitted, size, font, minSize);
      text(Math.max(42, xRight - width), y, size, fitted, font, gray, { minSize });
    }

    function textLines(x, y, size, lines, font = "F1", gray = 0, lineHeight = 15, minSize = 12) {
      lines.forEach((lineText, index) => {
        text(x, y - index * lineHeight, size, lineText, font, gray, { minSize });
      });
    }

    function line(x1, y1, x2, y2) {
      commands.push(`${x1} ${y1} m ${x2} ${y2} l S`);
    }

    function box(x, y, w, h) {
      commands.push(`${x} ${y} ${w} ${h} re S`);
    }

    function fillBox(x, y, w, h, gray = 0) {
      commands.push(`${gray} g ${x} ${y} ${w} ${h} re f 0 g`);
    }

    commands.push("0 g 0 G 0.08 w");
    if (logoImage) {
      const logoWidth = quoteCompany.pdfLogoWidth || 330;
      const logoHeight = Math.round((logoImage.height / logoImage.width) * logoWidth);
      commands.push(`q ${logoWidth} 0 0 ${logoHeight} 42 ${764 - logoHeight} cm /Logo Do Q`);
    } else {
      text(42, 748, 24, quoteCompany.label, "F2");
      text(42, 728, 8, quoteCompany.pdfFallbackSubtitle || "");
    }
    text(440, 748, 16, "Sales Quote", "F2");
    text(440, 731, 8, quote.quoteNumber);
    text(440, 704, 8, "Total in US$", "F2");
    text(440, 684, 18, money(totals.sellPrice), "F2");
    line(42, 670, 570, 670);

    if (quoteLines.length > 0) {
      text(42, 642, 10, "Quotation for:", "F2");
      quoteLines.slice(0, 5).forEach((lineText, index) => {
        text(42, 624 - index * 15, index === 0 ? 10 : 8, lineText, index === 0 ? "F2" : "F1", 0, { maxWidth: 260 });
      });
    }

    const dateBoxX = quoteLines.length > 0 ? 330 : 300;
    const dateBoxWidth = quoteLines.length > 0 ? 240 : 270;
    const dateRowHeight = 28;
    const dateBoxTop = 646;
    const dateBoxHeight = Math.max(dateRows.length, 1) * dateRowHeight;
    const dateBoxBottom = dateBoxTop - dateBoxHeight;
    const dateLabelWidth = 104;
    box(dateBoxX, dateBoxBottom, dateBoxWidth, dateBoxHeight);
    dateRows.forEach(([label, value], index) => {
      const rowTop = dateBoxTop - index * dateRowHeight;
      if (index > 0) line(dateBoxX, rowTop, dateBoxX + dateBoxWidth, rowTop);
      text(dateBoxX + 10, rowTop - 17, 8, `${label}:`, "F2", 0, { maxWidth: dateLabelWidth - 16 });
      text(dateBoxX + dateLabelWidth + 8, rowTop - 17, 8, value, "F1", 0, { maxWidth: dateBoxWidth - dateLabelWidth - 18 });
    });
    line(dateBoxX + dateLabelWidth, dateBoxBottom, dateBoxX + dateLabelWidth, dateBoxTop);

    const tableX = 42;
    const tableTop = 542;
    const tableWidth = 528;
    const headerHeight = 28;
    const rowHeight = 92;
    const totalRowHeight = 28;
    const visibleItems = items.slice(0, 1);
    const columns = [42, 308, 366, 404, 488, 570];
    const tableHeaderFontSize = 10;
    const tablePartFontSize = 11;
    const tableBodyFontSize = 10;
    const tableMinFontSize = 10;
    const tableBottom = tableTop - headerHeight - visibleItems.length * rowHeight - totalRowHeight;
    fillBox(tableX, tableTop - headerHeight, 528, headerHeight, 0);
    fillBox(tableX, tableBottom, tableWidth, totalRowHeight, 0.93);
    text(50, tableTop - 18, tableHeaderFontSize, "Part Number & Description", "F2", 1, { maxWidth: 246, minSize: tableMinFontSize });
    textRight(columns[2] - 8, tableTop - 18, tableHeaderFontSize, "Qty", "F2", 1, columns[2] - columns[1] - 12, tableMinFontSize);
    textRight(columns[3] - 8, tableTop - 18, tableHeaderFontSize, "UoM", "F2", 1, columns[3] - columns[2] - 12, tableMinFontSize);
    textRight(columns[4] - 8, tableTop - 18, tableHeaderFontSize, "Per Unit", "F2", 1, columns[4] - columns[3] - 12, tableMinFontSize);
    textRight(columns[5] - 8, tableTop - 18, tableHeaderFontSize, "Extended", "F2", 1, columns[5] - columns[4] - 12, tableMinFontSize);
    box(tableX, tableBottom, tableWidth, tableTop - tableBottom);
    columns.slice(1, -1).forEach((x) => line(x, tableBottom, x, tableTop));
    line(tableX, tableTop - headerHeight, 570, tableTop - headerHeight);

    visibleItems.forEach((item, index) => {
      const yTop = tableTop - headerHeight - index * rowHeight;
      const yBase = yTop - 16;
      const descriptionLines = [
        ...wrapPdfText(quoteLinePartNumber(item, quote), columns[1] - columns[0] - 16, tablePartFontSize, "F2", 1, tableMinFontSize),
        ...quoteLineDescriptionRows(item, quote)
          .slice(0, 4)
          .flatMap((lineText) => wrapPdfText(lineText, columns[1] - columns[0] - 16, tableBodyFontSize, "F1", 1, tableMinFontSize)),
      ].slice(0, 5);
      textLines(50, yBase, tablePartFontSize, descriptionLines.slice(0, 1), "F2", 0, 13, tableMinFontSize);
      textLines(50, yBase - 13, tableBodyFontSize, descriptionLines.slice(1), "F1", 0, 13, tableMinFontSize);
      textRight(columns[2] - 8, yBase, tableBodyFontSize, quoteTableQuantity(item, salesInfo.unitOfMeasure), "F1", 0, columns[2] - columns[1] - 12, tableMinFontSize);
      textRight(columns[3] - 8, yBase, tableBodyFontSize, quoteTableUomLabel(salesInfo.unitOfMeasure), "F1", 0, columns[3] - columns[2] - 12, tableMinFontSize);
      textRight(columns[4] - 8, yBase, tableBodyFontSize, quoteTableUnitPrice(item, salesInfo.unitOfMeasure), "F1", 0, columns[4] - columns[3] - 12, tableMinFontSize);
      textRight(columns[5] - 8, yBase, tableBodyFontSize, money(Number(item.pricing?.sellPrice || 0)), "F1", 0, columns[5] - columns[4] - 12, tableMinFontSize);
      line(tableX, yTop - rowHeight, 570, yTop - rowHeight);
    });
    if (items.length > visibleItems.length) text(50, tableBottom + 9, tableBodyFontSize, `${items.length - visibleItems.length} additional item(s) included in quote total.`, "F1", 0, { maxWidth: 300, minSize: tableMinFontSize });
    textRight(columns[4] - 8, tableBottom + 9, tableBodyFontSize, "Total in US$", "F2", 0, columns[4] - columns[3] - 12, tableMinFontSize);
    textRight(columns[5] - 8, tableBottom + 9, tableBodyFontSize, money(totals.sellPrice), "F2", 0, columns[5] - columns[4] - 12, tableMinFontSize);

    const signatureTop = tableBottom - 28;
    const signatureLeftX = 54;
    const signatureLineStart = 172;
    const signatureLineEnd = 306;
    const signatureRows = [
      ["Client P.O.", salesInfo.clientPo || ""],
      ["Authorized Signature", ""],
      ["Printed Name", ""],
      ["Title", ""],
      ["Date", ""],
    ];
    signatureRows.forEach(([label, value], index) => {
      const y = signatureTop - index * 20;
      text(signatureLeftX, y, 8, label, "F2", 0, { maxWidth: signatureLineStart - signatureLeftX - 12 });
      line(signatureLineStart, y - 2, signatureLineEnd, y - 2);
      if (value) text(signatureLineStart + 4, y + 1, 8, value, "F1", 0, { maxWidth: signatureLineEnd - signatureLineStart - 8 });
    });
    text(signatureLeftX, signatureTop - 108, 8, "**Please provide both the Bill To and Ship To addresses", "F2", 0, { maxWidth: 250 });
    text(signatureLeftX, signatureTop - 122, 8, "when submitting your order.**", "F2", 0, { maxWidth: 250 });

    fillBox(330, signatureTop - 126, 240, 136, 0.92);
    box(330, signatureTop - 126, 240, 136);
    textLines(348, signatureTop - 24, 10, wrapPdfText(quoteThankYouMessage, 204, 10, "F2", 2), "F2", 0, 15);
    textRight(552, signatureTop - 62, 8, quoteCompanyTeamName(quoteCompany), "F2", 0, 204);
    if (quote.contactEmail) textRight(552, signatureTop - 88, 8, quote.contactEmail, "F1", 0, 204);

    let termsY = signatureTop - 150;
    if (quote.notes) {
      wrapPdfText(quote.notes, 520, 8, "F1", 2).forEach((lineText) => {
        text(42, termsY, 8, lineText);
        termsY -= 14;
      });
      termsY -= 2;
    }
    terms.slice(0, 3).forEach((term) => {
      text(42, termsY, 6, `* ${term}`, "F1", 0, { maxWidth: 520 });
      termsY -= 14;
    });

    const stream = commands.join("\n");
    const contentObjectNumber = logoImage ? 7 : 6;
    const pageResources = logoImage
      ? "<< /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /Logo 6 0 R >> >>"
      : "<< /Font << /F1 4 0 R /F2 5 0 R >> >>";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources ${pageResources} /Contents ${contentObjectNumber} 0 R >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ];
    if (logoImage) {
      objects.push({
        parts: [
          `<< /Type /XObject /Subtype /Image /Width ${logoImage.width} /Height ${logoImage.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoImage.bytes.length} >>\nstream\n`,
          logoImage.bytes,
          "\nendstream",
        ],
      });
    }
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);

    const encoder = new TextEncoder();
    const chunks = [];
    const offsets = [0];
    let byteLength = 0;

    function appendPdfChunk(chunk) {
      const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
      chunks.push(bytes);
      byteLength += bytes.length;
    }

    appendPdfChunk("%PDF-1.4\n");
    objects.forEach((object, index) => {
      offsets.push(byteLength);
      appendPdfChunk(`${index + 1} 0 obj\n`);
      if (object.parts) {
        object.parts.forEach((part) => appendPdfChunk(part));
      } else {
        appendPdfChunk(object);
      }
      appendPdfChunk("\nendobj\n");
    });
    const xref = byteLength;
    appendPdfChunk(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
    offsets.slice(1).forEach((offset) => {
      appendPdfChunk(`${String(offset).padStart(10, "0")} 00000 n \n`);
    });
    appendPdfChunk(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);

    const pdfBytes = new Uint8Array(byteLength);
    let offset = 0;
    chunks.forEach((chunk) => {
      pdfBytes.set(chunk, offset);
      offset += chunk.length;
    });

    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${quote.quoteNumber}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function submitRaw(event) {
    event.preventDefault();
    if (!canManageQuoteMaterials) return;
    const name = rawForm.name.trim();
    if (!name) return;
    const next = {
      ...emptyRawForm,
      ...rawForm,
      id: editingRawId || makeId("raw"),
      name,
    };
    const saved = editingRawId
      ? await updateRecord("quote-raw-materials", next.id, rawMaterialPayload(next))
      : await createRecord("quote-raw-materials", rawMaterialPayload(next));
    setRawMaterials((prev) => {
      if (!editingRawId) return [saved, ...prev];
      return prev.map((raw) => raw.id === editingRawId ? saved : raw);
    });
    setRawForm(emptyRawForm);
    setEditingRawId(null);
  }

  async function submitFinished(event) {
    event.preventDefault();
    if (!canManageQuoteMaterials) return;
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
    const saved = editingFinishedId
      ? await updateRecord("quote-finished-materials", next.id, finishedMaterialPayload(next))
      : await createRecord("quote-finished-materials", finishedMaterialPayload(next));

    setFinishedMaterials((prev) => {
      if (!editingFinishedId) return [saved, ...prev];
      return prev.map((material) => material.id === editingFinishedId ? saved : material);
    });
    setForm((prev) => {
      const materialTargetPercent = materialTargetPricingPercent(saved, prev.pricingMode);
      return {
        ...prev,
        selectedMaterialId: saved.id,
        unitType: saved.unitType || prev.unitType,
        msiCost: String(calculateFinishedMaterialMsiCost(saved, rawMaterials, quoteRates)),
        pricingPercent: materialTargetPercent
          ? pricingPercentWithCoreSurcharge(materialTargetPercent, prev.pricingMode, prev.coreSize)
          : prev.pricingPercent,
      };
    });
    setFinishedForm(emptyFinishedForm);
    setEditingFinishedId(null);
    setActiveTab("pricing");
  }

  async function deleteRaw(id) {
    if (!canManageQuoteMaterials) return;
    await deleteRecord("quote-raw-materials", id);
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

  async function deleteFinished(id) {
    if (!canManageQuoteMaterials) return;
    await deleteRecord("quote-finished-materials", id);
    setFinishedMaterials((prev) => prev.filter((material) => material.id !== id));
    setForm((prev) => prev.selectedMaterialId === id ? { ...prev, selectedMaterialId: "manual" } : prev);
    if (editingFinishedId === id) {
      setEditingFinishedId(null);
      setFinishedForm(emptyFinishedForm);
    }
  }

  function useFinishedMaterial(material) {
    setForm((prev) => {
      const materialTargetPercent = materialTargetPricingPercent(material, prev.pricingMode);
      return {
        ...prev,
        selectedMaterialId: material.id,
        unitType: material.unitType || prev.unitType,
        msiCost: String(material.calculatedMsiCost),
        pricingPercent: materialTargetPercent
          ? pricingPercentWithCoreSurcharge(materialTargetPercent, prev.pricingMode, prev.coreSize)
          : prev.pricingPercent,
      };
    });
    setActiveTab("pricing");
  }

  function editFinishedMaterial(material) {
    if (!canManageQuoteMaterials) return;
    const { calculatedMsiCost, componentLabel, masterTypeLabel, ...editable } = material;
    setEditingFinishedId(material.id);
    setFinishedForm({ ...emptyFinishedForm, ...editable });
    setActiveTab("finished");
  }

  function cancelFinishedEdit() {
    setEditingFinishedId(null);
    setFinishedForm(emptyFinishedForm);
  }

  function editRawMaterial(raw) {
    if (!canManageQuoteMaterials) return;
    setEditingRawId(raw.id);
    setRawForm({ ...emptyRawForm, ...raw });
    setActiveTab("raw");
  }

  function cancelRawEdit() {
    setEditingRawId(null);
    setRawForm(emptyRawForm);
  }

  function renderCustomerAccountPanel() {
    return (
      <div className="quote-customer-picker">
        <label className="quote-ticket-search">
          <span>Customer Account</span>
          <div>
            <Search size={16} />
            <input
              value={customerSearch}
              onClick={() => setCustomerPickerOpen(true)}
              onFocus={() => setCustomerPickerOpen(true)}
              onChange={(event) => {
                setCustomerSearch(event.target.value);
                setCustomerPickerOpen(true);
              }}
              placeholder="Search customer, Customer ID, contact, city, or email"
            />
          </div>
        </label>

        {selectedCustomer && (
          <div className="quote-selected-customer">
            <div>
              <span>Selected Customer</span>
              <strong>{selectedCustomer.name}</strong>
              <em>{[selectedCustomer.customer_code ? `ID ${selectedCustomer.customer_code}` : "", selectedCustomer.contact_name, selectedCustomer.email].filter(Boolean).join(" / ")}</em>
            </div>
            <button className="ghost-btn" type="button" onClick={clearCustomerSelection}>Clear</button>
          </div>
        )}

        {customerPickerOpen && (
          <div className="quote-customer-results">
            <div className="quote-ticket-results-head">
              <span>{matchingCustomers.length.toLocaleString()} customer match{matchingCustomers.length === 1 ? "" : "es"}</span>
              <button type="button" onClick={() => setCustomerCreateOpen((current) => !current)}>
                <Plus size={14} /> Add Customer
              </button>
            </div>
            {matchingCustomers.map((customer) => (
              <button type="button" key={customer.id} onClick={() => selectCustomer(customer)}>
                <strong>{customerPickerLabel(customer)}</strong>
                <span>{[customer.contact_name, customer.email, customer.phone].filter(Boolean).join(" / ") || "No contact on file"}</span>
                <em>{customerAddressLines(customer).slice(0, 2).join(" / ") || "No address on file"}</em>
              </button>
            ))}
            {!matchingCustomers.length && <p className="quote-ticket-empty">No customers matched that search.</p>}
          </div>
        )}

        <details
          className="quote-customer-create"
          open={customerCreateOpen}
          onToggle={(event) => setCustomerCreateOpen(event.currentTarget.open)}
        >
          <summary>New Customer Details</summary>
          <div className="quote-simple-grid quote-info-grid">
            <Field label="Customer">
              <input value={customerDraft.name} onChange={(event) => updateCustomerDraft("name", event.target.value)} />
            </Field>
            <Field label="Customer ID">
              <input value={customerDraft.customer_code} onChange={(event) => updateCustomerDraft("customer_code", event.target.value)} />
            </Field>
            <Field label="Contact Name">
              <input value={customerDraft.contact_name} onChange={(event) => updateCustomerDraft("contact_name", event.target.value)} />
            </Field>
            <Field label="Contact Email">
              <input type="email" value={customerDraft.email} onChange={(event) => updateCustomerDraft("email", event.target.value)} />
            </Field>
            <Field label="Phone">
              <input value={customerDraft.phone} onChange={(event) => updateCustomerDraft("phone", event.target.value)} />
            </Field>
            <Field label="Address Line 1">
              <input value={customerDraft.address_line_1} onChange={(event) => updateCustomerDraft("address_line_1", event.target.value)} />
            </Field>
            <Field label="Address Line 2">
              <input value={customerDraft.address_line_2} onChange={(event) => updateCustomerDraft("address_line_2", event.target.value)} />
            </Field>
            <Field label="Address Line 3">
              <input value={customerDraft.address_line_3} onChange={(event) => updateCustomerDraft("address_line_3", event.target.value)} />
            </Field>
            <Field label="City">
              <input value={customerDraft.city} onChange={(event) => updateCustomerDraft("city", event.target.value)} />
            </Field>
            <Field label="State">
              <input value={customerDraft.state} onChange={(event) => updateCustomerDraft("state", event.target.value)} />
            </Field>
            <Field label="Zip">
              <input value={customerDraft.postal_code} onChange={(event) => updateCustomerDraft("postal_code", event.target.value)} />
            </Field>
            <Field label="Country">
              <input value={customerDraft.country} onChange={(event) => updateCustomerDraft("country", event.target.value)} />
            </Field>
            <label className="quote-field quote-field-wide">
              <span>Quotation Address</span>
              <textarea
                value={customerDraft.quotation_address}
                onChange={(event) => updateCustomerDraft("quotation_address", event.target.value)}
                placeholder="Optional quote address if it should differ from the customer account address"
              />
            </label>
          </div>
          <div className="quote-form-actions">
            <button className="ghost-btn" type="button" onClick={() => setCustomerCreateOpen(false)}>Cancel</button>
            <button className="primary-btn" type="button" onClick={createQuoteCustomer} disabled={customerSaving || !customerDraft.name.trim()}>
              {customerSaving ? "Saving..." : "Save Customer"}
            </button>
          </div>
        </details>
      </div>
    );
  }

  return (
    <section className="quote-tool">
      <nav className="quote-tabs" aria-label="Quote calculator sections">
        <TabButton active={activeTab === "pricing"} icon={CircleDollarSign} label="Pricing Tool" onClick={() => setActiveTab("pricing")} />
        <TabButton active={activeTab === "quotes"} icon={FileText} label="Saved Quotes" count={quoteWorkflowCounts.active} onClick={() => setActiveTab("quotes")} />
        {canManageQuoteMaterials && (
          <>
            <TabButton active={activeTab === "finished"} icon={Layers3} label="Finished Inventory" count={finishedMaterials.length} onClick={() => setActiveTab("finished")} />
            <TabButton active={activeTab === "raw"} icon={Ruler} label="Raw Inventory" count={rawMaterials.length} onClick={() => setActiveTab("raw")} />
          </>
        )}
      </nav>
      {quoteDataState === "loading" && <p className="quote-sync-note">Loading shared quote data...</p>}
      {quoteDataError && <p className="quote-ticket-warning">{quoteDataError}</p>}

      {activeTab === "pricing" && (
        <>
          {quoteEditContext && (
            <section className="quote-edit-banner">
              <div>
                <span>Editing Saved Quote</span>
                <strong>{quoteEditContext.quoteNumber}</strong>
                <em>Saving will keep this quote number, reset it to Needs Approval, and record your edit for manager review.</em>
              </div>
              <button className="ghost-btn" type="button" onClick={cancelQuoteEdit}>Cancel Edit</button>
            </section>
          )}
          <div className="quote-layout">
            <form className="quote-panel quote-input-panel" onSubmit={(event) => event.preventDefault()}>
              <section className="quote-section quote-primary-section">
                <div className="quote-section-head">
                  <FileText size={16} />
                  <strong>Quote Info</strong>
                </div>
                <div className="quote-segmented compact quote-info-mode-tabs">
                  <button className={quoteInfo.linkMode === "manual" ? "active" : ""} type="button" onClick={() => updateQuoteInfo("linkMode", "manual")}>Custom Quote</button>
                  <button className={quoteInfo.linkMode === "ticket" ? "active" : ""} type="button" onClick={() => updateQuoteInfo("linkMode", "ticket")}>Job Ticket</button>
                </div>
                <details className="quote-link-window quote-customer-contact-panel" defaultOpen={!selectedCustomer || (quoteInfo.linkMode === "ticket" && !selectedJobTicket)}>
                  <summary className="quote-link-window-head">
                    <strong>{quoteInfo.linkMode === "ticket" ? "Customer Account + Job Ticket" : "Customer Account"}</strong>
                    <span>
                      {quoteInfo.linkMode === "ticket"
                        ? [selectedCustomer?.name || quoteInfo.customerName || "Select customer", selectedJobTicket ? jobTicketPartNumber(selectedJobTicket) : "Search job ticket"].filter(Boolean).join(" / ")
                        : selectedCustomer?.name || quoteInfo.customerName || "Select or add customer"}
                    </span>
                  </summary>
                  {renderCustomerAccountPanel()}
                {quoteInfo.linkMode === "ticket" ? (
                  <div className="quote-ticket-grid">
                    <div className="quote-ticket-picker">
                      <label className="quote-ticket-search">
                        <span>Search part number</span>
                        <div>
                          <Search size={16} />
                          <input
                            value={jobTicketSearch}
                            onClick={openJobTicketSearch}
                            onFocus={openJobTicketSearch}
                            onChange={(event) => {
                              setJobTicketSearch(event.target.value);
                              setJobTicketPickerOpen(true);
                            }}
                            placeholder={jobTicketPickerOpen && jobTicketLoadState === "loading" ? "Loading job tickets..." : "Type a part number, TSM ID, or customer"}
                          />
                        </div>
                      </label>

                      {selectedJobTicket && (
                        <div className="quote-selected-ticket">
                          <JobTicketThumb ticket={selectedJobTicket} />
                          <div>
                            <span>Selected Part Number</span>
                            <strong>{jobTicketLabel(selectedJobTicket)}</strong>
                            <em>{jobTicketCustomer(selectedJobTicket)}</em>
                          </div>
                          <button className="ghost-btn quote-ticket-change" type="button" onClick={changeJobTicketSearch}>
                            Change
                          </button>
                        </div>
                      )}

                      {showJobTicketResults && (
                        <>
                          <div className="quote-ticket-results-head">
                            <span>{jobTicketLoadState === "loading" ? "Loading tickets" : `${matchingJobTickets.length.toLocaleString()} match${matchingJobTickets.length === 1 ? "" : "es"}`}</span>
                            {matchingJobTickets.length > visibleJobTickets.length && <em>Showing first {visibleJobTickets.length}</em>}
                          </div>

                          <div className="quote-ticket-results">
                            {visibleJobTickets.map((ticket) => {
                              const active = String(ticket.id) === String(quoteInfo.jobTicketId);
                              return (
                                <button
                                  className={`quote-ticket-option ${active ? "active" : ""}`}
                                  type="button"
                                  key={ticket.id}
                                  onClick={() => selectJobTicket(ticket)}
                                  title={jobTicketSearchText(ticket)}
                                >
                                  <JobTicketThumb ticket={ticket} />
                                  <span>
                                    <strong>{jobTicketPartNumber(ticket)}</strong>
                                    <em>{jobTicketCustomer(ticket)}</em>
                                    <small>{jobTicketSizeLine(ticket) || jobTicketMetaLine(ticket) || "Open ticket to review details"}</small>
                                  </span>
                                </button>
                              );
                            })}
                            {jobTicketLoadState === "ready" && !matchingJobTickets.length && (
                              <p className="quote-ticket-empty">No job tickets matched that search.</p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                    {selectedJobTicket && selectedJobTicketDimensions.message && (
                      <p className="quote-ticket-warning">{selectedJobTicketDimensions.message}</p>
                    )}
                    {selectedJobTicket && selectedJobTicketQuantity.message && (
                      <p className="quote-ticket-warning">{selectedJobTicketQuantity.message}</p>
                    )}
                    {selectedJobTicket && selectedJobTicketMasterTypeLabel && !jobTicketMaterialMatch && (
                      <p className="quote-ticket-warning">No finished quote material matched this job. Pick a material below or link one in Finished Inventory.</p>
                    )}
                    {selectedJobTicket && jobTicketMaterialMatch && (
                      <p className="quote-material-link-summary">
                        <CheckCircle2 size={14} />
                        Matched {selectedJobTicketMasterTypeLabel || jobTicketMaterialMatch.masterTypeLabel || "job material"} to {jobTicketMaterialMatch.name} at {unitMoney(jobTicketMaterialMatch.calculatedMsiCost)} / MSI.
                      </p>
                    )}
                    {selectedJobTicket && jobPrintState === "loading" && (
                      <p className="quote-print-summary muted"><Printer size={14} /> Checking print plates...</p>
                    )}
                    {selectedJobTicket && jobPrintState === "ready" && jobPrintColorCount > 0 && (
                      <p className="quote-print-summary">
                        <Printer size={14} />
                        Printed job: {jobPrintColorCount} color station{jobPrintColorCount === 1 ? "" : "s"}
                        {jobPrintPlates.length ? ` on ${jobPrintPlates.length} plate${jobPrintPlates.length === 1 ? "" : "s"}` : ""}
                        {jobPrintColorSummary ? ` (${jobPrintColorSummary})` : ""}.
                      </p>
                    )}
                    {selectedJobTicket && jobPrintState === "error" && (
                      <p className="quote-ticket-warning">Print plate data could not load for this job. Check the color count before quoting.</p>
                    )}
                    {jobTicketLoadState === "error" && <p className="quote-help-text">Job tickets could not load. Use manual entry for this quote.</p>}
                  </div>
                ) : null}
                </details>
              </section>

              <section className="quote-section quote-primary-section">
                <div className="quote-section-head">
                  <CircleDollarSign size={16} />
                  <strong>Quote Details</strong>
                </div>
                <div className="quote-identity-grid quote-item-identity-grid">
                  <Field label="Quoted Item / Part #">
                    <input value={quoteInfo.itemName} onChange={(event) => updateQuoteInfo("itemName", event.target.value)} placeholder="DTT-4-8-F-BLS" />
                  </Field>
                </div>
                <details className="quote-link-window quote-quote-options">
                  <summary className="quote-link-window-head">
                    <strong>Quote Options</strong>
                    <span>{[quoteInfo.clientPo ? `PO ${quoteInfo.clientPo}` : "", visibleQuoteExpirationDate ? `Expires ${visibleQuoteExpirationDate}` : "", quoteInfo.unitOfMeasure || quoteDefaultUnitOfMeasure].filter(Boolean).join(" / ") || "PO, expiration, and UoM"}</span>
                  </summary>
                  <div className="quote-simple-grid quote-info-grid quote-options-grid">
                    <Field label="Client P.O.">
                      <input value={quoteInfo.clientPo} onChange={(event) => updateQuoteInfo("clientPo", event.target.value)} />
                    </Field>
                    <Field label="Quote Expiration">
                      <input type="date" value={visibleQuoteExpirationDate} onChange={(event) => updateQuoteInfo("quoteExpirationDate", event.target.value)} />
                    </Field>
                    <Field label="UoM">
                      <select value={quoteInfo.unitOfMeasure} onChange={(event) => updateQuoteInfo("unitOfMeasure", event.target.value)}>
                        <option value="M">M - per 1,000 {quoteUnitLabel(form.unitType, true)}</option>
                        <option value="EA">EA - each {quoteUnitLabel(form.unitType)}</option>
                      </select>
                    </Field>
                  </div>
                </details>
                <div className="quote-top-grid quote-main-input-grid">
                  <Field label="Finished Material">
                    <select value={form.selectedMaterialId} onChange={(event) => updateMaterialSelection(event.target.value)}>
                      <option value="manual">Manual MSI Cost</option>
                      {materialOptions.map((material) => (
                        <option value={material.id} key={material.id}>{material.name} - {unitMoney(material.calculatedMsiCost)}/MSI</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Quantity" suffix={quoteUnitLabel(form.unitType, true)}>
                    <input type="number" step="1" value={form.quantity} onChange={(event) => updateField("quantity", event.target.value)} />
                  </Field>
                  <Field label="Waste" suffix="%">
                    <input type="number" step="0.01" value={form.wastePercent} onChange={(event) => updateField("wastePercent", event.target.value)} />
                  </Field>
                  <Field label={form.pricingMode === "markup" ? "Markup" : "Margin"} suffix="%">
                    <input type="number" step="0.01" value={form.pricingPercent} onChange={(event) => updateField("pricingPercent", event.target.value)} />
                  </Field>
                  <div className="quote-control-block quote-mode-compact">
                    <span>Pricing Mode</span>
                    <div className="quote-segmented compact">
                      <button className={form.pricingMode === "margin" ? "active" : ""} type="button" onClick={() => updateField("pricingMode", "margin")}>Margin</button>
                      <button className={form.pricingMode === "markup" ? "active" : ""} type="button" onClick={() => updateField("pricingMode", "markup")}>Markup</button>
                    </div>
                  </div>
                </div>

                {selectedMaterial && (
                  <div className="quote-material-targets">
                    <Metric label="Material MSI" value={`${unitMoney(selectedMaterial.calculatedMsiCost)} / MSI`} />
                    <Metric label="Minimum Markup" value={`${percentFormatter.format(Number(selectedMaterial.baseMarkupPercent || 0))}%`} />
                    <Metric label="Target Markup" value={`${percentFormatter.format(Number((selectedMaterial.targetMarkupPercent ?? selectedMaterial.targetMarginPercent) || 0))}%`} />
                  </div>
                )}

                <div className="quote-simple-grid quote-secondary-input-grid">
                  <Field label="Item Type">
                    <select value={form.unitType} onChange={(event) => updateField("unitType", event.target.value)}>
                      {quoteUnitTypeChoices.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                    </select>
                  </Field>
                  <Field label={`${quoteUnitTitle(form.unitType)} Width`} suffix="in">
                    <input type="number" step="0.0001" value={form.labelWidth} onChange={(event) => updateField("labelWidth", event.target.value)} />
                  </Field>
                  <Field label={`${quoteUnitTitle(form.unitType)} Length`} suffix="in">
                    <input type="number" step="0.0001" value={form.labelLength} onChange={(event) => updateField("labelLength", event.target.value)} />
                  </Field>
                  <Field label="Gap" suffix="in">
                    <input type="number" step="0.0001" value={form.gap} onChange={(event) => updateField("gap", event.target.value)} />
                  </Field>
                  <Field label="Finishing">
                    <select value={form.finishingType} onChange={(event) => updateField("finishingType", event.target.value)}>
                      {quoteFinishingTypeChoices.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                    </select>
                  </Field>
                  <Field label="Core Size">
                    <select value={form.coreSize} onChange={(event) => updateField("coreSize", event.target.value)}>
                      {quoteCoreSizeChoices.map((size) => (
                        <option value={size} key={size || "none"}>{size ? `${size}"` : "No core"}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={`${quoteUnitTitle(form.unitType, true)} / ${quoteItemContainerLabel(form)}`}>
                    <input type="number" step="1" min="0" value={form.labelsPerUnit} onChange={(event) => updateField("labelsPerUnit", event.target.value)} />
                  </Field>
                  <Field label={`${quoteUnitTitle(form.unitType, true)} / Carton`}>
                    <input type="number" step="1" min="0" value={form.labelsPerCarton} onChange={(event) => updateField("labelsPerCarton", event.target.value)} />
                  </Field>
                  <label className="quote-field quote-field-wide">
                    <span>Proof Note</span>
                    <input value={form.itemNote} onChange={(event) => updateField("itemNote", event.target.value)} placeholder="Yellow border" />
                  </label>
                  {manualMaterialWidth && (
                    <Field label="Material Width" suffix="in">
                      <input type="number" step="0.0001" value={form.materialWidth} onChange={(event) => updateField("materialWidth", event.target.value)} />
                    </Field>
                  )}
                  <Field label="MSI Cost" suffix="/ MSI">
                    <input type="number" step="0.0001" value={form.msiCost} readOnly={form.selectedMaterialId !== "manual"} onChange={(event) => updateField("msiCost", event.target.value)} />
                  </Field>
                  <Field label="Colors">
                    <input type="number" step="1" min="0" value={form.colorCount} onChange={(event) => updateField("colorCount", event.target.value)} />
                  </Field>
                  <Field label="Coatings">
                    <input type="number" step="1" min="0" value={form.coatingCount} onChange={(event) => updateField("coatingCount", event.target.value)} />
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
                  <span>Repeat is calculated automatically from {quoteUnitLabel(form.unitType)} length plus gap.</span>
                  <strong>{number(pricing.repeat, '"')}</strong>
                </div>
                <div className="quote-waste-recommendation">
                  <CheckCircle2 size={15} />
                  <div>
                    <span>Recommended waste</span>
                    <strong>{percent(pricing.recommendedWastePercent)}</strong>
                    <em>
                      {number(pricing.runFootage, " ft")} run / {percent(pricing.baseWastePercent)} base
                      {pricing.colorCount > 0
                        ? ` + ${percent(pricing.colorWastePercentPerColor)} per color (${pricing.colorCount} color${pricing.colorCount === 1 ? "" : "s"} = ${percent(pricing.colorWastePercent)})`
                        : ` + ${percent(pricing.colorWastePercentPerColor)} per color`}
                    </em>
                    {pricing.coreMarkupSurchargePercent > 0 && (
                      <em className="quote-core-surcharge-note">Core markup +15%: non-3" cores add 15% to markup.</em>
                    )}
                  </div>
                  {!wasteMatchesRecommendation && (
                    <button type="button" onClick={applyRecommendedWaste}>Use</button>
                  )}
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
                  <p className="quote-pass-through-note">Added costs are included in the cost base before markup or margin.</p>
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
                <div className={`quote-profit-health ${currentProfitHealth.className}`}>
                  <span>Profit</span>
                  <strong>{money(pricing.profit)}</strong>
                  <em>{currentProfitHealth.displayLabel} {percent(currentProfitHealth.displayCurrent)} / target {percent(currentProfitHealth.displayTarget)}</em>
                  <small>{currentProfitHealth.secondaryLabel}</small>
                </div>
                <Metric label={`Price / ${quoteUnitTitle(form.unitType)}`} value={unitMoney(pricing.pricePerLabel)} />
              </div>

              <div className="quote-breakdown">
                <BreakdownRow label="Auto Repeat" value={number(pricing.repeat, '"')} />
                <BreakdownRow label="Run Footage" value={number(pricing.runFootage, " ft")} />
                <BreakdownRow label="Number Across" value={pricing.numberAcross || "--"} />
                <BreakdownRow label="Unused Width" value={pricing.widthDelta >= 0 ? number(pricing.widthDelta, '"') : `Over ${number(Math.abs(pricing.widthDelta), '"')}`} />
                <BreakdownRow label="Base Material MSI" value={number(pricing.baseMaterialMsi)} />
                <BreakdownRow label="Waste MSI" value={number(pricing.wasteMsi)} />
                <BreakdownRow label="MSI With Waste" value={number(pricing.materialMsiWithWaste)} />
                <BreakdownRow label="Colors / Coatings" value={money(pricing.processMsiCost)} />
                <BreakdownRow label="Added Costs" value={`${money(pricing.extraCost)} in cost base`} />
              </div>

              {quoteItemsDraft.length > 0 && (
                <div className="quote-item-draft-list">
                  <header>
                    <strong>Quote Items</strong>
                    <span>{quoteItemsDraft.length}</span>
                  </header>
                  {quoteItemsDraft.map((item) => (
                    <div key={item.id}>
                      <span>{quoteItemDescription(item, { jobName: "" })}</span>
                      <strong>{money(Number(item.pricing?.sellPrice || 0))}</strong>
                      <button type="button" onClick={() => removeQuoteItem(item.id)}><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}

              <button className="ghost-btn quote-generate-btn" type="button" onClick={addQuoteItem} disabled={!pricing.fits || pricing.sellPrice <= 0}>
                <Plus size={16} /> Add Item to Quote
              </button>
              <button className="primary-btn quote-generate-btn" type="button" onClick={generateQuote} disabled={!quoteItemsDraft.length && (!pricing.fits || pricing.sellPrice <= 0)}>
                <FileText size={16} /> {quoteEditContext ? "Save Quote Revision" : `Generate ${quoteItemsDraft.length ? `${quoteItemsDraft.length} Item ` : ""}Quote`}
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
              <p className="quote-empty">No lane option fits the current item and material width.</p>
            )}
          </section>
        </>
      )}

      {activeTab === "quotes" && (
        <section className="quote-record-page">
          <div className="quote-record-list quote-panel">
            <div className="quote-section-head">
              <FileText size={16} />
              <strong>{quoteWorkflowLabel(quoteWorkflowFilter)} Quotes</strong>
              <span className="quote-list-count">{filteredSavedQuotes.length} shown</span>
            </div>
            <div className="quote-workflow-tabs" aria-label="Quote workflow section">
              {quoteWorkflowStates.map(([status, label]) => (
                <button className={quoteWorkflowFilter === status ? "active" : ""} type="button" key={status} onClick={() => setQuoteWorkflowFilter(status)}>
                  <strong>{label}</strong>
                  <span>{quoteWorkflowCounts[status] || 0}</span>
                </button>
              ))}
            </div>
            <label className="quote-record-search">
              <Search size={15} />
              <input value={quoteSearch} onChange={(event) => setQuoteSearch(event.target.value)} placeholder="Search quote, customer, job, material, or person..." />
              <span>{filteredSavedQuotes.length}</span>
            </label>
            <details className="quote-filter-drawer">
              <summary>
                <SlidersHorizontal size={15} />
                <strong>Filters</strong>
                <span>
                  {quoteWorkflowLabel(quoteWorkflowFilter)}
                  {" / "}
                  {quoteStatusFilter === "all" ? "All statuses" : quoteApprovalLabel(quoteStatusFilter)}
                  {" / "}
                  {quotePersonFilter === "all" ? "Everyone" : quotePersonTabs.find((person) => person.key === quotePersonFilter)?.name || "Person"}
                </span>
              </summary>
              <div className="quote-review-dashboard">
                <div>
                  <span>Pending</span>
                  <strong>{quoteStatusCounts.pending}</strong>
                </div>
                <div>
                  <span>Approved</span>
                  <strong>{quoteStatusCounts.approved}</strong>
                </div>
                <div>
                  <span>Rejected</span>
                  <strong>{quoteStatusCounts.rejected}</strong>
                </div>
              </div>
              <div className="quote-status-tabs" aria-label="Quote approval status">
                <button className={quoteStatusFilter === "all" ? "active" : ""} type="button" onClick={() => setQuoteStatusFilter("all")}>
                  <strong>All</strong>
                  <span>{quoteStatusCounts.all}</span>
                </button>
                {quoteApprovalStates.map(([status, label]) => (
                  <button className={quoteStatusFilter === status ? "active" : ""} type="button" key={status} onClick={() => setQuoteStatusFilter(status)}>
                    <strong>{label}</strong>
                    <span>{quoteStatusCounts[status]}</span>
                  </button>
                ))}
              </div>
              <div className="quote-person-tabs" aria-label="Saved quote people">
                <button className={quotePersonFilter === "all" ? "active" : ""} type="button" onClick={() => setQuotePersonFilter("all")}>
                  <i>All</i>
                  <div>
                    <strong>All Quotes</strong>
                    <em>Everyone</em>
                  </div>
                  <span>{workflowFilteredQuotes.length} quote{workflowFilteredQuotes.length === 1 ? "" : "s"}</span>
                </button>
                {quotePersonTabs.map((person) => (
                  <button className={quotePersonFilter === person.key ? "active" : ""} type="button" key={person.key} onClick={() => setQuotePersonFilter(person.key)}>
                    <i>{(person.name || "U").slice(0, 1).toUpperCase()}</i>
                    <div>
                      <strong>{person.isCurrentUser ? "My Quotes" : person.name}</strong>
                      <em>{person.isCurrentUser ? person.name : person.role || "Sales"}</em>
                    </div>
                    <span>{person.count} quote{person.count === 1 ? "" : "s"}</span>
                  </button>
                ))}
              </div>
            </details>
            <div className="quote-record-rows">
              {groupedSavedQuotes.length ? groupedSavedQuotes.map((group) => (
                <section className="quote-record-group" key={group.key}>
                  <header>
                    <strong>{group.name}</strong>
                    <em>{group.quotes.length} quote{group.quotes.length === 1 ? "" : "s"}</em>
                  </header>
                  {group.quotes.map((quote) => {
                    const approvalStatus = quoteApprovalStatus(quote);
                    const workflowStatus = quoteWorkflowStatus(quote);
                    const mine = quoteBelongsToPerson(quote, currentUserQuoteKey(currentUser), currentUser);
                    const lastEdited = quoteLastEditedSummary(quote);
                    return (
                      <button className={`${selectedQuote?.id === quote.id ? "active" : ""} ${mine ? "mine" : ""}`} type="button" key={quote.id} onClick={() => setSelectedQuoteId(quote.id)}>
                        <div className="quote-row-head">
                          <strong>{quote.quoteNumber}</strong>
                          <span className="quote-record-money">{money(quoteTotals(quote).sellPrice)}</span>
                        </div>
                        <span>{quote.customerName || "No customer"} / {quote.jobName || "No job"}</span>
                        <div className="quote-row-meta">
                          <em>{quoteDateLabel(quote.createdAt)}</em>
                          <em>{quotePreparedByName(quote)}</em>
                          <em>{quote.materialName || "Manual material"}</em>
                          {lastEdited && <em>{lastEdited}</em>}
                          {mine && <em className="quote-mine-pill">Mine</em>}
                        </div>
                        <div className="quote-row-foot">
                          <span className={`quote-status-pill ${approvalStatus}`}>{quoteApprovalLabel(approvalStatus)}</span>
                          {workflowStatus === "processed" && <span className="quote-workflow-pill processed">Processed</span>}
                          <em>{quoteCurrentMsiSummary(quote, materialOptions) || quoteApprovalSummary(quote)}</em>
                        </div>
                      </button>
                    );
                  })}
                </section>
              )) : (
                <p className="quote-empty">{savedQuotes.length ? `No ${quoteWorkflowLabel(quoteWorkflowFilter).toLowerCase()} quotes match that search.` : "No saved quotes yet. Generate one from the Pricing Tool tab."}</p>
              )}
            </div>
          </div>

          <div className="quote-record-view quote-panel">
            <div className="quote-record-actions">
              <div className="quote-section-head">
                <FileText size={16} />
                <strong>{selectedQuote ? selectedQuote.quoteNumber : "Quote Preview"}</strong>
                {selectedQuoteIsMine && <span className="quote-mine-pill">My quote</span>}
              </div>
              <div className="quote-record-action-line">
                <div className="quote-segmented compact quote-view-switch">
                  <button className={savedQuoteView === "customer" ? "active" : ""} type="button" onClick={() => setSavedQuoteView("customer")}>Customer View</button>
                  <button className={savedQuoteView === "internal" ? "active" : ""} type="button" onClick={() => setSavedQuoteView("internal")}>Internal Data</button>
                </div>
                <button className="quote-email-action" type="button" onClick={() => requestQuoteAction("email", selectedQuote)} disabled={!selectedQuote}>
                  <Mail size={15} /> <span>Approval</span>
                </button>
              </div>
              <details className="quote-record-action-menu">
                <summary><MoreHorizontal size={16} /> Actions</summary>
                <div>
                  <button className={savedQuoteView === "customer" ? "active" : ""} type="button" onClick={() => setSavedQuoteView("customer")}>Customer View</button>
                  <button className={savedQuoteView === "internal" ? "active" : ""} type="button" onClick={() => setSavedQuoteView("internal")}>Internal Data</button>
                  <button type="button" onClick={() => requestQuoteAction("email", selectedQuote)} disabled={!selectedQuote}><Mail size={15} /> Request Approval Email</button>
                  <button type="button" onClick={() => copyApprovalLink(selectedQuote)} disabled={!selectedQuote}><Copy size={15} /> Copy Approval Link</button>
                  <button type="button" onClick={() => loadQuoteForEdit(selectedQuote)} disabled={!selectedQuote}><Pencil size={15} /> Edit Quote</button>
                  <button type="button" onClick={() => requestQuoteAction("workflow", selectedQuote, selectedQuoteWorkflowStatus === "processed" ? "active" : "processed")} disabled={!selectedQuote || approvalSavingId === selectedQuote?.id}>
                    {selectedQuoteWorkflowStatus === "processed" ? "Reopen Active" : "Move to Processed"}
                  </button>
                  <button type="button" onClick={() => printQuote(selectedQuote)} disabled={!selectedQuote}><Printer size={15} /> Print / PDF</button>
                  <button type="button" onClick={() => downloadQuotePdf(selectedQuote)} disabled={!selectedQuote}><Download size={15} /> Download PDF</button>
                  <button className="danger" type="button" onClick={() => requestQuoteAction("delete", selectedQuote)} disabled={!selectedQuote}><Trash2 size={15} /> Delete</button>
                </div>
              </details>
            </div>
            {selectedQuote && (
              <details className={`quote-approval-card quote-approval-drawer ${quoteApprovalStatus(selectedQuote)}`}>
                <summary>
                  <span className={`quote-status-pill ${quoteApprovalStatus(selectedQuote)}`}>{quoteApprovalLabel(selectedQuote)}</span>
                  <strong>{quoteApprovalSummary(selectedQuote)}</strong>
                </summary>
                <div>
                  <em>{canApproveQuotes ? "Sales manager approval controls are available for this quote." : "Approval is controlled by users with Quote Approval permission."}</em>
                  {quoteLastEditedSummary(selectedQuote) && <em className="quote-revision-meta">{quoteLastEditedSummary(selectedQuote)}</em>}
                  {quoteProcessedSummary(selectedQuote) && <em className="quote-revision-meta">{quoteProcessedSummary(selectedQuote)}</em>}
                  {canApproveQuotes && (
                  <div>
                    <button className="primary-btn" type="button" onClick={() => requestQuoteAction("approve", selectedQuote)} disabled={approvalSavingId === selectedQuote.id || quoteApprovalStatus(selectedQuote) === "approved"}>
                      <CheckCircle2 size={15} /> Approve
                    </button>
                    <button className="ghost-btn" type="button" onClick={() => requestQuoteAction("reject", selectedQuote)} disabled={approvalSavingId === selectedQuote.id || quoteApprovalStatus(selectedQuote) === "rejected"}>
                      <XCircle size={15} /> Reject
                    </button>
                  </div>
                  )}
                </div>
              </details>
            )}
            {quoteActionError && <div className="error-box">{quoteActionError}</div>}
            {quoteActionNotice && <div className="quote-action-notice">{quoteActionNotice}</div>}
            {savedQuoteView === "internal" ? <InternalQuoteBreakdown quote={selectedQuote} materialOptions={materialOptions} /> : <QuoteDocument quote={selectedQuote} />}
          </div>
        </section>
      )}

      {canManageQuoteMaterials && activeTab === "finished" && (
        <section className="quote-inventory-page">
          <div className="quote-inventory-head">
            <div>
              <h3>Finished Inventory</h3>
              <p>Finished materials can be purchased stock or made from raw components.</p>
            </div>
            <Metric label="Materials" value={finishedMaterials.length} />
          </div>

          <section className="quote-rate-panel quote-panel">
            <div className="quote-section-head">
              <CircleDollarSign size={16} />
              <strong>Shared MSI Rates</strong>
            </div>
            <div className="quote-rate-grid">
              {quoteRateDefaults.map((defaultRate) => {
                const rate = quoteRates.find((item) => item.key === defaultRate.key) || defaultRate;
                return (
                  <Field label={rate.label} suffix="/ MSI" key={defaultRate.key}>
                    <input
                      type="number"
                      step="0.0001"
                      value={rate.msiCost}
                      onChange={(event) => updateQuoteRateLocal(defaultRate.key, "msiCost", event.target.value)}
                      onBlur={(event) => updateQuoteRate(defaultRate.key, "msiCost", event.target.value)}
                    />
                  </Field>
                );
              })}
            </div>
            <p className="quote-rate-note">Labor is added to every made in-house finished material. Color and coating rates are multiplied by the counts entered on each quote item.</p>
          </section>

          <div className="quote-material-library">
            <div className="quote-library-panel quote-panel">
              <div className="quote-section-head">
                <Plus size={16} />
                <strong>{editingFinishedId ? "Edit Finished Material" : "Add Finished Material"}</strong>
              </div>
              <FinishedMaterialForm
                form={finishedForm}
                rawMaterials={rawMaterials}
                materialMasterTypes={materialMasterTypes}
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
                      <span>{quoteUnitTitle(material.unitType)} / {material.masterTypeLabel ? `${material.masterTypeLabel} / ` : ""}{material.sourceType === "purchased" ? "Purchased" : "Made in-house"} / {material.componentLabel}</span>
                    </div>
                    <em>{unitMoney(material.calculatedMsiCost)}/MSI</em>
                    <span>{percentFormatter.format(Number(material.baseMarkupPercent || 0))}% minimum / {percentFormatter.format(Number((material.targetMarkupPercent ?? material.targetMarginPercent) || 0))}% target markup</span>
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

      {canManageQuoteMaterials && activeTab === "raw" && (
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

      {quoteConfirm && (
        <div className="quote-confirm-overlay" role="presentation" onMouseDown={() => setQuoteConfirm(null)}>
          <section className={`quote-confirm-window ${quoteConfirm.tone || ""}`} role="dialog" aria-modal="true" aria-labelledby="quote-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
            <div>
              <span>Confirm Action</span>
              <strong id="quote-confirm-title">{quoteConfirm.title}</strong>
              <em>{quoteConfirm.message}</em>
            </div>
            <footer>
              <button className="ghost-btn" type="button" onClick={() => setQuoteConfirm(null)}>Cancel</button>
              <button className={quoteConfirm.tone === "danger" ? "danger-btn" : "primary-btn"} type="button" onClick={runConfirmedQuoteAction}>
                {quoteConfirm.confirmLabel}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
