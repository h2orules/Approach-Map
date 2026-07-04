// Azure resources for Approach Map: a single Static Web App (Free tier).
//
// The SPA is served as static assets and the six /api/* proxy routes run as
// SWA-managed Azure Functions — no separate Functions app, storage account,
// or App Service plan is needed. Deployments arrive via the GitHub Actions
// workflow using the app's deployment token ("bring your own CI"), so no
// repositoryUrl/branch is configured here.
//
// Deploy with scripts/azure/provision.sh (or directly:
//   az deployment group create -g <rg> -f infra/main.bicep)

@description('Name of the Static Web App resource')
param name string = 'approach-map'

@description('Azure region — Static Web Apps is only offered in these regions. The static assets are globally distributed regardless; this only places the managed Functions.')
@allowed(['westus2', 'centralus', 'eastus2', 'westeurope', 'eastasia'])
param location string = 'eastus2'

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: name
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    // Allow staticwebapp.config.json in the repo to drive runtime config
    allowConfigFileUpdates: true
    // PR preview environments from the GitHub Actions workflow
    stagingEnvironmentPolicy: 'Enabled'
  }
}

output defaultHostname string = staticWebApp.properties.defaultHostname
output staticWebAppName string = staticWebApp.name
