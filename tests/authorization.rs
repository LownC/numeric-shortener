#![cfg(feature = "server")]
use dioxus::server::axum::http::{HeaderMap, HeaderValue};
use numeric_shortener::authorization::{CreationPolicy, PROXY_SECRET_HEADER};

// Public test fixture only; actual local/runtime secrets are generated privately.
const TEST_SECRET: &str = "unit-test-only-secret-not-for-runtime-0123456789";

#[test]
fn configured_secret_allows_authorized_creation() {
    let policy = CreationPolicy::new(true, Some(TEST_SECRET));
    let mut headers = HeaderMap::new();
    headers.insert(PROXY_SECRET_HEADER, HeaderValue::from_static(TEST_SECRET));
    assert!(policy.allows(&headers));
}

#[test]
fn creation_fails_closed_without_valid_configuration_or_credentials() {
    let mut headers = HeaderMap::new();
    assert!(!CreationPolicy::new(true, Some(TEST_SECRET)).allows(&headers));
    headers.insert(PROXY_SECRET_HEADER, HeaderValue::from_static(TEST_SECRET));
    assert!(!CreationPolicy::new(false, Some(TEST_SECRET)).allows(&headers));
    assert!(!CreationPolicy::new(true, None).allows(&headers));
    headers.insert(PROXY_SECRET_HEADER, HeaderValue::from_static("wrong"));
    assert!(!CreationPolicy::new(true, Some(TEST_SECRET)).allows(&headers));
    assert!(!CreationPolicy::new(true, Some("wrong")).allows(&headers));
}

#[test]
fn duplicate_secret_headers_are_not_accepted() {
    let mut headers = HeaderMap::new();
    headers.append(PROXY_SECRET_HEADER, HeaderValue::from_static(TEST_SECRET));
    headers.append(PROXY_SECRET_HEADER, HeaderValue::from_static(TEST_SECRET));
    assert!(!CreationPolicy::new(true, Some(TEST_SECRET)).allows(&headers));
}
