"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getModelsByProviderId } from "@/shared/constants/models";
import {
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
} from "@/shared/constants/providers";
import { isLiveOnlyModelProvider } from "@/shared/utils/mergeProviderModels";
import {
  STORAGE_KEYS,
  createId,
  safeParse,
  textValue,
  cloneSession,
  getProviderLabel,
  normalizeStaticModel,
  normalizeLiveModel,
  parseProviderModelsPayload,
  dedupeModels,
  sessionItemsFromSessions,
  buildUserContent,
  readAssistantText,
  fileToDataUrl,
  makeSessionTitle,
} from "../../components/local/helpers";

export function useBasicChat() {
  const [providerGroups, setProviderGroups] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sessions, setSessions] = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = safeParse(
        globalThis.localStorage.getItem(STORAGE_KEYS.sessions),
        [],
      );
      return Array.isArray(saved)
        ? saved.map((session) => ({
            ...session,
            messages: Array.isArray(session.messages) ? session.messages : [],
          }))
        : [];
    } catch {
      return [];
    }
  });
  const [activeSessionId, setActiveSessionId] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.activeSessionId) || "";
  });
  const [activeProviderId, setActiveProviderId] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.activeProviderId) || "";
  });
  const [activeModelId, setActiveModelId] = useState("");
  const [draft, setDraft] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.draft) || "";
  });
  const [attachments, setAttachments] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [favoriteModels, setFavoriteModels] = useState(() => {
    if (typeof window === "undefined") return [];
    const saved = safeParse(
      globalThis.localStorage.getItem(STORAGE_KEYS.favoriteModels),
      [],
    );
    return Array.isArray(saved) ? saved.filter(Boolean) : [];
  });
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsHydrated(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoadingData(true);
      setLoadError("");

      try {
        const providersRes = await fetch("/api/providers", {
          cache: "no-store",
        });
        const providersData = await providersRes.json().catch(() => ({}));
        const connections = Array.isArray(providersData.connections)
          ? providersData.connections.filter(
              (connection) => connection?.isActive !== false,
            )
          : [];

        if (connections.length === 0) {
          if (!cancelled) {
            setProviderGroups([]);
            setLoadError("No providers connected yet.");
          }
          return;
        }

        const providerMap = new Map();
        const liveHitByProvider = new Map();

        for (const connection of connections) {
          const providerId = connection.provider || connection.id;
          const providerName = getProviderLabel(connection);
          const providerType = isOpenAICompatibleProvider(providerId)
            ? "openai-compatible"
            : isAnthropicCompatibleProvider(providerId)
              ? "anthropic-compatible"
              : providerId;

          if (!providerMap.has(providerId)) {
            providerMap.set(providerId, {
              providerId,
              providerName,
              providerType,
              connections: [],
              models: [],
              staticModels: [],
              liveModels: [],
            });
          }

          const group = providerMap.get(providerId);
          group.providerName = group.providerName || providerName;
          group.providerType = group.providerType || providerType;
          group.connections.push(connection);

          const staticModels = getModelsByProviderId(providerId)
            .map((model) => normalizeStaticModel(model, connection))
            .filter(Boolean);
          group.staticModels.push(...staticModels);
        }

        const liveResults = await Promise.all(
          connections.map(async (connection) => {
            try {
              const response = await fetch(
                `/api/providers/${connection.id}/models`,
                { cache: "no-store" },
              );
              const data = await response.json().catch(() => ({}));
              if (!response.ok) return { connection, models: [] };
              const models = parseProviderModelsPayload(data)
                .map((model) => normalizeLiveModel(model, connection))
                .filter(Boolean);
              return { connection, models };
            } catch {
              return { connection, models: [] };
            }
          }),
        );

        for (const result of liveResults) {
          const providerId = result.connection.provider || result.connection.id;
          const group = providerMap.get(providerId);
          if (!group) continue;
          if (result.models.length > 0) {
            liveHitByProvider.set(providerId, true);
            group.liveModels.push(...result.models);
          }
        }

        for (const group of providerMap.values()) {
          if (
            isLiveOnlyModelProvider(group.providerId) &&
            liveHitByProvider.get(group.providerId)
          ) {
            group.models = group.liveModels;
          } else {
            group.models = [...group.staticModels, ...group.liveModels];
          }
        }

        const normalized = Array.from(providerMap.values())
          .map((group) => ({
            providerId: group.providerId,
            providerName: group.providerName,
            providerType: group.providerType,
            connections: group.connections,
            models: dedupeModels(group.models).sort((a, b) =>
              a.name.localeCompare(b.name),
            ),
          }))
          .filter((group) => group.models.length > 0)
          .sort((a, b) => a.providerName.localeCompare(b.providerName));

        if (!cancelled) {
          setProviderGroups(normalized);
          if (normalized.length === 0) {
            setLoadError("Providers connected but no models available.");
          }
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            textValue(error?.message) || "Failed to load providers/models.",
          );
          setProviderGroups([]);
        }
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  const modelIndex = useMemo(() => {
    const map = new Map();
    for (const group of providerGroups) {
      for (const model of group.models) {
        map.set(model.id, {
          ...model,
          providerId: group.providerId,
          providerName: group.providerName,
        });
      }
    }
    return map;
  }, [providerGroups]);

  const activeProviderGroup = useMemo(() => {
    return (
      providerGroups.find((group) => group.providerId === activeProviderId) ||
      providerGroups[0] ||
      null
    );
  }, [providerGroups, activeProviderId]);

  const activeModel = useMemo(() => {
    if (activeModelId && modelIndex.has(activeModelId))
      return modelIndex.get(activeModelId);
    if (activeSessionId) {
      const session = sessions.find((item) => item.id === activeSessionId);
      if (session?.modelId && modelIndex.has(session.modelId))
        return modelIndex.get(session.modelId);
    }
    return activeProviderGroup?.models?.[0] || null;
  }, [
    activeModelId,
    modelIndex,
    activeProviderGroup,
    sessions,
    activeSessionId,
  ]);

  const currentSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || null,
    [sessions, activeSessionId],
  );
  const currentMessages = currentSession?.messages || [];
  const normalizedModelSearch = modelSearch.trim().toLowerCase();
  const filteredProviderGroups = useMemo(() => {
    if (!normalizedModelSearch) return providerGroups;
    return providerGroups
      .map((group) => ({
        ...group,
        models: group.models.filter((model) => {
          const text =
            `${model.name} ${model.requestModel} ${group.providerName}`.toLowerCase();
          return text.includes(normalizedModelSearch);
        }),
      }))
      .filter((group) => group.models.length > 0);
  }, [providerGroups, normalizedModelSearch]);
  const favoriteModelItems = useMemo(
    () =>
      favoriteModels
        .map((modelId) => modelIndex.get(modelId))
        .filter(Boolean)
        .slice(0, 6),
    [favoriteModels, modelIndex],
  );
  const recentModelItems = useMemo(() => {
    const ids = [];
    for (const session of sessionItemsFromSessions(sessions)) {
      if (session.modelId && !favoriteModels.includes(session.modelId)) {
        ids.push(session.modelId);
      }
    }
    return [...new Set(ids)]
      .map((modelId) => modelIndex.get(modelId))
      .filter(Boolean)
      .slice(0, 6);
  }, [sessions, favoriteModels, modelIndex]);
  const sessionItems = useMemo(
    () => sessionItemsFromSessions(sessions),
    [sessions],
  );
  const normalizedHistorySearch = historySearch.trim().toLowerCase();
  const filteredSessionItems = useMemo(() => {
    if (!normalizedHistorySearch) return sessionItems;
    return sessionItems.filter((session) => {
      const latestMessage =
        [...(session.messages || [])]
          .reverse()
          .find((message) => message.role === "user") || session.messages?.[0];
      const text =
        `${session.title} ${textValue(latestMessage?.content)} ${session.modelName || ""}`.toLowerCase();
      return text.includes(normalizedHistorySearch);
    });
  }, [sessionItems, normalizedHistorySearch]);
  const canSend =
    !isSending &&
    !!activeModel &&
    (draft.trim().length > 0 || attachments.length > 0);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      globalThis.localStorage.setItem(
        STORAGE_KEYS.sessions,
        JSON.stringify(sessions),
      );
      globalThis.localStorage.setItem(
        STORAGE_KEYS.activeSessionId,
        activeSessionId,
      );
      globalThis.localStorage.setItem(
        STORAGE_KEYS.activeProviderId,
        activeProviderId,
      );
      globalThis.localStorage.setItem(STORAGE_KEYS.draft, draft);
      globalThis.localStorage.setItem(
        STORAGE_KEYS.favoriteModels,
        JSON.stringify(favoriteModels),
      );
    } catch {
      // Ignore
    }
  }, [
    isHydrated,
    sessions,
    activeSessionId,
    activeProviderId,
    draft,
    favoriteModels,
  ]);

  useEffect(() => {
    if (!isHydrated || loadingData || initializedRef.current) return;
    if (providerGroups.length === 0) return;

    const savedProvider =
      providerGroups.find((group) => group.providerId === activeProviderId) ||
      providerGroups[0];
    const savedModel =
      activeModelId && modelIndex.has(activeModelId)
        ? modelIndex.get(activeModelId)
        : savedProvider.models[0];

    if (sessions.length > 0) {
      const session =
        sessions.find((item) => item.id === activeSessionId) || sessions[0];
      const sessionModel =
        session?.modelId && modelIndex.has(session.modelId)
          ? modelIndex.get(session.modelId)
          : savedModel;
      initializedRef.current = true;
      
      const timer = setTimeout(() => {
        setActiveSessionId(session.id);
        setActiveProviderId(sessionModel?.providerId || savedProvider.providerId);
        setActiveModelId(sessionModel?.id || savedModel.id);
      }, 0);
      return () => clearTimeout(timer);
    }

    const session = {
      id: createId(),
      title: "New chat",
      providerId: savedProvider.providerId,
      providerName: savedProvider.providerName,
      modelId: savedModel.id,
      modelName: savedModel.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };

    initializedRef.current = true;
    
    const timer = setTimeout(() => {
      setSessions([session]);
      setActiveSessionId(session.id);
      setActiveProviderId(savedProvider.providerId);
      setActiveModelId(savedModel.id);
    }, 0);
    return () => clearTimeout(timer);
  }, [
    isHydrated,
    loadingData,
    providerGroups,
    modelIndex,
    sessions,
    activeSessionId,
    activeProviderId,
    activeModelId,
  ]);

  const updateSession = (sessionId, updater) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? updater(cloneSession(session)) : session,
      ),
    );
  };

  const ensureSessionForModel = (model) => {
    if (!model) return null;
    return {
      id: createId(),
      title: "New chat",
      providerId: model.providerId,
      providerName: model.providerName,
      modelId: model.id,
      modelName: model.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
  };

  const handleNewChat = () => {
    if (!activeModel) return;
    const session = ensureSessionForModel(activeModel);
    if (!session) return;
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
    setActiveProviderId(session.providerId);
    setActiveModelId(session.modelId);
    setDraft("");
    setAttachments([]);
    setStreamingMessageId("");
    setStreamingText("");
  };

  const handleSelectSession = (sessionId) => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveSessionId(sessionId);
    setActiveProviderId(session.providerId || activeProviderId);
    setActiveModelId(session.modelId || activeModelId);
    setHistoryOpen(false);
  };

  const handleDeleteCurrentChat = () => {
    if (!activeSessionId) return;
    const nextSessions = sessions.filter(
      (session) => session.id !== activeSessionId,
    );
    const fallback = nextSessions[0] || null;
    setSessions(nextSessions);
    if (fallback) {
      setActiveSessionId(fallback.id);
      setActiveProviderId(fallback.providerId);
      setActiveModelId(fallback.modelId);
    } else {
      setActiveSessionId("");
      setActiveProviderId("");
      setActiveModelId("");
    }
  };

  const handleSelectProvider = (providerId) => {
    const group = providerGroups.find((item) => item.providerId === providerId);
    if (!group || group.models.length === 0) return;
    const nextModel = group.models[0];

    const current = sessions.find((session) => session.id === activeSessionId);
    if (current && current.messages.length > 0) {
      const session = ensureSessionForModel(nextModel);
      if (!session) return;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    } else if (current) {
      setSessions((prev) =>
        prev.map((item) =>
          item.id === current.id
            ? {
                ...item,
                providerId: group.providerId,
                providerName: group.providerName,
                modelId: nextModel.id,
                modelName: nextModel.name,
              }
            : item,
        ),
      );
      setActiveSessionId(current.id);
    }

    setActiveProviderId(group.providerId);
    setActiveModelId(nextModel.id);
    setModelMenuOpen(false);
  };

  const toggleFavoriteModel = (modelId) => {
    setFavoriteModels((prev) =>
      prev.includes(modelId)
        ? prev.filter((id) => id !== modelId)
        : [modelId, ...prev].slice(0, 20),
    );
  };

  const handleSelectModel = (modelId) => {
    const model = modelIndex.get(modelId);
    if (!model) return;

    const current = sessions.find((session) => session.id === activeSessionId);
    if (current && current.messages.length > 0) {
      const session = ensureSessionForModel(model);
      if (!session) return;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    } else if (current) {
      setSessions((prev) =>
        prev.map((item) =>
          item.id === current.id
            ? {
                ...item,
                providerId: model.providerId,
                providerName: model.providerName,
                modelId: model.id,
                modelName: model.name,
              }
            : item,
        ),
      );
      setActiveSessionId(current.id);
    } else {
      const session = ensureSessionForModel(model);
      if (!session) return;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    }

    setActiveProviderId(model.providerId);
    setActiveModelId(model.id);
    setModelMenuOpen(false);
  };

  const handleAttachFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      event.target.value = "";
      return;
    }

    const converted = await Promise.all(
      images.map(async (file) => ({
        id: createId(),
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: await fileToDataUrl(file),
      })),
    );

    setAttachments((prev) => [...prev, ...converted]);
    event.target.value = "";
  };

  const removeAttachment = (attachmentId) => {
    setAttachments((prev) =>
      prev.filter((attachment) => attachment.id !== attachmentId),
    );
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const finalizeSessionTitle = (sessionId, titleSeed) => {
    const title = makeSessionTitle(titleSeed);
    updateSession(sessionId, (session) => ({
      ...session,
      title: session.title === "New chat" ? title : session.title,
      updatedAt: new Date().toISOString(),
    }));
  };

  const sendMessage = async () => {
    const model = activeModel || activeProviderGroup?.models?.[0] || null;
    if (!model) return;

    const userText = draft.trim();
    if (!userText && attachments.length === 0) return;

    let sessionId = activeSessionId;
    let session = sessions.find((item) => item.id === sessionId);
    if (!session) {
      session = ensureSessionForModel(model);
      if (!session) return;
      sessionId = session.id;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(sessionId);
    }

    const userMessage = {
      id: createId(),
      role: "user",
      content: userText,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
        dataUrl: attachment.dataUrl,
      })),
      createdAt: new Date().toISOString(),
    };

    const assistantMessageId = createId();
    const assistantMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      status: "streaming",
    };

    const nextMessages = [
      ...(session.messages || []),
      userMessage,
      assistantMessage,
    ];
    setSessions((prev) =>
      prev.map((item) =>
        item.id === sessionId
          ? {
              ...item,
              providerId: model.providerId,
              providerName: model.providerName,
              modelId: model.id,
              modelName: model.name,
              messages: nextMessages,
              updatedAt: new Date().toISOString(),
              title:
                item.title === "New chat"
                  ? makeSessionTitle(userText)
                  : item.title,
            }
          : item,
      ),
    );
    setDraft("");
    setAttachments([]);
    setIsSending(true);
    setStreamingMessageId(assistantMessageId);
    setStreamingText("");
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const requestMessages = nextMessages
      .filter(
        (message) =>
          !(message.role === "assistant" && message.id === assistantMessageId),
      )
      .map((message) => ({
        role: message.role,
        content:
          message.role === "user" ? buildUserContent(message) : message.content,
      }));

    try {
      const response = await fetch("/api/dashboard/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model: model.requestModel || model.id,
          messages: requestMessages,
          stream: true,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          textValue(
            errorData.error ||
              errorData.message ||
              `Request failed (${response.status})`,
          ),
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        const data = await response.json().catch(() => ({}));
        const fallbackText = textValue(
          data?.choices?.[0]?.message?.content ||
            data?.output_text ||
            data?.error ||
            data?.message ||
            "",
        );
        updateSession(sessionId, (currentSession) => ({
          ...currentSession,
          messages: currentSession.messages.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: fallbackText, status: "done" }
              : message,
          ),
          updatedAt: new Date().toISOString(),
        }));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          try {
            const chunk = JSON.parse(payload);
            const text = readAssistantText(chunk);
            if (!text) continue;

            assistantText += text;
            setStreamingText(assistantText);
            updateSession(sessionId, (currentSession) => ({
              ...currentSession,
              messages: currentSession.messages.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, content: assistantText, status: "streaming" }
                  : message,
              ),
              updatedAt: new Date().toISOString(),
            }));
          } catch {
            // Ignore
          }
        }
      }

      updateSession(sessionId, (currentSession) => ({
        ...currentSession,
        messages: currentSession.messages.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content: assistantText || message.content,
                status: "done",
              }
            : message,
        ),
        updatedAt: new Date().toISOString(),
      }));
      finalizeSessionTitle(sessionId, userText);
    } catch (error) {
      if (error.name !== "AbortError") {
        const errorText = textValue(error?.message || error);
        updateSession(sessionId, (currentSession) => ({
          ...currentSession,
          messages: currentSession.messages.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  content: message.content || `Error: ${errorText}`,
                  status: "error",
                }
              : message,
          ),
          updatedAt: new Date().toISOString(),
        }));
        setLoadError(errorText || "Failed to send message.");
      }
    } finally {
      setIsSending(false);
      setStreamingMessageId("");
      setStreamingText("");
      abortRef.current = null;
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) sendMessage();
    }
  };

  return {
    providerGroups,
    loadingData,
    loadError,
    setLoadError,
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
    activeProviderGroup,
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
    handleSelectProvider,
    toggleFavoriteModel,
    handleSelectModel,
    handleAttachFiles,
    removeAttachment,
    handleStop,
    sendMessage,
    handleKeyDown,
  };
}