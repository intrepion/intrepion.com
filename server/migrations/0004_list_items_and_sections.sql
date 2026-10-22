CREATE TABLE list_sections (
  owner_sub TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  position INTEGER NOT NULL CHECK(position>=0),
  PRIMARY KEY(owner_sub,id),
  FOREIGN KEY(owner_sub,collection_id) REFERENCES collections(owner_sub,id) ON DELETE CASCADE
);
CREATE INDEX section_order ON list_sections(owner_sub,collection_id,position,id);
CREATE TABLE list_items (
  owner_sub TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=10000),
  quantity TEXT NOT NULL DEFAULT '' CHECK(length(quantity)<=100),
  section_id TEXT NOT NULL DEFAULT '',
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN(0,1)),
  trashed INTEGER NOT NULL DEFAULT 0 CHECK(trashed IN(0,1)),
  position INTEGER NOT NULL CHECK(position>=0),
  PRIMARY KEY(owner_sub,id),
  FOREIGN KEY(owner_sub,collection_id) REFERENCES collections(owner_sub,id) ON DELETE CASCADE
);
CREATE INDEX item_order ON list_items(owner_sub,collection_id,section_id,position,id);
