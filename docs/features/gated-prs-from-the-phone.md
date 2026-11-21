# Gated PRs from the phone

While a ticket's pull request is open, the ticket page shows "PR #N waits for you" with an **Open in GitHub** link (a 44 px target on a phone). It opens the PR on github.com, which iOS hands to the GitHub app when installed, so Andy reviews and merges there as himself. The app itself never merges and holds no new write path (AI-194: M7.15: Gated PRs from the phone; ADR-0115 Q5, option a). Only a `https://github.com/<owner>/<repo>/pull/<n>` link is shown.

**How to use:** open a ticket whose PR is open; tap **Open in GitHub**.
