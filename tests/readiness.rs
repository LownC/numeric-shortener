#![cfg(feature = "server")]
use numeric_shortener::server::UrlService;

#[tokio::test]
async fn readiness_checks_the_real_schema_using_the_restricted_role() {
    let service = UrlService::from_env().expect("isolated local DB configuration");
    assert!(service.ready().await);
}

#[tokio::test]
async fn unavailable_database_is_not_ready() {
    let service = UrlService::new(
        "postgresql://test:unused@127.0.0.1:1/unreachable",
        "http://127.0.0.1:18787",
    )
    .expect("local test config");
    assert!(!service.ready().await);
}
