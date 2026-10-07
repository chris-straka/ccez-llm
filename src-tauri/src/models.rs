//! `GET {base}/models` from Rust, for gateways that send no CORS headers
//! (OpenCode Zen): no webview `fetch` can read them, the shell can. The
//! status and body go back raw; `providers/openai-compat.ts` keeps the
//! parsing and the error copy for both paths.

use std::time::Duration;

/// Status plus body of one `/models` request.
#[derive(serde::Serialize)]
pub struct ModelsResponse {
    status: u16,
    body: String,
}

/// The models URL for a base URL (one slash, however the base ends).
fn models_url(base_url: &str) -> String {
    format!("{}/models", base_url.trim_end_matches('/'))
}

#[tauri::command]
pub async fn list_models(base_url: String, api_key: String) -> Result<ModelsResponse, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.get(models_url(&base_url));
    // Keyless lists (Zen's is public) go out without a credential.
    if !api_key.trim().is_empty() {
        request = request.header("Authorization", format!("Bearer {}", api_key.trim()));
    }
    let res = request.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(ModelsResponse { status, body })
}

#[cfg(test)]
mod tests {
    use super::models_url;

    #[test]
    fn models_url_joins_with_one_slash() {
        assert_eq!(
            models_url("https://opencode.ai/zen/v1"),
            "https://opencode.ai/zen/v1/models"
        );
        assert_eq!(
            models_url("https://opencode.ai/zen/v1/"),
            "https://opencode.ai/zen/v1/models"
        );
    }
}
