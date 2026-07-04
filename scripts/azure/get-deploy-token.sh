#!/usr/bin/env bash
# Print the Static Web App deployment token (for the GitHub secret
# AZURE_STATIC_WEB_APPS_API_TOKEN). Useful if the token is rotated or was
# lost after provisioning.
#
# Usage: ./scripts/azure/get-deploy-token.sh
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-approach-map-rg}"
APP_NAME="${APP_NAME:-approach-map}"

az staticwebapp secrets list \
  --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --query properties.apiKey --output tsv
