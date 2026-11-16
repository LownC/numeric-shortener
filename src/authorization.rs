use dioxus::server::axum::{
    extract::{Extension, Request},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use subtle::ConstantTimeEq;

pub const PROXY_SECRET_HEADER: &str = "x-shortener-proxy-secret";

#[derive(Clone)]
pub struct CreationPolicy {
    enabled: bool,
    secret: Option<String>,
    local_debug_bypass: bool,
}

impl CreationPolicy {
    pub fn new(enabled: bool, secret: Option<&str>) -> Self {
        Self {
            enabled,
            secret: secret
                .filter(|value| valid_secret(value))
                .map(str::to_owned),
            local_debug_bypass: false,
        }
    }
    pub fn from_env() -> Self {
        let secret = std::env::var("PROXY_SHARED_SECRET").ok();
        let mut policy = Self::new(
            std::env::var("CREATE_URLS_ENABLED").as_deref() == Ok("true"),
            secret.as_deref(),
        );
        policy.local_debug_bypass = cfg!(debug_assertions)
            && std::env::var("APP_ENV").as_deref() == Ok("local")
            && matches!(std::env::var("IP").as_deref(), Ok("127.0.0.1" | "::1"))
            && std::env::var("ALLOW_INSECURE_LOCAL_CREATE").as_deref() == Ok("true");
        policy
    }
    pub fn allows(&self, headers: &HeaderMap) -> bool {
        if !self.enabled {
            return false;
        }
        if self.local_debug_bypass {
            return true;
        }
        let mut values = headers.get_all(PROXY_SECRET_HEADER).iter();
        let Some(provided) = values.next() else {
            return false;
        };
        if values.next().is_some() {
            return false;
        }
        self.secret
            .as_ref()
            .is_some_and(|secret| bool::from(secret.as_bytes().ct_eq(provided.as_bytes())))
    }
    pub fn is_ready(&self) -> bool {
        !self.enabled || self.local_debug_bypass || self.secret.is_some()
    }
}

fn valid_secret(value: &str) -> bool {
    (32..=256).contains(&value.len())
        && value.is_ascii()
        && !value
            .bytes()
            .any(|c| c.is_ascii_control() || c.is_ascii_whitespace())
}

pub async fn require_creation_access(
    Extension(policy): Extension<CreationPolicy>,
    request: Request,
    next: Next,
) -> Response {
    let creation_endpoint = request.uri().path() == "/api/urls";
    let mut response = if request.method() == Method::POST
        && creation_endpoint
        && !policy.allows(request.headers())
    {
        (StatusCode::FORBIDDEN, "주소 생성이 허용되지 않았습니다.").into_response()
    } else {
        next.run(request).await
    };
    if creation_endpoint {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        response.headers_mut().insert(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        );
    }
    response
}
