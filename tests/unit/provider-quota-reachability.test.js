import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function source(relativePath) {
  return readFile(resolve(root, relativePath), "utf8");
}

describe("provider and quota UI reachability", () => {
  it("keeps Codex JSON bulk import reachable from the provider page", async () => {
    const [page, card] = await Promise.all([
      source("src/app/(dashboard)/dashboard/providers/[id]/page.js"),
      source(
        "src/app/(dashboard)/dashboard/providers/[id]/components/ProviderConnectionsCard.js",
      ),
    ]);

    expect(page).toContain('import BulkImportCodexModal from "./BulkImportCodexModal"');
    expect(page).toContain("showBulkImportCodex");
    expect(page).toContain("<BulkImportCodexModal");
    expect(card).toContain('providerId === "codex"');
    expect(card).toContain("onOpenCodexBulkImport");
    expect(card).toContain("Bulk Add");
    expect(card).toContain("onTriggerAddConnection");
  });

  it("keeps Codex connection-row auto-ping reachable through settings", async () => {
    const [hook, card, list, row] = await Promise.all([
      source(
        "src/app/(dashboard)/dashboard/providers/[id]/hooks/useProviderDetailConnections.js",
      ),
      source(
        "src/app/(dashboard)/dashboard/providers/[id]/components/ProviderConnectionsCard.js",
      ),
      source(
        "src/app/(dashboard)/dashboard/providers/[id]/components/ProviderConnectionsList.js",
      ),
      source(
        "src/app/(dashboard)/dashboard/providers/[id]/components/ConnectionRow.js",
      ),
    ]);

    expect(hook).toContain('codex: "codexAutoPing"');
    expect(hook).toContain("handleToggleAutoPing");
    expect(hook).toContain("patchProviderSettings");
    expect(card).toContain("autoPingConnections={autoPingConnections}");
    expect(list).toContain("autoPingConnections[conn.id]");
    expect(list).toContain('conn.authType === "oauth"');
    expect(row).toContain("Auto-ping");
    expect(row).toContain("autoPing.onToggle");
    expect(hook).toContain("setSelectedConnectionsAutoPing");
    expect(hook).toContain("eligibleIds.length === 1 ? eligibleIds[0] : \"bulk\"");
    expect(hook).toContain("autoPingSelection");
    expect(card).toContain("setSelectedConnectionsAutoPing={setSelectedConnectionsAutoPing}");
    expect(card).toContain("autoPingSaving={autoPingSaving}");
    expect(card).toContain("autoPingSelection={autoPingSelection}");
    expect(
      await source(
        "src/app/(dashboard)/dashboard/providers/[id]/components/ProviderConnectionsToolbar.js",
      ),
    ).toContain("Auto-ping (${autoPingSelection.enabledCount}/${autoPingSelection.eligibleCount})");
  });

  it("keeps the Codex reset-credit action connected to its POST route", async () => {
    const [hook, card, quotaPage] = await Promise.all([
      source(
        "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/hooks/local/use-provider-limits.js",
      ),
      source(
        "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/components/local/provider-connection-card.js",
      ),
      source("src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js"),
    ]);

    expect(hook).toContain("handleResetCodexLimit");
    expect(hook).toContain("{ method: \"POST\" }");
    expect(card).toContain("onRequestCodexReset");
    expect(card).toContain("restart_alt");
    expect(quotaPage).toContain("<ConfirmModal");
    expect(quotaPage).toContain("handleResetCodexLimit(connection)");
  });

  it("keeps Auto-ping constrained to OAuth connections and merges fresh settings", async () => {
    const [config, quotaHook, quotaCard] = await Promise.all([
      source("src/shared/constants/config.js"),
      source(
        "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/hooks/local/use-provider-limits.js",
      ),
      source(
        "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/components/local/provider-connection-card.js",
      ),
    ]);

    expect(config).toContain('quotaKey: "session (5h)"');
    expect(quotaHook).toContain('connection?.authType !== "oauth"');
    expect(quotaHook).toContain('fetch("/api/settings", {');
    expect(quotaHook).toContain('cache: "no-store"');
    expect(quotaHook).toContain("const currentMap = settings[settingsKey]?.connections || {}");
    expect(quotaCard).toContain('conn.authType === "oauth"');
  });

  it("keeps the enabled-account count visible in the Round Robin toolbar", async () => {
    const [card, toolbar] = await Promise.all([
      source(
        "src/app/(dashboard)/dashboard/providers/[id]/components/ProviderConnectionsCard.js",
      ),
      source(
        "src/app/(dashboard)/dashboard/providers/[id]/components/ProviderConnectionsToolbar.js",
      ),
    ]);

    expect(card).toContain("connection?.isActive !== false");
    expect(card).toContain("enabledConnectionsCount={enabledConnectionsCount}");
    expect(toolbar).toContain("Round Robin ({enabledConnectionsCount})");
  });

  it("keeps the Round Robin label tied to enabled connection count", async () => {
    const [card, toolbar] = await Promise.all([
      source(
        "src/app/(dashboard)/dashboard/providers/[id]/components/ProviderConnectionsCard.js",
      ),
      source(
        "src/app/(dashboard)/dashboard/providers/[id]/components/ProviderConnectionsToolbar.js",
      ),
    ]);

    expect(card).toContain("connection?.isActive !== false");
    expect(card).toContain("enabledConnectionsCount={enabledConnectionsCount}");
    expect(toolbar).toContain("Round Robin ({enabledConnectionsCount})");
  });

  it("keeps Codex access-token connections eligible for quota tracking", async () => {
    const [connectionsRoute, usageRoute] = await Promise.all([
      source("src/app/api/providers/client/route.js"),
      source("src/app/api/usage/[connectionId]/route.js"),
    ]);

    expect(connectionsRoute).toContain('connection.authType === "access_token"');
    expect(usageRoute).toContain('connection.authType === "access_token"');
  });
});