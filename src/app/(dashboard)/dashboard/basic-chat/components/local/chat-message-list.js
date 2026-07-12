"use client";

import { textValue } from "./helpers";

export function ChatMessageList({
  currentMessages,
  streamingMessageId,
  streamingText,
  activeModel,
}) {
  if (currentMessages.length === 0) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center px-4 text-center">
        <div className="max-w-xl space-y-4">
          <div className="mx-auto flex size-16 items-center justify-center rounded-[20px] border border-white/10 bg-white/5 text-white/80">
            <span className="material-symbols-outlined text-[30px]">chat</span>
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-white">
              Start a conversation
            </h2>
            <p className="text-sm leading-6 text-white/60">
              Simple chat interface to interact with any AI model from
              connected providers. Select a model and start chatting!
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4">
      {currentMessages.map((message) => {
        const isUser = message.role === "user";
        const isAssistant = message.role === "assistant";
        const isStreaming =
          isAssistant &&
          message.id === streamingMessageId &&
          message.status === "streaming";
        const content =
          textValue(message.content) || (isAssistant ? streamingText : "");

        return (
          <div
            key={message.id}
            className={`flex w-full ${isUser ? "justify-end" : "justify-start"} mb-6`}
          >
            <div
              className={`max-w-[min(88%,42rem)] ${isUser ? "rounded-3xl bg-[#2f2f2f] px-5 py-3.5 text-white" : "text-white/90"}`}
            >
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold">
                  {isUser ? "You" : activeModel?.name || "Assistant"}
                </span>
              </div>

              {message.attachments?.length ? (
                <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 mt-2">
                  {message.attachments.map((attachment) => (
                    <a
                      key={attachment.id}
                      href={attachment.dataUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="overflow-hidden rounded-[18px] border border-white/10 bg-black/20"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={attachment.dataUrl}
                        alt={attachment.name}
                        className="h-28 w-full object-cover"
                      />
                    </a>
                  ))}
                </div>
              ) : null}

              <div className="whitespace-pre-wrap break-words text-[15px] leading-7">
                {content}
                {isAssistant && isStreaming && !streamingText ? (
                  <span className="inline-block animate-pulse">▋</span>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}