"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/shared/components";

// Import custom hook
import { useBasicChat } from "./hooks/local/use-basic-chat";

// Import local components
import { ChatModelSelector } from "./components/local/chat-model-selector";
import { ChatHistorySidebar } from "./components/local/chat-history-sidebar";
import { ChatMessageList } from "./components/local/chat-message-list";
import { ChatInputBar } from "./components/local/chat-input-bar";

/**
 * Proxy Shell Component for Basic Chat Client Page.
 * Outsources complex hooks and child components to separate files to optimize upstream merges.
 */
export default function BasicChatPageClient() {
  const {
    providerGroups,
    loadingData,
    loadError,
    sessions,
    activeSessionId,
    activeProviderId,
    activeModelId,
    draft,
    setDraft,
    attachments,
    isSending,
    streamingMessageId,
    streamingText,
    isHydrated,
    modelMenuOpen,
    setModelMenuOpen,
    historyOpen,
    setHistoryOpen,
    modelSearch,
    setModelSearch,
    historySearch,
    setHistorySearch,
    favoriteModels,
    fileInputRef,
    activeModel,
    currentSession,
    currentMessages,
    canSend,
    favoriteModelItems,
    recentModelItems,
    filteredProviderGroups,
    filteredSessionItems,
    handleNewChat,
    handleSelectSession,
    handleDeleteCurrentChat,
    toggleFavoriteModel,
    handleSelectModel,
    handleAttachFiles,
    removeAttachment,
    handleStop,
    sendMessage,
    handleKeyDown,
  } = useBasicChat();

  const modelMenuRef = useRef(null);
  const historyMenuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        modelMenuRef.current &&
        !modelMenuRef.current.contains(event.target)
      ) {
        setModelMenuOpen(false);
      }
      if (
        historyMenuRef.current &&
        !historyMenuRef.current.contains(event.target)
      ) {
        setHistoryOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [setModelMenuOpen, setHistoryOpen]);

  if (!isHydrated) return null;

  return (
    <div className="relative flex-1 flex flex-col h-full min-h-0 min-w-0 bg-[#212121] text-white overflow-hidden">
      <div className="relative mx-auto flex flex-1 h-full min-h-0 w-full max-w-4xl flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <ChatModelSelector
            modelMenuOpen={modelMenuOpen}
            setModelMenuOpen={setModelMenuOpen}
            modelMenuRef={modelMenuRef}
            activeModel={activeModel}
            toggleFavoriteModel={toggleFavoriteModel}
            favoriteModels={favoriteModels}
            modelSearch={modelSearch}
            setModelSearch={setModelSearch}
            favoriteModelItems={favoriteModelItems}
            recentModelItems={recentModelItems}
            filteredProviderGroups={filteredProviderGroups}
            activeModelId={activeModelId}
            handleSelectModel={handleSelectModel}
            normalizedModelSearch={modelSearch.trim().toLowerCase()}
          />

          <div className="flex items-center gap-2">
            <ChatHistorySidebar
              historyOpen={historyOpen}
              setHistoryOpen={setHistoryOpen}
              historyMenuRef={historyMenuRef}
              historySearch={historySearch}
              setHistorySearch={setHistorySearch}
              filteredSessionItems={filteredSessionItems}
              activeSessionId={activeSessionId}
              handleSelectSession={handleSelectSession}
              sessions={sessions}
              normalizedHistorySearch={historySearch.trim().toLowerCase()}
            />
            <Button
              variant="ghost"
              size="sm"
              icon="delete"
              onClick={handleDeleteCurrentChat}
              disabled={!activeSessionId || sessions.length === 0}
            >
              Clear
            </Button>
          </div>
        </div>

        {loadError ? (
          <div className="mt-4 rounded-[18px] border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-rose-100">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[20px]">
                error
              </span>
              <p className="text-sm leading-6">{loadError}</p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-1 flex-col min-h-0">
          <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
            <ChatMessageList
              currentMessages={currentMessages}
              streamingMessageId={streamingMessageId}
              streamingText={streamingText}
              activeModel={activeModel}
            />
          </div>

          <ChatInputBar
            draft={draft}
            setDraft={setDraft}
            attachments={attachments}
            removeAttachment={removeAttachment}
            fileInputRef={fileInputRef}
            activeModel={activeModel}
            loadingData={loadingData}
            handleAttachFiles={handleAttachFiles}
            isSending={isSending}
            handleStop={handleStop}
            sendMessage={sendMessage}
            handleKeyDown={handleKeyDown}
            canSend={canSend}
          />

          <p className="mx-auto mt-2 max-w-3xl px-4 pb-4 text-center text-[11px] text-white/30">
            Model list is filtered from connected providers.
          </p>
        </div>
      </div>
    </div>
  );
}