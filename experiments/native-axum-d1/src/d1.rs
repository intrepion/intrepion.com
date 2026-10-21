use serde::{Deserialize, de::DeserializeOwned};
use std::time::Duration;

#[derive(Clone)]
pub struct D1Client {
    http: reqwest::Client,
    query_url: String,
    token: String,
}

#[derive(Debug, PartialEq)]
pub enum DatabaseError {
    Transport,
    Http(u16),
    Api,
    Statement,
    Malformed,
}

impl DatabaseError {
    pub fn into_rpc(self) -> connectrpc::ConnectError {
        match self {
            Self::Transport | Self::Http(429 | 500..=599) => {
                connectrpc::ConnectError::unavailable("database temporarily unavailable")
            }
            _ => connectrpc::ConnectError::internal("database request failed"),
        }
    }
}

#[derive(Deserialize)]
struct Envelope<T> {
    success: bool,
    result: Option<Vec<Statement<T>>>,
}

#[derive(Deserialize)]
struct Statement<T> {
    success: bool,
    results: Vec<T>,
}

impl D1Client {
    pub fn new(query_url: String, token: String) -> Result<Self, reqwest::Error> {
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .connect_timeout(Duration::from_secs(3))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            query_url,
            token,
        })
    }

    pub async fn query<T: DeserializeOwned>(
        &self,
        sql: &str,
        params: &[String],
    ) -> Result<Vec<T>, DatabaseError> {
        // No automatic retries: an interrupted write may have committed already.
        // The token is server-side only; neither provider bodies nor SQL values
        // are reflected into Connect errors or application logs.
        let response = self
            .http
            .post(&self.query_url)
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "sql": sql, "params": params }))
            .send()
            .await
            .map_err(|_| DatabaseError::Transport)?;
        if !response.status().is_success() {
            return Err(DatabaseError::Http(response.status().as_u16()));
        }
        // Inspect success before decoding typed rows: error envelopes may omit
        // result/results entirely and must not be treated as an empty success.
        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|_| DatabaseError::Malformed)?;
        if body.get("success") == Some(&serde_json::Value::Bool(false))
            || body
                .get("errors")
                .and_then(|v| v.as_array())
                .is_some_and(|errors| !errors.is_empty())
        {
            return Err(DatabaseError::Api);
        }
        if body
            .get("result")
            .and_then(|v| v.as_array())
            .is_some_and(|results| {
                results.iter().any(|r| {
                    r.get("success") == Some(&serde_json::Value::Bool(false))
                        || r.get("error").is_some_and(|error| !error.is_null())
                })
            })
        {
            return Err(DatabaseError::Statement);
        }
        let envelope: Envelope<T> =
            serde_json::from_value(body).map_err(|_| DatabaseError::Malformed)?;
        if !envelope.success {
            return Err(DatabaseError::Api);
        }
        let mut results = envelope.result.ok_or(DatabaseError::Malformed)?;
        if results.len() != 1 {
            return Err(DatabaseError::Malformed);
        }
        let statement = results.remove(0);
        if !statement.success {
            return Err(DatabaseError::Statement);
        }
        Ok(statement.results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Router,
        body::Body,
        http::{Request, StatusCode},
        response::IntoResponse,
        routing::post,
    };

    async fn fixture(
        status: StatusCode,
        body: &'static str,
    ) -> (D1Client, tokio::task::JoinHandle<()>) {
        let app = Router::new().route(
            "/query",
            post(move |request: Request<Body>| async move {
                assert_eq!(request.headers()["authorization"], "Bearer fixture-token");
                let bytes = axum::body::to_bytes(request.into_body(), 4096)
                    .await
                    .unwrap();
                let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                assert_eq!(value["sql"], "SELECT ? AS value");
                assert_eq!(value["params"], serde_json::json!(["bound value"]));
                (status, body).into_response()
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/query", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (D1Client::new(url, "fixture-token".into()).unwrap(), task)
    }

    #[tokio::test]
    async fn decodes_rows_and_sends_bound_parameters_with_server_token() {
        let (client, task) = fixture(
            StatusCode::OK,
            r#"{"success":true,"result":[{"success":true,"results":[{"value":"bound value"}]}]}"#,
        )
        .await;
        let rows = client
            .query::<serde_json::Value>("SELECT ? AS value", &["bound value".into()])
            .await
            .unwrap();
        assert_eq!(rows, vec![serde_json::json!({ "value": "bound value" })]);
        task.abort();
    }

    #[tokio::test]
    async fn rejects_failed_or_malformed_provider_responses() {
        for (status, body, expected) in [
            (
                StatusCode::OK,
                r#"{"success":false,"errors":[{"code":7500,"message":"private SQL details"}]}"#,
                DatabaseError::Api,
            ),
            (
                StatusCode::OK,
                r#"{"success":true,"result":[{"success":false}]}"#,
                DatabaseError::Statement,
            ),
            (
                StatusCode::OK,
                r#"{"success":true,"errors":[{"code":7500,"message":"private details"}],"result":[]}"#,
                DatabaseError::Api,
            ),
            (
                StatusCode::OK,
                r#"{"success":true,"result":[{"success":true,"error":"private details","results":[]}]}"#,
                DatabaseError::Statement,
            ),
            (StatusCode::OK, "not JSON", DatabaseError::Malformed),
            (
                StatusCode::OK,
                r#"{"success":true,"result":[]}"#,
                DatabaseError::Malformed,
            ),
            (
                StatusCode::OK,
                r#"{"success":true,"result":[{"success":true,"results":[]},{"success":true,"results":[]}]}"#,
                DatabaseError::Malformed,
            ),
            (
                StatusCode::TOO_MANY_REQUESTS,
                "rate limited",
                DatabaseError::Http(429),
            ),
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "unavailable",
                DatabaseError::Http(503),
            ),
            (
                StatusCode::UNAUTHORIZED,
                "bad provider token",
                DatabaseError::Http(401),
            ),
        ] {
            let (client, task) = fixture(status, body).await;
            assert_eq!(
                client
                    .query::<serde_json::Value>("SELECT ? AS value", &["bound value".into()])
                    .await
                    .unwrap_err(),
                expected
            );
            task.abort();
        }
        assert_eq!(
            DatabaseError::Http(429).into_rpc().code,
            connectrpc::ErrorCode::Unavailable
        );
        assert_eq!(
            DatabaseError::Api.into_rpc().code,
            connectrpc::ErrorCode::Internal
        );
    }
}
