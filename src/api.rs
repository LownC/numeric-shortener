use dioxus::prelude::*;
use numeric_shortener::protocol::CreateOutcome;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProbeReply {
    pub message: String,
    pub echo: String,
}

#[post("/api/probe")]
pub async fn probe(input: String) -> Result<ProbeReply, ServerFnError> {
    println!("M1_PROBE_REQUEST");
    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    Ok(ProbeReply {
        message: "Rust 서버에서 응답했습니다.".into(),
        echo: input,
    })
}

#[post("/api/static_routes")]
pub async fn static_routes() -> Result<Vec<String>, ServerFnError> {
    Ok(vec!["/".into()])
}

#[post("/api/urls")]
pub async fn create_url(original_url: String) -> Result<CreateOutcome, ServerFnError> {
    let state = dioxus::fullstack::FullstackContext::current()
        .and_then(|ctx| ctx.extension::<numeric_shortener::server::AppState>())
        .ok_or_else(|| ServerFnError::new("Application state unavailable"))?;
    match state.create(&original_url).await {
        created @ CreateOutcome::Created { .. } => Ok(created),
        CreateOutcome::InvalidUrl { message } => Err(ServerFnError::ServerError {
            message,
            code: 400,
            details: None,
        }),
        CreateOutcome::Unavailable { message, .. } => Err(ServerFnError::ServerError {
            message,
            code: 503,
            details: None,
        }),
    }
}
