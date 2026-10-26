use connectrpc::ConnectError;
use serde::Serialize;
use std::time::Duration;

#[derive(Clone)]
pub enum LedgerSettings {
    Local,
    #[cfg(feature = "dev-auth")]
    BackblazeEmulator,
    Backblaze {
        key_id: String,
        key: String,
        bucket_id: String,
    },
}
#[derive(Serialize)]
pub struct SecurityChange {
    pub subject_hash: String,
    pub public_id: String,
    pub revision: u64,
    pub active: bool,
}
#[derive(Serialize)]
pub struct ErasureRecord {
    pub version: u32,
    pub database_id: String,
    pub operation_id: String,
    pub collection_id: String,
    pub scope: String,
    pub target_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub erase_due_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collection_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub security: Option<SecurityChange>,
}
impl ErasureRecord {
    // Client action IDs belong to a data scope. Publication IDs must be unique
    // across scopes because the independent ledger is shared by the database.
    pub fn namespaced(mut self, scope_key: &str) -> Self {
        use sha2::{Digest, Sha256};
        let identity = serde_json::to_vec(&(
            "intrepion-ledger",
            self.version,
            &self.database_id,
            scope_key,
            &self.operation_id,
            &self.collection_id,
            &self.scope,
            &self.target_id,
        ))
        .expect("serializable ledger identity");
        let hex = format!("{:x}", Sha256::digest(identity));
        self.operation_id = format!(
            "{}-{}-4{}-a{}-{}",
            &hex[..8],
            &hex[8..12],
            &hex[13..16],
            &hex[17..20],
            &hex[20..32]
        );
        self
    }
}
pub struct ErasureLedger {
    settings: LedgerSettings,
    http: reqwest::Client,
}
pub fn unavailable() -> ConnectError {
    ConnectError::unavailable(
        "Permanent erasure is pending. Retry the same action. Other changes to this collection are paused until it finishes.",
    )
}
impl ErasureLedger {
    pub fn new(settings: LedgerSettings) -> Result<Self, reqwest::Error> {
        Ok(Self {
            settings,
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(3))
                .timeout(Duration::from_secs(20))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
        })
    }
    pub async fn publish(&self, record: &ErasureRecord) -> Result<(), ConnectError> {
        match &self.settings {
            #[cfg(feature = "dev-auth")]
            LedgerSettings::BackblazeEmulator => {
                self.publish_backblaze(
                    record,
                    "emulator-key",
                    "emulator-secret",
                    "emulator-bucket",
                    "http://127.0.0.1:8792/b2api/v4/b2_authorize_account",
                    true,
                )
                .await
            }
            LedgerSettings::Local => {
                let response = self
                    .http
                    .post("http://127.0.0.1:8792/records")
                    .bearer_auth("local-erasure-only")
                    .json(record)
                    .send()
                    .await
                    .map_err(|_| unavailable())?;
                if !response.status().is_success() {
                    return Err(unavailable());
                }
                let body: serde_json::Value = response.json().await.map_err(|_| unavailable())?;
                if body["recorded"] != true || body["operation_id"] != record.operation_id {
                    return Err(unavailable());
                }
                Ok(())
            }
            LedgerSettings::Backblaze {
                key_id,
                key,
                bucket_id,
            } => {
                self.publish_backblaze(
                    record,
                    key_id,
                    key,
                    bucket_id,
                    "https://api.backblazeb2.com/b2api/v4/b2_authorize_account",
                    false,
                )
                .await
            }
        }
    }

    async fn response(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<serde_json::Value, ConnectError> {
        let response = request.send().await.map_err(|_| unavailable())?;
        if !response.status().is_success() {
            return Err(unavailable());
        }
        response.json().await.map_err(|_| unavailable())
    }
    async fn publish_backblaze(
        &self,
        record: &ErasureRecord,
        key_id: &str,
        key: &str,
        bucket: &str,
        authorize_url: &str,
        emulator: bool,
    ) -> Result<(), ConnectError> {
        let auth = self
            .response(self.http.get(authorize_url).basic_auth(key_id, Some(key)))
            .await?;
        let api = &auth["apiInfo"]["storageApi"];
        let allowed = &api["allowed"];
        let prefix = format!("erasures/{}/", record.database_id);
        // A ledger writer must not be able to delete retained versions, touch
        // daily backups, or write another database's ledger.
        if allowed["namePrefix"].as_str() != Some(prefix.as_str())
            || !allowed["buckets"]
                .as_array()
                .is_some_and(|b| b.len() == 1 && b[0]["id"] == bucket)
            || !allowed["capabilities"]
                .as_array()
                .is_some_and(|c| c.len() == 1 && c[0] == "writeFiles")
        {
            return Err(unavailable());
        }
        let base = provider_url(api["apiUrl"].as_str().ok_or_else(unavailable)?, emulator)?;
        let authorization = auth["authorizationToken"]
            .as_str()
            .filter(|v| !v.is_empty())
            .ok_or_else(unavailable)?;
        let upload = self
            .response(
                self.http
                    .post(format!(
                        "{}/b2api/v4/b2_get_upload_url",
                        base.trim_end_matches('/')
                    ))
                    .header("authorization", authorization)
                    .json(&serde_json::json!({"bucketId":bucket})),
            )
            .await?;
        if upload["bucketId"] != bucket {
            return Err(unavailable());
        }
        let upload_url = provider_url(
            upload["uploadUrl"].as_str().ok_or_else(unavailable)?,
            emulator,
        )?;
        let upload_token = upload["authorizationToken"]
            .as_str()
            .filter(|v| !v.is_empty())
            .ok_or_else(unavailable)?;
        let bytes = serde_json::to_vec(record).map_err(|_| unavailable())?;
        use sha1::Digest;
        let checksum = format!("{:x}", sha1::Sha1::digest(&bytes));
        let name = format!("{prefix}{}.json", record.operation_id);
        let result = self
            .response(
                self.http
                    .post(upload_url)
                    .header("authorization", upload_token)
                    .header("content-type", "application/json")
                    .header("X-Bz-File-Name", name.replace('/', "%2F"))
                    .header("X-Bz-Content-Sha1", &checksum)
                    .body(bytes.clone()),
            )
            .await?;
        let length = result["contentLength"].as_u64().or_else(|| {
            result["contentLength"]
                .as_str()
                .and_then(|v| v.parse().ok())
        });
        if result["action"] != "upload"
            || result["bucketId"] != bucket
            || result["fileName"] != name
            || result["contentSha1"] != checksum
            || length != Some(bytes.len() as u64)
            || !result["fileId"].as_str().is_some_and(|id| !id.is_empty())
        {
            return Err(unavailable());
        }
        Ok(())
    }
}

fn provider_url(value: &str, emulator: bool) -> Result<String, ConnectError> {
    let url = url::Url::parse(value).map_err(|_| unavailable())?;
    let host = url.host_str().ok_or_else(unavailable)?;
    let trusted = if emulator {
        url.scheme() == "http" && host == "127.0.0.1" && url.port() == Some(8792)
    } else {
        url.scheme() == "https"
            && (host.ends_with(".backblazeb2.com") || host.ends_with(".backblaze.com"))
            && url.port_or_known_default() == Some(443)
    };
    if !trusted
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(unavailable());
    }
    Ok(url.to_string())
}
