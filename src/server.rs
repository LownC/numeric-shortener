use crate::{destination::validate_destination, protocol::CreateOutcome};
use sqlx::{
    postgres::{PgConnectOptions, PgPoolOptions},
    ConnectOptions, PgPool,
};
use std::{sync::Arc, time::Duration};
use tokio::sync::OnceCell;
use url::Url;

#[derive(Clone, Default)]
pub struct AppState(Arc<OnceCell<UrlService>>);

#[derive(Debug, PartialEq, Eq)]
pub enum LookupOutcome {
    Found(String),
    Missing,
    Unavailable,
}

impl AppState {
    pub async fn close(&self) {
        if let Some(service) = self.0.get() {
            if let Some(pool) = service.pool.get() {
                pool.close().await;
            }
        }
    }
    pub async fn ready(&self) -> bool {
        match self.service().await {
            Ok(service) => service.ready().await,
            Err(_) => false,
        }
    }
    async fn service(&self) -> Result<&UrlService, &'static str> {
        self.0
            .get_or_try_init(|| async { UrlService::from_env() })
            .await
    }

    pub async fn create(&self, input: &str) -> CreateOutcome {
        match self.service().await {
            Ok(service) => service.create(input).await,
            Err(reason) => {
                // Only fixed diagnostic text: never log connection strings or user input.
                eprintln!("M2_CONFIGURATION_ERROR: {reason}");
                CreateOutcome::Unavailable {
                    kind: "configuration".into(),
                    message: "서비스 설정이 준비되지 않았습니다. 관리자에게 문의해 주세요.".into(),
                }
            }
        }
    }

    pub async fn lookup(&self, id: i64) -> LookupOutcome {
        match self.service().await {
            Ok(service) => service.lookup(id).await,
            Err(reason) => {
                eprintln!("M3_CONFIGURATION_ERROR: {reason}");
                LookupOutcome::Unavailable
            }
        }
    }
}

pub struct UrlService {
    database: PgConnectOptions,
    public_base: String,
    public_host: String,
    pool: OnceCell<PgPool>,
}

impl UrlService {
    pub async fn ready(&self) -> bool {
        tokio::time::timeout(Duration::from_secs(3), async {
            let pool = self.connection_pool().await?;
            sqlx::query_scalar::<_, i64>("SELECT id FROM public.urls LIMIT 1")
                .fetch_optional(pool)
                .await
                .map(|_| ())
        })
        .await
        .is_ok_and(|result| result.is_ok())
    }
    pub fn from_env() -> Result<Self, &'static str> {
        let database = std::env::var("DATABASE_URL").map_err(|_| "DATABASE_URL missing")?;
        let base = std::env::var("PUBLIC_BASE_URL").map_err(|_| "PUBLIC_BASE_URL missing")?;
        Self::new(&database, &base)
    }

    pub fn new(database_url: &str, public_base: &str) -> Result<Self, &'static str> {
        let base = Url::parse(public_base).map_err(|_| "PUBLIC_BASE_URL invalid")?;
        if !matches!(base.scheme(), "http" | "https")
            || base.host_str().is_none()
            || !base.username().is_empty()
            || base.password().is_some()
            || base.path() != "/"
            || base.query().is_some()
            || base.fragment().is_some()
            || public_base.chars().any(char::is_control)
        {
            return Err("PUBLIC_BASE_URL must be an HTTP(S) origin");
        }
        let database = database_url
            .parse::<PgConnectOptions>()
            .map_err(|_| "DATABASE_URL invalid")?
            .disable_statement_logging();
        Ok(Self {
            database,
            public_base: base.as_str().trim_end_matches('/').into(),
            public_host: base.host_str().expect("host checked").into(),
            pool: OnceCell::new(),
        })
    }

    pub async fn create(&self, original_url: &str) -> CreateOutcome {
        let destination = match validate_destination(original_url, Some(&self.public_host)) {
            Ok(value) => value,
            Err(_) => return CreateOutcome::InvalidUrl {
                message: "공개 웹사이트의 HTTP(S) 주소를 입력해 주세요. 사용자 정보·제어문자·내부 주소는 허용하지 않으며 최대 8,192바이트입니다.".into(),
            },
        };
        let pool = match self.connection_pool().await {
            Ok(pool) => pool,
            Err(_) => return database_unavailable(),
        };
        // A single autocommitted statement. No MAX(id), lookup/dedup, or automatic retry.
        match sqlx::query_scalar::<_, i64>(
            "INSERT INTO public.urls (original_url) VALUES ($1) RETURNING id",
        )
        .bind(destination)
        .fetch_one(pool)
        .await
        {
            Ok(id) => CreateOutcome::Created {
                id: id.to_string(),
                short_url: format!("{}/{id}", self.public_base),
            },
            Err(_) => database_unavailable(),
        }
    }

    async fn connection_pool(&self) -> Result<&PgPool, sqlx::Error> {
        self.pool
            .get_or_try_init(|| async {
                PgPoolOptions::new()
                    .max_connections(8)
                    .acquire_timeout(Duration::from_secs(3))
                    .connect_with(self.database.clone())
                    .await
            })
            .await
    }

    pub async fn lookup(&self, id: i64) -> LookupOutcome {
        let pool = match self.connection_pool().await {
            Ok(pool) => pool,
            Err(_) => {
                eprintln!("M3_DATABASE_UNAVAILABLE");
                return LookupOutcome::Unavailable;
            }
        };
        match sqlx::query_scalar::<_, String>("SELECT original_url FROM public.urls WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
        {
            Ok(Some(destination)) => {
                // Defense against unexpected/corrupt DB values; preserve the stored string on success.
                if validate_destination(&destination, Some(&self.public_host)).is_err() {
                    eprintln!("M3_INVALID_STORED_DESTINATION");
                    LookupOutcome::Unavailable
                } else {
                    LookupOutcome::Found(destination)
                }
            }
            Ok(None) => LookupOutcome::Missing,
            Err(_) => {
                eprintln!("M3_DATABASE_UNAVAILABLE");
                LookupOutcome::Unavailable
            }
        }
    }
}

fn database_unavailable() -> CreateOutcome {
    eprintln!("M2_DATABASE_UNAVAILABLE");
    CreateOutcome::Unavailable {
        kind: "database".into(),
        message:
            "저장 결과를 확인할 수 없습니다. 저장됐을 수 있으므로 자동으로 다시 요청하지 않습니다."
                .into(),
    }
}
