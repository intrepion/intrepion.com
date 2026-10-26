-- Approval applies finite measured policy later; migration never enables onboarding.
CREATE TABLE site_safety_policy (
 id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 personal_soft_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(personal_soft_json)),
 personal_hard_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(personal_hard_json)),
 household_soft_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(household_soft_json)),
 household_hard_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(household_hard_json)),
 max_items_per_collection INTEGER NOT NULL DEFAULT 0,
 max_sections_per_collection INTEGER NOT NULL DEFAULT 0,
 last_operation TEXT NOT NULL DEFAULT ''
);
INSERT INTO site_safety_policy(id) VALUES(1);
CREATE TABLE site_admin_operations(operation_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,revision INTEGER NOT NULL);
CREATE TABLE site_audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,operation_id TEXT NOT NULL UNIQUE,actor_sub TEXT NOT NULL,action TEXT NOT NULL,occurred_at INTEGER NOT NULL DEFAULT(unixepoch()));
-- Keep recorded legacy contributions intact, but stop reserving them in normal mode.
CREATE VIEW legacy_space_capacity AS
SELECT a.subject AS owner_sub,
 json_extract(a.plan_json,'$.items')-coalesce((SELECT sum(json_extract(x.amounts_json,'$.items')) FROM household_allocations x JOIN households h ON h.id=x.household_id WHERE x.subject=a.subject AND h.status<>'erased'),0) AS items,
 json_extract(a.plan_json,'$.shopping')-coalesce((SELECT sum(json_extract(x.amounts_json,'$.shopping')) FROM household_allocations x JOIN households h ON h.id=x.household_id WHERE x.subject=a.subject AND h.status<>'erased'),0) AS shopping,
 json_extract(a.plan_json,'$.templates')-coalesce((SELECT sum(json_extract(x.amounts_json,'$.templates')) FROM household_allocations x JOIN households h ON h.id=x.household_id WHERE x.subject=a.subject AND h.status<>'erased'),0) AS templates,
 json_extract(a.plan_json,'$.runs')-coalesce((SELECT sum(json_extract(x.amounts_json,'$.runs')) FROM household_allocations x JOIN households h ON h.id=x.household_id WHERE x.subject=a.subject AND h.status<>'erased'),0) AS runs,
 json_extract(a.plan_json,'$.bytes')-coalesce((SELECT sum(json_extract(x.amounts_json,'$.bytes')) FROM household_allocations x JOIN households h ON h.id=x.household_id WHERE x.subject=a.subject AND h.status<>'erased'),0) AS bytes FROM pilot_accounts a
UNION ALL
SELECT h.scope_sub AS owner_sub,
 coalesce((SELECT sum(json_extract(x.amounts_json,'$.items')) FROM household_allocations x WHERE x.household_id=h.id),0) AS items,
 coalesce((SELECT sum(json_extract(x.amounts_json,'$.shopping')) FROM household_allocations x WHERE x.household_id=h.id),0) AS shopping,
 coalesce((SELECT sum(json_extract(x.amounts_json,'$.templates')) FROM household_allocations x WHERE x.household_id=h.id),0) AS templates,
 coalesce((SELECT sum(json_extract(x.amounts_json,'$.runs')) FROM household_allocations x WHERE x.household_id=h.id),0) AS runs,
 coalesce((SELECT sum(json_extract(x.amounts_json,'$.bytes')) FROM household_allocations x WHERE x.household_id=h.id),0) AS bytes FROM households h WHERE h.status<>'erased';
DROP VIEW space_capacity;
CREATE VIEW space_capacity AS
SELECT c.* FROM legacy_space_capacity c WHERE (SELECT enabled FROM site_safety_policy WHERE id=1)=0
UNION ALL
SELECT a.subject AS owner_sub,json_extract(p.personal_hard_json,'$.items') AS items,json_extract(p.personal_hard_json,'$.shopping') AS shopping,json_extract(p.personal_hard_json,'$.templates') AS templates,json_extract(p.personal_hard_json,'$.runs') AS runs,json_extract(p.personal_hard_json,'$.bytes') AS bytes FROM pilot_accounts a JOIN site_safety_policy p ON p.id=1 AND p.enabled=1
UNION ALL
SELECT h.scope_sub AS owner_sub,json_extract(p.household_hard_json,'$.items') AS items,json_extract(p.household_hard_json,'$.shopping') AS shopping,json_extract(p.household_hard_json,'$.templates') AS templates,json_extract(p.household_hard_json,'$.runs') AS runs,json_extract(p.household_hard_json,'$.bytes') AS bytes FROM households h JOIN site_safety_policy p ON p.id=1 AND p.enabled=1 WHERE h.status<>'erased';
