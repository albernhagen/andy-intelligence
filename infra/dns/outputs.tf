output "control_plane_record" {
  value = "${cloudflare_dns_record.control_plane.name} CNAME ${cloudflare_dns_record.control_plane.content} (proxied = ${cloudflare_dns_record.control_plane.proxied})"
}
