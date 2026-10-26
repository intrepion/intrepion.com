CREATE VIEW content_space_usage AS
WITH scopes AS (
 SELECT subject AS owner_sub FROM pilot_accounts
 UNION SELECT owner_sub FROM collections
 UNION SELECT scope_sub FROM households WHERE status<>'erased'
)
SELECT owner_sub,
 (SELECT count(*) FROM collections c WHERE c.owner_sub=scopes.owner_sub AND kind=1)
 +(SELECT count(*) FROM list_items i WHERE i.owner_sub=scopes.owner_sub) AS items,
 (SELECT count(*) FROM collections c WHERE c.owner_sub=scopes.owner_sub AND kind=2) AS shopping,
 (SELECT count(*) FROM collections c WHERE c.owner_sub=scopes.owner_sub AND kind=3) AS templates,
 (SELECT count(*) FROM collections c WHERE c.owner_sub=scopes.owner_sub AND kind=4) AS runs,
 (SELECT coalesce(sum(length(CAST(name AS BLOB))),0) FROM households h WHERE h.scope_sub=scopes.owner_sub AND h.status<>'erased')
 +(SELECT coalesce(sum(length(CAST(title AS BLOB))+length(CAST(notes AS BLOB))+length(CAST(source_title AS BLOB))),0) FROM collections c WHERE c.owner_sub=scopes.owner_sub)
 +(SELECT coalesce(sum(length(CAST(title AS BLOB))),0) FROM list_sections x WHERE x.owner_sub=scopes.owner_sub)
 +(SELECT coalesce(sum(length(CAST(title AS BLOB))+length(CAST(notes AS BLOB))+length(CAST(quantity AS BLOB))),0) FROM list_items i WHERE i.owner_sub=scopes.owner_sub)
 +(SELECT coalesce(sum(length(CAST(target_title AS BLOB))+length(CAST(before_json AS BLOB))+length(CAST(after_json AS BLOB))),0) FROM collection_history e WHERE e.owner_sub=scopes.owner_sub) AS bytes,
 0 AS households
FROM scopes;

-- Preserve legacy accounting until independent safety policy is enabled.
-- Logical UTF-8 text/JSON payloads are counted; physical/index/identifier and
-- site-wide operational overhead remain separate from these space budgets.
DROP VIEW space_usage;
CREATE VIEW space_usage AS
SELECT u.owner_sub,u.items,u.shopping,u.templates,u.runs,
 u.bytes+CASE WHEN (SELECT enabled FROM site_safety_policy WHERE id=1)=1 THEN
  (SELECT coalesce(sum(length(CAST(a.action AS BLOB))+length(CAST(a.details_json AS BLOB))),0) FROM household_activity a JOIN households h ON h.id=a.household_id WHERE h.scope_sub=u.owner_sub)
 +(SELECT coalesce(sum(length(CAST(m.ceilings_json AS BLOB))),0) FROM household_heads m JOIN households h ON h.id=m.household_id WHERE h.scope_sub=u.owner_sub)
 +(SELECT coalesce(sum(length(CAST(x.amounts_json AS BLOB))),0) FROM household_allocations x JOIN households h ON h.id=x.household_id WHERE h.scope_sub=u.owner_sub)
 +(SELECT coalesce(sum(length(CAST(i.recipient_email AS BLOB))+length(CAST(i.token_hash AS BLOB))),0) FROM email_invitations i JOIN households h ON h.id=i.household_id WHERE h.scope_sub=u.owner_sub)
 ELSE 0 END AS bytes,u.households
FROM content_space_usage u;
