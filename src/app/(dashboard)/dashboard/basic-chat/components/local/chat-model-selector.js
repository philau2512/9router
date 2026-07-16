"use client";

import { Badge } from "@/shared/components";

export function ChatModelSelector({
  modelMenuOpen,
  setModelMenuOpen,
  modelMenuRef,
  activeModel,
  toggleFavoriteModel,
  favoriteModels,
  modelSearch,
  setModelSearch,
  favoriteModelItems,
  recentModelItems,
  filteredProviderGroups,
  activeModelId,
  handleSelectModel,
  normalizedModelSearch,
}) {
  const modelLabel = activeModel ? `${activeModel.name}` : "Select model";
  const modelSubLabel = activeModel
    ? activeModel.requestModel
    : "Choose from connected providers";

  return (
    <div ref={modelMenuRef} className="relative">
      <button
        type="button"
        onClick={() => setModelMenuOpen((value) => !value)}
        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/8"
        aria-label="Select chat model"
        aria-haspopup="menu"
        aria-expanded={modelMenuOpen}
        aria-controls="basic-chat-model-menu"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">
              {modelLabel}
            </span>
            <span className="material-symbols-outlined text-[18px] text-white/70">
              expand_more
            </span>
          </div>
          <p className="truncate text-xs text-white/55">
            {modelSubLabel}
          </p>
        </div>
      </button>
      {activeModel ? (
        <button
          type="button"
          onClick={() => toggleFavoriteModel(activeModel.id)}
          className="absolute -right-3 -top-3 flex size-8 items-center justify-center rounded-full border border-white/10 bg-[#2f2f2f] text-white/70 transition hover:text-amber-200"
          aria-label={
            favoriteModels.includes(activeModel.id)
              ? "Remove model from favorites"
              : "Add model to favorites"
          }
        >
          <span
            className={`material-symbols-outlined text-[18px] ${favoriteModels.includes(activeModel.id) ? "text-amber-300" : ""}`}
          >
            star
          </span>
        </button>
      ) : null}

      {modelMenuOpen ? (
        <div
          id="basic-chat-model-menu"
          role="menu"
          className="absolute left-0 top-[calc(100%+10px)] z-30 w-[min(520px,calc(100vw-2rem))] overflow-hidden rounded-[20px] border border-white/10 bg-[#262626] shadow-2xl shadow-black/50"
        >
          <div className="border-b border-white/10 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.22em] text-white/45">
              Models
            </p>
            <p className="text-sm text-white/75">
              Only from connected providers
            </p>
            <input
              type="search"
              value={modelSearch}
              onChange={(event) => setModelSearch(event.target.value)}
              placeholder="Search models"
              aria-label="Search models"
              className="mt-3 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35"
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-2 custom-scrollbar">
            {!normalizedModelSearch && favoriteModelItems.length > 0 ? (
              <div className="mb-2 rounded-[16px] border border-amber-300/20 bg-amber-300/10 p-2">
                <p className="px-2 py-2 text-sm font-semibold text-amber-100">
                  Favorites
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {favoriteModelItems.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => handleSelectModel(model.id)}
                      className="rounded-[14px] border border-amber-300/20 bg-black/20 px-3 py-3 text-left transition hover:bg-amber-300/10"
                      role="menuitem"
                    >
                      <p className="truncate text-sm font-medium text-white">
                        {model.name}
                      </p>
                      <p className="truncate text-[11px] text-white/45">
                        {model.requestModel}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {!normalizedModelSearch && recentModelItems.length > 0 ? (
              <div className="mb-2 rounded-[16px] border border-white/10 bg-black/20 p-2">
                <p className="px-2 py-2 text-sm font-semibold text-white">
                  Recent
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {recentModelItems.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => handleSelectModel(model.id)}
                      className="rounded-[14px] border border-white/10 bg-white/5 px-3 py-3 text-left transition hover:bg-white/8"
                      role="menuitem"
                    >
                      <p className="truncate text-sm font-medium text-white">
                        {model.name}
                      </p>
                      <p className="truncate text-[11px] text-white/45">
                        {model.requestModel}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {filteredProviderGroups.length === 0 ? (
              <div className="rounded-[16px] border border-dashed border-white/10 bg-white/5 p-4 text-sm text-white/55">
                No models match your search.
              </div>
            ) : null}
            {filteredProviderGroups.map((group) => (
              <div
                key={group.providerId}
                className="mb-2 rounded-[16px] border border-white/10 bg-black/20 p-2"
              >
                <div className="flex items-center justify-between px-2 py-2">
                  <p className="text-sm font-semibold text-white">
                    {group.providerName}
                  </p>
                  <Badge size="sm" variant="default">
                    {group.models.length}
                  </Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.models.map((model) => {
                    const isActive = model.id === activeModelId;
                    const isFavorite = favoriteModels.includes(model.id);
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => handleSelectModel(model.id)}
                        className={`rounded-[14px] border px-3 py-3 text-left transition ${isActive ? "border-blue-400/40 bg-blue-500/15" : "border-white/10 bg-white/5 hover:bg-white/8"}`}
                        role="menuitem"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-white">
                              {model.name}
                            </p>
                            <p className="truncate text-[11px] text-white/45">
                              {model.requestModel}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span
                              className={`material-symbols-outlined text-[18px] ${isFavorite ? "text-amber-300" : "text-white/25"}`}
                              aria-hidden="true"
                            >
                              star
                            </span>
                            {isActive ? (
                              <span className="material-symbols-outlined text-[18px] text-blue-300">
                                check_circle
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}