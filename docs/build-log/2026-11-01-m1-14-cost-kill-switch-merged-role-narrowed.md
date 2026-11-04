# 2026-11-01 — M1.14: Cost kill switch merged; role narrowed

- Merged: PR #18: Cost kill switch.
- Security review (low): the kill switch's Cloud Run permissions were project-wide. Follow-up PR binds `run.services.get/update` on the `control-plane` service only; queue list/pause and operation polling stay project-level (no narrower resource). This narrows the identity row in ADR-0036: Kill switch runs on Cloud Workflows.
