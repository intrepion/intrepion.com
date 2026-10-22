# MVP 2: Everyday lists

## Confirmed direction

- MVP 2 focuses on everyday lists: shopping lists and reusable checklists for travel and cooking recipes.
- MVP 3 is Household foundation.
- MVP 4: Full family access follows MVP 3 Household foundation, as confirmed in Q41.
- Define MVP 2 through a documented interview before designing or implementing it.
- Review wireframes, then mockups, then a standalone local prototype before production implementation. Each design stage retains owner approval. Prototype application code must remain separate from production code.
- Existing cost controls and CI policies remain in effect unless explicitly changed.

## Confirmed behavior

- Q1: Multiple named shopping lists remain active across shopping trips. Items can be added, removed, checked as purchased, and unchecked when needed again.
- Q2: A Checklist template creates independent Checklist runs. Later template edits affect future runs; existing runs retain their own items and progress.
- Q3: Cooking uses checklist templates with ingredient and ordered preparation sections. Ingredients are manually written. Serving calculations, timers, recipe imports, nutrition, and automatic shopping-list generation are deferred.
- Q4: Existing personal tasks remain available alongside shopping lists and checklists, without forced conversion. Their content and ordinary task operations are preserved; Q5 changes removal behavior.
- Q5: From the MVP 2 migration onward, retain change history for tasks, lists, templates, and runs. Ordinary removal is reversible. Previously deleted content cannot be reconstructed. Q12–Q17 define history and removal behavior.
- Q6: Shopping items have a name, optional free-text quantity, and optional notes. Unit conversion, prices, and product catalogs are deferred.
- Q7: Shopping lists support optional named sections and manual ordering. Within each section, needed items precede purchased items; each group preserves manual order. Automatic categorization is deferred.
- Q8: Checklist templates support named sections and manually ordered items with titles and optional notes. Checking an item leaves it in place; items may be checked in any order.
- Q9: A checklist run allows adding, editing, reordering, and removing items without changing its template. Editing the reusable template is a separate action.
- Q10: Finishing a run is explicit. Show progress, require confirmation to finish with unchecked items, and allow reopening finished runs. Each new run starts with fresh progress.
- Q11: MVP 2 requires internet access, including for shopping. Show connection failures and confirm changes only after server acknowledgement. Offline editing and synchronization remain deferred.
- Q12: Removing a task, shopping item, or checklist item moves it to Trash, hides it from ordinary views, retains its history, and allows restoration. Label this action “Move to Trash” rather than “Delete.”
- Q13: Shopping lists, checklist templates, and checklist runs support Archive separately from Trash. Archived collections remain viewable and can be unarchived. Trashing a template leaves existing runs intact.
- Q14: History records when a successful change happened, its actor, and previous/new values. Include content changes, completion changes, ordering, finishing/reopening, and removal/restoration. Exclude ordinary viewing, failed attempts, and unsaved drafts. The MVP 2 actor is the owner identity.
- Q15: Tasks, lists, templates, and runs have individual history views. List and checklist history includes item and section changes. Restore from Trash is supported; arbitrary revision rollback and a combined activity feed are deferred.
- Q16: History and Trash have no automatic expiration in MVP 2; they remain until explicit erasure. Monitor storage against existing budget thresholds. Operational backup retention remains seven days.
- Q17: Provide a separately confirmed permanent-erasure action for trashed items and collections and their associated content history. Identify the scope before confirmation. Erasing a source template leaves independent runs intact. Backup copies expire under existing retention; recovery procedures must account for erasures made after a backup.
- Q18: Main navigation is Tasks, Shopping, and Checklists. Checklists contains Templates and Runs. Archive and Trash have separate access; history remains attached to each task or collection.
- Q19: Starting a run asks for a name suggested from the template name and today's date. Multiple simultaneous runs may use the same template. Copy current sections, items, and notes; all run items start unchecked.
- Q20: Finished runs are read-only until explicitly reopened. A Finished view exposes progress and history; archiving remains separate.
- Q21: Sections can be renamed and reordered, and items moved between sections. Touch- and keyboard-usable buttons or menus are required; dragging is optional.
- Q22: Removing a section moves its items into an unsectioned group, preserving their relative order. Require confirmation explaining the destination and record the change in history.
- Q23: Shopping lists offer a confirmed “Mark all purchased items as needed” action, alongside individual controls. Bulk trashing and clearing items are deferred.
- Q24: Trashing a collection hides its contents together; restoring it returns its previous state. Previously individually trashed items remain trashed. Restore a parent collection before restoring an individual child.
- Q25: Permanently erasing a collection also erases its sections, items (including previously trashed items), and associated history. Erasing an individual item removes its content from parent history too. Independent runs retain copied content when their source template or template items are erased; confirmations explain this boundary.
- Q26: Archived collections are read-only, with viewing, history, unarchive, and Move to Trash available. Unarchiving a finished run leaves it finished; reopening is separate.
- Q27: Required names and item titles allow up to 200 characters and reject whitespace-only input. Optional notes allow up to 10,000 characters; shopping quantities allow up to 100. All content is plain text.
- Q28: Empty collections and duplicate collection/item names are allowed. Starting a run requires at least one non-trashed template item. Shopping items are not silently merged.
- Q29: Shopping lists and templates sort alphabetically; runs sort newest first within Active and Finished views. Preserve existing task ordering and agreed manual item/section ordering. Favorites and manual ordering of collections are deferred.
- Q30: Shopping lists, templates, and runs have optional collection notes, separate from item notes, with the agreed 10,000-character limit. Template notes are copied into new runs and then edited independently.
- Q31: Every non-trashed checklist item counts equally toward progress, displayed as completed/total. Optional items, skipped states, and step dependencies are deferred. Explicit finishing of incomplete runs still requires confirmation.
- Q32: Shopping items retain underlying manual positions when checked or unchecked; completion changes their display group rather than their underlying position. Bulk reset uses the same ordering rule.
- Q33: If a restored item's former section no longer exists, restore it to the end of the unsectioned group, preserving content and completion state and explaining its destination. Do not recreate the old section automatically.
- Q34: Conflicting edits must not silently overwrite newer content. Preserve unsaved drafts for comparison and allow reloading before retrying. Protect reorder and bulk-reset operations equivalently. Retries of successful operations must not duplicate items, runs, or history.
- Q35: Text search and advanced filters are deferred. MVP 2 uses agreed navigation, Active/Finished views, Archive, and Trash; revisit discovery after real use.
- Q36: Existing tasks receive a clearly labeled migration baseline containing their current state. Do not invent earlier creation dates or edit history; record subsequent changes normally.
- Q37: Before reopening the application after restoring an older backup, reapply subsequent permanent erasures using a separate content-free record of erased identifiers. Backup copies retain the seven-day expiration policy. Recovery must not silently reintroduce erased content.
- Q38: Templates are manually created. Whole-template duplication, run-to-template conversion, and conversions between shopping lists, tasks, and checklists are deferred.
- Q39: Archived and trashed templates cannot start runs. Unarchive or restore them first. Trashed content is read-only except for restoration and permanent erasure; viewing and history remain available. Finished runs may be archived or trashed without reopening.
- Q40: Demonstrate and verify the acceptance scenarios below on phone and desktop layouts, including empty, loading, and error states.

## Acceptance scenarios

- Shopping: Create a sectioned grocery list, enter quantities, check purchases, and reset purchased items for another trip.
- Travel: Create a packing template, start two independent trips, customize one, and finish/reopen a run.
- Cooking: Create ingredient and preparation sections, follow steps without items moving, and start fresh next time.
- Recovery: Inspect history, trash and restore content, and permanently erase content with a clear scope warning.
- Reliability: Preserve existing tasks, show connection failures, prevent duplicate retries, and handle conflicting edits.

## Scope and delivery boundaries

- Keep owner-only Google login and the existing responsive web client/Rust API direction. Household accounts, dependent profiles, PIN approval, other clients, AI, themes, and other authentication methods remain outside MVP 2.
- Keep existing spending controls, manual deployment of passing revisions, and local-only coverage/E2E policy.
- Wireframes must cover navigation, shopping, template editing, run creation/use/finishing, existing tasks, history, Archive, Trash, and permanent-erasure confirmations, including responsive and failure states.
- Mockups follow wireframe approval; the standalone local prototype follows mockup approval; production implementation follows prototype approval. Prototype application code remains separate from production.
- Implementation must preserve retry/conflict guarantees, add safe migrations, and extend backup/recovery verification to the new content, history, and erasure records. These are implementation obligations, not reasons to change accepted product behavior silently.

## Interview status

Q1–Q40 are accepted individually. Q41 confirms shared understanding of the complete scope. The owner subsequently approved the 22-panel wireframes, visual mockups, and standalone prototype, authorizing production implementation. Production implementation is in progress. Detailed technical design follows the accepted scope, with any newly discovered product trade-offs brought back to the owner.

The [wireframe review guide](../design/mvp-2/README.md) maps the accepted workflows to 22 static panels. The [history and checklist-run decision](adr/0004-recoverable-history-and-independent-checklist-runs.md) records the retention and independent-copy trade-offs.

The [visual mockup gallery](../design/mvp-2/mockups.html) and [visual review notes](../design/mvp-2/MOCKUPS.md) record the approved design. The [standalone prototype](../prototype/README.md) records the approved synthetic interactions.
