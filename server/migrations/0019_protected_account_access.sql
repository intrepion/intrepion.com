ALTER TABLE pilot_accounts ADD COLUMN access_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pilot_accounts ADD COLUMN last_access_operation TEXT NOT NULL DEFAULT '';
CREATE TABLE security_replay_control(id INTEGER PRIMARY KEY CHECK(id=1),replaying INTEGER NOT NULL DEFAULT 0 CHECK(replaying IN(0,1)));
INSERT INTO security_replay_control(id) VALUES(1);
CREATE TABLE site_security_outbox(
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 event_id TEXT NOT NULL UNIQUE DEFAULT(lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(6)))),
 scope TEXT NOT NULL CHECK(scope IN('account_access','head_membership')),
 subject TEXT NOT NULL DEFAULT '',subject_hash TEXT NOT NULL DEFAULT '',public_id TEXT NOT NULL,
 household_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
 active INTEGER NOT NULL CHECK(active IN(0,1)),published INTEGER NOT NULL DEFAULT 0 CHECK(published IN(0,1))
);
CREATE TABLE protected_account_access(subject_hash TEXT PRIMARY KEY,public_id TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),security_revision INTEGER NOT NULL);
CREATE INDEX protected_account_identity ON protected_account_access(public_id);
CREATE TABLE protected_membership_state(household_id TEXT NOT NULL,subject_hash TEXT NOT NULL,public_id TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),security_revision INTEGER NOT NULL,PRIMARY KEY(household_id,subject_hash));
CREATE TRIGGER record_account_access_change AFTER UPDATE OF approved ON pilot_accounts WHEN OLD.approved<>NEW.approved AND (SELECT replaying FROM security_replay_control WHERE id=1)=0 AND ((SELECT enabled FROM site_safety_policy WHERE id=1)=1 OR EXISTS(SELECT 1 FROM protected_account_access p WHERE p.public_id=NEW.public_id)) BEGIN
 UPDATE pilot_accounts SET access_revision=access_revision+1 WHERE subject=NEW.subject;
 INSERT INTO site_security_outbox(scope,subject,public_id,active) VALUES('account_access',NEW.subject,NEW.public_id,NEW.approved);
END;
CREATE TRIGGER record_head_admission AFTER INSERT ON household_heads WHEN NEW.active=1 AND (SELECT replaying FROM security_replay_control WHERE id=1)=0 AND (SELECT enabled FROM site_safety_policy WHERE id=1)=1 BEGIN
 INSERT INTO site_security_outbox(scope,subject,public_id,household_id,active) SELECT 'head_membership',NEW.subject,a.public_id,NEW.household_id,1 FROM pilot_accounts a WHERE a.subject=NEW.subject;
END;
CREATE TRIGGER record_head_access_change AFTER UPDATE OF active ON household_heads WHEN OLD.active<>NEW.active AND (SELECT replaying FROM security_replay_control WHERE id=1)=0 AND ((SELECT enabled FROM site_safety_policy WHERE id=1)=1 OR EXISTS(SELECT 1 FROM protected_membership_state p JOIN pilot_accounts a ON a.public_id=p.public_id WHERE p.household_id=NEW.household_id AND a.subject=NEW.subject)) BEGIN
 INSERT INTO site_security_outbox(scope,subject,public_id,household_id,active) SELECT 'head_membership',NEW.subject,a.public_id,NEW.household_id,NEW.active FROM pilot_accounts a WHERE a.subject=NEW.subject;
END;
