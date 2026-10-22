# Relief Atlas

### Everyday help, without the guesswork.

"Can someone bring dinner Friday and check on Dad Saturday?"

Two small requests can turn into a chain of messages and uncertainty. Relief Atlas keeps the important facts separate: what was proposed, what the organizer approved, who actually accepted and what was confirmed done.

The organizer reviews separate task drafts and exact outreach before anyone is contacted. A read-only rehearsal shows what could happen if a helper declines. Acceptance, helper-reported completion and organizer confirmation remain different states. If no one accepts, the task says **Uncovered** and recovery needs a new approval.

## Run from this repository

Use Node.js 24 and pnpm 11.19.0. From a terminal:

```sh
git clone https://github.com/usmanmohammed2306/relief-atlas.git
cd relief-atlas
pnpm install --frozen-lockfile
pnpm build
DEMO_MODE=true DEMO_PUBLIC_CONFIRM=fictional-data-only DELIVERY_MODE=simulated RELIEF_PROPOSER=deterministic APP_ORIGIN=http://localhost:4000 pnpm start
```

Open **http://localhost:4000**. The final command uses macOS/Linux shell syntax. No AWS account, email credential, model key or separate database is required for this fictional local demo. Stop with Ctrl+C. Local fictional data persists under `apps/api/.relief-data/` and must not be committed.

Verified October 20, 2026 on Node v24.21.0: isolated frozen-lockfile installation, web/API build, local startup, database readiness, built frontend and assets, fictional identity and MCP initialization. The smoke server shut down cleanly. This does not establish a full integration-suite pass or production readiness.

October 22 release checks: 92 API tests and 10 Chrome journeys passed in the maintainer workspace, covering the same application source. Five PostgreSQL integration checks, six infrastructure-template checks, and a non-root Linux container smoke also passed locally. The runtime package audit reports zero known advisories after security updates; this is a dated dependency check, not a security certification. Test suites and infrastructure remain outside this minimal repository.

For development, use `DEMO_MODE=true RELIEF_PROPOSER=deterministic pnpm dev`. The web app uses port 5173 and proxies the API and MCP requests to port 4000.

## Follow the story

1. Choose Alex, the fictional organizer. Ask: `Bring dinner tomorrow at 6pm and check on Dad tomorrow at 10am`.
2. Prepare the drafts through the Alexa-style web simulator. On **both** tasks, select only **Sam Morgan** and uncheck Jordan and Riley. Review exact deadlines and outgoing messages, then save the review. With Sam as the only selected helper, declining can demonstrate the uncovered path.
3. Rehearse Sam declining. This creates no real outreach.
4. Approve the exact plan. Offers are simulated, not real email. The tasks are still seeking help.
5. Switch to Sam. Accept one task and report completion; decline the other.
6. Return to Alex. Confirm the reported task and inspect the uncovered task's recovery draft and timeline.

## What needs you next

An organizer should not have to inspect every task to find the next useful step. The read-only **Next steps** inbox brings record issues, uncovered tasks, disputed completion, helper reports and approaching deadlines into one explainable list. It shows three items first, with an explicit option to see the rest.

Each item explains why it appears and opens that exact request and its timeline, even if a filter was hiding it. A task accepted before its deadline is not flagged prematurely. An overdue accepted task prompts a progress check, not an accusation that the helper failed. Sent or simulated offers never count as acceptance.

Suggestions use deterministic rules and a timestamped board snapshot, not AI predictions. Inspecting an item sends nothing, changes no task status and never bypasses approval. This inbox is organizer-only; helpers retain their scoped offers view. No new service or paid dependency is required.

## See what changed before you save

A small edit can change the plan substantially. **Review changes** compares your unsaved edits with the saved draft, field by field: title, briefing, task type, exact deadline, helper order and private details. Saved and proposed values appear side by side, with explicit timezone offsets and original timestamp values for deadlines. Private before-and-after values are collapsed until you open them.

Helper order matters: the first two helpers enter wave 1; later helpers enter wave 2. Moving someone can change their wave even if nobody is added or removed. The comparison makes that visible without claiming anyone is eligible or has accepted.

Unsaved edits still block approval. Saving refreshes the fingerprint and exact outreach preview; it does not approve the plan or send anything. The comparison is local to the current edit session, not a permanent version history or a substitute for server-side authorization. It uses no additional service or model.

## How it works

React and TypeScript provide the interface, with optional 3D illustrations, reduced-motion support and a lightweight graphics fallback. Fastify serves the API, built web app and a real Streamable HTTP MCP endpoint at `/mcp`. The Alexa-style entrance is a custom simulator, not a live Alexa+ integration.

PGlite provides local PostgreSQL-compatible storage. Exact organizer approval atomically writes tasks, offer snapshots, durable jobs and events. Workers recheck eligibility, retry delivery failures and fence obsolete results. A successful delivery does not mean acceptance or completion. MCP, parsing and rehearsal cannot approve or dispatch.

Production startup verifies required migration checksums with the restricted database role and refuses a missing or changed schema ledger. MCP tool arguments have an explicit structural limit before validation, alongside the API's request-size limit.

Default drafting is deterministic. The optional Bedrock adapter remains disabled unless its account, model access, data and cost prerequisites are separately configured and approved. This local setup makes no model or email-provider calls.

## Scope

This is the reference application source, not a production deployment or a completed hackathon submission. Live AWS, real Alexa+, real email delivery, deployed authentication/security, hosted recovery and independent usability remain unverified. The local checks above cover bounded fictional workflows. The independent learner reconstruction, tests, reports, recordings, infrastructure definitions and internal planning are deliberately excluded from this minimal runnable repository.

All included demo people and data are fictional. Relief Atlas supports ordinary nonmedical help, not emergencies, diagnosis or medication advice.

## License

MIT. See [LICENSE](LICENSE). Third-party packages retain their own licenses.
