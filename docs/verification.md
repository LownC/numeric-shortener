# 검증 기록

확인일: 2026-11-16. 요청 모델: GPT-6.1-sol / High. 실제 선택된 모델 ID와 Reasoning 설정은 도구로 확인할 수 없어 미확인입니다.

## 현재 수정본 로컬 검증

| 검사 | 결과·근거 |
|---|---|
| HTTP400 결함 red/green | 수정 전 실제 /api/urls 빈 값200 재현, 수정 후 빈 값·스킴·호스트·내부 주소·제어문자·길이400 |
| DB 연결 실패 | 합성 도달 불가 DB에서 생성503, code503 |
| Rust | server feature 테스트15개 PASS, 무시0; 실제 임시 PostgreSQL 연결 사용 |
| fmt·Clippy | PASS; 증분 캐시 hardlink 경고는 CARGO_INCREMENTAL=0 검사에서 제거 |
| Worker | 19개 PASS, 429/503 no-store·nosniff 및 upstream 미호출 |
| TypeScript | Worker와 Railway 선언 타입 검사 PASS |
| 실제 로컬 SQLite DO | IP5회/6번째429, 재시작 후 상태 유지, 서로 다른 IP 동시30→20허용/10거절 PASS |
| PostgreSQL 통합 | 중복 URL 별도 ID·동시32개·최소 권한·불변성 PASS |
| 숫자 이동 | 실제 HTTP58개 검사 및 TRACE/CONNECT 직접 서버405 PASS |
| 재시작·장애 | 서버 재시작 매핑36개 유지, DB 중단503, DB 재시작 후302/404복구 PASS |
| SSG | 활성 UI와 비활성 UI HTML·JS·Wasm·CSS 빌드 PASS |
| Wrangler | 실제 소스 dry-run·CreationLimiter export·SQLite migration 선언 PASS |
| Docker | Linux 이미지 numeric-shortener:final-verify 빌드 PASS |

로컬 전체 통합 테스트는 PostgreSQL17.11의 별도 임시 컨테이너·볼륨을 사용했습니다. 기존 로컬 DB는 시작·재생성하지 않았고 운영 DB에 접속하지 않았습니다. 운영 PostgreSQL18과의 차이는 운영 배포 검증에서 따로 확인합니다. 실제 로컬 DO 검사는 mock과 구분됩니다.

## 운영 검증 상태

이전 M5-B2에서 생성4건과 기존302·HTTPS·403·404·405·429, 브라우저 hydration·복사·다른 브라우저 이동을 검증한 기록이 있습니다. 당시 잘못된 URL은 HTTP200이어서 결함으로 기록됐습니다. 이 결과를 현재 수정본의 운영 PASS로 표시하지 않습니다.

현재 수정본의 Railway·Cloudflare 배포 및 제한 운영 검증은 아래와 같이 완료했습니다. 검증 후 양쪽 생성을 다시 비활성화했습니다. 제출용 장기 공개 생성은 별도 승인 전이며 기존 데이터와 스키마를 보존합니다.

2026-11-16 읽기 전용 계정 화면: Railway Trial25일/$4.90, 서버·Postgres Online. Cloudflare 오늘 Worker123/100,000 표시. 통계는 지연·반올림될 수 있어 비용0을 의미하지 않습니다. 현재 수정본의 운영 데이터·비용·버전 확인은 작업 완료 시 갱신합니다.

## 잔여 승인·미검증

- 제출에 필요한 장기 공개 익명 생성은 사용자 추가 승인 전 비활성으로 유지합니다.
- 운영 DB 장애 주입·재시작·UPDATE/DELETE 공격·글로벌20 초과 운영 부하는 NOT RUN으로 유지합니다.
- 운영 요청별 upstream trace·정확 청구액은 미확인입니다.
- 생성 비활성 상태만으로 DO 내부 정상 동작이나 활성 생성 성공을 입증하지 않습니다.


## 독립 코드 검수

### Standards

빈 트리 대비 공개 후보64개 파일을 검토했습니다. 문서 기준 위반0건, 실질적 코드 냄새 지적0건입니다. 읽기 전용 검수이며 별도 테스트 통과를 뜻하지 않습니다.

### Spec

현재 사용자 명세 대비 지적0건입니다. HTTP400/503, UI 오류 처리, DB 권한, IDENTITY·중복 입력 새 ID,302, Worker·DO 제한과 실패 차단,README를 확인했습니다. 운영 미실행 항목은 위의 NOT RUN 상태를 유지합니다.

## 2026-11-17 재개 확인

- 공개 HTTPS에12회 한정 요청: 양쪽 /healthz200·생성403,숫자400/404/405,기존4개 정확한302 PASS. INSERT 없음.
- Railway 런타임 조회: CREATE_URLS_ENABLED=false,앱 역할shortener_app,공유 비밀 존재,종료 유예10초 확인. 비밀 원문은 조회·기록하지 않았습니다.
- Worker 설정 조회: 생성false·LOCAL_DEV=false·공유 비밀과CREATION_LIMITER 존재 확인.
- Linux Docker 실제 실행: 잘못된 생성400·비밀 없는 직접 생성403,두 번의SIGTERM 종료code0·OOMKilled=false,각679ms/651ms PASS. DB볼륨을 사용하지 않은 격리 실행입니다.
- 코드·문서 후보64개 파일의 공개 전 비밀 패턴 검사 PASS. 테스트 전용 공개 합성문자열은 실제 비밀과 구분했습니다.

## 2026-11-17 실제 운영 배포·제한 검증

| 항목 | 결과 |
|---|---|
| Railway Docker·SSG·실행·헬스체크 | PASS, 코드 배포 c8abcc91, 제한 활성 e33226a2, 재차단 재배포 8b313cf6 |
| Cloudflare 실제 배포 | PASS, 제한 활성 dd93e189, 재차단 031864ec,각100% |
| 바인딩·migration | 기존 CreationLimiter·CREATION_LIMITER·ASSETS 및 creation-limiter-v1 유지,기존 SQLite namespace 동일 |
| 정적 자산 | 공개 HTML·CSS·JS·Wasm 네 파일이 검증 묶음 SHA256과 일치,SSG hydration 데이터·서버 echo200 확인 |
| 잘못된 원본 URL | 빈 값·스킴·호스트·내부 주소·제어문자·8192바이트 초과 모두 실제 HTTP400/code400 |
| 요청 제한 | 5회 허용 후6번째429,Retry-After57초·no-store·nosniff PASS;거절 요청은 매핑을 만들지 않음 |
| 정상 생성 | 시크릿 UI5번,실제 API HTTP200/created6번;같은 원본에 새 ID 발급 |
| 브라우저·오류 안내 | Chrome 시크릿 사용자 수동 PASS;자동 도구는 연결 불가·사생활 검사로 미실행 |
| 클립보드 | 사용자 메모장 대조와 실제 OS 클립보드의 공개 /5 값 확인 PASS;mock과 구분 |
| 다른 브라우저 | 별도 앱 내 브라우저에서 /5→IANA 원본,경로·쿼리·프래그먼트 보존 PASS |
| 302·400·404·405 | 실제 HTTP PASS;302는 정확한 Location·no-store·빈 본문 확인 |
| 직접 Railway 접근 | 비밀 없음·위조 비밀 모두403 PASS |
| 재차단 | CF 먼저false,새 Railway 배포 완료와 올바른 비밀을 포함한403 관측,실제 런타임false 확인 |
| 운영 DB | READ ONLY 조회로 총6건,기존1~4번 원본 동일,신규5·6번만 추가,소유자 유지·스키마 변경 없음 |
| 재시작 영속성 | 재차단 서버 재배포 후1~6번 모두 정확한302 PASS;운영 DB 자체 재시작은 하지 않음 |
| 공개 GitHub | 비로그인 API에서 Public·main/develop·64개 소스·README와 예시 설정 확인 PASS |

302 검증 첫 시도는 빈 본문 응답에도 nosniff를 요구한 테스트 조건 때문에 멈췄습니다. 기존302 계약은 빈 본문·Location·no-store이므로 테스트만 수정하고 읽기 요청으로 재검증했습니다. 실제 응답 본문이 있는400·403·429·503의 보안 헤더 검사는 유지했습니다. 최초 실패와 재검증 결과를 구분해 기록하며 추가 정상 생성 POST를 반복하지 않았습니다.

운영 HTTP 검증 장부27/32회,새 매핑2/2건입니다. 이 장부와 별도로 배포 전후 정적 자산·헬스체크·브라우저·세션 보호 확인 요청이 있었으며,브라우저 전체 네트워크의 정확 총합은 미측정입니다. 대량 부하나 제한 우회는 하지 않았습니다. 글로벌20 초과 운영 시험·운영 DB/DO 장애 주입은 NOT RUN이며 실제 로컬 검증과 구분합니다.

## 무료 이용·남은 결정

Cloudflare 계정 Free $0를 확인했고,화면의 오늘 요청은135→175/100,000이었습니다. Railway는 Trial25일·$4.90 표시를 유지했습니다. 통계 지연·반올림과 기존 서버·DB·볼륨의 지속 소비가 있으므로 비용0으로 단정하지 않습니다. 유료 플랜·결제수단·추가 클라우드 서비스 변경은 하지 않았습니다.

현재 기본 종료 상태는 양쪽 생성false입니다. 공개 저장소와 기존 숫자 주소는 접근할 수 있지만,최종 과제의 익명 생성 조건은 제출용 공개 활성화 승인·반영 전까지 미충족입니다. 임시 배포 키 두 개는 마지막 결정 이후 폐기할 예정이며 비밀 원문을 문서·Git·로그에 넣지 않았습니다.
