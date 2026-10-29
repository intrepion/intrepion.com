CREATE TRIGGER revoke_links_departed_head AFTER UPDATE OF active ON household_heads
WHEN OLD.active=1 AND NEW.active=0 BEGIN
 UPDATE household_invitation_requests SET status='canceled',closed_at=unixepoch()
 WHERE status='pending' AND link_id IN(SELECT id FROM household_request_links WHERE household_id=NEW.household_id AND created_by=NEW.subject AND revoked=0);
 UPDATE household_request_links SET revoked=1 WHERE household_id=NEW.household_id AND created_by=NEW.subject AND revoked=0;
END;
CREATE TRIGGER revoke_links_suspended_head AFTER UPDATE OF approved ON pilot_accounts
WHEN OLD.approved=1 AND NEW.approved=0 BEGIN
 UPDATE household_invitation_requests SET status='canceled',closed_at=unixepoch()
 WHERE status='pending' AND link_id IN(SELECT id FROM household_request_links WHERE created_by=NEW.subject AND revoked=0);
 UPDATE household_request_links SET revoked=1 WHERE created_by=NEW.subject AND revoked=0;
END;
CREATE TRIGGER revoke_links_closed_household AFTER UPDATE OF status ON households
WHEN OLD.status='active' AND NEW.status<>'active' BEGIN
 UPDATE household_invitation_requests SET status='canceled',closed_at=unixepoch() WHERE household_id=NEW.id AND status='pending';
 UPDATE household_request_links SET revoked=1 WHERE household_id=NEW.id AND revoked=0;
END;
