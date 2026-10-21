use serde::de::DeserializeOwned;
use std::time::{Duration, Instant};

#[derive(Clone)]
pub struct Database {
    http: reqwest::Client,
    url: String,
    token: String,
}

impl Database {
    pub fn new(url: String, token: String) -> Result<Self, reqwest::Error> {
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .connect_timeout(Duration::from_secs(3))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            url,
            token,
        })
    }

    pub async fn query<T: DeserializeOwned>(
        &self,
        sql: &str,
        params: &[String],
    ) -> Result<Vec<T>, connectrpc::ConnectError> {
        let start = Instant::now();
        let result = self.execute(sql, params).await;
        // Never log statements, parameters, headers, provider messages or rows.
        eprintln!(
            "{}",
            serde_json::json!({"event":"database", "duration_ms":start.elapsed().as_millis(), "ok":result.is_ok()})
        );
        result
    }

    async fn execute<T: DeserializeOwned>(
        &self,
        sql: &str,
        params: &[String],
    ) -> Result<Vec<T>, connectrpc::ConnectError> {
        let unavailable = || {
            connectrpc::ConnectError::unavailable(
                "Database temporarily unavailable. Retry the same action.",
            )
        };
        let failed = || connectrpc::ConnectError::internal("Database request failed.");
        // No automatic retries: the caller must retain the action identity.
        let response = self
            .http
            .post(&self.url)
            .bearer_auth(&self.token)
            .json(&serde_json::json!({"sql":sql,"params":params}))
            .send()
            .await
            .map_err(|_| unavailable())?;
        if response.status() == 429 || response.status().is_server_error() {
            return Err(unavailable());
        }
        if !response.status().is_success() {
            return Err(failed());
        }
        let body: serde_json::Value = response.json().await.map_err(|_| failed())?;
        decode(body).ok_or_else(failed)
    }
}

fn decode<T: DeserializeOwned>(body: serde_json::Value) -> Option<Vec<T>> {
    if !body.get("success")?.as_bool()?
        || body
            .get("errors")
            .and_then(|v| v.as_array())
            .is_some_and(|errors| !errors.is_empty())
    {
        return None;
    }
    let results = body.get("result")?.as_array()?;
    if results.len() != 1 {
        return None;
    }
    let statement = &results[0];
    if !statement.get("success")?.as_bool()?
        || statement.get("error").is_some_and(|error| !error.is_null())
    {
        return None;
    }
    serde_json::from_value(statement.get("results")?.clone()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn provider_errors_cannot_be_mistaken_for_an_empty_success() {
        for input in [
            r#"{"success":false}"#,
            r#"{"success":true,"result":[]}"#,
            r#"{"success":true,"result":[{"success":false}]}"#,
            r#"{"success":true,"errors":[{"message":"secret"}],"result":[{"success":true,"results":[]}]}"#,
        ] {
            assert!(decode::<serde_json::Value>(serde_json::from_str(input).unwrap()).is_none());
        }
        assert_eq!(
            decode::<serde_json::Value>(
                serde_json::json!({"success":true,"result":[{"success":true,"results":[]}]})
            ),
            Some(vec![])
        );
    }
}
