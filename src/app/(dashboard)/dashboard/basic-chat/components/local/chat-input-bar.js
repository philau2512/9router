"use client";

export function ChatInputBar({
  draft,
  setDraft,
  attachments,
  removeAttachment,
  fileInputRef,
  activeModel,
  loadingData,
  handleAttachFiles,
  isSending,
  handleStop,
  sendMessage,
  handleKeyDown,
  canSend,
}) {
  return (
    <div className="shrink-0 pt-2">
      {attachments.length > 0 ? (
        <div className="mx-auto mb-3 flex w-full max-w-3xl flex-wrap gap-2 px-4">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2"
            >
              <span className="text-xs text-white/80 max-w-[12rem] truncate">
                {attachment.name}
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(attachment.id)}
                className="text-white/55 hover:text-white"
                aria-label="Remove attachment"
              >
                <span className="material-symbols-outlined text-[18px]">
                  close
                </span>
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-3xl px-4 pb-2">
        <div className="rounded-[26px] bg-[#2f2f2f] px-3 pt-3 pb-2 shadow-[0_0_15px_rgba(0,0,0,0.10)] ring-1 ring-white/5">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message AI"
            aria-label="Message AI"
            rows={1}
            className="w-full resize-none bg-transparent px-2 text-[15px] leading-6 text-white outline-none placeholder:text-white/40 custom-scrollbar max-h-[25vh] overflow-y-auto"
          />

          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!activeModel || loadingData}
                className="p-2 text-white/50 hover:text-white transition rounded-full hover:bg-white/5"
                aria-label="Attach image files"
              >
                <span className="material-symbols-outlined text-[20px]">
                  attach_file
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleAttachFiles}
              />
              <span className="text-xs font-medium text-white/30 truncate max-w-[120px]">
                {activeModel ? activeModel.name : "No model"}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {isSending ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="p-2 text-white bg-white/10 hover:bg-white/20 transition rounded-full h-8 w-8 flex items-center justify-center"
                  aria-label="Stop response"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    stop
                  </span>
                </button>
              ) : null}
              <button
                onClick={sendMessage}
                disabled={!canSend}
                className={`h-8 w-8 rounded-full flex items-center justify-center transition ${canSend ? "bg-white text-black hover:opacity-90" : "bg-white/10 text-white/30 cursor-not-allowed"}`}
                aria-label="Send message"
              >
                <span className="material-symbols-outlined text-[16px]">
                  arrow_upward
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}