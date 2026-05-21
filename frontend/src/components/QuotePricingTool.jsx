import { AlertTriangle, CheckCircle2, CircleDollarSign, Download, FileText, Image as ImageIcon, Layers3, Pencil, Plus, Printer, Ruler, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createRecord, deleteRecord, fetchCollection, updateRecord } from "../api";
import { PdfPreview, isPdfUrl } from "./FilePreview";
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
  linkMode: "ticket",
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

function quoteDateLabel(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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
    jobTicketId: quote.jobTicketId || null,
    contactEmail: quote.contactEmail || "",
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
  return quote.jobName || `${quote.form.labelWidth}" x ${quote.form.labelLength}" label`;
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

function quoteItemDescription(item, quote) {
  const form = item.form || {};
  return item.itemName || quote.jobName || `${form.labelWidth || 0}" x ${form.labelLength || 0}" label`;
}

function quoteCustomerDetailRows(quote) {
  const items = quoteItems(quote);
  const rows = [
    ["Label Size", items.length > 1 ? "Multiple items" : `${quote.form.labelWidth}" x ${quote.form.labelLength}"`],
    ["Finished Material", items.length > 1 ? "Multiple materials" : quotePublicMaterialName(quote)],
    ["Quantity", Number(quoteTotals(quote).quantity || quote.form.quantity || 0).toLocaleString()],
    ["Quote Number", quote.quoteNumber],
    ["Quote Date", quoteDateLabel(quote.createdAt)],
  ];
  if (quote.productCode) rows.splice(3, 0, ["TSM ID", quote.productCode]);
  return rows;
}

function quoteCustomerPriceRows(quote) {
  const totals = quoteTotals(quote);
  return [
    ["Quantity", Number(totals.quantity || quote.form.quantity || 0).toLocaleString()],
    ["Price / M", money(totals.pricePerThousand)],
    ["Price / Label", unitMoney(totals.pricePerLabel)],
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
  return services.size ? Array.from(services) : ["Labels produced to quoted specification"];
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
  const sell = Number(totals.markedUpProductionSellPrice || totals.sellPrice || 0);
  const cost = Number(totals.productionCost || totals.totalCost || 0);
  const profit = sell - cost;
  return sell > 0 ? (profit / sell) * 100 : 0;
}

function quoteActualMarkup(quote) {
  const totals = quoteTotals(quote);
  const cost = Number(totals.productionCost || totals.totalCost || 0);
  const sell = Number(totals.markedUpProductionSellPrice || totals.sellPrice || 0);
  const profit = sell - cost;
  return cost > 0 ? (profit / cost) * 100 : 0;
}

function pricingActualMargin(pricing) {
  const sell = Number(pricing?.markedUpProductionSellPrice || pricing?.sellPrice || 0);
  const cost = Number(pricing?.productionCost || pricing?.totalCost || 0);
  const profit = sell - cost;
  return sell > 0 ? (profit / sell) * 100 : 0;
}

function pricingActualMarkup(pricing) {
  const cost = Number(pricing?.productionCost || pricing?.totalCost || 0);
  const sell = Number(pricing?.markedUpProductionSellPrice || pricing?.sellPrice || 0);
  const profit = sell - cost;
  return cost > 0 ? (profit / cost) * 100 : 0;
}

function markupToMargin(markupPercent) {
  const markup = Math.max(0, toQuoteNumber(markupPercent));
  return markup > 0 ? (markup / (100 + markup)) * 100 : 0;
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
        ["Job Number", quote.jobName || "--"],
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
        ["Run Footage", number(Number(quote.pricing?.runFootage || 0), " ft")],
        ["Quantity", Number(quote.form?.quantity || 0).toLocaleString()],
        ["Finished Label MSI", number(Number(quote.pricing?.finishedMsi || 0))],
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
        ["Markup Base Cost", money(Number(quote.pricing?.productionCost || 0))],
        ...quoteAddedCostRows(quote),
        ["Added Costs Total", `${money(Number(quote.pricing?.extraCost || 0))} pass-through`],
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
    quote.jobName,
    quote.productCode,
    quote.materialName,
    quotePreparedByName(quote),
    quotePreparedByRole(quote),
    quoteDateLabel(quote.createdAt),
    money(quote.pricing?.sellPrice),
  ].filter(Boolean).join(" ").toLowerCase();
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
  const detailRows = quoteCustomerDetailRows(quote);
  const priceRows = quoteCustomerPriceRows(quote);
  const includedServices = quoteIncludedServices(quote);
  const items = quoteItems(quote);
  const totals = quoteTotals(quote);

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
          <strong>{money(totals.sellPrice)}</strong>
          <em>{money(totals.pricePerThousand)} / M</em>
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
        <h3>{items.length > 1 ? "Quoted Items" : "Quoted Item"}</h3>
        <div className="quote-doc-item-table">
          {items.map((item) => (
            <div className="quote-doc-item-row" key={item.id || quoteItemDescription(item, quote)}>
              <div><span>Quantity</span><strong>{Number(item.form?.quantity || item.pricing?.quantity || 0).toLocaleString()}</strong></div>
              <div><span>Description</span><strong>{quoteItemDescription(item, quote)}</strong><em>{item.materialName && item.materialName !== "Manual MSI Cost" ? item.materialName : ""}</em></div>
              <div><span>Price / M</span><strong>{money(Number(item.pricing?.pricePerThousand || 0))}</strong></div>
              <div><span>Total</span><strong>{money(Number(item.pricing?.sellPrice || 0))}</strong></div>
            </div>
          ))}
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
              ({quote.pricing?.repeat || quote.form?.repeat || 0} repeat x {Number(quote.form?.quantity || 0).toLocaleString()} labels x {quote.form?.materialWidth || 0}" web) / (1000 x {quote.pricing?.numberAcross || 0} across) x {number(Number(quote.pricing?.wasteMultiplier || 1))} waste x {unitMoney(msiUnitCost)}
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

export default function QuotePricingTool({ currentUser, initialJobTicketId = "", canManageQuoteMaterials = false }) {
  const storedLibrary = useMemo(loadMaterialLibrary, []);
  const storedQuotes = useMemo(loadSavedQuotes, []);
  const [activeTab, setActiveTab] = useState("pricing");
  const [savedQuoteView, setSavedQuoteView] = useState("customer");
  const [form, setForm] = useState(initialForm);
  const [wasteManuallyEdited, setWasteManuallyEdited] = useState(false);
  const [quoteInfo, setQuoteInfo] = useState(emptyQuoteInfo);
  const [quoteSearch, setQuoteSearch] = useState("");
  const [quotePersonFilter, setQuotePersonFilter] = useState(() => currentUserQuoteKey(currentUser));
  const [rawForm, setRawForm] = useState(emptyRawForm);
  const [finishedForm, setFinishedForm] = useState(emptyFinishedForm);
  const [editingRawId, setEditingRawId] = useState(null);
  const [editingFinishedId, setEditingFinishedId] = useState(null);
  const [rawMaterials, setRawMaterials] = useState(storedLibrary.rawMaterials);
  const [finishedMaterials, setFinishedMaterials] = useState(storedLibrary.finishedMaterials);
  const [quoteRates, setQuoteRates] = useState(quoteRateDefaults);
  const [quoteItemsDraft, setQuoteItemsDraft] = useState([]);
  const [savedQuotes, setSavedQuotes] = useState(storedQuotes);
  const [selectedQuoteId, setSelectedQuoteId] = useState(storedQuotes[0]?.id ?? null);
  const [jobTickets, setJobTickets] = useState([]);
  const [jobTicketSearch, setJobTicketSearch] = useState("");
  const [jobTicketLoadState, setJobTicketLoadState] = useState("idle");
  const [quoteDataState, setQuoteDataState] = useState("loading");
  const [quoteDataError, setQuoteDataError] = useState("");

  const materialOptions = useMemo(() => {
    return finishedMaterials.map((material) => ({
      ...material,
      calculatedMsiCost: calculateFinishedMaterialMsiCost(material, rawMaterials, quoteRates),
      componentLabel: componentLabelForFinishedMaterial(material, rawMaterials),
      masterTypeLabel: [material.materialMasterTypeCode, material.materialMasterTypeName].filter(Boolean).join(" / "),
    }));
  }, [finishedMaterials, rawMaterials, quoteRates]);
  const visibleQuoteTabs = useMemo(() => {
    const tabs = ["pricing", "quotes"];
    if (canManageQuoteMaterials) tabs.push("finished", "raw");
    return tabs;
  }, [canManageQuoteMaterials]);

  const selectedMaterial = materialOptions.find((material) => String(material.id) === String(form.selectedMaterialId));
  const selectedJobTicket = jobTickets.find((ticket) => String(ticket.id) === String(quoteInfo.jobTicketId));
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
    savedQuotes.forEach((quote) => {
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
  }, [currentUser?.id, currentUser?.name, currentUser?.role, savedQuotes]);
  const searchedSavedQuotes = useMemo(() => {
    const search = quoteSearch.trim().toLowerCase();
    if (!search) return savedQuotes;
    return savedQuotes.filter((quote) => quoteSearchText(quote).includes(search));
  }, [quoteSearch, savedQuotes]);
  const filteredSavedQuotes = useMemo(() => {
    if (quotePersonFilter === "all") return searchedSavedQuotes;
    return searchedSavedQuotes.filter((quote) => quoteBelongsToPerson(quote, quotePersonFilter, currentUser));
  }, [quotePersonFilter, searchedSavedQuotes, currentUser?.id, currentUser?.name]);
  const groupedSavedQuotes = useMemo(() => {
    const groups = new Map();
    const currentKey = currentUserQuoteKey(currentUser);
    const currentName = currentUser?.name?.toLowerCase();
    filteredSavedQuotes.forEach((quote) => {
      const preparedName = quotePreparedByName(quote).toLowerCase();
      const rawKey = quotePersonKey(quote);
      const key = rawKey === currentKey || (currentName && preparedName === currentName) ? currentKey : rawKey;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name: key === currentKey && currentUser?.name ? currentUser.name : quotePreparedByName(quote),
          role: key === currentKey && currentUser?.role ? currentUser.role : quotePreparedByRole(quote),
          quotes: [],
        });
      }
      groups.get(key).quotes.push(quote);
    });
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [currentUser?.id, currentUser?.name, currentUser?.role, filteredSavedQuotes]);
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
      setForm((prev) => ({ ...prev, pricingMode: preference.pricingMode }));
    }
  }, [currentUser?.id, currentUser?.name]);

  useEffect(() => {
    if (activeTab !== "quotes") return;
    setQuotePersonFilter(currentUserQuoteKey(currentUser));
  }, [activeTab, currentUser?.id, currentUser?.name]);

  useEffect(() => {
    if (!filteredSavedQuotes.length) {
      setSelectedQuoteId(null);
      return;
    }
    setSelectedQuoteId((current) => filteredSavedQuotes.some((quote) => quote.id === current) ? current : filteredSavedQuotes[0].id);
  }, [filteredSavedQuotes]);

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
      if (!quiet) setQuoteDataState("loading");
      setQuoteDataError("");
      try {
        let [rawPayload, finishedPayload, quotePayload, ratePayload] = await Promise.all([
          fetchCollection("quote-raw-materials", { pageSize: 1000, fetchAll: true }),
          fetchCollection("quote-finished-materials", { pageSize: 1000, fetchAll: true }),
          fetchCollection("quote-records", { ordering: "-created_at", pageSize: 1000, fetchAll: true }),
          fetchCollection("quote-cost-rates", { pageSize: 1000, fetchAll: true }),
        ]);

        let rawResults = rawPayload.results ?? [];
        let finishedResults = finishedPayload.results ?? [];
        let quoteResults = quotePayload.results ?? [];
        let rateResults = ratePayload.results ?? [];

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
        setSelectedQuoteId((current) => current && quoteResults.some((quote) => quote.id === current) ? current : quoteResults[0]?.id ?? null);
        setQuoteDataState("ready");
      } catch (error) {
        if (!alive) return;
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
    if (!initialJobTicketId) return;
    setActiveTab("pricing");
    setWasteManuallyEdited(false);
    setQuoteInfo((prev) => ({
      ...prev,
      linkMode: "ticket",
      jobTicketId: String(initialJobTicketId),
    }));
  }, [initialJobTicketId]);

  useEffect(() => {
    let alive = true;
    setJobTicketLoadState("loading");
    fetchCollection("job-tickets", { ordering: "job_name,ticket_number", pageSize: 1000, fetchAll: true })
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
    }));
  }, [selectedMaterial?.id, selectedMaterial?.calculatedMsiCost, selectedMaterial?.width_inches]);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      colorMsiCost: String(rateCost(quoteRates, "color")),
      coatingMsiCost: String(rateCost(quoteRates, "coating")),
    }));
  }, [quoteRates]);

  useEffect(() => {
    if (quoteInfo.linkMode !== "ticket" || !selectedJobTicket) return;
    const dimensions = jobTicketQuoteDimensions(selectedJobTicket);
    const quantity = jobTicketQuoteQuantity(selectedJobTicket);
    const material = materialOptions.find((item) => materialMatchesJobTicket(item, selectedJobTicket)) || null;
    setForm((prev) => ({
      ...prev,
      labelWidth: dimensions.width,
      labelLength: dimensions.length,
      gap: dimensions.gap,
      quantity: quantity.quantity,
      selectedMaterialId: material?.id || prev.selectedMaterialId,
      msiCost: material ? String(material.calculatedMsiCost) : prev.msiCost,
      pricingPercent: material ? materialTargetPricingPercent(material, prev.pricingMode) || prev.pricingPercent : prev.pricingPercent,
    }));
  }, [quoteInfo.linkMode, selectedJobTicket?.id, materialOptions.length]);

  function updateField(name, value) {
    if (name === "pricingMode") {
      saveQuotePreference(currentUser, { pricingMode: value });
    }
    if (name === "wastePercent") {
      setWasteManuallyEdited(true);
    }
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      if (name === "pricingMode" && selectedMaterial) {
        const targetPercent = materialTargetPricingPercent(selectedMaterial, value);
        if (targetPercent) next.pricingPercent = targetPercent;
      }
      return next;
    });
  }

  function updateQuoteInfo(name, value) {
    if (name === "jobTicketId" || name === "linkMode") {
      setWasteManuallyEdited(false);
    }
    setQuoteInfo((prev) => ({ ...prev, [name]: value }));
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
    setForm((prev) => ({
      ...prev,
      selectedMaterialId: value,
      msiCost: material ? String(material.calculatedMsiCost) : prev.msiCost,
      pricingPercent: material ? materialTargetPricingPercent(material, prev.pricingMode) || prev.pricingPercent : prev.pricingPercent,
    }));
  }

  function useCandidate(numberAcross) {
    setForm((prev) => ({ ...prev, acrossMode: "manual", numberAcross: String(numberAcross) }));
  }

  function buildCurrentQuoteItem() {
    const itemName = quoteInfo.linkMode === "ticket"
      ? selectedJobTicket?.job_name || selectedJobTicket?.product_name || "Job ticket item"
      : quoteInfo.jobName || "Manual quote item";
    return {
      id: makeId("item"),
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
    const customerName = ticket?.customer_display || ticket?.customer_name || quoteInfo.customerName;
    const jobName = ticket?.job_name || ticket?.product_name || quoteInfo.jobName;
    const productCode = ticket?.product_code || "";
    const preparedBy = currentUser?.name || quoteInfo.preparedBy;
    const items = quoteItemsDraft.length ? quoteItemsDraft : [buildCurrentQuoteItem()];
    const totals = quoteTotals({ form: { items }, pricing: { items } });
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
      materialName: items.length === 1 ? items[0].materialName : "Multiple materials",
      materialSource: items.length === 1 ? items[0].materialSource : "multiple",
      materialComponents: items.length === 1 ? items[0].materialComponents : `${items.length} quoted items`,
      form: { ...form, repeat: String(pricing.repeat), items },
      pricing: { ...totals, items },
    };
    return record;
  }

  async function generateQuote() {
    const record = buildQuoteRecord();
    const saved = await createRecord("quote-records", quoteRecordPayload(record));
    setSavedQuotes((prev) => [saved, ...prev]);
    setSelectedQuoteId(saved.id);
    setQuotePersonFilter(currentUserQuoteKey(currentUser));
    setQuoteItemsDraft([]);
    setActiveTab("quotes");
  }

  async function deleteQuote(id) {
    await deleteRecord("quote-records", id);
    setSavedQuotes((prev) => prev.filter((quote) => quote.id !== id));
    setSelectedQuoteId((current) => current === id ? null : current);
  }

  function printQuote(quote) {
    if (!quote) return;
    const detailRows = quoteCustomerDetailRows(quote);
    const priceRows = quoteCustomerPriceRows(quote);
    const includedServices = quoteIncludedServices(quote);
    const items = quoteItems(quote);
    const totals = quoteTotals(quote);
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
.item{margin-top:12px}.item h2,.grid h2,.included h2,.notes h2{font-size:13px;margin:0 0 6px}.item-table{border:1px solid #111827}.item-row{display:grid;grid-template-columns:1fr 2fr 1fr 1fr;border-top:1px solid #e5e7eb}.item-row:first-child{border-top:0}.item-row div{padding:8px;border-left:1px solid #e5e7eb}.item-row div:first-child{border-left:0}.item strong{font-size:12px}.item em{display:block;color:#667085;font-size:9px;font-style:normal;margin-top:2px}.item-row div:last-child strong{font-size:15px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.box,.included,.notes{border:1px solid #e5e7eb;padding:9px}.row{display:flex;justify-content:space-between;gap:12px;border-top:1px solid #eef2f7;padding:5px 0}.row:first-of-type{border-top:0}.row strong{text-align:right;font-size:11px}.included{margin-top:12px}.included div{display:flex;flex-wrap:wrap;gap:6px}.included span{padding:5px 7px;border:1px solid #e5e7eb;border-radius:999px;color:#344054;font-size:10px}.notes{margin-top:12px}.notes p{margin:0;font-size:11px;line-height:1.3;white-space:pre-wrap}
@media print{body{background:white}.page{margin:0;width:auto;min-height:auto;padding:0}.no-print{display:none}}
</style>
</head>
<body>
<main class="page">
<section class="head"><div><strong>Tri-State Media</strong><span>Quote ${escapeHtml(quote.quoteNumber)}</span><em>${escapeHtml(quoteDateLabel(quote.createdAt))}</em></div><div><span>Total Quote</span><strong>${escapeHtml(money(totals.sellPrice))}</strong><em>${escapeHtml(money(totals.pricePerThousand))} / M</em></div></section>
<section class="meta">
<div><span>Customer</span><strong>${escapeHtml(clipText(quote.customerName || "--", 32))}</strong><em>${escapeHtml(clipText(quote.contactName || quote.contactEmail || "", 36))}</em></div>
<div><span>Job</span><strong>${escapeHtml(clipText(quote.jobName || "--", 32))}</strong><em>${escapeHtml(clipText(quote.jobTicketNumber ? `Job Ticket ${quote.jobTicketNumber}` : quote.productCode || "Manual quote", 36))}</em></div>
<div><span>Prepared By</span><strong>${escapeHtml(clipText(quotePreparedByName(quote), 32))}</strong><em>${escapeHtml(quotePreparedByRole(quote) || quoteDateLabel(quote.createdAt))}</em></div>
<div><span>Quote Date</span><strong>${escapeHtml(quoteDateLabel(quote.createdAt))}</strong><em>${escapeHtml(quote.quoteNumber)}</em></div>
</section>
<section class="item"><h2>${items.length > 1 ? "Quoted Items" : "Quoted Item"}</h2><div class="item-table">
${items.map((item) => `<div class="item-row"><div><span>Quantity</span><strong>${escapeHtml(Number(item.form?.quantity || item.pricing?.quantity || 0).toLocaleString())}</strong></div><div><span>Description</span><strong>${escapeHtml(clipText(quoteItemDescription(item, quote), 52))}</strong><em>${escapeHtml(clipText(item.materialName && item.materialName !== "Manual MSI Cost" ? item.materialName : "", 54))}</em></div><div><span>Price / M</span><strong>${escapeHtml(money(Number(item.pricing?.pricePerThousand || 0)))}</strong></div><div><span>Total</span><strong>${escapeHtml(money(Number(item.pricing?.sellPrice || 0)))}</strong></div></div>`).join("")}
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
    const items = quoteItems(quote);
    const totals = quoteTotals(quote);
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
    text(410, 724, 26, money(totals.sellPrice), "F2");
    text(410, 708, 10, `${money(totals.pricePerThousand)} / M`);
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

    text(42, 606, 12, items.length > 1 ? "Quoted Items" : "Quoted Item", "F2");
    const itemBoxHeight = Math.min(3, items.length) * 30 + 8;
    box(42, 588 - itemBoxHeight, 528, itemBoxHeight);
    items.slice(0, 3).forEach((item, index) => {
      const y = 574 - index * 30;
      text(52, y + 7, 7, "Quantity", "F2");
      text(52, y - 6, 10, Number(item.form?.quantity || item.pricing?.quantity || 0).toLocaleString(), "F2");
      text(150, y + 7, 7, "Description", "F2");
      text(150, y - 6, 10, clipText(quoteItemDescription(item, quote), 42), "F2");
      text(420, y + 7, 7, "Price / M", "F2");
      text(420, y - 6, 10, money(Number(item.pricing?.pricePerThousand || 0)), "F2");
      text(500, y + 7, 7, "Total", "F2");
      text(500, y - 6, 10, money(Number(item.pricing?.sellPrice || 0)), "F2");
      if (index < Math.min(3, items.length) - 1) line(42, y - 15, 570, y - 15);
    });
    if (items.length > 3) text(52, 588 - itemBoxHeight + 7, 8, `${items.length - 3} additional item(s) included in quote total.`);

    const detailTitleY = 562 - itemBoxHeight;
    const detailBoxTop = detailTitleY - 12;
    const detailBoxBottom = detailBoxTop - 178;
    text(42, detailTitleY, 12, "Quote Details", "F2");
    text(314, detailTitleY, 12, "Customer Pricing", "F2");
    box(42, detailBoxBottom, 240, 178);
    box(314, detailBoxBottom, 256, 178);

    details.forEach(([label, value], index) => {
      const y = detailBoxTop - 18 - index * 20;
      text(54, y, 7, label, "F2");
      text(166, y, 8, clipText(value, 28));
      if (index < details.length - 1) line(54, y - 8, 270, y - 8);
    });

    prices.forEach(([label, value], index) => {
      const y = detailBoxTop - 18 - index * 20;
      text(326, y, 7, label, "F2");
      text(488, y, 8, clipText(value, 20));
      if (index < prices.length - 1) line(326, y - 8, 558, y - 8);
    });

    const includedTitleY = detailBoxBottom - 28;
    text(42, includedTitleY, 12, "Included", "F2");
    box(42, includedTitleY - 28, 528, 18);
    text(54, includedTitleY - 22, 8, clipText(includedServices.join(", "), 115));

    if (quote.notes) {
      const notesTitleY = includedTitleY - 54;
      text(42, notesTitleY, 12, "Notes", "F2");
      box(42, notesTitleY - 70, 528, 58);
      const note = clipText(quote.notes.replace(/\s+/g, " "), 170);
      const chunks = note.match(/.{1,86}(\s|$)/g) || [note];
      chunks.slice(0, 3).forEach((chunk, index) => text(54, notesTitleY - 28 - index * 14, 8, chunk.trim()));
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
    setForm((prev) => ({
      ...prev,
      selectedMaterialId: saved.id,
      msiCost: String(calculateFinishedMaterialMsiCost(saved, rawMaterials, quoteRates)),
      pricingPercent: materialTargetPricingPercent(saved, prev.pricingMode) || prev.pricingPercent,
    }));
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
    setForm((prev) => ({
      ...prev,
      selectedMaterialId: material.id,
      msiCost: String(material.calculatedMsiCost),
      pricingPercent: materialTargetPricingPercent(material, prev.pricingMode) || prev.pricingPercent,
    }));
    setActiveTab("pricing");
  }

  function editFinishedMaterial(material) {
    if (!canManageQuoteMaterials) return;
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
    if (!canManageQuoteMaterials) return;
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
                  <div className="quote-ticket-grid">
                    <div className="quote-ticket-picker">
                      <label className="quote-ticket-search">
                        <span>Search part number</span>
                        <div>
                          <Search size={16} />
                          <input
                            value={jobTicketSearch}
                            onChange={(event) => setJobTicketSearch(event.target.value)}
                            placeholder={jobTicketLoadState === "loading" ? "Loading job tickets..." : "Type a part number, TSM ID, or customer"}
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
                        </div>
                      )}

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
                              onClick={() => updateQuoteInfo("jobTicketId", String(ticket.id))}
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
                    {jobTicketLoadState === "error" && <p className="quote-help-text">Job tickets could not load. Use manual entry for this quote.</p>}
                  </div>
                ) : (
                  <div className="quote-simple-grid quote-info-grid">
                    <Field label="Customer">
                      <input value={quoteInfo.customerName} onChange={(event) => updateQuoteInfo("customerName", event.target.value)} />
                    </Field>
                    <Field label="Job Number">
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
                <div className="quote-top-grid quote-main-input-grid">
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
                  <span>Repeat is calculated automatically from label length plus gap.</span>
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
                  <p className="quote-pass-through-note">Added costs are added after markup. Example: $178 quote + $100 added cost = $278 total.</p>
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
                <Metric label="Price / Label" value={unitMoney(pricing.pricePerLabel)} />
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
                <BreakdownRow label="Added Costs" value={`${money(pricing.extraCost)} pass-through`} />
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
                <FileText size={16} /> Generate {quoteItemsDraft.length ? `${quoteItemsDraft.length} Item ` : ""}Quote
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
            <div className="quote-person-tabs" aria-label="Saved quote people">
              <button className={quotePersonFilter === "all" ? "active" : ""} type="button" onClick={() => setQuotePersonFilter("all")}>
                <i>All</i>
                <div>
                  <strong>All Quotes</strong>
                  <em>Everyone</em>
                </div>
                <span>{savedQuotes.length} quote{savedQuotes.length === 1 ? "" : "s"}</span>
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
                      <em>{quoteDateLabel(quote.createdAt)} / {money(quoteTotals(quote).sellPrice)} / {quoteCurrentMsiSummary(quote, materialOptions)}</em>
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
                      <span>{material.masterTypeLabel ? `${material.masterTypeLabel} / ` : ""}{material.sourceType === "purchased" ? "Purchased" : "Made in-house"} / {material.componentLabel}</span>
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
    </section>
  );
}
