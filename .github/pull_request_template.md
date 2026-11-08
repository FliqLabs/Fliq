## What

<!-- One or two sentences. What changes for a user, a judge or a teammate. -->

## How to check

<!-- Do X, see Y. Commands, screens or curl calls a reviewer can run. -->

## Checklist

- [ ] Title is a conventional commit: `type(scope): summary`
- [ ] Only my area changed, or the other owners are tagged
- [ ] API change: `spec/openapi.yaml`, fixtures and generated types updated together
- [ ] Contract change touching balances, permissions or transfers: marked "needs contract review"
- [ ] Tests added or updated, `make test-<area>` passes locally
- [ ] No secrets, no `.env`, no AI attribution in commits
