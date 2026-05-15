const EPSILON = 0.000001;

export const quoteExtraCostFields = [
  { name: "setupCost", label: "Setup" },
  { name: "printCost", label: "Print / Complexity" },
  { name: "finishingCost", label: "Finishing / Cores" },
  { name: "packagingCost", label: "Packaging" },
  { name: "outsideCost", label: "Outside Service" },
];

export const rawComponentTypes = [
  ["face", "Face"],
  ["liner", "Liner"],
  ["adhesive", "Adhesive"],
  ["silicone", "Silicone"],
  ["ink", "Ink"],
  ["coating", "Coating"],
  ["labor", "Labor"],
  ["other", "Other"],
];

export const finishedComponentSlots = [
  { name: "faceRawId", label: "Face", type: "face" },
  { name: "linerRawId", label: "Liner", type: "liner" },
  { name: "adhesiveRawId", label: "Adhesive", type: "adhesive" },
  { name: "siliconeRawId", label: "Silicone", type: "silicone" },
  { name: "inkRawId", label: "Ink", type: "ink" },
];

export const finishedMaterialAdderFields = [
  { name: "laborMsiCost", label: "Labor" },
  { name: "coatingMsiCost", label: "Coating / Hard Coat" },
  { name: "complexityMsiCost", label: "Complexity" },
  { name: "otherMsiCost", label: "Other" },
];

export function toQuoteNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : fallback;
}

export function calculateLayoutWidth({ labelWidth, gap, numberAcross, sideTrim }) {
  const across = Math.max(0, Math.floor(toQuoteNumber(numberAcross)));
  if (across <= 0) return 0;
  return (
    toQuoteNumber(labelWidth) * across +
    Math.max(0, toQuoteNumber(gap)) * Math.max(0, across - 1) +
    Math.max(0, toQuoteNumber(sideTrim))
  );
}

export function calculateMaxAcross({ labelWidth, gap, materialWidth, sideTrim }) {
  const label = toQuoteNumber(labelWidth);
  const web = toQuoteNumber(materialWidth);
  const gapValue = Math.max(0, toQuoteNumber(gap));
  const trim = Math.max(0, toQuoteNumber(sideTrim));

  if (label <= 0 || web <= 0) return 0;

  const pitch = label + gapValue;
  const available = web - trim + gapValue;
  if (pitch <= 0 || available + EPSILON < label) return 0;

  return Math.max(0, Math.floor((available + EPSILON) / pitch));
}

export function calculateQuotePricing(input) {
  const labelWidth = toQuoteNumber(input.labelWidth);
  const labelLength = toQuoteNumber(input.labelLength);
  const repeat = toQuoteNumber(input.repeat, labelLength);
  const quantity = toQuoteNumber(input.quantity);
  const materialWidth = toQuoteNumber(input.materialWidth);
  const gap = Math.max(0, toQuoteNumber(input.gap));
  const sideTrim = Math.max(0, toQuoteNumber(input.sideTrim));
  const wastePercent = Math.max(0, toQuoteNumber(input.wastePercent));
  const msiCost = Math.max(0, toQuoteNumber(input.msiCost));
  const suggestedAcross = calculateMaxAcross({ labelWidth, gap, materialWidth, sideTrim });
  const requestedAcross = input.acrossMode === "manual"
    ? toQuoteNumber(input.numberAcross)
    : suggestedAcross;
  const numberAcross = Math.max(0, Math.floor(requestedAcross));
  const totalLayoutWidth = calculateLayoutWidth({ labelWidth, gap, numberAcross, sideTrim });
  const hasProductionInputs = repeat > 0 && quantity > 0 && materialWidth > 0 && numberAcross > 0;
  const fits = hasProductionInputs && totalLayoutWidth <= materialWidth + EPSILON;
  const widthDelta = materialWidth - totalLayoutWidth;
  const widthUsagePercent = materialWidth > 0 ? (totalLayoutWidth / materialWidth) * 100 : 0;
  const finishedMsi = labelWidth > 0 && labelLength > 0 && quantity > 0
    ? (labelWidth * labelLength * quantity) / 1000
    : 0;
  const baseMaterialMsi = fits
    ? (repeat * quantity * materialWidth) / (1000 * numberAcross)
    : 0;
  const wasteMultiplier = 1 + wastePercent / 100;
  const wasteMsi = baseMaterialMsi * (wastePercent / 100);
  const materialMsiWithWaste = baseMaterialMsi * wasteMultiplier;
  const materialCost = materialMsiWithWaste * msiCost;
  const extraCost = quoteExtraCostFields.reduce(
    (sum, field) => sum + Math.max(0, toQuoteNumber(input[field.name])),
    0
  );
  const totalCost = materialCost + extraCost;
  const rawPricingPercent = Math.max(0, toQuoteNumber(input.pricingPercent));
  const pricingPercent = input.pricingMode === "markup"
    ? rawPricingPercent
    : Math.min(95, rawPricingPercent);
  const sellPrice = input.pricingMode === "markup"
    ? totalCost * (1 + pricingPercent / 100)
    : totalCost / (1 - pricingPercent / 100);
  const profit = sellPrice - totalCost;
  const pricePerThousand = quantity > 0 ? sellPrice / (quantity / 1000) : 0;
  const pricePerLabel = quantity > 0 ? sellPrice / quantity : 0;

  return {
    labelWidth,
    labelLength,
    repeat,
    quantity,
    materialWidth,
    gap,
    sideTrim,
    wastePercent,
    msiCost,
    suggestedAcross,
    numberAcross,
    totalLayoutWidth,
    fits,
    widthDelta,
    widthUsagePercent,
    finishedMsi,
    baseMaterialMsi,
    wasteMultiplier,
    wasteMsi,
    materialMsiWithWaste,
    materialCost,
    extraCost,
    totalCost,
    pricingPercent,
    sellPrice,
    profit,
    pricePerThousand,
    pricePerLabel,
  };
}

export function calculateFinishedMaterialMsiCost(material, rawMaterials = []) {
  if (!material) return 0;
  if (material.sourceType === "purchased") return Math.max(0, toQuoteNumber(material.purchasedMsiCost));

  const rawById = new Map(rawMaterials.map((raw) => [String(raw.id), raw]));
  const componentCost = finishedComponentSlots.reduce((sum, slot) => {
    const raw = rawById.get(String(material[slot.name] ?? ""));
    return sum + Math.max(0, toQuoteNumber(raw?.msiCost));
  }, 0);
  const adderCost = finishedMaterialAdderFields.reduce(
    (sum, field) => sum + Math.max(0, toQuoteNumber(material[field.name])),
    0
  );

  return componentCost + adderCost;
}

export function componentLabelForFinishedMaterial(material, rawMaterials = []) {
  if (!material || material.sourceType === "purchased") return "Purchased finished material";
  const rawById = new Map(rawMaterials.map((raw) => [String(raw.id), raw]));
  return finishedComponentSlots
    .map((slot) => rawById.get(String(material[slot.name] ?? ""))?.name)
    .filter(Boolean)
    .join(" + ") || "Made in-house";
}

export function buildLayoutCandidates(input, limit = 12) {
  const maxAcross = Math.min(calculateMaxAcross(input), limit);
  if (maxAcross <= 0) return [];

  return Array.from({ length: maxAcross }, (_, index) => {
    const numberAcross = index + 1;
    return calculateQuotePricing({
      ...input,
      acrossMode: "manual",
      numberAcross,
    });
  }).reverse();
}
