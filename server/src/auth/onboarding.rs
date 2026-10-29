use super::*;
use crate::db::Statement;

#[derive(Deserialize)]
pub(crate) struct Onboarding {
    pub csrf: String,
    pub user_sub: String,
    pub email: String,
    pub display_name: String,
    pub invitation_id: String,
    pub generation: u64,
    pub expires_at: u64,
}
impl Auth {
    pub(crate) async fn onboarding(
        &self,
        headers: &HeaderMap,
        write: bool,
    ) -> Result<Onboarding, AuthError> {
        let token = cookie(headers, &self.name("onboarding"))
            .filter(|s| s.len() == 64)
            .ok_or_else(unauthorized)?;
        let row=self.db.query::<Onboarding>("SELECT o.csrf,o.user_sub,o.email,o.display_name,o.invitation_id,o.generation,o.expires_at FROM onboarding_sessions o JOIN email_invitations i ON i.id=o.invitation_id AND i.generation=o.generation JOIN households h ON h.id=i.household_id WHERE o.token_hash=? AND o.expires_at>? AND i.expires_at>? AND h.status='active' AND ((i.status='pending' AND EXISTS(SELECT 1 FROM household_heads m JOIN pilot_accounts a ON a.subject=m.subject WHERE m.household_id=i.household_id AND m.subject=i.created_by AND m.active=1 AND a.approved=1)) OR (i.status='accepted' AND i.accepted_by=o.user_sub AND EXISTS(SELECT 1 FROM household_heads m WHERE m.household_id=i.household_id AND m.subject=o.user_sub AND m.active=1))) AND NOT EXISTS(SELECT 1 FROM pilot_accounts a WHERE a.subject=o.user_sub AND a.approved=0)",&[hash(token),now().to_string(),now().to_string()]).await?.pop().ok_or_else(unauthorized)?;
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
    pub(crate) async fn begin_invitation(
        &self,
        subject: &str,
        address: &str,
        display_name: &str,
        token: &str,
    ) -> Result<Response, AuthError> {
        let unavailable = || {
            AuthError(
                StatusCode::GONE,
                "This invitation is unavailable. Open the newest email or ask a household head for a new invitation.",
            )
        };
        if token.len() != 64
            || !token
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(unavailable());
        }
        let address = crate::invitations::email(address).map_err(|_| forbidden())?;
        if !crate::capacity::normal_accounts(&self.db).await? {
            return Err(unavailable());
        }
        #[derive(Deserialize)]
        struct Invite {
            id: String,
            generation: u64,
            status: String,
            recipient_email: String,
            recipient_sub: String,
        }
        let invite=self.db.query::<Invite>("SELECT i.id,i.generation,i.status,i.recipient_email,i.recipient_sub FROM email_invitations i JOIN households h ON h.id=i.household_id WHERE i.token_hash=? AND i.expires_at>? AND h.status='active' AND NOT EXISTS(SELECT 1 FROM pilot_accounts a WHERE a.subject=? AND a.approved=0) AND NOT EXISTS(SELECT 1 FROM protected_account_access p WHERE p.subject_hash=? AND p.active=0) AND ((i.status='pending' AND EXISTS(SELECT 1 FROM household_heads m JOIN pilot_accounts a ON a.subject=m.subject WHERE m.household_id=i.household_id AND m.subject=i.created_by AND m.active=1 AND a.approved=1)) OR (i.status='accepted' AND i.accepted_by=? AND EXISTS(SELECT 1 FROM household_heads m WHERE m.household_id=i.household_id AND m.subject=? AND m.active=1)))",&[hash(token),now().to_string(),subject.into(),crate::security::subject_hash(subject),subject.into(),subject.into()]).await?.pop().ok_or_else(unavailable)?;
        if invite.recipient_email != address
            || (!invite.recipient_sub.is_empty() && invite.recipient_sub != subject)
        {
            return Err(forbidden());
        }
        if invite.status == "accepted" {
            return self.issue_session(subject).await;
        }
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
   Statement::new("DELETE FROM onboarding_sessions WHERE expires_at<=?",vec![now().to_string()]),
   Statement::new("INSERT INTO onboarding_sessions(token_hash,csrf,user_sub,email,display_name,invitation_id,generation,expires_at) VALUES(?,?,?,?,?,?,?,?)",vec![hash(&token),csrf.clone(),subject.into(),address.clone(),name.clone(),invite.id,invite.generation.to_string(),expires.to_string()]),
  ]).await?;
        let mut response=Json(serde_json::json!({"onboarding":true,"csrf":csrf,"expires_at":expires,"user_sub":subject,"display_name":name,"email":address})).into_response();
        for value in [
            self.set_cookie("onboarding", &token, 900),
            self.set_cookie("session", "", 0),
            self.set_cookie("login", "", 0),
        ] {
            response
                .headers_mut()
                .append(header::SET_COOKIE, value.parse().expect("generated cookie"));
        }
        Ok(response)
    }
}
