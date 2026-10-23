# MVP 3: Household foundation

Status: scope confirmed in Q56. The MVP 3 wireframes and visual mockups are approved; the separate standalone prototype is approved. Production implementation is in progress; numerical launch allowances and deployment remain separate approval gates. Interview rounds preserve the decision history; later accepted amendments supersede earlier proposals.

## Confirmed scope

### Audience and access

- Invitation-only pilot with operator-approved Google accounts. Personal-only users are allowed; every household participant is a head with their own login. Dependent profiles, ordinary non-head roles, PIN access and human approval of dependent logins remain MVP 4 work.
- Heads can invite approved people using recipient-bound, single-use links that expire in seven days. Inviting heads send links themselves; any current head may revoke an unaccepted invitation. Acceptance grants access to existing household content and History and rechecks eligibility and household limits.
- Heads have equal administrative authority regardless of contribution size. They can remove another head and explicitly erase shared content without a second-head approval. Each head controls only their own individual count ceilings. Losing membership immediately ends access on subsequent requests, without affecting personal or other-household access.

### Spaces and everyday lists

- Personal and household spaces contain a flat Tasks inbox, shopping lists, checklist templates and independent runs, with existing Sections, Archive, Trash and History behavior.
- Existing MVP 2 content and History remain in the original owner's personal space. Sharing creates an explicit independent copy with fresh household History; destination quota checks are all-or-nothing. No linked sharing, automatic historical migration or named task-list containers.
- Record actual actors for new changes, including administrative history, without inventing historical actors. Refresh shared data when opening spaces and after saves, plus an explicit Refresh control; preserve conflict and retry guarantees without promising instant cross-browser updates.

### Capacity and allowances

- One manually assigned pilot plan per user; no prices, payment collection, wallet, checkout or automatic billing. Users allocate explicit amounts of each shareable resource to households they head. Allocated capacity is reserved and unavailable personally or elsewhere; the remainder supports personal usage. Household contributions sum resource by resource.
- Meter retained tasks/list items, shopping lists, templates, runs, and logical content/History storage. Archive, Trash, finished runs and independent copies count. Individual member ceilings cover counts, not bytes, and do not reserve shares. New heads start with ceilings equal to current household count allowances, without making an automatic contribution. Explicit ceilings do not silently rise with later capacity increases.
- Apply a user-level limit on households headed and uniform operator-configured items/sections-per-collection caps. These structural caps do not increase through pooled contributions. Categories and their limits remain deferred.
- Over-limit states preserve data and viewing. Block increases to exceeded dimensions and check other limits normally. History can consume storage even when an edit shortens current text; never silently discard History to fit. Permanent erasure remains available. Provider overhead, backups and the independent content-free erasure ledger remain separate operator capacity concerns.
- Voluntary reallocations must leave source spaces within their remaining allowances. Operator-managed plan reductions use a preview and explicit replacement allocations, preserve content and expose affected over-limit spaces. No automatic spending or hosting upgrades.

### Departure and closure

- Leaving or removal does not erase the creator's shared content, transfer its attribution or charge it to another head's individual ceiling. It still counts toward the household total; rejoining restores the person's retained counts against their ceiling.
- A former head retains narrowly scoped control and withdrawal-eligibility information for their own allocation, without content access. Allocation withdrawal follows the same source-capacity rule and needs no other head's approval when valid.
- The last head can leave without a successor. This permanently closes the household, cancels pending invitations and schedules automatic content/History erasure at calendar month-end UTC. Show the exact deadline in local time before confirmation; there is no reopening in MVP 3. Retained capacity remains reserved until erasure succeeds, including erasure-aware backup recovery protection. Failures retry safely and alert the operator through GitHub.

### Operation and remaining gates

- Operator tools handle pilot admission and plan assignment; the website handles household administration, personal ceiling controls, contribution allocations and usage previews within the agreed privacy boundaries. Global account deletion is operator-assisted, with shared-data and retained-capacity consequences addressed explicitly.
- Preserve existing infrastructure spending controls, CI requirements, and local-only coverage/E2E policy. Other client applications, AI, themes, Categories, live collaboration delivery, automatic invitation email, an operator web dashboard and billing remain outside this release.
- Before launch, measure existing usage and representative export overhead, choose finite numerical plan/structural allowances, and obtain explicit approval of those values. The whole-database backup ceiling is not the same as logical customer storage; current private content must fit its initial allowances.
- After confirming this scope, produce wireframes for approval, then mockups for approval, then a separate server-free local prototype for approval. Production implementation is separate and follows these gates. Launch still requires verification of multi-user isolation, invitation and permission behavior, concurrent quotas/retries, migration preservation and erasure-aware recovery.

## Q56: shared understanding confirmed

The owner answered “yes” to the consolidated scope and proceeding to wireframes. This confirmation does not approve the wireframes, mockups, prototype, production implementation, numerical launch caps or deployment in advance.

The [MVP 3 wireframe gallery](../design/mvp-3/wireframes.html) and [review guide](../design/mvp-3/README.md) record the first design gate. The owner approved the wireframes and authorized proceeding to visual mockups. The [visual mockup gallery](../design/mvp-3/mockups.html) and [mockup review guide](../design/mvp-3/MOCKUPS.md) were approved by the owner. The [standalone prototype walkthrough](../design/mvp-3/PROTOTYPE.md) records the approved interaction gate. The owner approved the prototype and proceeding to separate production implementation. Numerical launch caps and deployment remain unapproved.

## Established context

- The accepted roadmap places Household foundation in MVP 3 and Full family access in MVP 4.
- MVP 2 is live, with personal tasks, shopping lists, checklist templates and independent checklist runs.
- Features still require approved wireframes, mockups and a standalone, server-free prototype before separate production implementation.
- The owner wants to explore subscription-dependent limits: items per list, checklists, categories, households and households someone heads. Prices and numerical allowances are undecided.
- Preserve the existing hosting spending controls. Customer allowances and operator infrastructure budgets are different concerns.

## Current repository facts

- Authentication and data access currently target one configured Google owner. There are no household, membership, subscription or entitlement records.
- Collections distinguish tasks, shopping lists, templates and runs. Sections group items within a collection; there is no cross-collection Category concept.
- Existing text, request-size and pagination limits are technical constraints, not subscription quotas. No plan-dependent saved-content count limits exist.
- Archive and Trash retain content, and history remains until explicit erasure. Template runs retain independent copies. Quota counting must account explicitly for these states and copies.
- Retries, concurrent changes, migration and erasure-aware recovery must remain safe when quota enforcement is introduced.

## Decision tree

The initial frontier is release scope, audience, plan holder, treatment of existing data when over a limit, separation of commercial allowances from infrastructure safety caps, and Category terminology.

Their answers unlock household ownership and membership rules, who sponsors shared usage, multiple-head scenarios, counted resources and states, atomic quota enforcement, plan changes, migration, invitations, permissions, and the concrete scope of the design artifacts. Prices and exact allowance numbers remain unresolved until explicitly chosen; they will not be invented during implementation.

## Round 1: accepted answers and amendments

- Q1 accepted: Household foundation with configurable plan allowances belongs in MVP 3; payment collection and Full family access remain later work.
- Q2 accepted: launch as an invitation-only pilot rather than public self-service registration.
- Q3 amended: any head of household may determine member allowances. Any head should eventually be able to pay all or part of the subscription. The proposed single sponsoring account was not accepted; the plan holder, contribution mechanism and allowance accounting remain open. A storage allowance alongside resource-count allowances is under consideration. Actual payment collection is still deferred under Q1; split-payment processing is not implicitly added to MVP 3.
- Q4 accepted and extended: exceeding a limit never automatically deletes or hides saved content; keep viewing and usage reduction available. Retained Trash counts toward limits because it still consumes resources. Exact counting dimensions and the storage meter remain open.
- Q5 accepted: commercial allowances remain distinct from infrastructure safety caps and operator spending controls.
- Q6 accepted: Category groups whole lists/templates; Section groups items inside one list/template/run. This terminology alone does not put a Categories feature into MVP 3.

Resolved terminology is recorded in `GLOSSARY.md`. Prices and allowance numbers remain undecided.

## Storage and attribution facts

Retained history contains previous and new field values, so editing or shortening current text can increase retained storage. Independent runs store their own copies. No usage meter or separate member creator/actor attribution exists yet: the current single-owner history reports "Owner". Whole-database size also includes shared indexes, sessions and other overhead; encrypted backups and the independent erasure ledger are separate retained resources. Customer metering, member attribution, erasure accounting and infrastructure measurements need distinct explicit decisions.

## Round 2: accepted answers and amendments

- Q7 amended: the preferred direction is a subscription held by a user, who decides which households receive contributions, including several households they help head. The proposed household-held subscription was not accepted. Whether "funds" means monetary contributions or allocations of subscription-provided capacity remains unresolved; household capacity derived from several contributions is also unresolved.
- Q8 accepted: member allowances are ceilings within the household total, not reserved slices of capacity. A member may encounter the household total before reaching their individual ceiling.
- Q9 accepted: use both resource counts and a visible logical storage allowance for retained content and History. Provider overhead, backups and the content-free erasure ledger remain in operator capacity accounting rather than the customer meter.
- Q10 accepted: archived content and finished runs count alongside active and trashed content. Independent copies consume their own allowances; restoring already-counted Trash does not count the same object twice.
- Q11 accepted: heads consume household capacity and obey their member allowances. Authority to adjust an allowance does not bypass the household total.
- Q12 accepted: retain a personal space alongside explicitly shared household spaces. Existing MVP 2 data remains personal until deliberately shared or moved; the precise sharing mechanism is not yet selected.

Subsequent rounds resolve personal-space capacity, contribution aggregation and several permission/attribution decisions. No monetary wallet, payment processing, billing shares or currency exchange mechanism is included.

## Round 3: accepted answers and amendments

- Q13 accepted: users hold subscriptions and allocate plan-provided capacity to households. There is no monetary balance or payment collection in MVP 3. Exact dimensions, allocation units and pooling rules remain undecided.
- Q14 accepted: head authority is independent of contribution size. Contributing more does not buy additional administrative rights or automatically make someone a head.
- Q15 amended: active participants use their own Google identities, but non-head household accounts are excluded from MVP 3. Ordinary household membership, dependent profiles, shared-account PIN access and head-approved dependent login remain later work. Whether a personal-only account with no household is allowed needs clarification; no non-head household role will be implemented silently.
- Q16 accepted: for resource-count allowances, charge a new object to its creator within its space, preserve that attribution through other people's edits, and charge fresh run copies to the person starting the run. Storage attribution for collaborative edits and History, departures and explicit transfers remain separate unresolved decisions.
- Q17 accepted: initially share personal content through an explicit independent copy into a household, leaving the original private and starting fresh household History. Linked sharing and moving historical content across spaces are deferred.
- Q18 accepted: Categories are deferred beyond MVP 3; existing Sections remain. Category-specific enforcement waits for that feature.

The user-held subscription and authority boundary is recorded in ADR 0005. Round 4 resolves contribution aggregation and defers individual storage attribution; capacity withdrawal and loss still need decisions.

## Round 4: accepted answers

- Q19 accepted: household capacity allocations earmark part of the contributor's plan. That portion cannot also be allocated to another household or used personally; the unallocated remainder is available to the contributor's personal space. Member ceilings within a household remain non-reserved.
- Q20 accepted: household aggregate capacity is the sum of valid contributions, resource by resource. Storage and object counts do not convert into each other. Personal membership/household-count limits and per-list structural caps are separate decisions, not automatically additive.
- Q21 accepted: heads-only is a household-role restriction: every MVP 3 household participant is a head, while invitation-only personal-space users may exist without joining a household. No ordinary household-member or dependent access is added.
- Q22 accepted: MVP 3 enforces storage at the personal/household-space level and individual household member ceilings for resource counts. Per-member byte attribution for collaborative content and History is deferred; actual authors are still recorded.
- Q23 accepted: heads may see allocations to their household and that household's usage, but not another contributor's private content, personal usage, other households or unrelated subscription allocations.
- Q24 accepted: any head may explicitly confirm permanent erasure of household content and its associated History, including content created by another head. No second-head approval is required in the trusted heads-only pilot. Personal content remains outside other heads' authority.

## Invitation and session facts

The existing application has no invitation records, redemption flow or email-delivery service. Its Google identity handling currently retains the configured stable subject, not an email/profile registry. Logout revokes the current database-backed session only; there is no account or household-membership revocation mechanism. MVP 3 must add the agreed multi-user admission and membership behavior rather than simply changing the configured owner. Operational GitHub failure emails are not an application invitation service.

## Round 5: accepted answers and amendment

- Q25 accepted: voluntary capacity moves must leave every affected source space within its remaining storage and count allowances. Otherwise obtain replacement capacity or erase retained content first. Actual plan reductions are a separate case and must not erase or hide content.
- Q26 accepted: allocate explicit amounts of each shareable resource independently, rather than one percentage that couples storage and count allocations. Plan amounts remain undecided; user-scoped and structural limits remain separate.
- Q27 accepted: during the manual-plan pilot, the operator changes plans with a preview and explicit replacement allocations. Show which spaces would exceed their limits; do not silently choose household cuts, redistribute contributions or add billing/expiry automation.
- Q28 amended: the last head may leave without appointing a successor; the household then closes. The user suggested it might also be deleted, but automatic permanent erasure, recovery, retention and release of contributed capacity are not yet decided. Do not implement the rejected last-head departure restriction or treat closure as consent to permanent erasure.
- Q29 accepted: the application operator approves entry to the pilot. Heads may invite already-approved users into their households as heads, but cannot independently admit unapproved Google accounts to the application.
- Q30 accepted: use recipient-bound, expiring, single-use invitation links, explicitly accepted after Google sign-in. The inviter copies and sends the link; automatic invitation email delivery is outside MVP 3.

Retaining data while repeatedly withdrawing and reallocating its backing capacity must not permit unlimited retained storage under one allowance. Last-head departure is allowed. Rounds 6–7 settle month-end erasure, final closure, retained contributions and creator attribution after departure.


## Round 6: accepted answers and amendment

- Q31 amended: when the last head leaves, the household closes and retains its capacity until the end of the month, then is automatically permanently erased because no heads remain. The proposal for indefinite retention without automatic erasure was not accepted. The exact month boundary, whether reopening is allowed, and safe capacity release after erasure remain to be settled. This schedules future erasure; it does not authorize erasing the live application during planning.
- Q32 accepted: any head may remove another head after explicit confirmation, with no second-head approval in the trusted pilot. Membership removal alone does not erase content or authorize changing the removed person's subscription allocations.
- Q33 accepted: after leaving or being removed, a person loses household access on subsequent requests, including from already-open sessions. Their personal space and other household memberships remain accessible.
- Q34 accepted: MVP 3 exposes configurable space limits for retained items, collections by kind (task lists, shopping lists, templates and runs), and logical retained bytes; structural limits include items per collection and sections per collection, and a user-level limit covers households headed. Archived and trashed records remain counted. Categories and ordinary household-member limits wait for their features. Numerical allowances remain undecided.
- Q35 accepted: copying personal content into a household either succeeds completely within the destination allowances or creates nothing, with the source left intact. Preview the required capacity; recheck it when saving because another head may use capacity meanwhile.
- Q36 accepted: record the actual actor for new household History and allowance/membership changes. Attribute existing single-owner records to the original owner without inventing additional historical actors; keep security/administration events free of copied private list content.


## Round 7: accepted answers

- Q37 accepted: use the end of the calendar month in UTC for pilot household closure, rather than a subscription billing cycle that does not yet exist. Display the exact scheduled erasure instant in the user's local time before last-head departure.
- Q38 accepted: closure is final in MVP 3: revoke outstanding household invitations and offer no reopening or rejoining after the final head leaves. Clearly explain the automatic erasure deadline before departure. Recovery after closure would require a separately designed feature.
- Q39 accepted: if a head leaves or is removed while other heads remain, retain their existing allocations until they can withdraw them under Q25 without leaving the household over its remaining allowances. Give the former head narrowly scoped visibility/control over their own allocation and its withdrawal eligibility, without household content access or authority over other contributors. Do not require another head's approval for an otherwise valid withdrawal.
- Q40 accepted: a former head's retained objects continue counting toward the household total and remain attributed to that creator, without automatically consuming another head's member ceiling. Rejoining with the same identity restores those existing counts against that person's member ceiling.
- Q41 accepted: household invitations expire after seven days and may be revoked by any current head before acceptance. Pending invitations grant no access and do not reserve a household membership slot; acceptance rechecks current eligibility and user household limits.
- Q42 accepted: before automatically erasing a closed household, require the existing erasure-aware recovery protections to cover its content and History. Release backing capacity only after erasure succeeds; failure keeps it reserved, retries safely and alerts the operator through GitHub.


## Round 8: accepted answers

- Q43 accepted: check each affected allowance when saving. If already over a count limit, permit edits that do not increase that exceeded count while checking remaining limits normally. If retained storage is full, History-producing edits may be blocked even when current text becomes shorter. Viewing and permanent erasure remain available; never silently discard History to admit an edit. Explain the blocking limit and available remedies.
- Q44 accepted: initially give new heads count ceilings equal to the household's current count allowances, without reserving capacity for them. Q53 qualifies ceiling administration: a head may set lower ceilings only for themselves; household totals always apply. Contribution is optional and acceptance does not automatically allocate a subscription. Later capacity increases do not silently raise explicitly assigned individual ceilings.
- Q45 accepted: migrate existing content into the original owner's personal space with its History and attribution intact. Preview actual retained usage before assigning finite pilot allowances; choose allowances that accommodate it rather than deleting, truncating or automatically sharing existing data.
- Q46 accepted: manage pilot admission and subscription assignments through documented operator tooling in MVP 3, without an operator web dashboard. Heads manage their household invitations, member ceilings and their own capacity allocations in the web application. No checkout or billing portal is included.
- Q47 accepted: show used/allowed resource counts and storage in each space, explain member ceilings versus household totals, and show an allocation preview identifying affected spaces. Allocation controls show only the current user's private plan remainder; other heads see that household's contributions only. Do not display prices or an upgrade checkout.
- Q48 accepted: defer self-service global account erasure in MVP 3; document an operator-assisted request process. Each request must explicitly address private data, retained contributions, shared content and actor attribution. Leaving a household, closing one or revoking access is not equivalent to deleting a person's entire account or other households' data.


## Task structure clarification

Read-only code research found that each Task is currently represented by a kind=1 collection record, exposed as one flat Tasks inbox. There is no task-list container feature. Q52 corrects Q34's reference to “task lists”: individual tasks consume retained-item allowance, while shopping lists, templates and runs have collection-kind allowances. This is a domain distinction even though task and non-task content share an internal table.

## Round 9: accepted answers and amendment

- Q49 amended: a head may lower their own ceiling below existing usage, but may not do so to another head. The user also wants heads to have this authority over future non-head members; those roles remain outside MVP 3. Q53 subsequently resolves this: each head controls only their own individual ceilings. Earlier broad statements that any head may set any member ceiling are qualified by this amendment.
- Q50 accepted: accepting head membership grants access to all retained household content and its existing History, including content predating the invitation. Warn explicitly before inviting or accepting; personal spaces remain private.
- Q51 accepted: preserve server-checked conflicts and quota enforcement while deferring live collaboration delivery. In MVP 3, refresh shared data on opening a space and after saves, with an explicit Refresh control; no promise of instant cross-browser updates, presence indicators or push notifications.
- Q52 accepted: preserve one flat Tasks inbox per personal/household space, without adding named task-list containers. Count individual tasks in the retained-item allowance; use separate collection-kind budgets for shopping lists, checklist templates and runs. Technical task collection rows do not become a second customer-facing task-list charge.


## Pilot sizing facts

No current retained-content/storage baseline is documented in the repository. The backup implementation limits the entire unencrypted SQL export to 20 MiB and encrypted output to 21 MiB; logical customer bytes cannot be treated as equivalent to export size, because SQL syntax, metadata and other records add overhead. Initial caps and pilot admission must therefore be calibrated against actual existing usage and representative export amplification before launch. No production measurements or provider changes were made during this research.

## Round 10: accepted answers

- Q53 accepted: each head controls only their own individual count ceilings in MVP 3, including voluntary reductions below their usage. Other heads cannot raise or lower those ceilings. Household totals, shared content administration and explicit membership removal retain their agreed behavior. Authority over future non-heads is deferred with those roles.
- Q54 accepted: use uniform operator-configured structural caps for items and sections per collection during the pilot. These are distinct from additive, allocatable retained-item/collection/storage budgets; pooling contributions cannot increase a structural per-collection cap. Plan-specific structural caps can be designed later.
- Q55 accepted: begin with one manually assigned pilot plan whose finite numerical limits are explicitly documented and reviewed before launch. Select them after measuring the owner's existing usage and representative backup export overhead; do not invent prices, promise that logical bytes equal database/export bytes, or treat configurable allowances as permission to exceed infrastructure spending controls. The interview can settle this sizing process now, with numerical launch values as an explicit later approval gate.
