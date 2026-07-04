#!/usr/bin/env bash
# Provision the Azure resources for Approach Map (one-time setup).
#
# Creates a resource group and deploys infra/main.bicep (a Free-tier Static
# Web App), then prints the deployment token you need to add to GitHub as
# the AZURE_STATIC_WEB_APPS_API_TOKEN secret.
#
# Prerequisites: az cli logged in (az login) with the target subscription
# selected (az account set --subscription <id>).
#
# Usage:
#   ./scripts/azure/provision.sh
#   RESOURCE_GROUP=my-rg LOCATION=westus2 APP_NAME=my-app ./scripts/azure/provision.sh
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-approach-map-rg}"
LOCATION="${LOCATION:-eastus2}"
APP_NAME="${APP_NAME:-approach-map}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "==> Creating resource group '$RESOURCE_GROUP' in $LOCATION"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

echo "==> Deploying Static Web App '$APP_NAME' (Free tier) via Bicep"
az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "$REPO_ROOT/infra/main.bicep" \
  --parameters name="$APP_NAME" location="$LOCATION" \
  --output none

HOSTNAME=$(az staticwebapp show \
  --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --query defaultHostname --output tsv)

DEPLOY_TOKEN=$(az staticwebapp secrets list \
  --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --query properties.apiKey --output tsv)

echo
echo "Provisioned: https://$HOSTNAME"
echo
echo "Next steps:"
echo "  1. Add GitHub repository secrets (Settings > Secrets and variables > Actions):"
echo "       AZURE_STATIC_WEB_APPS_API_TOKEN = $DEPLOY_TOKEN"
echo "       VITE_MAPBOX_TOKEN               = <your Mapbox public token>"
echo "  2. Set the server-side ADS-B Exchange key:"
echo "       ./scripts/azure/set-adsbx-key.sh"
echo "  3. Push to main (or run the workflow manually) to deploy."
echo "  4. Optional custom domain: ./scripts/azure/configure-custom-domain.sh"
