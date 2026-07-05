#!/usr/bin/env bash
# Store the ADS-B Exchange RapidAPI key as a server-side application setting
# on the Static Web App. The Functions proxy (api/src/functions/proxy.ts)
# reads it as process.env.ADSBX_API_KEY at runtime — it is never part of the
# client bundle or the GitHub repository.
#
# Usage:
#   ./scripts/azure/set-adsbx-key.sh              # prompts for the key
#   ADSBX_API_KEY=xxx ./scripts/azure/set-adsbx-key.sh
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-approach-map-rg}"
APP_NAME="${APP_NAME:-approach-map}"

if [[ -z "${ADSBX_API_KEY:-}" ]]; then
  read -r -s -p "ADS-B Exchange RapidAPI key: " ADSBX_API_KEY
  echo
fi

if [[ -z "$ADSBX_API_KEY" ]]; then
  echo "error: no key provided" >&2
  exit 1
fi

echo "==> Setting ADSBX_API_KEY app setting on '$APP_NAME'"
az staticwebapp appsettings set \
  --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --setting-names ADSBX_API_KEY="$ADSBX_API_KEY" \
  --output none

echo "Done. The Functions proxy picks the new value up on its next cold start (typically <1 min)."
