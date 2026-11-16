#[derive(Debug, PartialEq, Eq)]
pub struct InvalidId;

pub fn parse_id(input: &str) -> Result<i64, InvalidId> {
    if input.is_empty()
        || input.len() > 19
        || input.starts_with('0')
        || !input.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(InvalidId);
    }
    input
        .parse::<i64>()
        .ok()
        .filter(|id| *id > 0)
        .ok_or(InvalidId)
}

use crate::server::{AppState, LookupOutcome};
use dioxus::server::axum::{
    body::Body,
    extract::{Extension, OriginalUri},
    http::{header, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
};

pub async fn resolve(
    Extension(state): Extension<AppState>,
    OriginalUri(uri): OriginalUri,
    method: Method,
) -> Response {
    // These service roots are never numeric IDs. Registered asset/API routes take precedence.
    if matches!(uri.path(), "/api" | "/assets") {
        return error_response(StatusCode::NOT_FOUND, "요청한 주소를 찾을 수 없습니다.");
    }
    if method != Method::GET && method != Method::HEAD {
        let mut response = error_response(
            StatusCode::METHOD_NOT_ALLOWED,
            "이 주소는 GET, HEAD만 지원합니다.",
        );
        response
            .headers_mut()
            .insert(header::ALLOW, HeaderValue::from_static("GET, HEAD"));
        return response;
    }
    // Use the original encoded path, not a decoded Path<String>: %31 is not a canonical ID.
    let id = match parse_id(uri.path().strip_prefix('/').unwrap_or_default()) {
        Ok(id) => id,
        Err(_) => {
            return error_response(StatusCode::BAD_REQUEST, "올바른 숫자 ID를 입력해 주세요.")
        }
    };
    match state.lookup(id).await {
        LookupOutcome::Found(destination) => match HeaderValue::from_str(&destination) {
            Ok(location) => {
                let mut response = Response::new(Body::empty());
                *response.status_mut() = StatusCode::FOUND;
                response.headers_mut().insert(header::LOCATION, location);
                response
                    .headers_mut()
                    .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
                response
            }
            Err(_) => unavailable(),
        },
        LookupOutcome::Missing => {
            error_response(StatusCode::NOT_FOUND, "해당 숫자 주소를 찾을 수 없습니다.")
        }
        LookupOutcome::Unavailable => unavailable(),
    }
}

fn error_response(status: StatusCode, message: &'static str) -> Response {
    let mut response = (status, message).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response
}

fn unavailable() -> Response {
    let mut response = error_response(
        StatusCode::SERVICE_UNAVAILABLE,
        "일시적으로 주소를 조회할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    );
    response
        .headers_mut()
        .insert(header::RETRY_AFTER, HeaderValue::from_static("3"));
    response
}
