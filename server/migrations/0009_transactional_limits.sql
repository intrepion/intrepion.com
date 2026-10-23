-- Budgets are checked within the same D1 transaction as each content change.
CREATE TABLE operator_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  max_items_per_collection INTEGER NOT NULL DEFAULT 0 CHECK(max_items_per_collection>=0),
  max_sections_per_collection INTEGER NOT NULL DEFAULT 0 CHECK(max_sections_per_collection>=0)
);
-- Zero means the operator has not approved finite launch values yet.
INSERT INTO operator_settings(id) VALUES(1);
CREATE VIEW creator_usage AS
WITH creators AS (SELECT owner_sub,creator_sub FROM collections UNION SELECT owner_sub,creator_sub FROM list_items)
SELECT owner_sub,creator_sub,
 (SELECT count(*) FROM collections c WHERE c.owner_sub=creators.owner_sub AND c.creator_sub=creators.creator_sub AND kind=1)
 +(SELECT count(*) FROM list_items i WHERE i.owner_sub=creators.owner_sub AND i.creator_sub=creators.creator_sub) AS items,
 (SELECT count(*) FROM collections c WHERE c.owner_sub=creators.owner_sub AND c.creator_sub=creators.creator_sub AND kind=2) AS shopping,
 (SELECT count(*) FROM collections c WHERE c.owner_sub=creators.owner_sub AND c.creator_sub=creators.creator_sub AND kind=3) AS templates,
 (SELECT count(*) FROM collections c WHERE c.owner_sub=creators.owner_sub AND c.creator_sub=creators.creator_sub AND kind=4) AS runs,
 0 AS bytes,0 AS households FROM creators;
CREATE VIEW space_capacity AS
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
CREATE TABLE write_budgets (
  id INTEGER PRIMARY KEY CHECK(id=1),
  owner_sub TEXT NOT NULL,actor_sub TEXT NOT NULL,collection_id TEXT NOT NULL,
  usage_json TEXT NOT NULL CHECK(json_valid(usage_json)),
  own_json TEXT NOT NULL CHECK(json_valid(own_json)),
  structure_json TEXT NOT NULL CHECK(json_valid(structure_json))
);
CREATE TABLE limit_guards (
 space_items INTEGER NOT NULL DEFAULT 1 CONSTRAINT space_items_allowance CHECK(space_items=1),
 space_shopping INTEGER NOT NULL DEFAULT 1 CONSTRAINT space_shopping_allowance CHECK(space_shopping=1),
 space_templates INTEGER NOT NULL DEFAULT 1 CONSTRAINT space_templates_allowance CHECK(space_templates=1),
 space_runs INTEGER NOT NULL DEFAULT 1 CONSTRAINT space_runs_allowance CHECK(space_runs=1),
 space_bytes INTEGER NOT NULL DEFAULT 1 CONSTRAINT space_bytes_allowance CHECK(space_bytes=1),
 member_items INTEGER NOT NULL DEFAULT 1 CONSTRAINT member_items_allowance CHECK(member_items=1),
 member_shopping INTEGER NOT NULL DEFAULT 1 CONSTRAINT member_shopping_allowance CHECK(member_shopping=1),
 member_templates INTEGER NOT NULL DEFAULT 1 CONSTRAINT member_templates_allowance CHECK(member_templates=1),
 member_runs INTEGER NOT NULL DEFAULT 1 CONSTRAINT member_runs_allowance CHECK(member_runs=1),
 collection_items INTEGER NOT NULL DEFAULT 1 CONSTRAINT collection_items_allowance CHECK(collection_items=1),
 collection_sections INTEGER NOT NULL DEFAULT 1 CONSTRAINT collection_sections_allowance CHECK(collection_sections=1)
);
