# 구조와 데이터 계약

단일 Cargo 프로젝트에 Dioxus UI·Server Function과 Rust 서버 모듈이 있습니다. UI는 SSG HTML과 Wasm으로 Cloudflare에 배포하고, API와 숫자 주소 조회는 Railway 서버가 처리합니다.

| 위치 | 역할 |
|---|---|
| src/api.rs | /api/urls, /api/probe, SSG 경로 Server Function |
| src/ui.rs | URL 생성·오류 안내·클립보드 |
| src/destination.rs | 원본 URL 검증과 정규화 |
| src/server.rs | SQLx 연결과 INSERT RETURNING |
| src/authorization.rs | 생성 플래그·공유 비밀·응답 보안 헤더 |
| src/redirect.rs | 숫자 ID 파싱·SELECT·302/404/400/503/405 |
| src/lifecycle.rs | SIGTERM 수신·수신 종료·요청 drain·pool close |
| edge/worker.ts | 정적 자산·프록시·생성 보안·요청 제한 호출 |
| edge/creation-limiter.ts | 단일 글로벌 SQLite DO의 원자적 카운터 |
| migrations/0001_urls.sql | IDENTITY와 앱 최소 권한 |

생성 흐름: 브라우저 POST /api/urls → Worker 생성 플래그·보안/크기 검사 → 신뢰할 수 있는 CF-Connecting-IP 확인 → DO 검사 → 비밀 헤더를 추가해 Rust로 전달 → Rust 생성 플래그·상수시간 비밀 비교 → URL 검증 → PostgreSQL INSERT RETURNING → 생성 결과. 임의 X-Forwarded-For와 사용자가 보낸 비밀 헤더는 신뢰하지 않습니다.

오류 URL은 INSERT 전에 거절하고 ServerFnError code400으로 HTTP400을 보냅니다. DB 연결/저장 실패는503입니다. 제한기는 60초 고정 창으로 IP5·전체20을 함께 검사하며, 하나라도 거절하면 두 카운터 모두 증가하지 않습니다. 동기 SQLite 트랜잭션 안에 비동기 대기를 넣지 않습니다. 제한 초과429, 제한기 누락·장애·2초 timeout503이며 이때 Railway 생성 호출은 없습니다.

이동 흐름: GET /숫자 → Rust 파싱 → 앱 역할 SELECT → 302와 정확한 Location. 없는 ID404, 잘못된 ID400, DB 실패503입니다. Worker는 redirect:manual을 사용합니다. 프래그먼트는 서버에 수신되는 단축 URL 요청의 일부가 아니라 저장된 원본 Location의 일부로 전달됩니다.

매핑은 앱 권한으로 수정·삭제할 수 없습니다. 운영 관리자·테이블 소유자는 별도 신뢰 경계입니다. DB migration은 앱 시작 시 실행하지 않습니다.
