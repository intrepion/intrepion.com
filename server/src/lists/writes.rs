use super::{Event, ListItem};
use crate::db::Statement;
use connectrpc::ConnectError;
use serde_json::{Value, json};

// D1 bounds a bound value at 2 MB. Chunk by encoded bytes, not item count.
const ROWSET_BYTES: usize = 1024 * 1024;
pub(super) fn json_chunks(
    rows: impl IntoIterator<Item = Value>,
) -> Result<Vec<String>, ConnectError> {
    let mut chunks = Vec::new();
    let mut current = Vec::new();
    let mut bytes = 2;
    for row in rows {
        let row = row.to_string();
        if row.len() + 2 > ROWSET_BYTES {
            return Err(ConnectError::resource_exhausted(
                "A change exceeds the database value budget.",
            ));
        }
        if bytes + row.len() + 1 > ROWSET_BYTES {
            chunks.push(format!("[{}]", current.join(",")));
            current.clear();
            bytes = 2;
        }
        bytes += row.len() + 1;
        current.push(row);
    }
    if !current.is_empty() {
        chunks.push(format!("[{}]", current.join(",")));
    }
    Ok(chunks)
}

#[derive(Default)]
pub(super) struct Writes {
    statements: Vec<Statement>,
    items: Vec<Value>,
    sections: Vec<Value>,
}
impl Writes {
    pub(super) fn push(&mut self, statement: Statement) {
        self.statements.push(statement);
    }
    pub(super) fn update_item(&mut self, item: &ListItem) {
        self.items.push(json!({"id":item.id,"title":item.title,"notes":item.notes,"quantity":item.quantity,"section_id":item.section_id,"completed":i32::from(item.completed),"trashed":i32::from(item.trashed),"position":item.position}));
    }
    pub(super) fn section_position(&mut self, id: &str, position: usize) {
        self.sections.push(json!({"id":id,"position":position}));
    }
    pub(super) fn finish(
        mut self,
        owner: &str,
        collection: &str,
    ) -> Result<Vec<Statement>, ConnectError> {
        for rows in json_chunks(self.items)? {
            self.statements.push(Statement::new("UPDATE list_items SET title=json_extract(input.value,'$.title'),notes=json_extract(input.value,'$.notes'),quantity=json_extract(input.value,'$.quantity'),section_id=json_extract(input.value,'$.section_id'),completed=json_extract(input.value,'$.completed'),trashed=json_extract(input.value,'$.trashed'),position=json_extract(input.value,'$.position') FROM json_each(?) AS input WHERE list_items.owner_sub=? AND list_items.collection_id=? AND list_items.id=json_extract(input.value,'$.id') AND @guard",vec![rows,owner.into(),collection.into()]));
        }
        for rows in json_chunks(self.sections)? {
            self.statements.push(Statement::new("UPDATE list_sections SET position=json_extract(input.value,'$.position') FROM json_each(?) AS input WHERE list_sections.owner_sub=? AND list_sections.collection_id=? AND list_sections.id=json_extract(input.value,'$.id') AND @guard",vec![rows,owner.into(),collection.into()]));
        }
        Ok(self.statements)
    }
}
pub(super) fn history_writes(
    owner: &str,
    collection: &str,
    operation: &str,
    events: Vec<Event>,
) -> Result<Vec<Statement>, ConnectError> {
    json_chunks(events.into_iter().filter(|event|event.before!=event.after).map(|event|json!(event))).map(|chunks|chunks.into_iter().map(|rows|Statement::new("INSERT INTO collection_history(owner_sub,collection_id,operation_id,target_id,target_title,action,before_json,after_json) SELECT ?,?,?,json_extract(value,'$.target'),json_extract(value,'$.title'),json_extract(value,'$.action'),coalesce(json_extract(value,'$.before'),'null'),coalesce(json_extract(value,'$.after'),'null') FROM json_each(?) WHERE @guard ON CONFLICT(owner_sub,operation_id,target_id) DO NOTHING",vec![owner.into(),collection.into(),operation.into(),rows])).collect())
}
