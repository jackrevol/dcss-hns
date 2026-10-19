# PC 원본 메인 메뉴 통합 작업 인수인계

## 2026-10-19 CI 캐시·병렬 빌드 최적화

- WASM의 데이터 식별자를 파일 시각에서 배포되는 dat/docs의 경로·내용 해시로 변경했습니다. WASM에 넣지 않는 dat/tiles는 제외하며, 타일은 기존 전체 빌드 ID로 검사합니다.
- 데이터 식별자는 `files.o`에만 컴파일 옵션으로 넣습니다. 시각만 바뀌면 재컴파일하지 않고, 내용이 바뀌면 해당 객체와 링크만 갱신합니다. 같은 초의 변경도 감지하며 `make -q`가 갱신 상태를 소비하지 않습니다. prewarm 식별자는 WASM 해시도 포함합니다.
- PC 네이티브 컴파일을 WASM과 동시에 시작하고 tar 아티팩트로 전달합니다. 패키징은 `--prebuilt-native`로 컴파일을 생략하며 커밋·버전·플랫폼·CPU·필수 경로를 검사합니다. 네이티브 작업의 실패·생략·취소도 릴리즈를 막습니다. 새 옵션을 지원하지 않는 기존 태그는 종전 컴파일·패키징 경로를 사용합니다.
- 네이티브 컴파일 단계에는 npm 설치가 필요하지 않고, 패키징 단계에는 C++ 도구·서브모듈이 필요하지 않습니다. WASM·PC 빌드 체크아웃도 필요한 커밋으로 줄였습니다.
- 문법 검사, 실행 계획·릴리즈 차단·네이티브 검증 15개와 데이터 식별자·실제 Make 증분 빌드 검사 6개를 통과했습니다. macOS에서 SDL 컴파일 → tar 왕복 → 재컴파일 없는 패키징 → 실제 SDL 메뉴 68단계와 Android 세이브 왕복을 통과했습니다.
- 전체 WASM 빌드와 Windows/Linux/macOS Intel, 실제 속도 단축 폭은 원격 CI에서 확인해야 합니다. 첫 실행은 새 캐시를 채우며 재실행부터 캐시 적중률과 전체 시간을 비교합니다. 기존 CI의 실제 WASM으로 새 prewarm 생성 방식을 실행해 579개 캐시 파일 생성을 확인했습니다.

## 2026-10-19 GitHub Actions 통합

- `ci.yml`의 **DCSS HNS** 하나로 검사·WASM·Android·PC·릴리즈를 연결하고, 별도 `mobile.yml`·`release.yml`을 제거했습니다. `workflow_run`으로 다른 실행을 연쇄 호출하지 않습니다.
- 일반 실행은 배포 플랫폼과 GCC/Clang·MSVC 대표 조합, C++ 단위 테스트를 검사합니다. 원본 전체 조합·헤더·범용 macOS·MinGW·레거시 Android·웹 서버·문서 검사는 수동 `extended`로 보존했습니다.
- UI·클라우드 검사를 먼저 수행하며 WASM·웹 빌드는 한 번만 실행합니다. 검증한 웹 결과로 APK를 만들고, PC에는 버전 정보·테스트 세이브만 전달해 4개 플랫폼을 병렬 패키징합니다. 릴리즈는 이 실행의 파일을 그대로 게시합니다.
- SDK·npm·Gradle·컴파일 캐시, 문서 변경의 패키징 생략, PR 이전 실행 취소를 추가했습니다. master·수동 릴리즈는 순서대로 실행해 버전 선택이 겹치지 않게 합니다.
- 모든 단계의 결과를 모으고 실패·취소·필수 작업의 누락이 있으면 게시를 막습니다. PR에서는 게시하지 않습니다. 수동 `publish` 해제로 빌드만 할 수 있고, 기존 태그도 정확한 커밋으로 재빌드합니다.
- `actionlint`와 실행 계획·릴리즈 차단 테스트 11개를 로컬에서 통과했습니다. 원격 전체 빌드 결과와 소요 시간은 새 워크플로 실행에서 확인해야 합니다.

## 2026-10-19 PC 클라우드 메뉴·자동 저장 추가

- 클라우드 주 메뉴를 `Local -> Cloud (upload)`, `Cloud -> Local (download)`로 정리했습니다. 계정·로그아웃·복구 사본·잠금 해제는 `Account / recovery`에 모았고 별도 기기 연결과 충돌 파일별 선택을 제거했습니다.
- PC에서 로그인하면 자동으로 계정을 연결합니다. 앱 시작 전 변경 내역과 원래 저장 시각을 비교하여 최신 진행을 내려받거나 업로드합니다. 네트워크 확인은 4초 후 취소하며 실패해도 로컬로 시작합니다. 플레이 중에는 원본 SDL의 1분 주기·창 전환 체크포인트를 업로드하고 종료 시 다시 동기화합니다. 플레이 중인 로컬 파일에는 다운로드하지 않습니다.
- 양쪽에서 같은 파일을 변경했으면 원래 저장 시각을 비교합니다. 시각이 같거나 유효하지 않거나 삭제와 진행이 충돌하면 두 사본을 보존하고 수동 방향 선택을 기다립니다. 수동 복사는 확인 후 선택한 쪽의 전체 세이브로 목적지를 교체하며 자동 병합하지 않습니다.
- 네이티브 폴더에 파일을 복사할 때 수정 시각을 보존했습니다. 앱 시작·다운로드 자체가 과거 세이브를 최신으로 보이게 하지 않습니다.
- 플랫폼·UI 변경에 따른 빌드 해시 차이는 원본 엔진의 읽기 전용 `-save-version`으로 실제 저장 형식을 검사합니다. 호환되는 이전 저장은 허용하며, 더 새로운 형식이나 잘못된 파일은 차단합니다. 사용자 파일은 일회용 폴더에서 검사한 뒤 삭제합니다. 서버 스키마와 저장 팩 형식 변경은 없습니다.
- 단위 테스트 1,749개 통과(18개 건너뜀), 타입 검사·모바일 UI·PC 서비스 빌드 통과. macOS 패키지의 SDL 메뉴 68단계, 자동 업로드·수동 양방향 복사·취소, Android 백업 호환·잘못된 세이브 차단 검사를 통과했습니다. 서버 요청은 일회용 프로필에서 모의 응답으로 처리합니다.
- 최종 macOS 앱을 실제 사용자 프로필로 실행해 기존 계정의 클라우드 세이브가 시작 시 자동으로 내려와 캐릭터 목록에 표시되고, F7에 `Automatic cloud saves: up to date`가 표시되는 것을 확인했습니다. 앱은 실행 상태로 두었습니다.
- 빌드 결과는 `mobile/build/desktop-cloud-final/DCSS-HNS-0.35-a0-hns.1-mac-arm64.zip`입니다. `HNS_DESKTOP_OUTPUT`으로 실행 중인 앱을 교체하지 않고 별도 결과 폴더에 빌드할 수 있습니다.
- 클라우드 변경과 아래 CI 수정을 함께 master에 반영합니다. Windows/Linux 및 macOS Intel 결과는 GitHub Actions에서 확인합니다. 아래 오전 기록의 `f258333432` 작업은 이미 master 병합·push했습니다.

## 2026-10-19 GitHub Actions 실패 수정

- Build 실행 `39183468631`의 실패 로그에서 Android의 PC 메뉴 참조, MSVC의 메뉴 소스 누락, `unbrace` 위반을 확인했습니다. PC 전용 시작 메뉴를 Android에서 제외하고 MSVC 프로젝트·필터에 메뉴 소스와 헤더를 등록했으며 스타일을 정리했습니다.
- Mobile Android 실행 `39183468701`은 무작위 시작 지형에서 Executioner를 놓을 공간이 없어 실패했습니다. 원본 위저드 DLua로 주변 바닥을 준비한 뒤 실제 전투·사망·부활을 검증하며, 기존 검증은 유지합니다.
- 로컬 `checkwhite`·`unbrace`, 모바일 UI 빌드와 실제 WASM의 생성·전투·부활·체크포인트·백업 왕복 검사를 통과했습니다. WASM은 이전 성공 CI의 엔진 아티팩트를 사용했고, 새 엔진 빌드는 push 후 CI에서 확인합니다.

## 2026-10-19 재개 결과

- PC 백업 파일명의 `pocketzot-offline` 표시와 잘못된 백업의 PocketZot 오류 문구를 제거했습니다. 백업은 `dcss-hns-YYYY-MM-DD.pzsave`로 저장하며 기존 형식과 호환됩니다.
- 화면 없는 PC 서비스에 불필요한 웹용 로고·폰트 복사를 제거했습니다. SDL 엔진의 원본 타일·폰트는 그대로 포함합니다. 저작권·라이선스 고지와 저장 형식의 호환성 상수는 유지합니다.
- PC Vite 빌드에서 모바일 화면·게임 UI·CSS·WASM 혼입을 차단하고, 배포 검사에서 서비스 파일 목록과 모바일 진입점 미포함을 확인합니다.
- 이전 SDL 검사 실패 원인을 재현했습니다. 원본 `Loading complete, press any key to start.` 화면에서 F2를 찾고 있었습니다. 검사 드라이버에 Enter 입력을 추가하여 원본 타이틀 화면을 통과합니다. 일반 게임의 시작 동작은 변경하지 않습니다.
- 네이티브 오류의 stdout도 검사 로그에 남깁니다. 메뉴 요청은 종류만 기록하며 비밀번호가 포함된 요청 본문은 기록하지 않습니다. `HNS_DESKTOP_KEEP_TEST_PROFILE=1`로 임시 프로필을 보존할 수 있습니다.
- macOS Apple Silicon에서 앱·배포 ZIP 생성, 개발 모드 메뉴 검사와 **패키징된 앱의 `npm run test:desktop` 39단계**가 통과했습니다. Android CI의 `HnsSmoke` 백업 복원, 캐릭터 목록 갱신, 드랍·RC 반영, 재수출한 캐릭터 세이브의 바이트 일치를 확인했습니다. 메인·드랍·옵션·기록·클라우드·로그인 스크린샷을 확인했고 비밀번호가 가려집니다.
- 전체 단위 테스트: 120개 파일·1,721개 테스트 통과, 1개 파일·18개 테스트 건너뜀. 타입 검사와 모바일 UI 빌드도 통과했습니다.
- 결과물: `mobile/build/desktop/DCSS-HNS-0.35-a0-hns.1-mac-arm64.zip`. 생성물은 추적하지 않습니다.
- **오전 재개에서 Windows/Linux 및 macOS Intel 빌드·CI와 실제 서버의 클라우드 로그인·동기화는 실행하지 않았습니다. 해당 변경은 이후 master 병합·push했습니다.** 아래 실패 로그와 미해결 목록은 중단 당시 기록이며, SDL 메뉴 검사 실패는 위와 같이 해결했습니다.

## 2026-10-18 중단 당시 기록

작성: 2026-10-18 (한국 시간). 작업 브랜치: `codex/pc-native-main-menu`.
기준 커밋: `4165da074054cc955ec4736a612a2d1d357a8761` (`master`).

**중단 당시에는 Windows 빌드 성공 후 실제 SDL 메뉴 통합 검사가 실패한 상태였습니다.**
사용자 요청으로 오늘 작업을 종료하고, 다른 컴퓨터에서 이어갈 수 있도록 코드와 알려진 문제를 보관합니다.

## 반드시 유지할 사용자 요구사항

- Windows/Linux/macOS PC 클라이언트는 원본 DCSS의 UI, 키보드·마우스 조작을 사용합니다.
- 드랍 설정, 옵션 파일, 기록/영안실, 세이브 백업·복원, 클라우드 기능을 원본 메인에서 직접 엽니다.
- 별도 관리 창이나 모바일 로비를 거치지 않습니다. PC에서는 오류 상황에도 모바일 화면이 나타나면 안 됩니다.
- 원본을 전부 새로 만드는 작업은 아닙니다. 기존 원본 메뉴·위젯·아이콘 스타일에 추가 기능을 통합합니다.
- 드랍·저장·클라우드의 기존 기능과 저장 형식은 유지합니다.
- 릴리즈 버전은 사용자가 선택한 `0.35-a0-hns.1` 형식으로 원본 개발 버전을 유지합니다.

## 이번 브랜치에 구현한 내용

- `crawl-ref/source/startup.cc`: 원본 시작 화면에 F2 드랍, F3 옵션, F4 기록/영안실, F5 백업, F6 복원, F7 클라우드 버튼을 배치했습니다. 원본 아이콘을 사용하며 변경 후 같은 창에서 목록과 옵션을 다시 읽습니다.
- `crawl-ref/source/hns-desktop-menu.cc`: 원본 SDL 위젯을 사용하는 드랍 입력, RC 편집, 기록 조회/삭제/내보내기, 백업, 클라우드 계정·동기화·충돌·복구 메뉴입니다. 원본 폰트에 맞춰 메뉴는 영어이며 비밀번호 입력은 가립니다.
- `mobile/src/platform/desktop-actions.ts`: 기존 드랍/RC, IndexedDB, `.pzsave`, 기록 및 클라우드 기능을 네이티브 메뉴 요청에 연결합니다.
- `mobile/desktop/native-session.ts`, `mobile/src/platform/native-game.ts`: SDL 요청을 stdout 파이프로 받고 숨겨진 서비스에서 처리합니다. 세이브 반영 확인, 소유권 잠금, 비정상 종료 복구 저널을 추가했습니다. 비밀번호 원문은 요청 파일에 기록하지 않습니다.
- `mobile/desktop/main.cjs`, `mobile/src/platform/desktop-service.ts`: Electron은 화면 없는 저장 서비스로만 실행합니다. 모바일 로비를 표시하는 경로를 제거했습니다. 파일 선택은 운영체제 대화상자를 사용합니다.
- `mobile/vite.desktop.config.ts`, `mobile/desktop-service.html`, `mobile/scripts/build-desktop.mjs`: PC 전용 서비스 번들을 패키징합니다. 모바일 HTML·CSS·UI 번들은 PC 패키지에서 제외합니다.
- 기존 `mobile/src/views/desktop-manager.ts`, `desktop.css`를 삭제하고 모바일 `app.ts`의 PC 관리 화면 분기를 제거했습니다.
- SDL 내부 위젯 검사와 스크린샷을 위한 테스트 전용 코드를 `windowmanager-sdl.cc`에 추가했습니다. `HNS_DESKTOP_UI_TEST`가 있을 때만 작동하며 테스트 SDL 창은 숨깁니다.

## 검증 결과와 미해결 문제

- 전체 단위 테스트의 마지막 실행: 120개 파일 통과, 1개 건너뜀 / 1,721개 테스트 통과, 18개 건너뜀. 이후 수정은 주로 통합 검사 진단 및 테스트 창 숨김 처리입니다.
- 종료 전 재검사: `npm run typecheck`, JS 구문 검사 통과. `desktop/native-session.test.ts`, `src/platform/native-game.test.ts`, `src/platform/desktop-actions.test.ts`의 15개 테스트 통과.
- Windows SDL 컴파일 및 PC 압축 파일 생성 성공. 생성물은 추적하지 않습니다.
- 원본 메인에 여섯 버튼이 보이는 스크린샷을 한 번 확보했습니다. 로컬 경로는 `mobile/test-results/native-menu/main.png`이며 Git에는 포함하지 않았습니다.
- **`npm run test:desktop-menu`는 실패합니다.** 패키지 실행에서는 보고서 생성 없이 제한 시간 초과가 발생했고, 마지막 개발 모드 실행에서는 네이티브 프로세스가 종료 코드 1로 끝났습니다. 원인은 아직 확인하지 못했습니다.

마지막 실패의 핵심 로그:

```text
Failed to load resource: the server responded with a status of 404 (Not Found)
게임 창이 종료되었습니다. 저장된 진행은 보존했습니다. 앱을 다시 실행해 주세요.
Native started: 24792
Native exited: 1
AssertionError [ERR_ASSERTION]: Native menu test stopped before completion
```

`Menu action:` 로그와 완료 보고서가 없었습니다. 네이티브 초기화/종료 원인, 테스트 드라이버 진입 여부, 서비스 요청 연결을 확인해야 합니다.
404는 테스트가 모바일 `/index.html`의 미포함을 확인하면서 의도적으로 발생시킬 수 있습니다. **원인 확인 없이 모바일 HTML을 PC에 다시 넣지 마세요.**
`test:desktop`도 이 메뉴 검사를 포함하므로 현재 통합 검사가 통과한다고 가정하면 안 됩니다.
테스트의 임시 프로필은 종료 시 삭제됩니다. 실패 진단은 콘솔의 `.progress`, `.stderr` 내용을 먼저 확인하고, 추가 진단이 필요하면 임시 프로필 보존 옵션을 구현하세요.

## 다른 컴퓨터에서 재개

```sh
git clone --branch codex/pc-native-main-menu --recurse-submodules https://github.com/jackrevol/dcss-hns.git
cd dcss-hns/mobile
npm ci
npm run typecheck
npm test
```

기존 체크아웃에서는 이 브랜치를 가져와 전환한 뒤 `git submodule update --init --recursive`를 실행합니다.
Node.js는 `package.json`의 요구 버전(22.12 이상)을 사용하고, 원본 네이티브 의존성은 `crawl-ref/INSTALL.md`와 `.github/workflows/mobile.yml`을 참고하세요.

Windows 로컬 빌드에 사용한 PowerShell 환경:

```powershell
# MSYS2 MINGW64와 의존성이 설치된 환경에서, mobile 폴더 기준
$env:PATH = 'C:\msys64\mingw64\bin;C:\msys64\usr\bin;' + $env:PATH
$env:MSYSTEM = 'MINGW64'
npm run build:desktop
npm run test:desktop
```

Windows 생성물: `mobile/build/desktop/DCSS-HNS-0.35-a0-hns.1-windows-x64.zip`.
개발 서비스 소스는 `mobile/build/desktop-source`, SDL 패키지는 `mobile/build/sdl/native`에 생성됩니다.
별도로 메뉴 검사만 실행할 때는 `npm run test:desktop-menu`를 사용합니다.
`HNS_DESKTOP_EXECUTABLE`을 설정하면 해당 패키지 실행 파일을 검사하고, 설정하지 않으면 개발 서비스 소스를 사용합니다.
`HNS_DESKTOP_PACK`에는 테스트용 `.pzsave`의 절대 경로를 지정할 수 있습니다.

실제 Android CI 테스트 세이브는 아래 명령으로 다시 받을 수 있습니다(아티팩트 보존 기간 내, GitHub 인증 필요).

```sh
gh run download 39126518970 --repo jackrevol/dcss-hns --name dcss-hns-client-input --dir mobile/build/ci-client-input
```

해당 아티팩트의 `test-results/offline-backup.pzsave`에 `HnsSmoke` 캐릭터가 있습니다.
메뉴 검사에서 import 경로까지 검사하려면 이 파일을 `HNS_DESKTOP_PACK`으로 지정하세요.
기본 검색 위치는 `mobile/test-results/offline-backup.pzsave`입니다. 파일이 없으면 복원 검사를 건너뜁니다.
개인 세이브나 계정 정보를 테스트 입력이나 Git에 추가하지 마세요.

## 먼저 이어서 할 일

1. 실제 SDL 메뉴 검사의 종료 코드 1/시간 초과 원인을 재현하고 해결합니다. 모바일 UI 없는 전용 서비스 구조를 유지합니다.
2. 여섯 메뉴, 드랍 저장 및 RC 재로딩, 백업·복원, 기록, 클라우드 입력과 비밀번호 가림을 같은 원본 창에서 검증합니다.
3. 저장 중단/강제 종료/복구, 기존 Android 백업과의 호환성을 확인합니다. 네이티브 DB 캐시와 복구 저널 처리도 유지합니다.
4. Windows/Linux/macOS CI를 확인한 뒤 `master` 반영과 릴리즈를 진행합니다. 현재 브랜치는 미완료 작업 보관용입니다.

## 이전 master 수정과 CI 이력

- `34cbfe9eba`: PC 원본 SDL UI와 조작 복원, HNS 저장 기능, 버전 표기 정리.
- `d7a78129e6`: Windows CI에 존재하지 않는 선택 패키지 `mingw-w64-x86_64-advancecomp` 제거.
- `4165da0740`: 다른 드라이브에서 실행할 때 `_create_dirs`가 `C:`에 `_wmkdir`를 호출하던 오류 수정. 실제 드라이브 분리 조건에서 이전 실패/수정 후 통과를 확인했습니다.
- CI 실행 `39126518970`은 Windows 드라이브 문제 수정 전 실패한 실행입니다. 이후 `4165da0740`의 실행 `39129872819`는 취소 상태를 확인했으며, 전체 릴리즈 성공을 확인한 상태가 아닙니다.

## 보관 범위와 작업 규칙

- 루트의 미추적 `dist/`는 기존 사용자 파일/실행 파일/세이브가 있는 로컬 폴더입니다. 수정·삭제·커밋하지 않았습니다.
- `mobile/build/`, `mobile/test-results/` 등 생성물은 제외했습니다. 다른 컴퓨터에서는 다시 빌드해야 합니다.
- 오늘 실행한 게임/테스트 프로세스는 종료했습니다.
- 응답·인수인계·커밋은 한국어, 텍스트 파일은 UTF-8을 사용합니다. 기존 프로젝트 주석 스타일을 우선합니다.
- 별도 하위 에이전트 사용은 사용자가 요청한 경우에만 허용됩니다.
