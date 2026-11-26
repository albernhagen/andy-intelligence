# Every repo variable the baseline deploy.yml, release.yml and preview.yml read (andy-intelligence
# docs/features/deploy-caller.md). Not secret. Set them all after apply:
#   terraform output -json repo_variables | jq -r 'to_entries[] | "\(.key)=\(.value)"' > repo-vars.env
#   gh variable set --repo <owner>/<name> -f repo-vars.env && rm repo-vars.env
output "repo_variables" {
  description = "Repo variable name → value for the deploy caller (prod is the first environment)."
  value = {
    GCP_PROJECT_ID          = var.prod_project_id
    GCP_REGION              = var.region
    GCP_SERVICE             = module.prod.service_name
    GCP_SERVICE_URL         = module.prod.service_url
    GCP_WIF_PROVIDER        = module.prod.workload_identity_provider
    GCP_DEPLOYER_SA         = module.prod.deployer_email
    GCP_IMAGE_REPO          = module.prod.image_repository
    GCP_PREVIEW_SERVICE     = module.prod.preview_service_name
    GCP_PREVIEW_DEPLOYER_SA = module.prod.preview_deployer_email
    GCP_PREVIEW_IMAGE_REPO  = module.prod.preview_image_repository
    DEPLOY_SMOKE_CHECKS     = var.smoke_checks
  }
}
