# Every repo variable the baseline deploy.yml, release.yml and preview.yml read (andy-intelligence
# docs/features/deploy-caller.md). Not secret. `GCP_DEV_*` makes dev the first environment. Set
# them all after apply:
#   terraform output -json repo_variables | jq -r 'to_entries[] | "\(.key)=\(.value)"' > repo-vars.env
#   gh variable set --repo <owner>/<name> -f repo-vars.env && rm repo-vars.env
output "repo_variables" {
  description = "Repo variable name → value for the deploy caller (dev first, then prod by promote)."
  value = {
    GCP_DEV_PROJECT_ID          = var.dev_project_id
    GCP_DEV_REGION              = var.region
    GCP_DEV_SERVICE             = module.dev.service_name
    GCP_DEV_SERVICE_URL         = module.dev.service_url
    GCP_DEV_WIF_PROVIDER        = module.dev.workload_identity_provider
    GCP_DEV_DEPLOYER_SA         = module.dev.deployer_email
    GCP_DEV_IMAGE_REPO          = module.dev.image_repository
    GCP_DEV_PREVIEW_SERVICE     = module.dev.preview_service_name
    GCP_DEV_PREVIEW_DEPLOYER_SA = module.dev.preview_deployer_email
    GCP_DEV_PREVIEW_IMAGE_REPO  = module.dev.preview_image_repository
    GCP_PROJECT_ID              = var.prod_project_id
    GCP_REGION                  = var.region
    GCP_SERVICE                 = module.prod.service_name
    GCP_SERVICE_URL             = module.prod.service_url
    GCP_WIF_PROVIDER            = module.prod.workload_identity_provider
    GCP_DEPLOYER_SA             = module.prod.deployer_email
    GCP_IMAGE_REPO              = module.prod.image_repository
    DEPLOY_SMOKE_CHECKS         = var.smoke_checks
  }
}
