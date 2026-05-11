import { useMemo, useState } from "react";
import { CalendarPlus, Edit3, PackageCheck, Trash2 } from "lucide-react";
import RecipeOptionsView from "./RecipeOptionsView";
import { formatInches, getRecordTitle, labelize } from "../lib/format";

const tabs = [
  { key: "general", label: "General" },
  { key: "schedule", label: "Schedule" },
  { key: "editor", label: "Editor" },
  { key: "spec", label: "Spec" },
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

function Stat({ label, value }) {
  return (
    <div className="job-stat">
      <span>{label}</span>
      <strong>{value ?? "--"}</strong>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="job-info-row">
      <span>{label}</span>
      <strong>{value || "--"}</strong>
    </div>
  );
}

function materialTitle(ticket) {
  return [
    ticket.material_spec_code,
    ticket.material_spec_name,
    ticket.material_spec_family,
    ticket.material_spec_gsm ? `${ticket.material_spec_gsm} GSM` : "",
    ticket.material_spec_liner_pounds ? `${ticket.material_spec_liner_pounds}#` : "",
  ].filter(Boolean).join(" / ");
}

function matchingMaterialInventory(ticket, rows) {
  return (rows ?? []).filter((row) => {
    if (sameId(row.material, ticket.material_spec)) return true;
    if (ticket.material_spec_code && row.material_code === ticket.material_spec_code) return true;
    if (ticket.material_spec_code && row.code === ticket.material_spec_code) return true;
    return false;
  });
}

function groupInventoryByWidth(rows) {
  return (rows ?? []).reduce((acc, row) => {
    const key = row.width_inches ? `${formatInches(row.width_inches)} wide` : "No width";
    if (!acc[key]) acc[key] = { rows: [], total: 0 };
    acc[key].rows.push(row);
    const qty = Number(row.length_feet ?? row.quantity ?? 0);
    if (Number.isFinite(qty) && !["depleted", "scrapped"].includes(row.status)) acc[key].total += qty;
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
  return (rows ?? []).filter((row) => sameId(row.box, ticket.box));
}

function matchingSchedule(ticket, rows) {
  return (rows ?? []).filter((row) => sameId(row.job_ticket, ticket.id) || row.job_ticket_number === ticket.ticket_number);
}

function matchingOrders(ticket, rows) {
  return (rows ?? []).filter((row) => sameId(row.job_ticket, ticket.id) || row.job_ticket_number === ticket.ticket_number);
}

export default function JobTicketPanel({ ticket, lookups, editing, deleting, onEdit, onDelete, onSchedule }) {
  const [activeTab, setActiveTab] = useState("general");

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

  const boxInventory = useMemo(
    () => matchingBoxInventory(ticket, lookups["box-inventory"]),
    [ticket, lookups]
  );

  const scheduleRows = useMemo(
    () => matchingSchedule(ticket, lookups["production-schedule"]),
    [ticket, lookups]
  );

  const orderRows = useMemo(
    () => matchingOrders(ticket, lookups["customer-orders"]),
    [ticket, lookups]
  );

  const recentBoxAverage = useMemo(() => {
    const recent = finishedRows.filter((row) => row.status === "shipped" && dateInLastMonths(row.run_date, 3));
    const boxes = recent.reduce((sum, row) => sum + getBoxCount(row, ticket), 0);
    return boxes > 0 ? Math.round((boxes / 3) * 10) / 10 : null;
  }, [finishedRows, ticket]);

  const availableInventory = materialInventory.filter((row) => row.is_active !== false && !["depleted", "scrapped"].includes(row.status));
  const inventoryByWidth = useMemo(() => groupInventoryByWidth(availableInventory), [availableInventory]);
  const availableBoxes = boxInventory.filter((row) => row.is_active !== false && !["depleted", "scrapped"].includes(row.status));
  const title = getRecordTitle(ticket);

  return (
    <>
      <div className="panel-head thin">
        <div>
          <p className="eyebrow">Job Packet</p>
          <h2>{title}</h2>
        </div>
      </div>

      <div className="job-tabs" role="tablist" aria-label="Job ticket sections">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={activeTab === tab.key ? "active" : ""}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "general" && (
        <div className="job-panel-section">
          <div className="job-stat-grid">
            <Stat label="Material Rolls" value={availableInventory.length} />
            <Stat label="Box Locations" value={availableBoxes.length} />
            <Stat label="Avg Boxes / Month" value={recentBoxAverage ?? "--"} />
          </div>

          <div className="job-info-list">
            <InfoRow label="Customer" value={ticket.customer_name} />
            <InfoRow label="Customer Sheet" value={ticket.customer_display} />
            <InfoRow label="Product" value={ticket.product_code} />
            <InfoRow label="Material" value={materialTitle(ticket)} />
            <InfoRow label="Label Size" value={`${formatInches(ticket.label_width_inches)} x ${formatInches(ticket.label_length_inches)}`} />
            <InfoRow label="Repeat" value={formatInches(ticket.repeat_inches)} />
            <InfoRow label="Cutting" value={labelize(ticket.cutting_type)} />
            <InfoRow label="Finishing" value={labelize(ticket.finishing_type)} />
            <InfoRow label="Box" value={[ticket.box_item_number, ticket.box_name, ticket.box_supplier].filter(Boolean).join(" / ")} />
          </div>

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
              <strong>Box Inventory Locations</strong>
            </div>
            {availableBoxes.length ? (
              <div className="job-inventory-list">
                {availableBoxes.slice(0, 8).map((row) => (
                  <div key={row.id} className="job-inventory-row">
                    <strong>{row.lot_number || row.box_name}</strong>
                    <span>{row.location_full_path || row.location_name || "No location"}</span>
                    <em>{[row.quantity ? `${row.quantity} boxes` : "", labelize(row.status)].filter(Boolean).join(" / ")}</em>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No active box inventory is linked to this box yet.</p>
            )}
          </section>
        </div>
      )}

      {activeTab === "schedule" && (
        <div className="job-panel-section">
          <div className="job-editor-actions">
            <button className="primary-btn" type="button" onClick={onSchedule}>
              <CalendarPlus size={15} /> Schedule This Job
            </button>
          </div>

          {scheduleRows.length ? (
            <div className="job-inventory-list">
              {scheduleRows.map((row) => (
                <div key={row.id} className="job-inventory-row">
                  <strong>{[row.scheduled_date, labelize(row.priority), labelize(row.status)].filter(Boolean).join(" / ")}</strong>
                  <span>{[row.customer_po ? `PO ${row.customer_po}` : "", row.quantity_to_ship ? `${row.quantity_to_ship} ship` : "", row.quantity_to_stock ? `${row.quantity_to_stock} stock` : ""].filter(Boolean).join(" / ")}</span>
                  <em>{row.notes || "No operator note"}</em>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">This job is not actively scheduled yet.</p>
          )}

          <section className="job-subsection">
            <div className="job-subsection-head">
              <PackageCheck size={15} />
              <strong>Customer Order Pool</strong>
            </div>
            {orderRows.length ? (
              <div className="job-inventory-list">
                {orderRows.map((row) => (
                  <div key={row.id} className="job-inventory-row">
                    <strong>{[row.order_date, row.customer_name, row.customer_po ? `PO ${row.customer_po}` : ""].filter(Boolean).join(" / ")}</strong>
                    <span>{[row.quantity_to_ship ? `${row.quantity_to_ship} ship` : "", row.quantity_to_stock ? `${row.quantity_to_stock} stock` : "", labelize(row.status)].filter(Boolean).join(" / ")}</span>
                    <em>{row.operator_note || "No note"}</em>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No permanent customer order records exist for this job yet.</p>
            )}
          </section>
        </div>
      )}

      {activeTab === "editor" && (
        <div className="job-panel-section">
          <div className="job-editor-actions">
            <button className="primary-btn" type="button" onClick={onEdit} disabled={editing}>
              <Edit3 size={15} /> Edit Job Ticket
            </button>
            <button className="danger-btn" type="button" onClick={onDelete} disabled={deleting}>
              <Trash2 size={15} /> Delete
            </button>
          </div>

          <div className="job-info-list">
            <InfoRow label="Ticket #" value={ticket.ticket_number} />
            <InfoRow label="Job Name" value={ticket.job_name} />
            <InfoRow label="Requested Qty" value={ticket.requested_quantity} />
            <InfoRow label="Labels / Unit" value={ticket.labels_per_unit} />
            <InfoRow label="Units / Carton" value={ticket.units_per_carton} />
            <InfoRow label="Core Size" value={formatInches(ticket.core_size_inches)} />
            <InfoRow label="Wind" value={ticket.wind_direction ? `Wind ${ticket.wind_direction}` : ""} />
            <InfoRow label="Finishing Notes" value={ticket.finishing_notes} />
            <InfoRow label="Job Notes" value={ticket.job_notes} />
          </div>
        </div>
      )}

      {activeTab === "spec" && (
        <div className="job-panel-section">
          <div className="job-info-list">
            <InfoRow label="Tooling Recipe" value={ticket.recipe_name} />
            <InfoRow label="Operator Spec" value={`${formatInches(ticket.label_width_inches)} x ${formatInches(ticket.label_length_inches)} / ${formatInches(ticket.repeat_inches)} repeat / ${labelize(ticket.cutting_type)}`} />
            <InfoRow label="Finishing" value={[labelize(ticket.finishing_type), ticket.labels_per_unit ? `${ticket.labels_per_unit} labels/unit` : "", ticket.units_per_carton ? `${ticket.units_per_carton} units/carton` : ""].filter(Boolean).join(" / ")} />
          </div>

          <section className="job-subsection">
            <div className="job-subsection-head">
              <PackageCheck size={15} />
              <strong>Recipe Tooling</strong>
            </div>
            {recipeOptions.length ? (
              <RecipeOptionsView rows={recipeOptions} />
            ) : (
              <p className="muted">Attach a tooling recipe to show operator tooling information here.</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
