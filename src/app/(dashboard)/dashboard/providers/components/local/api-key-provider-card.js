import PropTypes from "prop-types";
import { Card, Badge, Toggle } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import Link from "next/link";
import {
  OPENAI_COMPATIBLE_PREFIX,
  ANTHROPIC_COMPATIBLE_PREFIX,
} from "@/shared/constants/providers";
import { getStatusDisplay } from "./helpers";

export default function ApiKeyProviderCard({
  providerId,
  provider,
  stats,
  authType,
  onToggle,
}) {
  const { connected, error, errorCode, errorTime, allDisabled } = stats;
  const isCompatible = providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
  const isAnthropicCompatible = providerId.startsWith(
    ANTHROPIC_COMPATIBLE_PREFIX,
  );

  const getIconPath = () => {
    if (isCompatible)
      return provider.apiType === "responses"
        ? "/providers/oai-r.png"
        : "/providers/oai-cc.png";
    if (isAnthropicCompatible) return "/providers/anthropic-m.png";
    return `/providers/${provider.id}.png`;
  };

  return (
    <Link href={`/dashboard/providers/${providerId}`} className="group min-w-0">
      <Card
        padding="xs"
        className={`h-full hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors cursor-pointer ${allDisabled ? "opacity-50" : ""}`}
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="size-8 shrink-0 rounded-lg flex items-center justify-center"
              style={{
                backgroundColor: `${provider.color?.length > 7 ? provider.color : provider.color + "15"}`,
              }}
            >
              <ProviderIcon
                src={getIconPath()}
                alt={provider.name}
                size={30}
                className="object-contain rounded-lg max-w-[30px] max-h-[30px]"
                fallbackText={
                  provider.textIcon || provider.id.slice(0, 2).toUpperCase()
                }
                fallbackColor={provider.color}
              />
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-semibold">{provider.name}</h3>
              <div className="flex min-w-0 items-center gap-1.5 text-xs flex-wrap">
                {allDisabled ? (
                  <Badge variant="default" size="sm">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">
                        pause_circle
                      </span>
                      Disabled
                    </span>
                  </Badge>
                ) : (
                  <>
                    {getStatusDisplay(connected, error, errorCode)}
                    {isCompatible && (
                      <Badge variant="default" size="sm">
                        {provider.apiType === "responses"
                          ? "Responses"
                          : "Chat"}
                      </Badge>
                    )}
                    {isAnthropicCompatible && (
                      <Badge variant="default" size="sm">
                        Messages
                      </Badge>
                    )}
                    {errorTime && (
                      <span className="text-text-muted">{errorTime}</span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {stats.total > 0 && (
              <div
                className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggle(!allDisabled ? false : true);
                }}
              >
                <Toggle
                  size="sm"
                  checked={!allDisabled}
                  onChange={() => {}}
                  title={allDisabled ? "Enable provider" : "Disable provider"}
                />
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

ApiKeyProviderCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  provider: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    color: PropTypes.string,
    textIcon: PropTypes.string,
    apiType: PropTypes.string,
  }).isRequired,
  stats: PropTypes.shape({
    connected: PropTypes.number,
    error: PropTypes.number,
    errorCode: PropTypes.string,
    errorTime: PropTypes.string,
    total: PropTypes.number,
    allDisabled: PropTypes.bool,
  }).isRequired,
  authType: PropTypes.string,
  onToggle: PropTypes.func,
};