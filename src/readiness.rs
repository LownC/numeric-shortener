use crate::{authorization::CreationPolicy, server::AppState};
use dioxus::server::axum::{
    extract::Extension,
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};

pub async fn healthz(
    Extension(state): Extension<AppState>,
    Extension(policy): Extension<CreationPolicy>,
) -> Response {
    let ready = policy.is_ready() && state.ready().await;
    let mut response = if ready {
        (StatusCode::OK, "ok\n")
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, "unavailable\n")
    }
    .into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response
}
