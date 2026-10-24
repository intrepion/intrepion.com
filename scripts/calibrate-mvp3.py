#!/usr/bin/env python3
"""Offline sizing fixtures, not quota-enforcement tests or a D1 export.

Uses synthetic data only, current migrations, and in-memory SQLite. Produces
compact SQLite dump and column-explicit recovery-format size estimates. Budget
contexts satisfy writer fences during fixture construction; the production API
is not exercised. No network access, credentials, or database files are used.
"""
import argparse
import hashlib
import json
import pathlib
import sqlite3
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
PLAN = dict(items=250, shopping=10, templates=10, runs=25, bytes=131072, households=2)


def encoded(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False)


def text_bytes(value):
    return len(value.encode())


class Fixture:
    def __init__(self, users, allowance):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.serial = 0
        self.scopes = []
        self.allowance = allowance
        for path in sorted((ROOT / 'server/migrations').glob('*.sql')):
            self.db.executescript(path.read_text())
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.execute('UPDATE operator_settings SET max_items_per_collection=100,max_sections_per_collection=20')
        for index in range(users):
            subject = f'999000000000000000{index:03d}'
            plan = dict(PLAN, bytes=allowance)
            self.db.execute('INSERT INTO pilot_accounts(subject,display_name,public_id,plan_json,plan_revision) VALUES(?,?,?,?,1)',
                            (subject, f'Synthetic {index}', f'{index+1:032x}', encoded(plan)))
            house = self.identity()
            scope = f'household:{house}'
            self.db.execute('INSERT INTO households(id,scope_sub,name,created_by,last_operation) VALUES(?,?,?,?,?)',
                            (house, scope, 'h', subject, self.identity()))
            self.db.execute('INSERT INTO household_heads(household_id,subject,ceilings_json) VALUES(?,?,?)',
                            (house, subject, encoded(dict(plan, bytes=0, households=0))))
            self.db.execute('INSERT INTO household_allocations(household_id,subject,amounts_json) VALUES(?,?,?)',
                            (house, subject, encoded(dict(plan, households=0))))
            self.scopes.append((scope, subject))
        self.db.commit()

    def identity(self):
        self.serial += 1
        return str(uuid.UUID(int=self.serial))

    def budget(self, scope, actor, collection):
        self.db.execute('DELETE FROM write_budgets')
        self.db.execute("INSERT INTO write_budgets VALUES(1,?,?,?,'{}','{}','{}')", (scope, actor, collection))

    def event(self, scope, actor, collection, target, title, action, before, after):
        operation = self.identity()
        fingerprint = hashlib.sha256(operation.encode()).hexdigest()
        self.db.execute('INSERT INTO collection_operations(owner_sub,operation_id,collection_id,fingerprint) VALUES(?,?,?,?)',
                        (scope, operation, collection, fingerprint))
        self.db.execute('INSERT INTO collection_history(owner_sub,collection_id,operation_id,target_id,target_title,action,before_json,after_json,actor_sub) VALUES(?,?,?,?,?,?,?,?,?)',
                        (scope, collection, operation, target, title, action, encoded(before), encoded(after), actor))

    def usage(self, scope):
        return dict(self.db.execute('SELECT * FROM space_usage WHERE owner_sub=?', (scope,)).fetchone())

    def populate(self, mode):
        for scope, actor in self.scopes:
            collections = []
            sections = []
            for kind, count in [(2, PLAN['shopping']), (3, PLAN['templates']), (4, PLAN['runs'])]:
                for index in range(count):
                    collection = self.identity()
                    self.budget(scope, actor, collection)
                    title = 'a' if mode == 'small_section_renames' else f'Synthetic list {kind}-{index}'
                    self.db.execute('INSERT INTO collections(owner_sub,id,kind,title,last_operation,creator_sub) VALUES(?,?,?,?,?,?)',
                                    (scope, collection, kind, title, self.identity(), actor))
                    self.event(scope, actor, collection, collection, title, 'Created', None,
                               dict(title=title, notes='', completed=False))
                    collections.append(collection)
                    for position in range(20 if mode == 'small_section_renames' else 2):
                        section = self.identity()
                        self.db.execute('INSERT INTO list_sections VALUES(?,?,?,?,?)', (scope, collection, section, 'a', position))
                        self.event(scope, actor, collection, section, 'a', 'Section added', None,
                                   dict(title='a', position=position+1))
                        sections.append((collection, section))
            used = self.usage(scope)['bytes']
            for index in range(PLAN['items']):
                collection = collections[index % len(collections)]
                title = 'a' if mode == 'small_section_renames' else f'Synthetic item {index}'
                notes = "😀'\"" * 300 if mode == 'unicode_and_quotes' else ('' if mode == 'small_section_renames' else 'Synthetic everyday notes')
                after = dict(title=title, notes=notes, quantity='', section='Unsectioned', completed=False, trashed=False)
                charge = text_bytes(title+notes+title+encoded(None)+encoded(after))
                if used + charge > self.allowance:
                    break
                self.budget(scope, actor, collection)
                item = self.identity()
                self.db.execute('INSERT INTO list_items(owner_sub,collection_id,id,title,notes,position,creator_sub) VALUES(?,?,?,?,?,?,?)',
                                (scope, collection, item, title, notes, index // len(collections), actor))
                self.event(scope, actor, collection, item, title, 'Item added', None, after)
                used += charge
            # Tiny legal section renames expose identifier/receipt overhead per metered byte.
            # Two existing positions or full item snapshots would meter more bytes per row.
            collection, section = sections[0]
            self.budget(scope, actor, collection)
            current_title = 'a'
            while True:
                next_title = 'b' if current_title == 'a' else 'a'
                before, after = dict(title=current_title), dict(title=next_title)
                charge = text_bytes(next_title+encoded(before)+encoded(after))
                if used + charge > self.allowance:
                    break
                self.db.execute('UPDATE list_sections SET title=? WHERE owner_sub=? AND id=?', (next_title, scope, section))
                self.event(scope, actor, collection, section, next_title, 'Section renamed', before, after)
                self.db.execute('UPDATE collections SET revision=revision+1 WHERE owner_sub=? AND id=?', (scope, collection))
                used += charge
                current_title = next_title
            actual = self.usage(scope)
            assert actual['bytes'] <= self.allowance, actual['bytes']
            assert actual['items'] <= PLAN['items']
            assert actual['shopping'] == PLAN['shopping']
            assert actual['templates'] == PLAN['templates']
            assert actual['runs'] == PLAN['runs']
        self.db.execute('DELETE FROM write_budgets')
        self.db.commit()
        assert not self.db.execute('PRAGMA foreign_key_check').fetchall()
        assert self.db.execute('PRAGMA quick_check').fetchone()[0] == 'ok'

    def compact_sql(self):
        # Node SQLite enables foreign keys by default; disable them before BEGIN
        # because compact dumps may insert child tables before parent tables.
        return 'PRAGMA foreign_keys=OFF;\n'+'\n'.join(self.db.iterdump())+'\nPRAGMA foreign_keys=ON;\n'

    def metrics(self):
        compact = text_bytes(self.compact_sql())
        schema = self.db.execute("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid").fetchall()
        explicit = text_bytes('PRAGMA foreign_keys=OFF;\nPRAGMA foreign_keys=ON;\n')
        for entry in schema:
            explicit += text_bytes(entry['sql']+';\n')
            if entry['type'] != 'table':
                continue
            table = entry['name']
            columns = [row[1] for row in self.db.execute(f'PRAGMA table_info("{table}")')]
            prefix = f'INSERT INTO "{table}"('+','.join(f'"{c}"' for c in columns)+') VALUES('
            for row in self.db.execute(f'SELECT * FROM "{table}"'):
                values = []
                for value in row:
                    if value is None:
                        values.append('NULL')
                    elif isinstance(value, str):
                        values.append("'"+value.replace("'", "''")+"'")
                    elif isinstance(value, bytes):
                        values.append("X'"+value.hex()+"'")
                    else:
                        values.append(str(value))
                explicit += text_bytes(prefix+','.join(values)+');\n')
        logical = self.db.execute('SELECT coalesce(sum(bytes),0) FROM space_usage').fetchone()[0]
        return dict(logical_bytes=logical, history_rows=self.db.execute('SELECT count(*) FROM collection_history').fetchone()[0],
                    compact_sql_bytes=compact, column_explicit_sql_bytes=explicit,
                    local_sqlite_bytes=self.db.execute('PRAGMA page_count').fetchone()[0]*self.db.execute('PRAGMA page_size').fetchone()[0],
                    explicit_to_logical_ratio=round(explicit/max(1, logical), 3))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--users', type=int, default=3)
    parser.add_argument('--bytes-limit', type=int, default=131072)
    parser.add_argument('--erased-collections', type=int, default=0, help='Model this many retained erasure receipts per user instead of content.')
    args = parser.parse_args()
    if not 1 <= args.users <= 10 or not 65536 <= args.bytes_limit <= 1048576:
        parser.error('Use 1–10 synthetic users and 64 KiB–1 MiB per user.')
    if not 0 <= args.erased_collections <= 10000:
        parser.error('Use at most 10,000 erased collections per user.')
    if args.erased_collections:
        fixture = Fixture(args.users, args.bytes_limit)
        try:
            for scope, actor in fixture.scopes:
                for _ in range(args.erased_collections):
                    collection = fixture.identity()
                    operation = fixture.identity()
                    fixture.db.execute("INSERT INTO retired_list_ids(kind,id) VALUES('collection',?)", (collection,))
                    fixture.db.execute("INSERT INTO collection_operations(owner_sub,operation_id,collection_id,fingerprint,erased_scope) VALUES(?,?,?,?,'collection')",
                                       (scope, operation, collection, hashlib.sha256(operation.encode()).hexdigest()))
            fixture.db.commit()
            print(json.dumps(dict(synthetic_only=True, users=args.users, erased_collections_per_user=args.erased_collections,
                                  **fixture.metrics()), indent=2))
        finally:
            fixture.db.close()
        return
    rows = []
    for mode in ['small_section_renames', 'everyday_text', 'unicode_and_quotes']:
        fixture = Fixture(args.users, args.bytes_limit)
        try:
            fixture.populate(mode)
            rows.append(dict(scenario=mode, **fixture.metrics()))
        finally:
            fixture.db.close()
    print(json.dumps(dict(synthetic_only=True, api_enforcement_test=False, users=args.users,
                          plan=dict(PLAN, bytes=args.bytes_limit), max_items_per_collection=100,
                          max_sections_per_collection=20, scenarios=rows), indent=2))


if __name__ == '__main__':
    main()
