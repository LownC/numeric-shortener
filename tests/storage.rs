#![cfg(feature = "server")]
use numeric_shortener::{protocol::CreateOutcome, server::UrlService};

#[tokio::test]
async fn duplicate_submissions_get_distinct_string_ids_in_postgres() {
    let service = UrlService::from_env().expect("dedicated M2 test configuration required");
    let first = service
        .create("https://example.com/m2-duplicate?q=1#x")
        .await;
    let second = service
        .create("https://example.com/m2-duplicate?q=1#x")
        .await;
    match (first, second) {
        (CreateOutcome::Created { id: a, .. }, CreateOutcome::Created { id: b, .. }) => {
            assert!(a.parse::<i64>().expect("numeric string") > 0);
            assert!(b.parse::<i64>().expect("numeric string") > 0);
            assert_ne!(a, b, "every submission creates a new mapping");
        }
        _ => panic!("both valid submissions must be committed"),
    }
}

#[tokio::test]
async fn database_failure_is_distinct_and_validation_does_not_require_a_connection() {
    let service = UrlService::new(
        "postgresql://m2_unreachable:unused@127.0.0.1:1/m2_unreachable",
        "http://127.0.0.1:18080",
    )
    .expect("syntactically valid local test configuration");
    assert!(matches!(
        service.create("http://127.1/").await,
        CreateOutcome::InvalidUrl { .. }
    ));
    match service.create("https://example.com/m2-db-failure").await {
        CreateOutcome::Unavailable { kind, message } => {
            assert_eq!(kind, "database");
            assert!(message.contains("저장됐을 수"));
        }
        _ => panic!("DB outage must be explicit without claiming nothing was saved"),
    }
}

#[test]
fn rejects_invalid_database_and_public_origin_configuration() {
    assert!(UrlService::new("not a database URI", "https://short.example").is_err());
    for base in [
        "ftp://short.example",
        "https://short.example/path",
        "https://short.example/?q=1",
        "https://short.example/#x",
        "https://user:pw@short.example/",
    ] {
        assert!(UrlService::new("postgresql://unused@localhost/test", base).is_err());
    }
}
