import { Button, Input, Modal } from "@/shared/components";

export default function RelayDeploymentModals({
  showVercelModal,
  closeVercelModal,
  vercelForm,
  setVercelForm,
  handleVercelDeploy,
  showCloudflareModal,
  closeCloudflareModal,
  cloudflareForm,
  setCloudflareForm,
  handleCloudflareDeploy,
  showDenoModal,
  closeDenoModal,
  denoForm,
  setDenoForm,
  handleDenoDeploy,
  deploying,
}) {
  return (
    <>
      {/* Vercel Relay Modal */}
      <Modal
        isOpen={showVercelModal}
        title="Deploy Vercel Relay"
        onClose={closeVercelModal}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-lg bg-blue-500/5 border border-blue-500/10 p-3 flex flex-col gap-1.5">
            <p className="text-sm text-text-main font-medium">
              What is Vercel Relay?
            </p>
            <p className="text-xs text-text-muted">
              Deploys an edge relay function to Vercel. All AI provider requests
              will be forwarded through Vercel&apos;s edge network, masking your
              real IP from providers.
            </p>
            <ul className="text-xs text-text-muted list-disc pl-4 space-y-0.5">
              <li>
                Your IP is replaced by Vercel&apos;s dynamic edge IPs (hundreds
                of IPs across 20+ global regions)
              </li>
              <li>
                Vercel serves millions of apps — providers can&apos;t block
                Vercel IPs without affecting legitimate traffic
              </li>
              <li>Free tier: 100GB bandwidth/month, 500K edge invocations</li>
              <li>
                Deploy multiple relays on different accounts for more IP
                diversity
              </li>
            </ul>
          </div>
          <Input
            label="Vercel API Token"
            value={vercelForm.vercelToken}
            onChange={(e) =>
              setVercelForm((prev) => ({
                ...prev,
                vercelToken: e.target.value,
              }))
            }
            placeholder="your-vercel-api-token"
            hint={
              <>
                Token is used once for deployment and not stored.{" "}
                <a
                  href="https://vercel.com/account/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Get token →
                </a>
              </>
            }
            type="password"
          />
          <Input
            label="Project Name"
            value={vercelForm.projectName}
            onChange={(e) =>
              setVercelForm((prev) => ({
                ...prev,
                projectName: e.target.value,
              }))
            }
            placeholder="my-relay"
            hint="Unique name for your Vercel project. Leave empty for auto-generated name."
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              fullWidth
              onClick={handleVercelDeploy}
              disabled={!vercelForm.vercelToken.trim() || deploying}
            >
              {deploying ? "Deploying... (may take ~1 min)" : "Deploy"}
            </Button>
            <Button
              fullWidth
              variant="ghost"
              onClick={closeVercelModal}
              disabled={deploying}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Cloudflare Relay Modal */}
      <Modal
        isOpen={showCloudflareModal}
        title="Deploy Cloudflare Relay"
        onClose={closeCloudflareModal}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-lg bg-orange-500/5 border border-orange-500/10 p-3 flex flex-col gap-1.5">
            <p className="text-sm text-text-main font-medium">
              What is Cloudflare Relay?
            </p>
            <p className="text-xs text-text-muted">
              Deploys a Cloudflare Worker as a proxy relay. All AI provider
              requests will be forwarded through Cloudflare&apos;s global edge
              network.
            </p>
            <ul className="text-xs text-text-muted list-disc pl-4 space-y-0.5">
              <li>
                High performance global routing and IP masking via Cloudflare
                Workers
              </li>
              <li>Free tier: 100,000 requests per day</li>
              <li>
                Requires Cloudflare Account ID and a Workers API Token (Edit
                Workers permission)
              </li>
            </ul>
            <div className="mt-2 pt-2 border-t border-orange-500/10 text-xs text-text-muted">
              <p className="font-medium text-text-main mb-1">
                How to generate your API Token:
              </p>
              <ol className="list-decimal pl-4 space-y-0.5">
                <li>
                  Go to <b>My Profile</b> → <b>API Tokens</b> →{" "}
                  <b>Create Token</b>
                </li>
                <li>
                  Scroll down to <b>Custom Token</b> and click{" "}
                  <b>Get started</b>
                </li>
                <li>
                  Under <b>Permissions</b>: Account | Workers Scripts | Edit
                </li>
                <li>
                  Under <b>Account Resources</b>: Include | Account |{" "}
                  <i>Your Account Name</i>
                </li>
                <li>
                  Click <b>Continue to summary</b> → <b>Create Token</b>
                </li>
              </ol>
            </div>
          </div>
          <Input
            label="Account ID"
            value={cloudflareForm.accountId}
            onChange={(e) =>
              setCloudflareForm((prev) => ({
                ...prev,
                accountId: e.target.value,
              }))
            }
            placeholder="your-cloudflare-account-id"
            hint={
              <>
                Found on the right side of the Cloudflare dashboard overview
                page.
              </>
            }
          />
          <Input
            label="API Token"
            value={cloudflareForm.apiToken}
            onChange={(e) =>
              setCloudflareForm((prev) => ({
                ...prev,
                apiToken: e.target.value,
              }))
            }
            placeholder="your-cloudflare-api-token"
            hint={
              <>
                Requires &quot;Workers Scripts: Edit&quot; permission.{" "}
                <a
                  href="https://dash.cloudflare.com/profile/api-tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Get token →
                </a>
              </>
            }
            type="password"
          />
          <Input
            label="Worker Name"
            value={cloudflareForm.projectName}
            onChange={(e) =>
              setCloudflareForm((prev) => ({
                ...prev,
                projectName: e.target.value,
              }))
            }
            placeholder="my-relay"
            hint="Unique name for your Cloudflare Worker. Leave empty for auto-generated name."
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              fullWidth
              onClick={handleCloudflareDeploy}
              disabled={
                !cloudflareForm.accountId.trim() ||
                !cloudflareForm.apiToken.trim() ||
                deploying
              }
            >
              {deploying ? "Deploying..." : "Deploy Worker"}
            </Button>
            <Button
              fullWidth
              variant="ghost"
              onClick={closeCloudflareModal}
              disabled={deploying}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Deno Relay Modal */}
      <Modal
        isOpen={showDenoModal}
        title="Deploy Deno Relay"
        onClose={closeDenoModal}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 p-3 flex flex-col gap-1.5">
            <p className="text-sm text-text-main font-medium">
              What is Deno Relay?
            </p>
            <p className="text-xs text-text-muted">
              Deploys a relay worker to Deno Deploy&apos;s global edge network.
              All AI provider requests are forwarded through Deno&apos;s edge,
              masking your real IP.
            </p>
            <ul className="text-xs text-text-muted list-disc pl-4 space-y-0.5">
              <li>
                Deno Deploy v2 runs on a high-performance global edge network
              </li>
              <li>
                Free tier: 1M requests & 100GiB outbound traffic per month
              </li>
              <li>No per-request CPU time limits (unlike Vercel/Cloudflare)</li>
              <li>Support up to 20 active apps & 50 custom domains</li>
              <li>Deploy multiple relays for maximum IP diversity</li>
            </ul>
            <div className="mt-2 pt-2 border-t border-black/10 dark:border-white/10 text-xs text-text-muted">
              <p className="font-medium text-text-main mb-1">
                How to generate API token:
              </p>
              <ol className="list-decimal pl-4 space-y-0.5">
                <li>
                  Go to <b>console.deno.com</b>
                </li>
                <li>
                  Select your <b>Organization</b> → <b>Settings</b> →{" "}
                  <b>Organization Tokens</b>
                </li>
                <li>
                  Create a <b>Organization Token</b> (prefix <b>ddo_</b>)
                </li>
              </ol>
            </div>
          </div>
          <Input
            label="Deno Deploy API Token"
            value={denoForm.denoToken}
            onChange={(e) =>
              setDenoForm((prev) => ({ ...prev, denoToken: e.target.value }))
            }
            placeholder="ddo_xxxxxxxxxxxxxxxx"
            hint={
              <>
                Token is used once for deployment, not stored. Found in
                Organization Settings.
              </>
            }
            type="password"
          />
          <Input
            label="Organization Domain"
            value={denoForm.orgDomain}
            onChange={(e) =>
              setDenoForm((prev) => ({ ...prev, orgDomain: e.target.value }))
            }
            placeholder="your-org.deno.net"
            hint="Organization's default domain. Your relay URL will be in the format: https://my-relay.your-org.deno.net"
          />
          <Input
            label="App Name"
            value={denoForm.projectName}
            onChange={(e) =>
              setDenoForm((prev) => ({ ...prev, projectName: e.target.value }))
            }
            placeholder="deno-relay"
            hint="Unique app name. Leave empty for auto-generated name."
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              fullWidth
              onClick={handleDenoDeploy}
              disabled={
                !denoForm.denoToken.trim() ||
                !denoForm.orgDomain.trim() ||
                deploying
              }
            >
              {deploying ? "Deploying..." : "Deploy Relay"}
            </Button>
            <Button
              fullWidth
              variant="ghost"
              onClick={closeDenoModal}
              disabled={deploying}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}