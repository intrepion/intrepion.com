-- Keep the entire confirmed retry identity through page reloads and lost ledger responses.
ALTER TABLE erasure_intents ADD COLUMN confirmed_active_erasure INTEGER NOT NULL DEFAULT 0 CHECK(confirmed_active_erasure IN(0,1));
