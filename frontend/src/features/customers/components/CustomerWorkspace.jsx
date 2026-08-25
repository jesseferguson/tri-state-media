import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  AtSign,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Link2,
  Mail,
  MapPin,
  Phone,
  ReceiptText,
  UserRound,
  Users,
} from "lucide-react";
import CustomerFollowUps, { CustomerFollowUpPreview } from "./CustomerFollowUps.jsx";
import OpenLogsSheet from "./OpenLogsSheet.jsx";
import TeamNotifyPanel from "./TeamNotifyPanel.jsx";
import {
  CustomerCard,
  CustomerSearchInput,
  FactRow,
  Metric,
  OrderRow,
  QuoteRow,
  RelatedCard,
  TicketRow,
  TimelineRow,
} from "./customerCards.jsx";
import { CRM_STAGES, CUSTOMER_PAGES, INTERACTION_TYPES } from "../utils/customerChoices.js";
import {
  choiceLabel,
  customerAddressLines,
  customerMatchesOwner,
  dateLabel,
  externalUrl,
  interactionCustomerId,
  interactionRelationLabel,
  isOpenInteraction,
  money,
  number,
  orderOpen,
  quoteJobName,
  quoteNumber,
  quoteRecordId,
  quoteTotal,
  relationOptionLabel,
  sameId,
  sortDateValue,
  statusLabel,
  ticketSortValue,
} from "../utils/customerUtils.js";

export default function CustomerWorkspace({
  rows,
  allRows = rows,
  totalCount = 0,
  search = "",
  selected,
  quotes = [],
  orders = [],
  jobTickets = [],
  interactions = [],
  openInteractions = [],
  users = [],
  currentUser,
  externalFollowUpSeed = null,
  interactionSaving = false,
  openLogSaving = false,
  notifyTeamSaving = false,
  loading = false,
  onSearchChange,
  onSelect,
  onEdit,
  onDelete,
  onQuote,
  onAddInteraction,
  onUpdateOpenLog,
  onNotifyTeam,
  onFollowUpSeedHandled,
}) {
  const [activePage, setActivePage] = useState("overview");
  const [showInlineResults, setShowInlineResults] = useState(false);
  const [ownerScope, setOwnerScope] = useState("mine");
  const [showOpenLogs, setShowOpenLogs] = useState(false);
  const [selectedFollowUpId, setSelectedFollowUpId] = useState("");
  const [followUpSeed, setFollowUpSeed] = useState(null);
  const address = customerAddressLines(selected);
  const quoteTotalValue = quotes.reduce((sum, quote) => sum + quoteTotal(quote), 0);
  const openOrders = orders.filter(orderOpen);
  const shippedUnits = orders.reduce((sum, order) => sum + Number(order.quantity_to_ship || 0), 0);
  const customersById = useMemo(() => new Map(allRows.map((row) => [String(row.id), row])), [allRows]);
  const openInteractionRows = useMemo(() => openInteractions.filter(isOpenInteraction), [openInteractions]);
  const notificationCounts = useMemo(() => {
    const counts = new Map();
    for (const interaction of openInteractionRows) {
      const key = interactionCustomerId(interaction);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [openInteractionRows]);
  const ownerFilteredRows = useMemo(() => (
    ownerScope === "mine" && (currentUser?.name || currentUser?.username)
      ? rows.filter((row) => customerMatchesOwner(row, currentUser))
      : rows
  ), [currentUser, ownerScope, rows]);
  const sortedCustomerRows = useMemo(() => (
    [...ownerFilteredRows].sort((a, b) => {
      const notificationDiff = (notificationCounts.get(String(b.id)) || 0) - (notificationCounts.get(String(a.id)) || 0);
      if (notificationDiff) return notificationDiff;
      return String(a.name || "").localeCompare(String(b.name || ""));
    })
  ), [notificationCounts, ownerFilteredRows]);
  const visibleOpenLogCount = useMemo(() => (
    openInteractionRows.filter((interaction) => {
      if (ownerScope !== "mine" || !(currentUser?.name || currentUser?.username)) return true;
      const customer = customersById.get(interactionCustomerId(interaction));
      return customerMatchesOwner(customer, currentUser);
    }).length
  ), [customersById, currentUser, openInteractionRows, ownerScope]);
  const sortedInteractions = useMemo(() => (
    [...interactions].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      return new Date(b.occurred_at || b.created_at || 0) - new Date(a.occurred_at || a.created_at || 0);
    })
  ), [interactions]);
  const selectedNotificationCount = selected ? (notificationCounts.get(String(selected.id)) || 0) : 0;
  const customerOpenFollowUps = useMemo(() => (
    sortedInteractions
      .filter(isOpenInteraction)
      .sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
        const aDate = ticketSortValue(a);
        const bDate = ticketSortValue(b);
        if (aDate && bDate && aDate !== bDate) return aDate - bDate;
        if (aDate !== bDate) return aDate ? -1 : 1;
        return sortDateValue(b.updated_at || b.created_at) - sortDateValue(a.updated_at || a.created_at);
      })
  ), [sortedInteractions]);
  const followUpBadgeCount = customerOpenFollowUps.length || selectedNotificationCount;
  const openFollowUps = customerOpenFollowUps.length;
  const lastTouch = selected?.last_contacted_at || sortedInteractions.find((interaction) => ["email", "call", "meeting"].includes(interaction.interaction_type))?.occurred_at;
  const relationOptions = useMemo(() => [
    { value: "", label: "Account only" },
    ...orders.map((order) => ({ value: `order:${order.id}`, label: `Order - ${relationOptionLabel("order", order)}` })),
    ...jobTickets.map((ticket) => ({ value: `job:${ticket.id}`, label: `Job - ${relationOptionLabel("job", ticket)}` })),
    ...quotes.map((quote) => ({ value: `quote:${quoteRecordId(quote)}`, label: `Quote - ${relationOptionLabel("quote", quote)}` })),
  ], [jobTickets, orders, quotes]);
  const timeline = [
    ...sortedInteractions.map((interaction) => ({
      type: "crm",
      interactionType: interaction.interaction_type,
      date: interaction.occurred_at || interaction.created_at,
      title: interaction.subject || interaction.email_subject || choiceLabel(INTERACTION_TYPES, interaction.interaction_type),
      detail: [interaction.status_label || statusLabel(interaction.status), interactionRelationLabel(interaction)].filter(Boolean).join(" / "),
      id: interaction.id,
    })),
    ...quotes.map((quote) => ({
      type: "quote",
      date: quote.createdAt || quote.created_at,
      title: quoteNumber(quote),
      detail: `${money(quoteTotal(quote))} / ${quoteJobName(quote)}`,
      id: quote.id || quoteNumber(quote),
    })),
    ...orders.map((order) => ({
      type: "order",
      date: order.order_date || order.scheduled_date || order.updated_at,
      title: order.order_number || "Order",
      detail: `${statusLabel(order.status)} / ${order.job_name || "No job name"}`,
      id: order.id || order.order_number,
    })),
  ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 10);
  const searchResults = sortedCustomerRows.slice(0, search.trim() ? 12 : 6);

  useEffect(() => {
    if (!selected?.id || !sortedInteractions.length) {
      setSelectedFollowUpId("");
      return;
    }
    if (!sortedInteractions.some((followUp) => sameId(followUp.id, selectedFollowUpId))) {
      setSelectedFollowUpId(String(sortedInteractions[0].id));
    }
  }, [selected?.id, selectedFollowUpId, sortedInteractions]);

  useEffect(() => {
    if (!externalFollowUpSeed?.id || !selected?.id) return;
    if (externalFollowUpSeed.customerId && !sameId(externalFollowUpSeed.customerId, selected.id)) return;
    setFollowUpSeed(externalFollowUpSeed);
    setSelectedFollowUpId("");
    setActivePage("tickets");
    onFollowUpSeedHandled?.();
  }, [externalFollowUpSeed, onFollowUpSeedHandled, selected?.id]);

  function selectCustomer(row) {
    setActivePage("overview");
    setShowInlineResults(false);
    setSelectedFollowUpId("");
    setFollowUpSeed(null);
    onSearchChange?.("");
    onSelect?.(row);
  }

  function backToSearch() {
    setActivePage("overview");
    setShowInlineResults(false);
    onSearchChange?.("");
    onSelect?.(null);
  }

  function updateSearch(value) {
    onSearchChange?.(value);
    setShowInlineResults(Boolean(String(value || "").trim()));
  }

  function openFollowUp(followUp) {
    setSelectedFollowUpId(String(followUp?.id || ""));
    setActivePage("tickets");
  }

  function createFollowUpFromQuote(quote) {
    setFollowUpSeed({
      id: `quote-${quoteRecordId(quote)}-${Date.now()}`,
      quoteIds: [quoteRecordId(quote)].filter(Boolean),
      jobTicketIds: quote.jobTicketId ? [String(quote.jobTicketId)] : [],
      subject: `${quoteNumber(quote)} follow-up`,
      body: "",
    });
    setActivePage("tickets");
  }

  function createFollowUpFromJob(ticket) {
    setFollowUpSeed({
      id: `job-${ticket.id}-${Date.now()}`,
      jobTicketIds: [String(ticket.id)].filter(Boolean),
      quoteIds: [],
      subject: `${ticket.ticket_number || ticket.job_name || "Job"} follow-up`,
      body: "",
    });
    setActivePage("tickets");
  }

  if (!selected) {
    return (
      <section className="customer-crm-page">
        <div className="customer-crm-home">
          <section className="customer-home-hero">
            <div>
              <span>Customer CRM</span>
              <h3>Customer Accounts</h3>
              <p>Search accounts, review open follow-ups, and keep customer notes, jobs, quotes, and team messages in one place.</p>
            </div>
            <div className="customer-home-search">
              <CustomerSearchInput value={search} onChange={updateSearch} count={sortedCustomerRows.length} total={totalCount || rows.length} autoFocus />
              <div className="customer-home-controls">
                <div className="customer-scope-toggle" role="group" aria-label="Customer account scope">
                  <button className={ownerScope === "mine" ? "active" : ""} type="button" onClick={() => setOwnerScope("mine")}>My Accounts</button>
                  <button className={ownerScope === "all" ? "active" : ""} type="button" onClick={() => setOwnerScope("all")}>All Accounts</button>
                </div>
                <button className={`customer-open-log-toggle ${showOpenLogs ? "active" : ""}`} type="button" onClick={() => setShowOpenLogs((value) => !value)}>
                  <Bell size={15} />
                  {showOpenLogs ? "Hide Open Follow-Ups" : "Show Open Follow-Ups"}
                  {visibleOpenLogCount > 0 && <span>{visibleOpenLogCount}</span>}
                </button>
              </div>
            </div>
          </section>

          <section className="customer-home-stats">
            <Metric label="Accounts" value={number(totalCount || rows.length)} detail="available customer records" />
            <Metric label={ownerScope === "mine" ? "My Results" : "Search Results"} value={number(sortedCustomerRows.length)} detail={search.trim() ? "matching this search" : ownerScope === "mine" ? "assigned to you" : "visible accounts"} />
            <Metric label="Open Follow-Ups" value={number(visibleOpenLogCount)} detail="not closed yet" tone={visibleOpenLogCount ? "watch" : ""} />
          </section>

          {showOpenLogs && (
            <OpenLogsSheet
              interactions={openInteractionRows}
              customersById={customersById}
              ownerScope={ownerScope}
              currentUser={currentUser}
              saving={openLogSaving}
              onUpdate={onUpdateOpenLog}
              onOpenCustomer={selectCustomer}
            />
          )}

          <section className="customer-results-panel">
            <header>
              <strong>{search.trim() ? "Matching Accounts" : "Start Here"}</strong>
              <span>{search.trim() ? `${sortedCustomerRows.length} result${sortedCustomerRows.length === 1 ? "" : "s"}` : "Open follow-ups are sorted to the top"}</span>
            </header>
            <div className="customer-search-grid">
              {searchResults.map((customer) => (
                <CustomerCard key={customer.id} customer={customer} notificationCount={notificationCounts.get(String(customer.id)) || 0} onSelect={selectCustomer} />
              ))}
              {!searchResults.length && <p>{loading ? "Loading customers..." : "No customers match this search."}</p>}
            </div>
          </section>
        </div>
      </section>
    );
  }

  return (
    <section className="customer-crm-page">
      <header className="customer-record-searchbar">
        <button className="customer-back-btn" type="button" onClick={backToSearch}>
          <ArrowLeft size={16} />
          Back
        </button>
        <CustomerSearchInput
          value={search}
          onChange={updateSearch}
          onFocus={() => setShowInlineResults(Boolean(search.trim()))}
          count={sortedCustomerRows.length}
          total={totalCount || rows.length}
        />
        {showInlineResults && search.trim() && (
          <div className="customer-inline-results">
            {sortedCustomerRows.slice(0, 6).map((customer) => (
              <CustomerCard
                key={customer.id}
                customer={customer}
                selected={sameId(customer.id, selected.id)}
                notificationCount={notificationCounts.get(String(customer.id)) || 0}
                onSelect={selectCustomer}
              />
            ))}
            {!sortedCustomerRows.length && <p>No customers match this search.</p>}
          </div>
        )}
      </header>

      <section className="customer-account-shell">
        <header className="customer-record-hero">
          <div className="customer-account-title">
            <span>{selected.is_active === false ? "Inactive Customer" : `${choiceLabel(CRM_STAGES, selected.crm_stage || "active")} Customer`}</span>
            <h3>{selected.name}</h3>
            <p>{selected.customer_code ? `Customer ID ${selected.customer_code}` : "No Customer ID on file"}</p>
            {selectedNotificationCount > 0 && (
              <button className="customer-record-alert" type="button" onClick={() => setActivePage("tickets")}>
                <Bell size={14} />
                {selectedNotificationCount} open follow-up{selectedNotificationCount === 1 ? "" : "s"}
              </button>
            )}
          </div>
          <div className="customer-record-actions">
            <button className="ghost-btn" type="button" onClick={() => onQuote?.(selected)}>Quote</button>
            <button className="primary-btn" type="button" onClick={() => onEdit(selected)}>Edit Customer</button>
            <button className="danger-btn" type="button" onClick={() => onDelete(selected)}>Delete</button>
          </div>
        </header>

        <nav className="customer-page-tabs" aria-label="Customer pages">
          {CUSTOMER_PAGES.map(([key, label]) => (
            <button className={activePage === key ? "active" : ""} type="button" key={key} onClick={() => setActivePage(key)}>
              {label}
              {key === "tickets" && followUpBadgeCount > 0 && <span>{followUpBadgeCount}</span>}
            </button>
          ))}
        </nav>

        {activePage === "overview" && (
          <section className="customer-page-content customer-overview-page">
            <section className="customer-home-stats customer-overview-stats">
              <Metric label="Open Orders" value={openOrders.length.toLocaleString()} detail={`${orders.length} total order${orders.length === 1 ? "" : "s"}`} tone={openOrders.length ? "watch" : ""} />
              <Metric label="Open Follow-Ups" value={openFollowUps.toLocaleString()} detail={`${sortedInteractions.length} total follow-up${sortedInteractions.length === 1 ? "" : "s"}`} tone={openFollowUps ? "watch" : ""} />
              <Metric label="Quote Value" value={money(quoteTotalValue)} detail={`${quotes.length} saved quote${quotes.length === 1 ? "" : "s"}`} tone="money" />
              <Metric label="Production Jobs" value={jobTickets.length.toLocaleString()} detail={`${number(shippedUnits)} labels to ship`} />
            </section>

            <div className="customer-overview-grid">
              <section className="customer-page-card">
                <header><strong>Account Snapshot</strong></header>
                <div className="customer-fact-list">
                  <FactRow icon={AtSign} label="Owner" value={selected.account_owner || "Unassigned"} />
                  <FactRow icon={CheckCircle2} label="Stage" value={choiceLabel(CRM_STAGES, selected.crm_stage || (selected.is_active === false ? "inactive" : "active"))} />
                  <FactRow icon={CalendarDays} label="Next Follow-Up" value={dateLabel(selected.next_follow_up)} />
                  <FactRow icon={Clock3} label="Last Touch" value={dateLabel(lastTouch)} />
                  <FactRow icon={UserRound} label="Contact" value={selected.contact_name || "No primary contact"} />
                  <FactRow icon={Mail} label="Email" value={selected.email || "No email"} href={selected.email ? `mailto:${selected.email}` : ""} />
                  <FactRow icon={Phone} label="Phone" value={selected.phone || "No phone"} href={selected.phone ? `tel:${selected.phone}` : ""} />
                  <FactRow icon={MapPin} label="Address" value={address.join(" / ") || "No address"} />
                  {selected.website && <FactRow icon={ExternalLink} label="Website" value={String(selected.website).replace(/^https?:\/\//i, "")} href={externalUrl(selected.website)} />}
                  {selected.source_sheet_url && <FactRow icon={Link2} label="Source Sheet" value="Open Sheet" href={externalUrl(selected.source_sheet_url)} />}
                </div>
              </section>

              <CustomerFollowUpPreview
                followUps={customerOpenFollowUps}
                loading={loading}
                onOpenFollowUp={openFollowUp}
                onViewAll={() => setActivePage("tickets")}
              />

              <section className="customer-page-card customer-notes">
                <header><strong>Account Notes</strong></header>
                <p>{selected.notes || "No account notes have been added yet."}</p>
              </section>
            </div>
          </section>
        )}

        {activePage === "tickets" && (
          <CustomerFollowUps
            customer={selected}
            followUps={sortedInteractions}
            selectedFollowUpId={selectedFollowUpId}
            jobTickets={jobTickets}
            quotes={quotes}
            currentUser={currentUser}
            draftSeed={followUpSeed}
            saving={interactionSaving || openLogSaving}
            onSelectFollowUp={setSelectedFollowUpId}
            onCreate={onAddInteraction}
            onUpdate={onUpdateOpenLog}
            loading={loading}
          />
        )}

        {activePage === "work" && (
          <section className="customer-page-content customer-work-page">
            <RelatedCard icon={ReceiptText} title="Orders" count={orders.length}>
              <div className="customer-activity-list">
                {orders.slice(0, 10).map((order) => <OrderRow key={order.id || order.order_number} order={order} />)}
                {!orders.length && <p>{loading ? "Loading orders..." : "No orders found for this customer."}</p>}
              </div>
            </RelatedCard>
            <RelatedCard icon={FileText} title="Quotes" count={quotes.length}>
              <div className="customer-activity-list">
                {quotes.slice(0, 10).map((quote) => <QuoteRow key={quote.id || quoteNumber(quote)} quote={quote} onFollowUp={createFollowUpFromQuote} />)}
                {!quotes.length && <p>{loading ? "Loading quotes..." : "No quotes found for this customer."}</p>}
              </div>
            </RelatedCard>
            <RelatedCard icon={BriefcaseBusiness} title="Production Job Tickets" count={jobTickets.length}>
              <div className="customer-ticket-list">
                {jobTickets.slice(0, 12).map((ticket) => <TicketRow key={ticket.id} ticket={ticket} onFollowUp={createFollowUpFromJob} />)}
                {!jobTickets.length && <p>{loading ? "Loading job tickets..." : "No job tickets linked yet."}</p>}
              </div>
            </RelatedCard>
            <RelatedCard icon={Clock3} title="Recent Movement" count={timeline.length}>
              <div className="customer-timeline">
                {timeline.map((item) => <TimelineRow key={`${item.type}-${item.id}-${item.date}`} item={item} />)}
                {!timeline.length && <p>Quotes, orders, and follow-ups will appear here as this account grows.</p>}
              </div>
            </RelatedCard>
          </section>
        )}

        {activePage === "team" && (
          <section className="customer-page-content customer-team-page">
            <TeamNotifyPanel
              customer={selected}
              users={users}
              currentUser={currentUser}
              relationOptions={relationOptions}
              saving={notifyTeamSaving}
              onNotify={onNotifyTeam}
            />
            <section className="customer-page-card customer-team-info">
              <header>
                <Bell size={15} />
                <strong>How Team Messages Work</strong>
              </header>
              <p>Choose a sales, production, art, or management teammate, add the note, and this creates a message board linked to this customer. The note is also logged as a follow-up so the account history stays together.</p>
              <div>
                <Users size={18} />
                <strong>{users.filter((user) => user?.active !== false).length}</strong>
                <span>active team members</span>
              </div>
            </section>
          </section>
        )}
      </section>
    </section>
  );
}
