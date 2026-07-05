#!/usr/bin/env bash
# Attach a custom subdomain to the Static Web App (free managed SSL included,
# even on the Free tier). Validation is via CNAME, so create the DNS record
# FIRST, then run this script.
#
# For approachmap.aquagnomeapps.com (GoDaddy):
#   1. GoDaddy > aquagnomeapps.com > DNS > Add record:
#        Type: CNAME
#        Name: approachmap
#        Value: <default hostname printed by provision.sh, e.g.
#                gentle-sky-0abc12345.6.azurestaticapps.net>
#        TTL: 1 hour (default is fine)
#   2. Wait for DNS to propagate (usually minutes; verify with
#        dig +short approachmap.aquagnomeapps.com CNAME)
#   3. Run this script.
#
# Usage:
#   ./scripts/azure/configure-custom-domain.sh                       # uses default hostname below
#   DOMAIN=other.example.com ./scripts/azure/configure-custom-domain.sh
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-approach-map-rg}"
APP_NAME="${APP_NAME:-approach-map}"
DOMAIN="${DOMAIN:-approachmap.aquagnomeapps.com}"

DEFAULT_HOSTNAME=$(az staticwebapp show \
  --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --query defaultHostname --output tsv)

echo "==> Verifying CNAME for $DOMAIN"
if command -v dig >/dev/null 2>&1; then
  RESOLVED=$(dig +short "$DOMAIN" CNAME | sed 's/\.$//')
  if [[ "$RESOLVED" != "$DEFAULT_HOSTNAME" ]]; then
    echo "warning: expected CNAME $DOMAIN -> $DEFAULT_HOSTNAME but resolved '${RESOLVED:-<nothing>}'." >&2
    echo "         If you just created the record, DNS may still be propagating." >&2
  fi
fi

echo "==> Registering $DOMAIN on '$APP_NAME' (validation + certificate can take a few minutes)"
az staticwebapp hostname set \
  --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --hostname "$DOMAIN"

echo "Done. Check status with:"
echo "  az staticwebapp hostname list --name $APP_NAME --resource-group $RESOURCE_GROUP --output table"
