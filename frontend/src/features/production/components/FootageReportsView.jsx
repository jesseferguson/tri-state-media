import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CalendarDays, Clock3, Save, Search, Settings2 } from "lucide-react";
import { fetchCollection, updateRecord } from "../../../api";

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function footage(value) {
  return `${Math.round(number(value)).toLocaleString()} ft`;
}

function dateValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function groupTotals(rows, field) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = row[field] || "Unassigned";
    if (!groups.has(key)) groups.set(key, { label: key, total: 0, good: 0, waste: 0, reports: 0 });
    const group = groups.get(key);
    group.total += number(row.total_footage);
    group.good += number(row.good_footage);
    group.waste += number(row.waste_footage);
    group.reports += 1;
  });
  return Array.from(groups.values()).sort((left, right) => right.good - left.good);
}

function ReportBars({ title, rows }) {
  const max = Math.max(1, ...rows.map((row) => row.good));
  return (
    <section className="footage-report-chart">
      <header><BarChart3 size={17} /><strong>{title}</strong></header>
      <div>
        {rows.map((row) => (
          <article key={row.label}>
            <span>{row.label}</span>
            <div><i style={{ width: `${Math.max(2, (row.good / max) * 100)}%` }} /></div>
            <strong>{footage(row.good)}</strong>
            <em>{row.reports} report{row.reports === 1 ? "" : "s"}</em>
          </article>
        ))}
        {!rows.length && <p>No reports in this window.</p>}
      </div>
    </section>
  );
}

export default function FootageReportsView({ currentUser }) {
  const queryClient = useQueryClient();
  const today = dateValue();
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [operator, setOperator] = useState("");
  const [press, setPress] = useState("");
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [settingForm, setSettingForm] = useState(null);

  const reportQuery = useQuery({
    queryKey: ["footage-reports", dateFrom, dateTo],
    queryFn: () => fetchCollection("production-shift-reports", {
      filters: { date_from: dateFrom, date_to: dateTo },
      ordering: "-report_date,-shift_end",
      pageSize: 1000,
      fetchAll: true,
    }).then((result) => result.results),
  });
  const settingQuery = useQuery({
    queryKey: ["production-shift-settings"],
    queryFn: () => fetchCollection("production-shift-settings", { pageSize: 10 }).then((result) => result.results),
    onSuccess: (rows) => {
      if (rows[0]) setSettingForm(rows[0]);
    },
  });

  const setting = settingForm || settingQuery.data?.[0];
  const allRows = reportQuery.data ?? [];
  const operators = useMemo(
    () => [...new Set(allRows.flatMap((row) => [row.operator, row.suboperator]).filter(Boolean))].sort(),
    [allRows],
  );
  const presses = useMemo(
    () => [...new Map(allRows.filter((row) => row.press).map((row) => [String(row.press), { id: row.press, name: row.press_name || "Press" }])).values()],
    [allRows],
  );
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allRows.filter((row) => {
      if (operator && row.operator !== operator && row.suboperator !== operator) return false;
      if (press && String(row.press) !== String(press)) return false;
      if (!needle) return true;
      return [
        row.operator,
        row.suboperator,
        row.press_name,
        row.job_ticket_number,
        row.job_name,
        row.display_job_name,
        row.schedule_reference,
        row.coater_schedule_tag_number,
        row.coater_material_name,
        row.customer_name,
        row.notes,
      ].some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [allRows, operator, press, search]);

  const totals = rows.reduce((result, row) => ({
    total: result.total + number(row.total_footage),
    good: result.good + number(row.good_footage),
    material: result.material + number(row.material_footage),
    waste: result.waste + number(row.waste_footage),
  }), { total: 0, good: 0, material: 0, waste: 0 });
  const pressTotals = groupTotals(rows, "press_name");
  const operatorTotals = groupTotals(rows, "operator");

  const settingMutation = useMutation({
    mutationFn: () => updateRecord("production-shift-settings", setting.id, {
      shift_start_time: setting.shift_start_time,
      shift_end_time: setting.shift_end_time,
      end_on_next_day: setting.end_on_next_day,
      updated_by: currentUser?.name || "",
    }),
    onSuccess: (saved) => {
      setSettingForm(saved);
      setNotice("Reporting-day times saved.");
      queryClient.invalidateQueries({ queryKey: ["production-shift-settings"] });
    },
  });

  return (
    <section className="footage-reports-page">
      <header className="footage-reports-header">
        <div>
          <span>Production Reporting</span>
          <h2>Footage Reports</h2>
          <p>
            {setting
              ? `Reporting day: ${String(setting.shift_start_time).slice(0, 5)} to ${String(setting.shift_end_time).slice(0, 5)}${setting.end_on_next_day ? " next day" : ""}`
              : "Loading reporting-day settings..."}
          </p>
        </div>
        <button className="ghost-btn" type="button" onClick={() => setSettingsOpen((value) => !value)}>
          <Settings2 size={17} /> Shift Times
        </button>
      </header>

      {settingsOpen && setting && (
        <section className="footage-report-settings">
          <div><Clock3 size={18} /><strong>Reporting Day Boundary</strong></div>
          <label>
            <span>Starts</span>
            <input type="time" value={String(setting.shift_start_time).slice(0, 5)} onChange={(event) => setSettingForm({ ...setting, shift_start_time: event.target.value })} />
          </label>
          <label>
            <span>Ends</span>
            <input type="time" value={String(setting.shift_end_time).slice(0, 5)} onChange={(event) => setSettingForm({ ...setting, shift_end_time: event.target.value })} />
          </label>
          <label className="footage-next-day">
            <input type="checkbox" checked={setting.end_on_next_day} onChange={(event) => setSettingForm({ ...setting, end_on_next_day: event.target.checked })} />
            <span>End time is on the next calendar day</span>
          </label>
          <button className="primary-btn" type="button" onClick={() => settingMutation.mutate()} disabled={settingMutation.isPending}>
            <Save size={16} /> Save Times
          </button>
          {notice && <em>{notice}</em>}
        </section>
      )}

      <section className="footage-report-filters">
        <label><CalendarDays size={16} /><span>From</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label><CalendarDays size={16} /><span>Through</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        <label><span>Operator</span><select value={operator} onChange={(event) => setOperator(event.target.value)}><option value="">All operators</option>{operators.map((name) => <option value={name} key={name}>{name}</option>)}</select></label>
        <label><span>Press</span><select value={press} onChange={(event) => setPress(event.target.value)}><option value="">All presses</option>{presses.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label>
        <label className="footage-report-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Job, customer, note..." /></label>
      </section>

      <section className="footage-report-total">
        <div>
          <span>Main Total Footage</span>
          <strong>{footage(totals.total)}</strong>
          <em>{rows.length} shift report{rows.length === 1 ? "" : "s"}</em>
        </div>
        <div><span>Good Footage</span><strong>{footage(totals.good)}</strong></div>
        <div><span>Waste</span><strong>{footage(totals.waste)}</strong></div>
        <div><span>Material Used</span><strong>{footage(totals.material)}</strong></div>
      </section>

      <div className="footage-report-charts">
        <ReportBars title="Footage by Press" rows={pressTotals} />
        <ReportBars title="Footage by Operator" rows={operatorTotals} />
      </div>

      <section className="footage-report-list">
        <header>
          <strong>Shift Reports</strong>
          <span>{dateFrom === dateTo ? dateFrom : `${dateFrom} through ${dateTo}`}</span>
        </header>
        {rows.map((row) => (
          <article key={row.id}>
            <div>
              <strong>{row.job_ticket_number || row.schedule_reference || row.display_job_name || row.job_name || "Footage Report"}</strong>
              <span>{[row.display_job_name || row.job_name, row.customer_name, row.press_name].filter(Boolean).join(" / ")}</span>
            </div>
            <div><strong>{[row.operator, row.suboperator ? `+ ${row.suboperator}` : ""].filter(Boolean).join(" ")}</strong><span>{new Date(row.shift_end).toLocaleString()}</span></div>
            <div><b>{footage(row.good_footage)}</b><span>good</span></div>
            <div><b>{footage(row.waste_footage)}</b><span>waste</span></div>
            <em>{row.outcome === "job_complete" ? "Job Complete" : "End of Shift"}{row.notes ? ` / ${row.notes}` : ""}</em>
          </article>
        ))}
        {!reportQuery.isLoading && !rows.length && <p>No footage reports match this window.</p>}
      </section>
    </section>
  );
}
