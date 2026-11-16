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

현재 수정본의 Railway·Cloudflare 배포와 HTTP400·생성 재검증은 **NOT RUN / 인증 준비 필요**입니다. 기존4개 매핑을 수정하거나 삭제하지 않습니다. 공개 생성의 기본 종료 상태는 양쪽false입니다.

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
