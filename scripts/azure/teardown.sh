#!/usr/bin/env bash
# Delete ALL Azure resources for Approach Map by removing the resource group.
# Irreversible — prompts before deleting.
#
# Usage: ./scripts/azure/teardown.sh
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-approach-map-rg}"

read -r -p "Delete resource group '$RESOURCE_GROUP' and everything in it? [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "Aborted."
  exit 1
fi

az group delete --name "$RESOURCE_GROUP" --yes
echo "Deleted. Remember to remove the GitHub secrets and the GoDaddy CNAME record."
