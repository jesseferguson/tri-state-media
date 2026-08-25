import { useState } from "react";
import { LogIn, QrCode, ShieldCheck } from "lucide-react";

function SignInScreen({ onSignIn, message = "" }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const scanRequest = (() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get("skidToken")) return { label: "Skid", detail: "Sign in to open this skid." };
    if (params.get("rollTagId") || params.get("inventoryId")) return { label: "Roll", detail: "Sign in to open this material roll." };
    if (params.get("rackToken")) return { label: "Rack", detail: "Sign in to open this rack." };
    if (params.get("flexDieId")) return { label: "Flex Die", detail: "Sign in to open this flex die folder." };
    if (params.get("pressDashboard")) return { label: "Press", detail: "Sign in to open this press footage dashboard." };
    return null;
  })();

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    const result = await onSignIn(username, password);
    setSubmitting(false);
    if (result?.error) setError(result.error);
  }

  const authMessage = error || message;

  return (
    <main className="auth-screen">
      <section className="auth-card compact-card">
        {scanRequest && (
          <div className="auth-scan-request">
            <QrCode size={22} />
            <div><strong>{scanRequest.label} scan ready</strong><span>{scanRequest.detail}</span></div>
          </div>
        )}
        <div className="auth-brand-panel">
          <span className="auth-brand-mark"><ShieldCheck size={22} /></span>
          <div>
            <p className="eyebrow">Tri-State Media</p>
            <h1>Sign In</h1>
            <p>Use your company account to continue.</p>
          </div>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span>Username</span>
            <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Your login name" autoFocus />
          </label>
          <label className="field">
            <span>Password</span>
            <input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" />
          </label>
          {authMessage && <div className="auth-error">{authMessage}</div>}
          <button className="primary-btn" type="submit" disabled={submitting}><LogIn size={16} /> {submitting ? "Signing In..." : "Sign In"}</button>
        </form>
      </section>
    </main>
  );
}

export default SignInScreen;
