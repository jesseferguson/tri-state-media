import { PackageCheck, PackageMinus } from "lucide-react";
import { formatCell, formatInches, labelize } from "../lib/format";

function numeric(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function locationName(row) {
  return row.location_full_path || row.location_name || "No location";
}

function itemTitle(row) {
  return row.kind === "core"
    ? [row.core_item_number, row.core_name, row.core_size_inches ? formatInches(row.core_size_inches) : ""].filter(Boolean).join(" / ")
    : [row.box_item_number, row.box_name].filter(Boolean).join(" / ");
}

function itemSupplier(row) {
  return row.kind === "core" ? row.core_supplier : row.box_supplier;
}

function normalizeBox(row) {
  return { ...row, kind: "box" };
}

function normalizeCore(row) {
  return { ...row, kind: "core" };
}

function InventoryCard({ row }) {
  const Icon = row.kind === "core" ? PackageMinus : PackageCheck;
  return (
    <article className={`packaging-inventory-card ${row.kind}`}>
      <div className="packaging-inventory-icon">
        <Icon size={17} />
      </div>
      <div className="packaging-inventory-main">
        <strong>{itemTitle(row) || "Unnamed item"}</strong>
        <span>{[itemSupplier(row), row.lot_number].filter(Boolean).join(" / ") || "No supplier or lot"}</span>
      </div>
      <div className="packaging-inventory-qty">
        <strong>{numeric(row.quantity).toLocaleString()}</strong>
        <span>{labelize(row.status || "available")}</span>
      </div>
      <div className="packaging-inventory-location">
        <strong>{locationName(row)}</strong>
        <span>{formatCell(row, "received_date")}</span>
      </div>
    </article>
  );
}

function groupByLocation(rows) {
  return rows.reduce((acc, row) => {
    const key = locationName(row);
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});
}

export default function PackagingInventoryView({ boxRows = [], coreRows = [], search = "" }) {
  const needle = String(search || "").toLowerCase();
  const rows = [...boxRows.map(normalizeBox), ...coreRows.map(normalizeCore)]
    .filter((row) => row.is_active !== false)
    .filter((row) => {
      if (!needle) return true;
      return [
        row.kind,
        itemTitle(row),
        itemSupplier(row),
        row.lot_number,
        row.status,
        locationName(row),
        row.notes,
      ].filter(Boolean).join(" ").toLowerCase().includes(needle);
    })
    .sort((a, b) => locationName(a).localeCompare(locationName(b)) || a.kind.localeCompare(b.kind) || itemTitle(a).localeCompare(itemTitle(b)));
  const groups = groupByLocation(rows);
  const boxCount = rows.filter((row) => row.kind === "box").length;
  const coreCount = rows.filter((row) => row.kind === "core").length;
  const totalQty = rows.reduce((sum, row) => sum + numeric(row.quantity), 0);

  return (
    <section className="packaging-inventory-view">
      <div className="packaging-inventory-summary">
        <div>
          <span>Box Lots</span>
          <strong>{boxCount.toLocaleString()}</strong>
        </div>
        <div>
          <span>Core Lots</span>
          <strong>{coreCount.toLocaleString()}</strong>
        </div>
        <div>
          <span>Total Quantity</span>
          <strong>{totalQty.toLocaleString()}</strong>
        </div>
      </div>

      {Object.entries(groups).map(([location, items]) => (
        <section className="packaging-location-group" key={location}>
          <header>
            <strong>{location}</strong>
            <span>{items.length} lot{items.length === 1 ? "" : "s"}</span>
          </header>
          <div>
            {items.map((row) => <InventoryCard key={`${row.kind}-${row.id}`} row={row} />)}
          </div>
        </section>
      ))}

      {!rows.length && <p className="empty-row">No packaging inventory matches this view.</p>}
    </section>
  );
}
