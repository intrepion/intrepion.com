DROP VIEW space_usage;
CREATE VIEW space_usage AS
SELECT u.owner_sub,u.items,u.shopping,u.templates,u.runs,
 u.bytes+CASE WHEN (SELECT enabled FROM site_safety_policy WHERE id=1)=1 THEN
  (SELECT coalesce(sum(length(CAST(a.action AS BLOB))+length(CAST(a.details_json AS BLOB))),0) FROM household_activity a JOIN households h ON h.id=a.household_id WHERE h.scope_sub=u.owner_sub)
 +(SELECT coalesce(sum(length(CAST(m.ceilings_json AS BLOB))),0) FROM household_heads m JOIN households h ON h.id=m.household_id WHERE h.scope_sub=u.owner_sub)
 +(SELECT coalesce(sum(length(CAST(x.amounts_json AS BLOB))),0) FROM household_allocations x JOIN households h ON h.id=x.household_id WHERE h.scope_sub=u.owner_sub)
 +(SELECT coalesce(sum(length(CAST(i.recipient_email AS BLOB))+length(CAST(i.token_hash AS BLOB))+length(CAST(i.recipient_sub AS BLOB))),0) FROM email_invitations i JOIN households h ON h.id=i.household_id WHERE h.scope_sub=u.owner_sub)
 +(SELECT coalesce(sum(length(CAST(l.token_hash AS BLOB))+length(CAST(l.created_by AS BLOB))+length(CAST(l.id AS BLOB))),0) FROM household_request_links l JOIN households h ON h.id=l.household_id WHERE h.scope_sub=u.owner_sub)
 +(SELECT coalesce(sum(length(CAST(q.user_sub AS BLOB))+length(CAST(q.email AS BLOB))+length(CAST(q.display_name AS BLOB))+length(CAST(q.consent_version AS BLOB))+length(CAST(q.id AS BLOB))),0) FROM household_invitation_requests q JOIN households h ON h.id=q.household_id WHERE h.scope_sub=u.owner_sub)
 +(SELECT coalesce(sum(length(CAST(o.user_sub AS BLOB))+length(CAST(o.operation_id AS BLOB))),0) FROM household_request_operations o JOIN household_invitation_requests q ON q.id=o.request_id JOIN households h ON h.id=q.household_id WHERE h.scope_sub=u.owner_sub)
 +(SELECT coalesce(sum(length(CAST(d.actor_sub AS BLOB))+length(CAST(d.operation_id AS BLOB))),0) FROM household_request_decisions d JOIN households h ON h.id=d.household_id WHERE h.scope_sub=u.owner_sub)
 +(SELECT coalesce(sum(length(CAST(w.user_sub AS BLOB))+length(CAST(w.operation_id AS BLOB))),0) FROM household_request_withdrawals w JOIN household_invitation_requests q ON q.id=w.request_id JOIN households h ON h.id=q.household_id WHERE h.scope_sub=u.owner_sub)
 ELSE 0 END AS bytes,u.households
FROM content_space_usage u;
CREATE INDEX request_storage_marker ON household_invitation_requests(household_id,closed_at);
