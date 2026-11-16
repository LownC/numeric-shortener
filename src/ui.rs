use crate::api::{create_url, probe, ProbeReply};
use dioxus::prelude::*;
use numeric_shortener::protocol::CreateOutcome;

#[component]
pub fn App() -> Element {
    let read_only_demo = option_env!("SHORTENER_READ_ONLY_DEMO") == Some("true");
    let mut input = use_signal(String::new);
    let mut loading = use_signal(|| false);
    let mut created = use_signal(|| None::<String>);
    let mut error = use_signal(|| None::<String>);
    let mut copied = use_signal(|| None::<String>);
    let mut copying = use_signal(|| false);
    rsx! {
        document::Stylesheet { href: asset!("/assets/main.css") }
        main { class: "shell",
            section { class: "card",
                p { class: "eyebrow", "숫자로 간단하게" }
                h1 { "숫자 URL 서비스" }
                if read_only_demo {
                    p { class: "intro", role: "status", "현재 시연 환경에서는 주소 생성이 비활성화되어 있습니다." }
                } else {
                    p { class: "intro", "긴 웹 주소를 입력하고 나만의 숫자 주소를 만들어 보세요." }
                }
                form {
                    onsubmit: move |event| {
                        event.prevent_default();
                        let submit = !read_only_demo && !loading();
                        let submitted = input();
                        if submit {
                            loading.set(true); created.set(None); error.set(None); copied.set(None);
                        }
                        async move {
                            if !submit { return; }
                            match create_url(submitted).await {
                                Ok(CreateOutcome::Created { short_url, .. }) => created.set(Some(short_url)),
                                Ok(CreateOutcome::InvalidUrl { message }) | Ok(CreateOutcome::Unavailable { message, .. }) => error.set(Some(message)),
                                Err(ServerFnError::ServerError { code: 400 | 503, message, .. }) => error.set(Some(message)),
                                Err(_) => error.set(Some("요청 결과를 확인할 수 없습니다. 저장됐을 수 있으므로 자동으로 다시 요청하지 않습니다.".into())),
                            }
                            loading.set(false);
                        }
                    },
                    label { r#for: "url-input", "원본 URL" }
                    input {
                        id: "url-input", name: "original_url", r#type: "text", inputmode: "url",
                        placeholder: "https://example.com/a/long/address", autocomplete: "url",
                        value: "{input}", disabled: read_only_demo || loading(), aria_describedby: "url-help",
                        oninput: move |event| input.set(event.value()),
                    }
                    p { id: "url-help", class: "hint", "HTTP·HTTPS 주소만 사용할 수 있습니다. 같은 주소도 매번 새 번호가 만들어집니다." }
                    button { r#type: "submit", disabled: read_only_demo || loading(),
                        if loading() { "주소를 생성하고 있습니다…" } else { "숫자 주소 만들기" }
                    }
                }
                if loading() { p { role: "status", "저장 결과를 기다리고 있습니다." } }
                if let Some(message) = error() { p { class: "error", role: "alert", "{message}" } }
                if let Some(short_url) = created() {
                    section { class: "result", aria_label: "생성 결과",
                        p { class: "success", role: "status", "숫자 주소를 만들었습니다." }
                        label { r#for: "short-url", "생성된 단축 URL" }
                        input { id: "short-url", readonly: true, value: "{short_url}" }
                        button { class: "secondary", r#type: "button", disabled: copying(),
                            onclick: move |_| {
                                let text = created().unwrap_or_default();
                                copying.set(true); copied.set(None);
                                async move {
                                    let eval = document::eval(r#"
                                        const text = await dioxus.recv();
                                        try { await navigator.clipboard.writeText(text); return true; }
                                        catch (_) { return false; }
                                    "#);
                                    let success = eval.send(text).is_ok() && eval.join::<bool>().await.unwrap_or(false);
                                    copied.set(Some(if success { "주소를 복사했습니다." } else { "복사하지 못했습니다. 위 주소를 직접 선택해 복사해 주세요." }.into()));
                                    copying.set(false);
                                }
                            },
                            if copying() { "복사 중…" } else { "주소 복사" }
                        }
                        if let Some(message) = copied() { p { role: "status", "{message}" } }
                        a { class: "open-link", href: "{short_url}", target: "_blank", rel: "noopener noreferrer", "원본으로 이동" }
                    }
                }
                p { class: "note", "숫자 주소를 열면 원본 웹사이트로 이동합니다. 공개 웹사이트의 주소만 사용해 주세요." }
                details { class: "probe",
                    summary {
                        if read_only_demo { "서비스 연결 확인" } else { "개발 연결 확인" }
                    }
                    ProbePanel {}
                }
            }
        }
    }
}

#[component]
fn ProbePanel() -> Element {
    let mut input = use_signal(String::new);
    let mut loading = use_signal(|| false);
    let mut reply = use_signal(|| None::<ProbeReply>);
    let mut error = use_signal(|| None::<String>);
    rsx! {
        form {
            onsubmit: move |event| {
                event.prevent_default();
                async move {
                    if loading() { return; }
                    loading.set(true); error.set(None); reply.set(None);
                    match probe(input()).await {
                        Ok(value) => reply.set(Some(value)),
                        Err(_) => error.set(Some("서버에 연결하지 못했습니다. 서버 상태를 확인한 후 다시 시도해 주세요.".into())),
                    }
                    loading.set(false);
                }
            },
            label { r#for: "probe-input", "서버에 보낼 메시지" }
            input { id: "probe-input", r#type: "text", value: "{input}", disabled: loading(),
                oninput: move |event| input.set(event.value()),
            }
            button { r#type: "submit", disabled: loading(),
                if loading() { "서버 응답을 기다리는 중…" } else { "서버 연결 테스트" }
            }
        }
        div { class: "result", role: "status",
            if let Some(value) = reply() {
                p { class: "success", "{value.message}" }
                p { "보낸 메시지: {value.echo}" }
            } else if loading() { p { "요청을 보내고 있습니다." } }
        }
        if let Some(message) = error() { p { class: "error", role: "alert", "{message}" } }
    }
}
