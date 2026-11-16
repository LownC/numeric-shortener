# 안전한 배포와 복구

기존 Cloudflare Worker·Railway 서버·PostgreSQL·영속 볼륨을 재사용합니다. 운영 DB 스키마와 기존 매핑은 변경하지 않습니다.

1. 계정 무료 정책·크레딧·기존 대상·현재 배포 버전·DO namespace와 migration을 읽기 전용으로 확인합니다.
2. 소스·버전·비밀 제외·테스트·SSG·Docker 빌드와 업로드 파일 해시를 확인합니다.
3. 생성 false 상태에서 Rust 수정본을 기존 서비스에 업로드합니다. 성공한 새 배포 ID, /healthz200, DB 연결·제한 역할을 확인합니다.
4. Worker의 새 코드·일치하는 자산을 생성 false로 배포합니다. 기존 Secret·DO 바인딩·creation-limiter-v1 이력을 보존합니다.
5. 제한 검증을 위해서만 양쪽 설정과 공유 비밀 정합성을 확인한 뒤 활성화합니다. 운영 테스트는 소수의 안전한 URL과 사전에 정한 요청 수로 수행합니다.
6. Worker를 먼저 false로 닫고 Railway도 false로 설정합니다. 설정 변경은 재빌드를 유발할 수 있어 새 deployment SUCCESS와 실제403을 모두 확인합니다.
7. 임시 키를 폐기하고 기존·추가 매핑 및 잔액을 확인합니다. 장기 공개 생성은 별도 결정입니다.

## 운영 환경

Rust: IP=0.0.0.0, Railway PORT, APP_ENV=production, 제한 앱 DATABASE_URL, Cloudflare PUBLIC_BASE_URL, CREATE_URLS_ENABLED=false, 공유 PROXY_SHARED_SECRET. RAILWAY_DEPLOYMENT_DRAINING_SECONDS=10.

Worker: LOCAL_DEV=false, Railway HTTPS UPSTREAM_ORIGIN, CREATE_URLS_ENABLED=false, Secret PROXY_SHARED_SECRET. 정적 자산 ASSETS와 SQLite 클래스 CreationLimiter의 CREATION_LIMITER 바인딩이 필요합니다.

운영 DB 관리자 계정·마이그레이션 비밀은 앱·Worker에 넣지 않습니다. 토큰은 사용자 숨김 입력에서 메모리로만 받고 해당 공급자의 필요한 프로세스/HTTPS 요청에만 전달합니다. 공개 저장소에는 개인 계정에 고정된 인증·운영 도구와 과거 비공개 증거를 포함하지 않습니다.

## 복구

새 빌드·migration이 실패하면 활성화하지 않습니다. 활성 검증 중 문제가 생기면 Worker 생성 false를 우선 적용하고, Railway false도 독립적으로 시도합니다. 설정 반영과 실제403은 별도 확인합니다.

DO migration·SQLite 상태는 코드 버전과 별개입니다. 이전 코드 복구가 migration을 취소하지 않습니다. 기존 CreationLimiter export·binding·namespace·migration 이력을 보존하는 호환 가능한 수정 배포를 우선합니다. DO 삭제, 상태 초기화, deleted_classes, 운영 데이터 삭제·DB 재생성은 복구 수단으로 쓰지 않습니다.

## 비용

Cloudflare Free의 Workers·SQLite DO 무료 범위를 사용합니다. 한도에 도달하면 실패·제한될 수 있으며 유료 전환을 자동 승인하지 않습니다. Railway Trial 크레딧과 기간은 계정에서 확인해야 합니다. 월 무료 크레딧만으로 서버+DB 상시 실행을 보장하지 않습니다. 생성 API가 닫혀도 기존 서버·DB·볼륨은 비용을 소비할 수 있습니다.

공식 확인: [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/), [SQLite DO 요금](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Railway Trial](https://docs.railway.com/pricing/free-trial), [Railway Project Token](https://docs.railway.com/integrations/api).
