use crate::server::AppState;
use dioxus::server::axum::{self, Router};
use std::{io, net::SocketAddr, time::Duration};
use tokio::{net::TcpListener, sync::oneshot, time::timeout};

/// Release lifecycle only; debug serving stays with Dioxus for hot reload.
pub async fn serve(router: Router, state: AppState, address: SocketAddr) -> io::Result<()> {
    // Install the signal handlers before announcing readiness through the listener.
    #[cfg(unix)]
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    #[cfg(unix)]
    let mut interrupt = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())?;
    let signal = async move {
        #[cfg(unix)]
        tokio::select! {
            _ = terminate.recv() => {},
            _ = interrupt.recv() => {},
        }
        #[cfg(not(unix))]
        tokio::signal::ctrl_c().await.expect("shutdown signal");
    };
    let listener = TcpListener::bind(address).await?;
    let (shutdown, requested) = oneshot::channel::<()>();
    let running = async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = requested.await;
            })
            .await
    };
    tokio::pin!(running);
    let result = tokio::select! {
        result = &mut running => result,
        _ = signal => {
            eprintln!("SERVER_SHUTDOWN_BEGIN");
            let _ = shutdown.send(());
            // Stop accepting new connections; finish existing requests with a bound.
            match timeout(Duration::from_secs(5), &mut running).await {
                Ok(result) => result,
                Err(_) => Err(io::Error::new(io::ErrorKind::TimedOut, "request drain timeout")),
            }
        }
    };
    // Do not initialize a pool just to shut down; close an existing pool after drain.
    if timeout(Duration::from_secs(2), state.close())
        .await
        .is_err()
    {
        eprintln!("SERVER_SHUTDOWN_POOL_TIMEOUT");
        return Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "pool close timeout",
        ));
    }
    result?;
    eprintln!("SERVER_SHUTDOWN_COMPLETE");
    Ok(())
}
