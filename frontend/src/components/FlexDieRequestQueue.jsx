import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, PackageCheck, PackagePlus, RefreshCw, Search, ShoppingCart, XCircle } from "lucide-react";
import { fetchCollection, postRecordAction } from "../api";
import { formatInches, labelize } from "../lib/format";

function userLabel(user) {
  return user?.name || user?.username || "system";
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function requestSummary(row) {
  return [
    `${row.flex_die_number_across || "--"} across`,
    `${row.flex_die_number_around || "--"} around`,
    row.flex_die_gear ? `${row.flex_die_gear}T` : "",
    row.flex_die_repeat_inches ? `Repeat ${formatInches(row.flex_die_repeat_inches)}` : "",
    row.flex_die_web_width_inches ? `Web ${formatInches(row.flex_die_web_width_inches)}` : "",
    labelize(row.flex_die_shape_type),
  ].filter(Boolean).join(" / ");
}

function statusTone(status) {
  if (status === "ordered") return "ordered";
  if (status === "received") return "received";
  if (status === "closed_without_order") return "closed";
  return "requested";
}

function ProcessForm({ action, busy, onCancel, onSubmit }) {
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [quantity, setQuantity] = useState(1);

  return (
    <form
      className="flex-die-request-process-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ notes, reason, serialNumber, quantity });
      }}
    >
      {action === "receive" && (
        <div className="flex-die-request-receive-grid">
          <label>
            <span>Serial Number</span>
            <input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} placeholder="Optional serial number" />
          </label>
          <label>
            <span>Quantity</span>
            <input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          </label>
        </div>
      )}
      {action === "close" ? (
        <label>
          <span>Close Reason</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} required placeholder="Example: Request belongs to another FD folder / different specs." />
        </label>
      ) : (
        <label>
          <span>{action === "ordered" ? "Order Notes" : "Receive Notes"}</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional processing note" />
        </label>
      )}
      <div className="flex-die-request-process-actions">
        <button className="ghost-btn xs" type="button" onClick={onCancel}>Cancel</button>
        <button className="primary-btn xs" type="submit" disabled={busy}>
          {busy ? "Saving..." : action === "ordered" ? "Mark Ordered" : action === "receive" ? "Mark Received" : "Close Request"}
        </button>
      </div>
    </form>
  );
}

export default function FlexDieRequestQueue({
  currentUser,
  flexDieId = "",
  canProcess = false,
  compact = false,
  showControls = true,
  title = "Flex Die Requests",
  emptyText = "No open flex die requests.",
  embedded = false,
  onChanged,
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState("open");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState({ id: "", action: "" });

  const filters = {
    ...(flexDieId ? { flex_die: flexDieId } : {}),
    ...(mode === "open" ? { open: "true" } : {}),
  };

  const requestsQuery = useQuery({
    queryKey: ["flex-die-requests", flexDieId || "all", mode],
    queryFn: () => fetchCollection("flex-die-requests", {
      filters,
      pageSize: compact ? 50 : 200,
      fetchAll: true,
    }),
    enabled: Boolean(canProcess),
    staleTime: 10_000,
    refetchInterval: canProcess ? 30_000 : false,
  });

  const processMutation = useMutation({
    mutationFn: ({ requestId, action, payload }) => postRecordAction("flex-die-requests", requestId, action, payload),
    onSuccess: async () => {
      setActive({ id: "", action: "" });
      await queryClient.invalidateQueries({ queryKey: ["flex-die-requests"] });
      await queryClient.invalidateQueries({ queryKey: ["collection", "flex-dies"] });
      await queryClient.invalidateQueries({ queryKey: ["lookups"] });
      onChanged?.();
    },
  });

  const rows = requestsQuery.data?.results ?? [];
  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => [
      row.flex_die_name,
      row.status,
      row.requested_by,
      row.request_notes,
      row.flex_die_supplier_name,
      row.flex_die_location_full_path,
      requestSummary(row),
    ].some((value) => String(value || "").toLowerCase().includes(needle)));
  }, [rows, search]);

  function submitProcess(row, form) {
    const base = { performed_by: userLabel(currentUser) };
    if (active.action === "ordered") {
      processMutation.mutate({ requestId: row.id, action: "mark-ordered", payload: { ...base, notes: form.notes } });
    } else if (active.action === "receive") {
      processMutation.mutate({
        requestId: row.id,
        action: "receive",
        payload: { ...base, received_by: userLabel(currentUser), serial_number: form.serialNumber, quantity: form.quantity, notes: form.notes },
      });
    } else if (active.action === "close") {
      processMutation.mutate({ requestId: row.id, action: "close-without-order", payload: { ...base, reason: form.reason } });
    }
  }

  if (!canProcess) return null;

  return (
    <section className={`flex-die-request-queue ${compact ? "compact" : ""} ${embedded ? "embedded" : ""}`}>
      <header className="flex-die-request-head">
        <div>
          <strong>{title}</strong>
          <span>{requestsQuery.isLoading ? "Loading requests" : `${filteredRows.length} shown / ${rows.length} total`}</span>
        </div>
        {showControls && (
          <div className="flex-die-request-toolbar">
            <label>
              <Search size={14} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search requests" />
            </label>
            <div className="flex-die-request-mode">
              <button className={mode === "open" ? "active" : ""} type="button" onClick={() => setMode("open")}>Open</button>
              <button className={mode === "all" ? "active" : ""} type="button" onClick={() => setMode("all")}>All</button>
            </div>
            <button className="ghost-btn xs icon-only" type="button" onClick={() => requestsQuery.refetch()} aria-label="Refresh flex die requests">
              <RefreshCw size={14} />
            </button>
          </div>
        )}
      </header>

      {requestsQuery.error && (
        <div className="flex-die-request-error">
          <AlertTriangle size={15} />
          <span>{requestsQuery.error.message}</span>
        </div>
      )}

      <div className="flex-die-request-list">
        {filteredRows.length ? filteredRows.map((row) => {
          const isOpen = row.status === "requested" || row.status === "ordered";
          const activeForRow = String(active.id) === String(row.id) ? active.action : "";
          return (
            <article className={`flex-die-request-card ${statusTone(row.status)}`} key={row.id}>
              <div className="flex-die-request-main">
                <span className={`flex-die-request-status ${statusTone(row.status)}`}>{labelize(row.status)}</span>
                <div>
                  <strong>{row.flex_die_name || `FD #${row.flex_die}`}</strong>
                  <em>{requestSummary(row)}</em>
                </div>
              </div>
              <div className="flex-die-request-meta">
                <span>Requested by {row.requested_by || "system"}</span>
                <span>{formatDateTime(row.created_at)}</span>
                <span>{row.flex_die_supplier_name || "No supplier assigned"}</span>
              </div>
              {row.request_notes && <p>{row.request_notes}</p>}
              {row.closed_reason && <p className="flex-die-request-close-reason">{row.closed_reason}</p>}
              {isOpen && (
                <div className="flex-die-request-actions">
                  <button className="ghost-btn xs" type="button" onClick={() => setActive({ id: row.id, action: "ordered" })}>
                    <ShoppingCart size={13} /> Ordered
                  </button>
                  <button className="primary-btn xs" type="button" onClick={() => setActive({ id: row.id, action: "receive" })}>
                    <PackageCheck size={13} /> Received
                  </button>
                  <button className="danger-btn xs" type="button" onClick={() => setActive({ id: row.id, action: "close" })}>
                    <XCircle size={13} /> Close
                  </button>
                </div>
              )}
              {activeForRow && (
                <ProcessForm
                  action={activeForRow}
                  busy={processMutation.isPending}
                  onCancel={() => setActive({ id: "", action: "" })}
                  onSubmit={(form) => submitProcess(row, form)}
                />
              )}
            </article>
          );
        }) : (
          <div className="flex-die-request-empty">
            <PackagePlus size={18} />
            <span>{requestsQuery.isLoading ? "Loading flex die requests..." : emptyText}</span>
          </div>
        )}
      </div>

      {processMutation.error && <p className="flex-die-request-error text-only">{processMutation.error.message}</p>}
    </section>
  );
}
