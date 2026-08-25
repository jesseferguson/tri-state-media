import { useState } from "react";
import { Send } from "lucide-react";
import { userId, userLabel } from "../utils/customerUtils.js";

export default function TeamNotifyPanel({ customer, users = [], currentUser, relationOptions, saving, onNotify }) {
  const [recipientIds, setRecipientIds] = useState([]);
  const [relatedValue, setRelatedValue] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [localError, setLocalError] = useState("");
  const [sent, setSent] = useState("");
  const viewerId = userId(currentUser);
  const activeUsers = users.filter((user) => user?.active !== false && userId(user) && userId(user) !== viewerId);
  const relatedRecord = relationOptions.find((option) => option.value === relatedValue) || relationOptions[0];

  function toggleRecipient(id) {
    setRecipientIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setLocalError("");
    setSent("");
  }

  async function submit(event) {
    event.preventDefault();
    if (!recipientIds.length) {
      setLocalError("Choose at least one team member.");
      return;
    }
    if (!body.trim()) {
      setLocalError("Add a note for the team.");
      return;
    }
    await onNotify?.({
      customer,
      recipientIds,
      subject: subject.trim() || `${customer.name} follow-up`,
      body: body.trim(),
      relatedRecord,
    });
    setRecipientIds([]);
    setRelatedValue("");
    setSubject("");
    setBody("");
    setLocalError("");
    setSent("Team notification sent and logged on this customer.");
  }

  return (
    <section className="customer-team-panel customer-page-card">
      <header>
        <div>
          <strong>Notify Team</strong>
          <span>Create a message board linked to this customer.</span>
        </div>
      </header>
      <form onSubmit={submit}>
        <div className="customer-team-picker">
          {activeUsers.map((user) => {
            const id = userId(user);
            return (
              <button className={recipientIds.includes(id) ? "active" : ""} type="button" key={id} onClick={() => toggleRecipient(id)}>
                <span>{userLabel(user)}</span>
                <em>{user.role || "Team"}</em>
              </button>
            );
          })}
          {!activeUsers.length && <p>No active users are available to notify.</p>}
        </div>
        <div className="customer-crm-fields">
          <label className="wide">
            <span>Related Item</span>
            <select value={relatedValue} onChange={(event) => setRelatedValue(event.target.value)}>
              {relationOptions.map((option) => <option key={option.value || "account"} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="wide">
            <span>Subject</span>
            <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder={`${customer.name} follow-up`} />
          </label>
          <label className="wide">
            <span>Team Note</span>
            <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} placeholder="What should sales, production, art, or management know?" />
          </label>
        </div>
        {localError && <p className="customer-crm-error">{localError}</p>}
        {sent && <p className="customer-team-success">{sent}</p>}
        <div className="customer-crm-submit">
          <button className="primary-btn" type="submit" disabled={saving || !activeUsers.length}>
            <Send size={15} />
            {saving ? "Sending..." : "Notify Team"}
          </button>
        </div>
      </form>
    </section>
  );
}
