# 2026-11-01 — Multi-project moved up; data evolution planned

- **Decided (Andy, ADR-0035: Multi-project milestone moved up; data evolution):** new M2: Multi-project in parallel right after M1: First end-to-end flow, including stories by project; later milestones renumbered (M3: Add Jules + model routing, M4: Paid models + spend caps, M5: Epics + story board, M6: Dev → prod releases).
- Control-plane Firestore is live data from M1.2: Ticket core on: additive schema changes, versioned upgraders for breaking ones, backups + manual export before risky deploys (ARCHITECTURE §10.4).
- Follow-up (not urgent): the GCP project ID is hardcoded as Terraform variable defaults and backend bucket names; make them settings so another install (ADR-0032) can deploy. Identifiers in docs are not secrets.
