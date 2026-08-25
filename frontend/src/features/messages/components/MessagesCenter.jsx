import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Inbox, MessageCircle, PackagePlus, Plus, Search, Send, Users, X } from "lucide-react";
import { createRecord, fetchCollection, requestApi } from "../../../api";
import FlexDieRequestQueue from "../../tooling/components/FlexDieRequestQueue";

function userId(user) {
  return String(user?.id || user?.username || "").trim();
}

function userLabel(user) {
  return user?.name || user?.username || "User";
}

function formatMessageTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function threadInitial(title) {
  return String(title || "M").trim()[0]?.toUpperCase() || "M";
}

function participantNames(thread, currentUser) {
  const currentName = String(userLabel(currentUser)).toLowerCase();
  const names = Array.isArray(thread?.participant_names) ? thread.participant_names : [];
  return names.filter((name) => String(name || "").toLowerCase() !== currentName).join(", ") || "Just you";
}

export default function MessagesCenter({ currentUser, users = [], compact = false, showToast = true, canProcessFlexDieRequests = false }) {
  const queryClient = useQueryClient();
  const viewerId = userId(currentUser);
  const [open, setOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [threadSearch, setThreadSearch] = useState("");
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [subject, setSubject] = useState("");
  const [firstMessage, setFirstMessage] = useState("");
  const [reply, setReply] = useState("");
  const [activeView, setActiveView] = useState("messages");

  const activeUsers = useMemo(
    () => (users ?? []).filter((user) => user?.active !== false && userId(user) && userId(user) !== viewerId),
    [users, viewerId]
  );

  const threadsQuery = useQuery({
    queryKey: ["message-threads", viewerId],
    queryFn: () => fetchCollection("message-threads", {
      filters: { viewer: viewerId },
      pageSize: 100,
      fetchAll: true,
    }),
    enabled: Boolean(viewerId),
    staleTime: 10_000,
    refetchInterval: 25_000,
    refetchIntervalInBackground: false,
  });

  const threads = threadsQuery.data?.results ?? [];
  const totalUnread = threads.reduce((sum, thread) => sum + Number(thread.unreadCount || 0), 0);
  const selectedThread = threads.find((thread) => String(thread.id) === String(selectedThreadId)) || null;

  const filteredThreads = useMemo(() => {
    const needle = threadSearch.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter((thread) => [
      thread.title,
      thread.context_label,
      thread.lastMessage,
      ...(Array.isArray(thread.participant_names) ? thread.participant_names : []),
    ].some((value) => String(value || "").toLowerCase().includes(needle)));
  }, [threadSearch, threads]);

  const messagesQuery = useQuery({
    queryKey: ["messages", selectedThreadId],
    queryFn: () => fetchCollection("messages", {
      filters: { thread: selectedThreadId },
      pageSize: 250,
      fetchAll: true,
    }),
    enabled: open && Boolean(selectedThreadId),
    staleTime: 5_000,
    refetchInterval: open ? 10_000 : false,
  });

  const markReadMutation = useMutation({
    mutationFn: (threadId) => requestApi(`message-threads/${threadId}/mark-read`, {
      method: "POST",
      body: JSON.stringify({ viewer: viewerId }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["message-threads", viewerId] });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: (payload) => createRecord("messages", payload),
    onSuccess: () => {
      setReply("");
      queryClient.invalidateQueries({ queryKey: ["messages", selectedThreadId] });
      queryClient.invalidateQueries({ queryKey: ["message-threads", viewerId] });
    },
  });

  const createThreadMutation = useMutation({
    mutationFn: async () => {
      const participantIds = [...new Set([viewerId, ...selectedUsers].filter(Boolean))];
      if (!subject.trim() || !selectedUsers.length) throw new Error("Add a subject and at least one person.");
      const participants = [currentUser, ...activeUsers.filter((user) => participantIds.includes(userId(user)))];
      const thread = await createRecord("message-threads", {
        title: subject.trim(),
        participant_user_ids: participantIds,
        participant_names: participants.map(userLabel),
        context_type: "",
        context_id: "",
        context_label: "",
        created_by_user_id: viewerId,
        created_by_name: userLabel(currentUser),
      });
      if (firstMessage.trim()) {
        await createRecord("messages", {
          thread: thread.id,
          sender_user_id: viewerId,
          sender_name: userLabel(currentUser),
          body: firstMessage.trim(),
          read_by_user_ids: [viewerId],
        });
      }
      return thread;
    },
    onSuccess: (thread) => {
      setComposeOpen(false);
      setSubject("");
      setFirstMessage("");
      setSelectedUsers([]);
      setSelectedThreadId(String(thread.id));
      queryClient.invalidateQueries({ queryKey: ["message-threads", viewerId] });
      queryClient.invalidateQueries({ queryKey: ["messages", String(thread.id)] });
    },
  });

  useEffect(() => {
    if (!open || selectedThreadId || !threads.length) return;
    setSelectedThreadId(String(threads[0].id));
  }, [open, selectedThreadId, threads]);

  useEffect(() => {
    if (!canProcessFlexDieRequests && activeView !== "messages") setActiveView("messages");
  }, [activeView, canProcessFlexDieRequests]);

  useEffect(() => {
    if (!open || !selectedThread?.unreadCount || markReadMutation.isPending) return;
    markReadMutation.mutate(selectedThread.id);
  }, [open, selectedThread?.id, selectedThread?.unreadCount]);

  function toggleUser(id) {
    setSelectedUsers((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function sendReply(event) {
    event.preventDefault();
    if (!selectedThreadId || !reply.trim()) return;
    sendMessageMutation.mutate({
      thread: selectedThreadId,
      sender_user_id: viewerId,
      sender_name: userLabel(currentUser),
      body: reply.trim(),
      read_by_user_ids: [viewerId],
    });
  }

  function createThread(event) {
    event.preventDefault();
    createThreadMutation.mutate();
  }

  return (
    <div className={`messages-center ${compact ? "compact" : ""}`}>
      <button className={`messages-trigger ${totalUnread ? "has-unread" : ""}`} type="button" onClick={() => setOpen(true)}>
        <MessageCircle size={16} />
        <span>Messages</span>
        {totalUnread > 0 && <b>{totalUnread > 99 ? "99+" : totalUnread}</b>}
      </button>

      {showToast && totalUnread > 0 && !open && (
        <button className="messages-unread-toast" type="button" onClick={() => setOpen(true)}>
          <Bell size={16} />
          <span>{totalUnread} unread message{totalUnread === 1 ? "" : "s"}</span>
        </button>
      )}

      {open && (
        <section className="messages-overlay" role="dialog" aria-modal="true" aria-label="Messages">
          <div className="messages-window">
            <header className="messages-head">
              <div>
                <p className="eyebrow">Inbox</p>
                <h2>Messages</h2>
                <span>{totalUnread ? `${totalUnread} unread` : "Everything is caught up"}</span>
              </div>
              <div>
                <button className="ghost-btn" type="button" onClick={() => setComposeOpen((value) => !value)}>
                  <Plus size={15} /> New
                </button>
                <button className="ghost-btn icon-only" type="button" onClick={() => setOpen(false)} aria-label="Close messages">
                  <X size={16} />
                </button>
              </div>
            </header>

            {canProcessFlexDieRequests && (
              <nav className="messages-tabs" aria-label="Messages sections">
                <button className={activeView === "messages" ? "active" : ""} type="button" onClick={() => setActiveView("messages")}>
                  <MessageCircle size={15} /> Messages
                </button>
                <button className={activeView === "flex-die-requests" ? "active" : ""} type="button" onClick={() => setActiveView("flex-die-requests")}>
                  <PackagePlus size={15} /> Flex Die Requests
                </button>
              </nav>
            )}

            {activeView === "flex-die-requests" ? (
              <div className="messages-request-pane">
                <FlexDieRequestQueue
                  currentUser={currentUser}
                  canProcess={canProcessFlexDieRequests}
                  title="Flex Die Requests"
                  emptyText="No flex die requests need attention."
                />
              </div>
            ) : (
            <div className="messages-layout">
              <aside className="messages-thread-pane">
                <label className="messages-search">
                  <Search size={15} />
                  <input value={threadSearch} onChange={(event) => setThreadSearch(event.target.value)} placeholder="Search messages" />
                </label>

                <div className="messages-thread-list">
                  {filteredThreads.length ? filteredThreads.map((thread) => (
                    <button
                      type="button"
                      className={`${String(selectedThreadId) === String(thread.id) ? "active" : ""} ${thread.unreadCount ? "unread" : ""}`}
                      key={thread.id}
                      onClick={() => {
                        setComposeOpen(false);
                        setSelectedThreadId(String(thread.id));
                      }}
                    >
                      <i>{threadInitial(thread.title)}</i>
                      <span>
                        <strong>{thread.title}</strong>
                        <em>{participantNames(thread, currentUser)}</em>
                        <small>{thread.lastMessage || "No messages yet"}</small>
                      </span>
                      {thread.unreadCount > 0 && <b>{thread.unreadCount}</b>}
                    </button>
                  )) : (
                    <div className="messages-empty-list">
                      <Inbox size={18} />
                      <span>No message boards yet.</span>
                    </div>
                  )}
                </div>
              </aside>

              <section className="messages-conversation">
                {composeOpen ? (
                  <form className="messages-compose" onSubmit={createThread}>
                    <div className="messages-compose-hero">
                      <Users size={18} />
                      <div>
                        <strong>Start a message board</strong>
                        <span>Ask about a quote, artwork, approval, schedule, or anything that needs another set of eyes.</span>
                      </div>
                    </div>
                    <label>
                      <span>Subject</span>
                      <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Quote approval, artwork update, job ticket question..." />
                    </label>
                    <div className="messages-user-picker">
                      <span>People</span>
                      <div>
                        {activeUsers.map((user) => {
                          const id = userId(user);
                          return (
                            <button type="button" className={selectedUsers.includes(id) ? "active" : ""} key={id} onClick={() => toggleUser(id)}>
                              {userLabel(user)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <label>
                      <span>Message</span>
                      <textarea value={firstMessage} onChange={(event) => setFirstMessage(event.target.value)} rows={5} placeholder="Write the first message..." />
                    </label>
                    {createThreadMutation.error && <p className="messages-error">{createThreadMutation.error.message}</p>}
                    <div className="messages-compose-actions">
                      <button className="ghost-btn" type="button" onClick={() => setComposeOpen(false)}>Cancel</button>
                      <button className="primary-btn" type="submit" disabled={createThreadMutation.isPending}>
                        <Send size={15} /> {createThreadMutation.isPending ? "Creating..." : "Create Board"}
                      </button>
                    </div>
                  </form>
                ) : selectedThread ? (
                  <>
                    <div className="messages-conversation-head">
                      <div>
                        <strong>{selectedThread.title}</strong>
                        <span>{participantNames(selectedThread, currentUser)}</span>
                      </div>
                      <em><CheckCheck size={14} /> {selectedThread.unreadCount ? "Marking read" : "Read"}</em>
                    </div>
                    <div className="messages-body">
                      {(messagesQuery.data?.results ?? []).length ? (messagesQuery.data?.results ?? []).map((message) => {
                        const mine = String(message.sender_user_id || "") === viewerId;
                        return (
                          <article className={mine ? "mine" : ""} key={message.id}>
                            <div>
                              <strong>{message.sender_name || "Message"}</strong>
                              <span>{formatMessageTime(message.created_at)}</span>
                            </div>
                            <p>{message.body}</p>
                          </article>
                        );
                      }) : (
                        <div className="messages-empty-conversation">
                          <MessageCircle size={24} />
                          <strong>No messages yet</strong>
                          <span>Send the first note to get this board moving.</span>
                        </div>
                      )}
                    </div>
                    <form className="messages-reply" onSubmit={sendReply}>
                      <textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={2} placeholder="Type a reply..." />
                      <button className="primary-btn icon-only" type="submit" disabled={sendMessageMutation.isPending || !reply.trim()} aria-label="Send message">
                        <Send size={16} />
                      </button>
                    </form>
                  </>
                ) : (
                  <div className="messages-empty-conversation">
                    <MessageCircle size={26} />
                    <strong>Select a message board</strong>
                    <span>Or start a new one from the top right.</span>
                  </div>
                )}
              </section>
            </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
