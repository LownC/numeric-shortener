mod api;
mod ui;
use ui::App;

fn main() {
    #[cfg(feature = "server")]
    {
        let state = numeric_shortener::server::AppState::default();
        let creation_policy = numeric_shortener::authorization::CreationPolicy::from_env();
        let shutdown_state = state.clone();
        let router_factory = move || {
            let state = state.clone();
            let creation_policy = creation_policy.clone();
            async move {
                use dioxus::server::{
                    axum::{
                        self,
                        response::Html,
                        routing::{any, get},
                    },
                    DioxusRouterExt, FullstackState, IncrementalRendererConfig, ServeConfig,
                };
                let public = std::env::current_exe()?
                    .parent()
                    .expect("executable parent")
                    .join("public");
                let config = ServeConfig::new().incremental(
                    IncrementalRendererConfig::new()
                        .static_dir(&public)
                        .clear_cache(false),
                );
                // A completed SSG page is not an empty SSR template. Rendering
                // into it again duplicates both the app and its hydration data.
                let prerendered = std::fs::read_to_string(public.join("index.html"))
                    .ok()
                    .filter(|index| {
                        index.contains("<script>window.initial_dioxus_hydration_data=")
                    });
                let root = if let Some(index) = prerendered {
                    get(move || {
                        let index = index.clone();
                        async move { Html(index) }
                    })
                } else {
                    get(FullstackState::render_handler)
                };
                Ok::<_, std::io::Error>(
                    axum::Router::new()
                        .route("/", root)
                        .route("/{id}", any(numeric_shortener::redirect::resolve))
                        .route("/healthz", get(numeric_shortener::readiness::healthz))
                        .register_server_functions()
                        .serve_static_assets()
                        .with_state(FullstackState::new(config, App))
                        .layer(axum::middleware::from_fn(
                            numeric_shortener::authorization::require_creation_access,
                        ))
                        .layer(axum::Extension(creation_policy))
                        .layer(axum::Extension(state)),
                )
            }
        };
        #[cfg(debug_assertions)]
        {
            // Preserve Dioxus CLI hot reload in local development.
            let _ = shutdown_state;
            dioxus::server::serve(move || {
                let router = router_factory();
                async move { Ok(router.await?) }
            });
        }
        #[cfg(not(debug_assertions))]
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("server runtime")
            .block_on(async move {
                let router = router_factory().await.expect("server router");
                let address = dioxus::cli_config::fullstack_address_or_localhost();
                numeric_shortener::lifecycle::serve(router, shutdown_state, address)
                    .await
                    .expect("server lifecycle");
            });
    }
    #[cfg(not(feature = "server"))]
    dioxus::launch(App);
}
