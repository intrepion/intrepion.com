use super::*;
use crate::db::Statement;

#[derive(Deserialize)]
pub(crate) struct RequestSession {
    pub csrf: String,
    pub user_sub: String,
    pub email: String,
    pub display_name: String,
    pub link_id: String,
    pub expires_at: u64,
}
#[derive(Deserialize)]
pub(crate) struct RequestLookupSession {
    pub csrf: String,
    pub user_sub: String,
    pub email: String,
    pub display_name: String,
    pub expires_at: u64,
}

impl Auth {
    pub(crate) async fn begin_request_lookup(
        &self,
        subject: &str,
        address: &str,
        display_name: &str,
    ) -> Result<Response, AuthError> {
        let address = crate::invitations::email(address).map_err(|_| forbidden())?;
        if !self.db.query::<serde_json::Value>("SELECT 1 FROM pilot_accounts WHERE subject=? AND approved=0 UNION ALL SELECT 1 FROM protected_account_access WHERE subject_hash=? AND active=0",&[subject.into(),crate::security::subject_hash(subject)]).await?.is_empty() { return Err(forbidden()); }
        let token = secret();
        let csrf = secret();
        let expires = now() + 900;
        let name = display_name
            .trim()
            .chars()
            .filter(|c| !c.is_control())
            .take(100)
            .collect::<String>();
        self.db.batch(&[Statement::new("DELETE FROM request_lookup_sessions WHERE expires_at<=?",vec![now().to_string()]),Statement::new("INSERT INTO request_lookup_sessions(token_hash,csrf,user_sub,email,display_name,expires_at) VALUES(?,?,?,?,?,?)",vec![hash(&token),csrf.clone(),subject.into(),address.clone(),name.clone(),expires.to_string()])]).await?;
        let mut response=Json(serde_json::json!({"request_lookup":true,"csrf":csrf,"expires_at":expires,"user_sub":subject,"email":address,"display_name":name})).into_response();
        for value in [
            self.set_cookie("request-lookup", &token, 900),
            self.set_cookie("request", "", 0),
            self.set_cookie("session", "", 0),
            self.set_cookie("onboarding", "", 0),
            self.set_cookie("login", "", 0),
        ] {
            response
                .headers_mut()
                .append(header::SET_COOKIE, value.parse().expect("generated cookie"));
        }
        Ok(response)
    }
    pub(crate) async fn request_lookup_session(
        &self,
        headers: &HeaderMap,
        write: bool,
    ) -> Result<RequestLookupSession, AuthError> {
        let token = cookie(headers, &self.name("request-lookup"))
            .filter(|s| s.len() == 64)
            .ok_or_else(unauthorized)?;
        let row=self.db.query::<RequestLookupSession>("SELECT csrf,user_sub,email,display_name,expires_at FROM request_lookup_sessions WHERE token_hash=? AND expires_at>? AND NOT EXISTS(SELECT 1 FROM pilot_accounts a WHERE a.subject=request_lookup_sessions.user_sub AND a.approved=0)",&[hash(token),now().to_string()]).await?.pop().ok_or_else(unauthorized)?;
        if !self
            .db
            .query::<serde_json::Value>(
                "SELECT 1 FROM protected_account_access WHERE subject_hash=? AND active=0",
                &[crate::security::subject_hash(&row.user_sub)],
            )
            .await?
            .is_empty()
        {
            return Err(forbidden());
        }
        if write {
            self.check_origin(headers)?;
            if headers.get("x-csrf-token").and_then(|v| v.to_str().ok()) != Some(row.csrf.as_str())
            {
                return Err(forbidden());
            }
        }
        Ok(row)
    }
    pub(crate) async fn begin_request(
        &self,
        subject: &str,
        address: &str,
        display_name: &str,
        link_token: &str,
    ) -> Result<Response, AuthError> {
        let unavailable = || AuthError(StatusCode::GONE, "This request link is unavailable.");
        if link_token.len() != 64
            || !link_token
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(unavailable());
        }
        let address = crate::invitations::email(address).map_err(|_| forbidden())?;
        #[derive(Deserialize)]
        struct Link {
            id: String,
        }
        let link = self.db.query::<Link>("SELECT l.id FROM household_request_links l JOIN households h ON h.id=l.household_id WHERE l.token_hash=? AND l.revoked=0 AND l.expires_at>? AND h.status='active' AND NOT EXISTS(SELECT 1 FROM pilot_accounts a WHERE a.subject=? AND a.approved=0) AND NOT EXISTS(SELECT 1 FROM protected_account_access p WHERE p.subject_hash=? AND p.active=0)", &[hash(link_token),now().to_string(),subject.into(),crate::security::subject_hash(subject)]).await?.pop().ok_or_else(unavailable)?;
        let token = secret();
        let csrf = secret();
        let expires = now() + 900;
        let name = display_name
            .trim()
            .chars()
            .filter(|c| !c.is_control())
            .take(100)
            .collect::<String>();
        let name = if name.is_empty() {
            "New head".into()
        } else {
            name
        };
        self.db.batch(&[
            Statement::new("DELETE FROM request_sessions WHERE expires_at<=?",vec![now().to_string()]),
            Statement::new("INSERT INTO request_sessions(token_hash,csrf,user_sub,email,display_name,link_id,expires_at) VALUES(?,?,?,?,?,?,?)",vec![hash(&token),csrf.clone(),subject.into(),address.clone(),name.clone(),link.id,expires.to_string()]),
        ]).await?;
        let mut response=Json(serde_json::json!({"request_session":true,"csrf":csrf,"expires_at":expires,"user_sub":subject,"email":address,"display_name":name})).into_response();
        for value in [
            self.set_cookie("request", &token, 900),
            self.set_cookie("request-lookup", "", 0),
            self.set_cookie("session", "", 0),
            self.set_cookie("onboarding", "", 0),
            self.set_cookie("login", "", 0),
        ] {
            response
                .headers_mut()
                .append(header::SET_COOKIE, value.parse().expect("generated cookie"));
        }
        Ok(response)
    }
    pub(crate) async fn request_session(
        &self,
        headers: &HeaderMap,
        write: bool,
    ) -> Result<RequestSession, AuthError> {
        let token = cookie(headers, &self.name("request"))
            .filter(|s| s.len() == 64)
            .ok_or_else(unauthorized)?;
        let row=self.db.query::<RequestSession>("SELECT s.csrf,s.user_sub,s.email,s.display_name,s.link_id,s.expires_at FROM request_sessions s JOIN household_request_links l ON l.id=s.link_id JOIN households h ON h.id=l.household_id WHERE s.token_hash=? AND s.expires_at>? AND l.revoked=0 AND l.expires_at>? AND h.status='active' AND NOT EXISTS(SELECT 1 FROM pilot_accounts a WHERE a.subject=s.user_sub AND a.approved=0)",&[hash(token),now().to_string(),now().to_string()]).await?.pop().ok_or_else(unauthorized)?;
        if !self
            .db
            .query::<serde_json::Value>(
                "SELECT 1 FROM protected_account_access WHERE subject_hash=? AND active=0",
                &[crate::security::subject_hash(&row.user_sub)],
            )
            .await?
            .is_empty()
        {
            return Err(forbidden());
        }
        if write {
            self.check_origin(headers)?;
            if headers.get("x-csrf-token").and_then(|v| v.to_str().ok()) != Some(row.csrf.as_str())
            {
                return Err(forbidden());
            }
        }
        Ok(row)
    }
}
