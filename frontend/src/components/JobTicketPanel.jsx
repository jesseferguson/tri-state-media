import { useMemo, useState } from "react";
import { CalendarPlus, FileText, Image as ImageIcon, PackageCheck } from "lucide-react";
import RecipeOptionsView from "./RecipeOptionsView";
import { formatInches, labelize } from "../lib/format";

const tabs = [
  { key: "general", label: "General" },
  { key: "schedule", label: "Schedule" },
  { key: "editor", label: "Editor" },
];

const chartRangeOptions = [
  { key: "all", label: "All" },
  { key: "last-quarter", label: "Last Quarter" },
  { key: "last-year", label: "Last Year" },
  { key: "ytd", label: "YTD" },
  { key: "30bd", label: "30 Days", featured: true },
  { key: "60bd", label: "60 Days", featured: true },
  { key: "90bd", label: "90 Days", featured: true },
];

function sameId(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

function dateInLastMonths(value, months = 3) {
  if (!value) return false;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return date >= cutoff;
}

function getBoxCount(row, ticket) {
  const unit = String(row.unit ?? "").toLowerCase();
  const qty = Number(row.quantity ?? 0);
  if (["carton", "case"].includes(unit)) return Number.isFinite(qty) ? qty : 0;
  return 0;
}

function numeric(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function inventoryFootage(row) {
  return numeric(row?.length_feet ?? row?.quantity);
}

function formatNumber(value, suffix = "") {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "--";
  const rounded = Math.round(n * 10) / 10;
  return `${rounded.toLocaleString()}${suffix}`;
}

function unitNoun(ticket) {
  return ticket?.unit_type === "tag" ? "Tags" : "Labels";
}

function unitPerPackageLabel(ticket) {
  return ticket?.finishing_type === "rolls" ? `${unitNoun(ticket)} / Roll` : `${unitNoun(ticket)} / Unit`;
}

function unitsPerCartonLabel(ticket) {
  return `${unitNoun(ticket)} / Carton`;
}

function labelsPerFoldLabel(ticket) {
  return `${unitNoun(ticket)} / Fold`;
}

function inventoryRollName(row) {
  return row?.name || row?.source_roll_tag_number || row?.serial_number || row?.lot_number || row?.code || "Roll";
}

function inventoryLocation(row) {
  return row?.location_full_path || row?.location_name || "No location";
}

function Stat({ label, value, bars, rangeLabel }) {
  return (
    <div className="job-stat">
      <div>
        <span>{label}</span>
        <strong>{value ?? "--"}</strong>
      </div>
      {bars && <MiniBarChart bars={bars} rangeLabel={rangeLabel} />}
    </div>
  );
}

function MiniBarChart({ bars, rangeLabel }) {
  const [selected, setSelected] = useState(null);
  if (!bars?.length) {
    return <div className="job-mini-chart empty"><span>No data</span></div>;
  }
  const max = Math.max(...bars.map((bar) => bar.value), 1);
  const active = selected || bars[bars.length - 1];
  return (
    <div className="job-mini-bars">
      <div className="job-mini-bar-track" style={{ "--bar-count": bars.length }}>
        {bars.map((bar) => (
          <button
            type="button"
            key={bar.key}
            title={`${bar.label}: ${formatNumber(bar.value)}`}
            className={active.key === bar.key ? "active" : ""}
            style={{ "--bar-height": `${Math.max(4, (bar.value / max) * 100)}%` }}
            onMouseEnter={() => setSelected(bar)}
            onFocus={() => setSelected(bar)}
            onClick={() => setSelected(bar)}
          >
            <span />
          </button>
        ))}
      </div>
      <em>{active.label}: {formatNumber(active.value)} <small>{rangeLabel}</small></em>
    </div>
  );
}

function sameText(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const left = String(a).trim().toLowerCase();
  const right = String(b).trim().toLowerCase();
  if (!left || !right) return false;
  return left === right;
}

function sameNumber(a, b) {
  const left = Number(a);
  const right = Number(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 0.0001;
}

function InfoRow({ label, value, wide = false }) {
  const displayValue = value === null || value === undefined || value === "" ? "--" : value;
  return (
    <div className={`job-info-row ${wide ? "wide" : ""}`} title={`${label}: ${displayValue}`}>
      <span>{label}</span>
      <strong>{displayValue}</strong>
    </div>
  );
}

function primaryImage(ticket) {
  const images = Array.isArray(ticket.job_images) ? ticket.job_images : [];
  return (
    images.find((image) => image.slot === "general" && image.url) ||
    images.find((image) => image.url) ||
    null
  );
}

function imageSourceLabel(image) {
  return image?.source || "";
}

function matchingMaterialInventory(ticket, rows) {
  return (rows ?? []).filter((row) => {
    if (sameId(row.material, ticket.material_spec)) return true;
    if (ticket.material_master_type && sameId(row.material_master_type, ticket.material_master_type)) return true;
    if (ticket.material_spec_master_type && sameId(row.material_master_type, ticket.material_spec_master_type)) return true;
    if (ticket.material_spec_code && row.material_code === ticket.material_spec_code) return true;
    if (ticket.material_spec_code && row.code === ticket.material_spec_code) return true;
    return false;
  });
}

function groupInventoryByWidth(rows) {
  return (rows ?? []).reduce((acc, row) => {
    const qty = inventoryFootage(row);
    if (qty <= 0 || ["depleted", "scrapped"].includes(row.status)) return acc;
    const key = row.width_inches ? `${formatInches(row.width_inches)} wide` : "No width";
    if (!acc[key]) acc[key] = { rows: [], total: 0 };
    acc[key].rows.push(row);
    acc[key].total += qty;
    return acc;
  }, {});
}

function matchingFinishedRows(ticket, rows) {
  return (rows ?? []).filter((row) => sameId(row.job_ticket, ticket.id) || row.job_ticket_number === ticket.ticket_number);
}

function matchingRecipeOptions(ticket, rows) {
  return (rows ?? []).filter((row) => {
    if (ticket.recipe && sameId(row.recipe, ticket.recipe)) return true;
    if (ticket.recipe_name && row.recipe_name === ticket.recipe_name) return true;
    return false;
  });
}

function matchingBoxInventory(ticket, rows) {
  return (rows ?? []).filter((row) => {
    if (sameId(row.box, ticket.box)) return true;
    if (sameText(row.box_item_number, ticket.box_item_number || ticket.linked_box_item_number)) return true;
    if (sameText(row.box_name, ticket.box_name)) return true;
    return false;
  });
}

function matchingCoreInventory(ticket, rows) {
  return (rows ?? []).filter((row) => {
    if (sameId(row.core, ticket.core)) return true;
    if (sameText(row.core_item_number, ticket.core_item_number)) return true;
    if (sameText(row.core_name, ticket.core_name)) return true;
    if (sameNumber(row.core_size_inches, ticket.core_size_inches)) return true;
    return false;
  });
}

function activePackagingRows(rows) {
  return (rows ?? [])
    .filter((row) => row.is_active !== false && !["depleted", "scrapped"].includes(row.status) && numeric(row.quantity) > 0)
    .sort((a, b) => String(a.location_full_path || a.location_name || "").localeCompare(String(b.location_full_path || b.location_name || "")));
}

function shortDate(value) {
  if (!value) return "--";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function RecipePressOverview({ rows }) {
  const groups = (rows ?? []).reduce((acc, row) => {
    const pressName = row.press_name || row.press_details?.name || "No press";
    if (!acc[pressName]) acc[pressName] = { total: 0, approved: 0, preferred: 0 };
    acc[pressName].total += 1;
    if (row.is_approved !== false && row.is_active !== false) acc[pressName].approved += 1;
    if (row.is_preferred) acc[pressName].preferred += 1;
    return acc;
  }, {});
  const entries = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return null;
  return (
    <div className="job-recipe-press-strip" aria-label="Recipe press options">
      {entries.map(([pressName, stat]) => (
        <div key={pressName} className={stat.approved ? "ready" : "review"}>
          <span>Press</span>
          <strong>{pressName}</strong>
          <em>{stat.approved}/{stat.total} active{stat.preferred ? ` / ${stat.preferred} preferred` : ""}</em>
        </div>
      ))}
    </div>
  );
}

function PackagingInventoryTable({ title, type, rows }) {
  const visibleRows = activePackagingRows(rows);
  const isCore = type === "core";
  return (
    <div className="job-packaging-inventory-card">
      <div className="job-packaging-inventory-head">
        <strong>{title}</strong>
        <span>{visibleRows.length ? `${visibleRows.length} active location${visibleRows.length === 1 ? "" : "s"}` : "No active inventory"}</span>
      </div>
      {visibleRows.length ? (
        <div className="job-packaging-table-wrap">
          <table className="job-packaging-table">
            <thead>
              <tr>
                <th>Item #</th>
                <th>{isCore ? "Core" : "Box"}</th>
                <th>Supplier</th>
                {isCore && <th>Size</th>}
                <th>Lot</th>
                <th className="qty-cell">Qty</th>
                <th>Status</th>
                <th>Location</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id || `${row.lot_number}-${row.location_full_path || row.location_name}`}>
                  <td title={isCore ? row.core_item_number : row.box_item_number}>{isCore ? row.core_item_number || "--" : row.box_item_number || "--"}</td>
                  <td title={isCore ? row.core_name : row.box_name}>{isCore ? row.core_name || "--" : row.box_name || "--"}</td>
                  <td title={isCore ? row.core_supplier : row.box_supplier}>{isCore ? row.core_supplier || "--" : row.box_supplier || "--"}</td>
                  {isCore && <td>{formatInches(row.core_size_inches)}</td>}
                  <td title={row.lot_number}>{row.lot_number || "--"}</td>
                  <td className="qty-cell">{formatNumber(row.quantity)}</td>
                  <td>{labelize(row.status || "available")}</td>
                  <td title={row.location_full_path || row.location_name}>{row.location_full_path || row.location_name || "--"}</td>
                  <td>{shortDate(row.received_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No linked {isCore ? "core" : "box"} inventory is available yet.</p>
      )}
    </div>
  );
}

function matchingSchedule(ticket, rows) {
  return (rows ?? []).filter((row) => sameId(row.job_ticket, ticket.id) || row.job_ticket_number === ticket.ticket_number);
}

function scheduleQuantity(row) {
  return numeric(row.quantity_to_ship) + numeric(row.quantity_to_stock);
}

function dateValue(row) {
  return row.scheduled_date || row.order_date || row.due_date || row.run_date || "";
}

function subtractBusinessDays(days) {
  const now = new Date();
  const date = new Date(now);
  let remaining = days;
  while (remaining > 0) {
    date.setDate(date.getDate() - 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return date;
}

function rangeStart(rangeKey) {
  const now = new Date();
  if (rangeKey === "all") return null;
  if (rangeKey === "ytd") return new Date(now.getFullYear(), 0, 1);
  if (rangeKey === "last-year") return new Date(now.getFullYear() - 1, 0, 1);
  if (rangeKey === "last-quarter") {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const startMonth = currentQuarter === 0 ? 9 : (currentQuarter - 1) * 3;
    const year = currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear();
    return new Date(year, startMonth, 1);
  }
  if (rangeKey === "30bd") return subtractBusinessDays(30);
  if (rangeKey === "60bd") return subtractBusinessDays(60);
  if (rangeKey === "90bd") return subtractBusinessDays(90);
  return null;
}

function rangeEnd(rangeKey) {
  const now = new Date();
  if (rangeKey === "last-year") return new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
  if (rangeKey === "last-quarter") {
    const start = rangeStart(rangeKey);
    return new Date(start.getFullYear(), start.getMonth() + 3, 0, 23, 59, 59);
  }
  return now;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date) {
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function monthlyBars(rows, dateGetter, quantityGetter, rangeKey) {
  const start = rangeStart(rangeKey);
  const end = rangeEnd(rangeKey);
  const grouped = new Map();
  rows
    .map((row) => {
      const rawDate = dateGetter(row);
      const date = rawDate ? new Date(`${rawDate}T00:00:00`) : null;
      const quantity = quantityGetter(row);
      return date && !Number.isNaN(date.getTime()) && (!start || date >= start) && date <= end && quantity > 0
        ? { date, quantity }
        : null;
    })
    .filter(Boolean)
    .forEach((point) => {
      const key = monthKey(point.date);
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          label: monthLabel(point.date),
          value: 0,
          sort: new Date(point.date.getFullYear(), point.date.getMonth(), 1).getTime(),
        });
      }
      grouped.get(key).value += point.quantity;
    });

  return Array.from(grouped.values()).sort((a, b) => a.sort - b.sort);
}

function WidthFootageChart({ rows }) {
  const [selectedLabel, setSelectedLabel] = useState("");
  const groups = Object.entries(groupInventoryByWidth(rows ?? []))
    .map(([label, group]) => ({
      label,
      value: group.total,
      rows: [...group.rows].sort((a, b) => inventoryLocation(a).localeCompare(inventoryLocation(b))),
    }))
    .filter((group) => group.value > 0);
  if (!groups.length) return <p className="muted">No active material widths yet.</p>;
  const max = Math.max(...groups.map((group) => group.value), 1);
  const selectedGroup = groups.find((group) => group.label === selectedLabel);
  return (
    <div className="job-width-chart">
      {groups.map((group) => (
        <button
          key={group.label}
          type="button"
          className={selectedGroup?.label === group.label ? "active" : ""}
          onClick={() => setSelectedLabel((current) => (current === group.label ? "" : group.label))}
        >
          <span>{group.label}</span>
          <strong>{formatNumber(group.value, " ft")}</strong>
          <em style={{ "--bar-width": `${Math.max(5, (group.value / max) * 100)}%` }} />
        </button>
      ))}
      {selectedGroup && (
        <div className="job-width-detail">
          <strong>{selectedGroup.label} Locations</strong>
          <table>
            <thead>
              <tr>
                <th>Roll</th>
                <th>Location</th>
                <th>Feet</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {selectedGroup.rows.map((row) => (
                <tr key={row.id || `${inventoryRollName(row)}-${inventoryLocation(row)}`}>
                  <td>{inventoryRollName(row)}</td>
                  <td>{inventoryLocation(row)}</td>
                  <td>{formatNumber(inventoryFootage(row), " ft")}</td>
                  <td>{labelize(row.status || "available")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function JobTicketPanel({
  ticket,
  lookups,
  canEdit = false,
  canSchedule = false,
  canQuote = false,
  onQuoteJob,
  renderEditorForm,
  renderScheduleForm,
}) {
  const [activeTab, setActiveTab] = useState("general");
  const [chartRange, setChartRange] = useState("90bd");

  const materialInventory = useMemo(
    () => matchingMaterialInventory(ticket, lookups["raw-materials"]),
    [ticket, lookups]
  );

  const finishedRows = useMemo(
    () => matchingFinishedRows(ticket, lookups["finished-inventory"]),
    [ticket, lookups]
  );

  const recipeOptions = useMemo(
    () => matchingRecipeOptions(ticket, lookups["recipe-options"]),
    [ticket, lookups]
  );

  const scheduleRows = useMemo(
    () => matchingSchedule(ticket, lookups["production-schedule"]),
    [ticket, lookups]
  );
  const boxInventoryRows = useMemo(
    () => matchingBoxInventory(ticket, lookups["box-inventory"]),
    [ticket, lookups]
  );
  const coreInventoryRows = useMemo(
    () => matchingCoreInventory(ticket, lookups["core-inventory"]),
    [ticket, lookups]
  );

  const recentBoxAverage = useMemo(() => {
    const recent = finishedRows.filter((row) => row.status === "shipped" && dateInLastMonths(row.run_date, 3));
    const boxes = recent.reduce((sum, row) => sum + getBoxCount(row, ticket), 0);
    return boxes > 0 ? Math.round((boxes / 3) * 10) / 10 : null;
  }, [finishedRows, ticket]);

  const availableInventory = materialInventory.filter((row) => row.is_active !== false && !["depleted", "scrapped"].includes(row.status));
  const availableInventoryWithFeet = availableInventory.filter((row) => inventoryFootage(row) > 0);
  const inventoryByWidth = useMemo(() => groupInventoryByWidth(availableInventoryWithFeet), [availableInventoryWithFeet]);
  const availableFinished = finishedRows.filter((row) => row.is_active !== false && !["depleted", "scrapped", "shipped"].includes(row.status));
  const materialFeet = availableInventoryWithFeet.reduce((sum, row) => sum + inventoryFootage(row), 0);
  const finishedQuantity = availableFinished.reduce((sum, row) => sum + numeric(row.quantity), 0);
  const scheduleTotal = scheduleRows.reduce((sum, row) => sum + scheduleQuantity(row), 0);
  const averageScheduled = scheduleRows.length ? scheduleTotal / scheduleRows.length : null;
  const selectedRangeLabel = chartRangeOptions.find((option) => option.key === chartRange)?.label || "90 Days";
  const scheduledBars = useMemo(
    () => monthlyBars(scheduleRows, dateValue, scheduleQuantity, chartRange),
    [chartRange, scheduleRows]
  );
  const shippedBars = useMemo(
    () => monthlyBars(
      finishedRows.filter((row) => row.status === "shipped"),
      (row) => row.run_date,
      (row) => getBoxCount(row, ticket) || numeric(row.quantity),
      chartRange
    ),
    [chartRange, finishedRows, ticket]
  );
  const recentSchedules = [...scheduleRows]
    .sort((a, b) => String(dateValue(b)).localeCompare(String(dateValue(a))))
    .slice(0, 6);
  const image = primaryImage(ticket);
  const visibleTabs = tabs.filter((tab) => {
    if (tab.key === "schedule") return canSchedule;
    if (tab.key === "editor") return canEdit;
    return true;
  });

  function selectTab(key) {
    setActiveTab(key);
  }

  return (
    <div className="job-ticket-panel">
      <div className="job-packet-toolbar">
        <div>
          <p className="eyebrow">Job Packet</p>
          <strong>{ticket.product_code ? `TSM ${ticket.product_code}` : ticket.customer_display || ticket.customer_name || "Job details"}</strong>
        </div>
        <div>
          {canQuote && (
            <button className="primary-btn" type="button" onClick={onQuoteJob}>
              <FileText size={15} /> Quote Job
            </button>
          )}
        </div>
      </div>

      {visibleTabs.length > 1 && (
        <div className="job-tabs" role="tablist" aria-label="Job ticket sections">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={activeTab === tab.key ? "active" : ""}
              onClick={() => selectTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {activeTab === "general" && (
        <div className="job-panel-section">
          <section className="job-hero-section">
            <div className="job-hero-image">
              {image?.url && !image.isDocument ? (
                <img src={image.url} alt={image.name || ticket.job_name || "Job image"} />
              ) : image?.url ? (
                <a className="job-linked-file" href={image.url} target="_blank" rel="noreferrer">
                  <ImageIcon size={30} />
                  <strong>Open linked file</strong>
                  <span>{image.source || "External source"}</span>
                </a>
              ) : (
                <div>
                  <ImageIcon size={30} />
                  <span>No job image</span>
                </div>
              )}
              {imageSourceLabel(image) && <span className="job-image-source-badge">{imageSourceLabel(image)}</span>}
            </div>
            <div className="job-hero-details">
              <div>
                <span>Customer</span>
                <strong>{ticket.customer_display || ticket.customer_name || "--"}</strong>
              </div>
              <div>
                <span>TSM ID</span>
                <strong>{ticket.product_code || "--"}</strong>
              </div>
              <div>
                <span>Material Type</span>
                <strong>{ticket.material_master_type_code || ticket.material_spec_master_type_code || "--"}</strong>
              </div>
              <div className="job-material-on-hand">
                <span>Material On Hand</span>
                <strong>{`${availableInventoryWithFeet.length} rolls / ${formatNumber(materialFeet, " ft")}`}</strong>
                <WidthFootageChart rows={availableInventoryWithFeet} />
              </div>
            </div>
          </section>

          <div className="job-chart-range">
            {chartRangeOptions.map((option) => (
              <button
                className={`${chartRange === option.key ? "active" : ""} ${option.featured ? "featured" : ""}`}
                type="button"
                key={option.key}
                onClick={() => setChartRange(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="job-stat-grid focus">
            <Stat label="Finished Stock" value={`${formatNumber(finishedQuantity)} units / ${availableFinished.length} lots`} />
            <Stat label="Avg Scheduled" value={averageScheduled ? formatNumber(averageScheduled) : "--"} bars={scheduledBars} rangeLabel={selectedRangeLabel} />
            <Stat label="Avg Shipped / Month" value={recentBoxAverage ?? "--"} bars={shippedBars} rangeLabel={selectedRangeLabel} />
          </div>

          <section className="job-spec-layout">
            <div className="job-subsection job-spec-card">
              <div className="job-subsection-head">
                <PackageCheck size={15} />
                <strong>Label Specs</strong>
              </div>
              <div className="job-info-list compact">
                <InfoRow label="Size" value={`${formatInches(ticket.label_width_inches)} x ${formatInches(ticket.label_length_inches)}`} />
                <InfoRow label="Repeat" value={formatInches(ticket.repeat_inches)} />
                <InfoRow label="Cutting" value={labelize(ticket.cutting_type)} />
                <InfoRow label="Recipe" value={ticket.recipe_name} wide />
                <InfoRow label="Description" value={ticket.description} wide />
              </div>
            </div>

            <div className="job-subsection job-spec-card">
              <div className="job-subsection-head">
                <PackageCheck size={15} />
                <strong>Packaging Specs</strong>
              </div>
              <div className="job-info-list compact">
                <InfoRow label="Finishing" value={labelize(ticket.finishing_type)} />
                <InfoRow label={unitPerPackageLabel(ticket)} value={ticket.labels_per_unit} />
                <InfoRow label={unitsPerCartonLabel(ticket)} value={ticket.units_per_carton} />
                <InfoRow label="Ribbon" value={labelize(ticket.ribbon || "no_ribbon")} />
                <InfoRow label="Laminate" value={labelize(ticket.laminate || "no_laminate")} />
                <InfoRow label="Bagged" value={labelize(ticket.bagged || "not_bagged")} />
                <InfoRow label="Core / Wind" value={[formatInches(ticket.core_size_inches), ticket.wind_direction ? `Wind ${ticket.wind_direction}` : ""].filter(Boolean).join(" / ")} wide />
                {ticket.finishing_type === "fanfold" && <InfoRow label="Fanfold Gear" value={ticket.fanfold_gear} />}
                {ticket.finishing_type === "fanfold" && <InfoRow label={labelsPerFoldLabel(ticket)} value={ticket.labels_per_fold} />}
                <InfoRow label="Box Item #" value={ticket.box_item_number || ticket.linked_box_item_number} />
                <InfoRow label="Box" value={[ticket.linked_box_item_number, ticket.box_name].filter(Boolean).join(" / ")} wide />
                <InfoRow label="Core" value={[ticket.core_item_number, ticket.core_name].filter(Boolean).join(" / ")} wide />
              </div>
            </div>
          </section>

          <section className="job-subsection">
            <div className="job-subsection-head">
              <PackageCheck size={15} />
              <strong>Packaging Inventory</strong>
            </div>
            <div className="job-packaging-inventory-grid">
              <PackagingInventoryTable title="Box Inventory" type="box" rows={boxInventoryRows} />
              <PackagingInventoryTable title="Core Inventory" type="core" rows={coreInventoryRows} />
            </div>
          </section>

          {(ticket.description || ticket.finishing_notes || ticket.job_notes) && (
            <section className="job-notes-grid">
              {ticket.description && (
                <div>
                  <span>Description</span>
                  <p>{ticket.description}</p>
                </div>
              )}
              {ticket.finishing_notes && (
                <div>
                  <span>Finishing Notes</span>
                  <p>{ticket.finishing_notes}</p>
                </div>
              )}
              {ticket.job_notes && (
                <div>
                  <span>Job Notes</span>
                  <p>{ticket.job_notes}</p>
                </div>
              )}
            </section>
          )}

          <section className="job-subsection">
            <div className="job-subsection-head">
              <PackageCheck size={15} />
              <strong>Recipe Tooling</strong>
            </div>
            {recipeOptions.length ? (
              <>
                <RecipePressOverview rows={recipeOptions} />
                <RecipeOptionsView rows={recipeOptions} defaultOpenAll />
              </>
            ) : (
              <p className="muted">Attach a tooling recipe to show operator tooling information here.</p>
            )}
          </section>

          <section className="job-subsection">
            <div className="job-subsection-head">
              <PackageCheck size={15} />
              <strong>Material Inventory By Width</strong>
            </div>
            {Object.keys(inventoryByWidth).length ? (
              <div className="job-inventory-list">
                {Object.entries(inventoryByWidth).map(([width, group]) => (
                  <div key={width} className="job-inventory-row">
                    <strong>{width}</strong>
                    <span>{`${group.total.toLocaleString()} ft across ${group.rows.length} lots`}</span>
                    <em>{group.rows.map((row) => row.location_full_path || row.location_name).filter(Boolean).slice(0, 3).join(" / ") || "No location"}</em>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No active inventory rolls are linked to this material family yet.</p>
            )}
          </section>

          <section className="job-subsection">
            <div className="job-subsection-head">
              <PackageCheck size={15} />
              <strong>Finished Stock Inventory</strong>
            </div>
            {availableFinished.length ? (
              <div className="job-inventory-list">
                {availableFinished.slice(0, 8).map((row) => (
                  <div key={row.id} className="job-inventory-row">
                    <strong>{row.name || row.sku || row.job_ticket_number}</strong>
                    <span>{[row.quantity ? `${row.quantity} ${row.unit || "units"}` : "", row.run_date, labelize(row.status)].filter(Boolean).join(" / ")}</span>
                    <em>{row.location_full_path || row.location_name || row.notes || "No location"}</em>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No finished stock is linked to this job yet.</p>
            )}
          </section>

          <section className="job-subsection">
            <div className="job-subsection-head">
              <CalendarPlus size={15} />
              <strong>Previous Schedule History</strong>
            </div>
            {recentSchedules.length ? (
              <div className="job-inventory-list">
                {recentSchedules.map((row) => (
                  <div key={row.id} className="job-inventory-row">
                    <strong>{[dateValue(row) || "No date", labelize(row.status), labelize(row.priority)].filter(Boolean).join(" / ")}</strong>
                    <span>{[row.customer_po ? `PO ${row.customer_po}` : "", scheduleQuantity(row) ? `${formatNumber(scheduleQuantity(row))} total` : ""].filter(Boolean).join(" / ")}</span>
                    <em>{row.notes || "No operator note"}</em>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No previous schedule records are linked to this job yet.</p>
            )}
          </section>
        </div>
      )}

      {activeTab === "schedule" && (
        <div className="job-panel-section job-schedule-form-only">
          {renderScheduleForm?.({ onCancel: () => setActiveTab("general") })}
        </div>
      )}

      {activeTab === "editor" && (
        <div className="job-panel-section job-editor-form-only">
          {renderEditorForm?.({ onCancel: () => setActiveTab("general") })}
        </div>
      )}
    </div>
  );
}
