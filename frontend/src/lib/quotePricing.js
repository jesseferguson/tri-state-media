const EPSILON = 0.000001;

export const wasteRecommendationRules = [
  { minFootage: 90000, wastePercent: 6, label: "90,000+ ft" },
  { minFootage: 50000, wastePercent: 7, label: "50,000-89,999 ft" },
  { minFootage: 20000, wastePercent: 7.5, label: "20,000-49,999 ft" },
  { minFootage: 10000, wastePercent: 8, label: "10,000-19,999 ft" },
  { minFootage: 5000, wastePercent: 10, label: "5,000-9,999 ft" },
  { minFootage: 0, wastePercent: 25, label: "under 5,000 ft" },
];

export const colorWasteRecommendationRules = [
  { minFootage: 90000, wastePercentPerColor: 0.25, label: "90,000+ ft" },
  { minFootage: 50000, wastePercentPerColor: 0.5, label: "50,000-89,999 ft" },
  { minFootage: 20000, wastePercentPerColor: 1, label: "20,000-49,999 ft" },
  { minFootage: 10000, wastePercentPerColor: 2, label: "10,000-19,999 ft" },
  { minFootage: 5000, wastePercentPerColor: 4, label: "5,000-9,999 ft" },
  { minFootage: 0, wastePercentPerColor: 6, label: "under 5,000 ft" },
];

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
  { name: "complexityMsiCost", label: "Complexity" },
  { name: "otherMsiCost", label: "Other" },
];

export const quoteRateDefaults = [
  { key: "labor", label: "Labor", msiCost: "0", notes: "Added to every made in-house finished material." },
  { key: "color", label: "Color / Ink", msiCost: "0.03", notes: "Multiplied by the number of colors on a quote item." },
  { key: "coating", label: "Coating", msiCost: "0", notes: "Multiplied by the number of coatings on a quote item." },
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

export function calculateAutoRepeat({ labelLength, gap }) {
  return Math.max(0, toQuoteNumber(labelLength) + Math.max(0, toQuoteNumber(gap)));
}

export function calculateRunFootage({ quantity, repeat, numberAcross }) {
  const labelQuantity = Math.max(0, toQuoteNumber(quantity));
  const repeatInches = Math.max(0, toQuoteNumber(repeat));
  const lanes = Math.max(0, Math.floor(toQuoteNumber(numberAcross)));
  if (labelQuantity <= 0 || repeatInches <= 0 || lanes <= 0) return 0;
  return (labelQuantity * repeatInches) / 12 / lanes;
}

export function calculateRecommendedWastePercent({ runFootage, colorCount }) {
  const footage = Math.max(0, toQuoteNumber(runFootage));
  const colors = Math.max(0, Math.floor(toQuoteNumber(colorCount)));
  const baseRule = wasteRecommendationRules.find((rule) => footage >= rule.minFootage) || wasteRecommendationRules[wasteRecommendationRules.length - 1];
  const colorRule = colorWasteRecommendationRules.find((rule) => footage >= rule.minFootage) || colorWasteRecommendationRules[colorWasteRecommendationRules.length - 1];
  return {
    baseWastePercent: baseRule.wastePercent,
    colorWastePercent: colors * colorRule.wastePercentPerColor,
    colorWastePercentPerColor: colorRule.wastePercentPerColor,
    recommendedWastePercent: baseRule.wastePercent + colors * colorRule.wastePercentPerColor,
    ruleLabel: baseRule.label,
    colorRuleLabel: colorRule.label,
  };
}

export function calculateQuotePricing(input) {
  const labelWidth = toQuoteNumber(input.labelWidth);
  const labelLength = toQuoteNumber(input.labelLength);
  const repeat = calculateAutoRepeat(input);
  const quantity = toQuoteNumber(input.quantity);
  const materialWidth = toQuoteNumber(input.materialWidth);
  const gap = Math.max(0, toQuoteNumber(input.gap));
  const sideTrim = Math.max(0, toQuoteNumber(input.sideTrim));
  const wastePercent = Math.max(0, toQuoteNumber(input.wastePercent));
  const msiCost = Math.max(0, toQuoteNumber(input.msiCost));
  const colorCount = Math.max(0, Math.floor(toQuoteNumber(input.colorCount)));
  const coatingCount = Math.max(0, Math.floor(toQuoteNumber(input.coatingCount)));
  const colorMsiCost = Math.max(0, toQuoteNumber(input.colorMsiCost));
  const coatingMsiCost = Math.max(0, toQuoteNumber(input.coatingMsiCost));
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
  const runFootage = fits ? calculateRunFootage({ quantity, repeat, numberAcross }) : 0;
  const wasteRecommendation = calculateRecommendedWastePercent({ runFootage, colorCount });
  const baseMaterialMsi = fits
    ? (repeat * quantity * materialWidth) / (1000 * numberAcross)
    : 0;
  const wasteMultiplier = 1 + wastePercent / 100;
  const wasteMsi = baseMaterialMsi * (wastePercent / 100);
  const materialMsiWithWaste = baseMaterialMsi * wasteMultiplier;
  const materialCost = materialMsiWithWaste * msiCost;
  const colorCost = materialMsiWithWaste * colorMsiCost * colorCount;
  const coatingCost = materialMsiWithWaste * coatingMsiCost * coatingCount;
  const processMsiCost = colorCost + coatingCost;
  const productionCost = materialCost + processMsiCost;
  const extraCost = quoteExtraCostFields.reduce(
    (sum, field) => sum + Math.max(0, toQuoteNumber(input[field.name])),
    0
  );
  const totalCost = productionCost + extraCost;
  const rawPricingPercent = Math.max(0, toQuoteNumber(input.pricingPercent));
  const pricingPercent = input.pricingMode === "markup"
    ? rawPricingPercent
    : Math.min(95, rawPricingPercent);
  const markedUpProductionSellPrice = input.pricingMode === "markup"
    ? productionCost * (1 + pricingPercent / 100)
    : productionCost / (1 - pricingPercent / 100);
  const sellPrice = markedUpProductionSellPrice + extraCost;
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
    colorCount,
    coatingCount,
    colorMsiCost,
    coatingMsiCost,
    suggestedAcross,
    numberAcross,
    totalLayoutWidth,
    fits,
    widthDelta,
    widthUsagePercent,
    finishedMsi,
    runFootage,
    baseWastePercent: wasteRecommendation.baseWastePercent,
    colorWastePercent: wasteRecommendation.colorWastePercent,
    colorWastePercentPerColor: wasteRecommendation.colorWastePercentPerColor,
    recommendedWastePercent: wasteRecommendation.recommendedWastePercent,
    wasteRuleLabel: wasteRecommendation.ruleLabel,
    colorWasteRuleLabel: wasteRecommendation.colorRuleLabel,
    baseMaterialMsi,
    wasteMultiplier,
    wasteMsi,
    materialMsiWithWaste,
    materialCost,
    colorCost,
    coatingCost,
    processMsiCost,
    productionCost,
    extraCost,
    totalCost,
    pricingPercent,
    markedUpProductionSellPrice,
    sellPrice,
    profit,
    pricePerThousand,
    pricePerLabel,
  };
}

export function rateCost(rates, key) {
  const rate = (rates || []).find((item) => item.key === key);
  return Math.max(0, toQuoteNumber(rate?.msiCost));
}

export function calculateFinishedMaterialMsiCost(material, rawMaterials = [], rates = []) {
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
  const globalLaborCost = rateCost(rates, "labor");

  return componentCost + adderCost + globalLaborCost;
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

export function calculateBestMaterialWidth(input, presets = []) {
  const candidates = presets
    .map((width) => {
      const recommendationPricing = calculateQuotePricing({
        ...input,
        materialWidth: width,
        acrossMode: "auto",
        numberAcross: "",
      });
      const pricing = calculateQuotePricing({
        ...input,
        materialWidth: width,
        acrossMode: "auto",
        numberAcross: "",
        wastePercent: recommendationPricing.recommendedWastePercent,
      });
      return { width: String(width), pricing };
    })
    .filter(({ pricing }) => pricing.fits && pricing.numberAcross > 0);

  if (!candidates.length) return "";

  candidates.sort((a, b) => {
    const costDelta = a.pricing.productionCost - b.pricing.productionCost;
    if (Math.abs(costDelta) > EPSILON) return costDelta;
    const wasteDelta = a.pricing.widthDelta - b.pricing.widthDelta;
    if (Math.abs(wasteDelta) > EPSILON) return wasteDelta;
    return a.pricing.materialWidth - b.pricing.materialWidth;
  });

  return candidates[0].width;
}
