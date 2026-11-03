# DNS for the control plane's custom domain (ADR-0044) on Cloudflare: the CNAME for the Cloud
# Run domain mapping and the Search Console verification TXT. The zone lives in Andy's
# Cloudflare account, so plans and applies are local only (Andy): CI runs fmt/validate but has
# no Cloudflare token. The token comes from CLOUDFLARE_API_TOKEN (Zone → DNS → Edit, this zone
# only); it is never in the repo, tfvars or chat.

terraform {
  required_version = ">= 1.16, < 2.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
  }
  backend "gcs" {
    bucket = "andy-intelligence-512400-tfstate"
    prefix = "dns"
  }
}

provider "cloudflare" {}

# Must stay DNS-only (grey cloud): if Cloudflare proxies it, Google can't issue the certificate.
resource "cloudflare_dns_record" "control_plane" {
  zone_id = var.zone_id
  name    = var.custom_domain
  type    = "CNAME"
  content = "ghs.googlehosted.com"
  proxied = false
  ttl     = 300
  comment = "andy-intelligence control plane (Cloud Run domain mapping, ADR-0044)"
}

# Search Console ownership of the apex, which Cloud Run needs before it maps any subdomain.
resource "cloudflare_dns_record" "google_site_verification" {
  zone_id = var.zone_id
  name    = var.apex_domain
  type    = "TXT"
  content = "\"google-site-verification=${var.google_site_verification}\""
  ttl     = 3600
  comment = "Search Console ownership for the Cloud Run domain mapping (ADR-0044)"
}
