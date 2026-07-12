"use client";

import { formatRelativeTime, textValue } from "./helpers";

export function ChatHistorySidebar({
  historyOpen,
  setHistoryOpen,
  historyMenuRef,
  historySearch,
  setHistorySearch,
  filteredSessionItems,
  activeSessionId,
  handleSelectSession,
  sessions,
  normalizedHistorySearch,
}) {
  return (
    <>
      <button
        type="button"
        onClick={() => setHistoryOpen((value) => !value)}
        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80 transition hover:bg-white/8"
        aria-label="Open chat history"
        aria-haspopup="menu"
        aria-expanded={historyOpen}
        aria-controls="basic-chat-history-menu"
      >
        History
      </button>

      {historyOpen ? (
        <div
          id="basic-chat-history-menu"
          ref={historyMenuRef}
          role="menu"
          className="absolute right-4 top-[72px] z-20 w-[min(360px,calc(100vw-2rem))] rounded-[20px] border border-white/10 bg-[#262626] p-2 shadow-2xl shadow-black/50 lg:right-6"
        >
          <div className="px-3 py-2">
            <p className="text-xs uppercase tracking-[0.22em] text-white/45">
              Recent chats
            </p>
            <input
              type="search"
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
              className="mt-3 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35"
            />
          </div>
          <div className="max-h-[48vh] space-y-2 overflow-y-auto p-1 custom-scrollbar">
            {filteredSessionItems.length === 0 ? (
              <div className="rounded-[16px] border border-dashed border-white/10 bg-white/5 p-4 text-sm text-white/55">
                {normalizedHistorySearch
                  ? "No chats match your search."
                  : "No conversations yet."}
              </div>
            ) : (
              filteredSessionItems.map((session) => {
                const isActive = session.id === activeSessionId;
                const latestMessage =
                  [...(session.messages || [])]
                    .reverse()
                    .find((message) => message.role === "user") ||
                  session.messages?.[0];
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => handleSelectSession(session.id)}
                    className={`w-full rounded-[16px] border px-3 py-3 text-left transition ${isActive ? "border-blue-400/40 bg-blue-500/15" : "border-white/10 bg-white/5 hover:bg-white/8"}`}
                    role="menuitem"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">
                          {session.title}
                        </p>
                        <p className="mt-1 truncate text-xs text-white/50">
                          {textValue(latestMessage?.content) || "Empty chat"}
                        </p>
                      </div>
                      <span className="text-[10px] text-white/40 shrink-0">
                        {formatRelativeTime(session.updatedAt)}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}