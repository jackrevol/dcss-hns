# DCSS HNS 작업 인수인계

## 부활을 놓친 캐릭터 복구

- 실제 사망 처리 전에 마지막 층 진입 체크포인트를 `saves/recovery/<캐릭터>.cs`에 복사합니다. 캐릭터별 최근 사망 사본 하나를 유지하며, 복구 사본 생성에 실패하면 원래 저장 파일을 삭제하지 않습니다. 종료·승리·탈출과 `hns_revival = false`는 생성 대상에서 제외합니다.
- PC 시작 화면 **F8 Death recovery**, 모바일 오프라인 로비 **사망 캐릭터 복구**에서 선택합니다. 이전 클라이언트의 로컬 자동 백업도 검색합니다. 새 복구 사본은 마지막 층 진입, 이전 백업은 실제 저장 시점으로 구분합니다. 백업 없이 사망 기록만 있는 캐릭터는 복구할 수 없습니다.
- 캐릭터 파일 하나만 복원하고 현재 설정·다른 캐릭터·사망 기록을 유지합니다. 같은 이름의 저장 게임이 있으면 거절합니다. 모바일은 게임/클라우드 소유권을 잡고 IndexedDB `add`로 중복 복구 경쟁도 차단합니다. 복구 후 파일의 저장 시각을 갱신해 다음 동기화에서 새 진행으로 취급합니다.
- macOS SDL 빌드와 C++ 75개 테스트·9,637 assertions, 네이티브 백엔드 검사, 모바일 전체 1,745개 및 추가 실행 중 복구 차단 검사, 390px Chromium 복구 화면·실제 IndexedDB 복원 검증을 통과했습니다. SDL F8에서는 기존 Android fixture의 캐릭터 바이트가 복원되고 현재 드랍 설정이 유지되는 것도 확인했습니다. 모든 검증은 일회용 프로필에서 실행했습니다.

## 로컬 버전 표시 수정

- 로컬 빌드가 Git 태그를 읽지 않고 `version.json`의 초기 순번 1만 사용해 새 앱도 `hns.1`로 표시됐습니다. 로컬 태그도 .1만 있었습니다. 빌드 전 `git fetch origin --tags`로 갱신합니다.
- `releaseVersion()`도 CI와 같은 태그 선택 규칙을 사용합니다. 현재 커밋의 태그를 재사용하며 미발행 커밋은 다음 순번입니다. CI 지정값/대응 소스 기록의 우선순위는 유지하고, Git·기록이 없는 경우만 기본값을 씁니다.
- PC 메타데이터는 네이티브 manifest의 버전과 실행 파일 SHA-256으로 만듭니다. 남은 `dist/offline/version.json`에 의존하지 않으며, 단독 앱 CI에서도 웹 버전 artifact 전달을 생략합니다. 이전 태그의 빌드 경로는 유지합니다.
- macOS 번들의 ShortVersion/BundleVersion은 숫자 버전으로 갱신하며 HNSReleaseVersion에 전체 HNS 버전을 기록합니다. 게임 타이틀과 버전 명령은 전체 HNS 버전을 표시합니다.
- 로컬 태그 재사용/다음 순번/명시적 버전/소스 기록, 네이티브 바이너리 변경에 따른 빌드 ID와 CI 호환 검사를 추가했습니다.

## 소모품 배수 범위·설정 반영 수정

- 실제 사용자 RC의 `hns_consumable_amount = 500`을 확인했습니다. 입력 5가 5배로 저장되지만 기존 엔진은 일반 랜덤 바닥 생성에만 적용해 금고·특수방의 명시된 물약/스크롤/탄약 수량을 늘리지 않았습니다.
- 사용자 선택에 따라 금고·특수방을 포함한 새 바닥 소모품 전체로 범위를 넓혔습니다. 명시 수량을 정한 다음 한 번만 곱하며 상점의 원점 좌표와 몬스터 소지품은 제외합니다. 골드·품질 등 다른 옵션은 종전 범위입니다. 기존 층·아이템은 바꾸지 않습니다.
- PC 메뉴에서 드랍/RC 저장 후 시작 메뉴가 옵션을 즉시 다시 읽습니다. 앱 시작 클라우드 동기화가 바꾼 RC도 캐릭터 선택·첫 층 생성 전에 다시 읽습니다.
- 실행 중인 엔진 Options가 소모품 500/바닥 450인지 확인하는 SDL 검사와 클라우드 복사 후 Options 125 검사도 추가했습니다. 기존 RC 파일 표시만으로 성공을 판단하지 않습니다.
- 기존 앱의 금고 배치 경로에서 물약 2개가 5배 설정에도 2개인 현상을 재현했습니다. 수정 엔진의 실제 Lua 배치에서 1배/5배를 비교해 물약 2→10, 스크롤 3→15, 탄약 4→20을 확인했습니다. C++ `[hns]` 검사 5개·300 assertions가 통과해 일반 드롭·금고 배수·상점 수량 유지도 검증했습니다.
- 수동 재현: 일회용 프로필 RC에 `hns_consumable_amount = 500`을 넣고 소스 폴더에서 `crawl -rc <RC> -headless -builddb`, `crawl -rc <RC> -script hns-consumables 5`를 실행합니다. `CRAWL_DIR`와 RC의 `save_dir`/`morgue_dir`는 일회용 폴더로 지정합니다. 기본 Actions에 실행 테스트를 추가하지 않습니다.

## Windows Actions 패키징 수정

- 실행 `39205404105`는 Windows 엔진 컴파일과 설치 후 DLL 수집에서 실패했습니다. `objdump -p`가 출력한 PE 예외 테이블이 Node `execFileSync`의 기본 1MiB 한도를 넘어 `ENOBUFS`가 발생했습니다. Linux·macOS 두 아키텍처·WASM·Android APK는 성공했습니다.
- `mobile/scripts/windows-runtime.mjs`에서 출력을 줄 단위로 읽고 DLL 이름만 보관합니다. 종속 DLL 재귀 복사와 누락 검사, 검사 도구 실패 전파는 유지합니다. 오류 출력은 마지막 4KiB만 보관합니다.
- 1MiB를 넘는 출력의 앞뒤 DLL과 중복 제거, 검사 도구 오류·실행 파일 누락을 검증했습니다. 기본 빌드에 테스트를 추가하지 않았고, 수동 검사에서는 이전 태그에 새 검사 파일이 없는 경우를 허용합니다.

## 현재 구조: PC SDL 단독 앱

- 사용자 요청에 따라 Electron·Chromium 런타임과 별도 저장 서비스를 제거했습니다. macOS는 공개 앱 ID `io.github.jackrevol.dcsshns.desktop`을 가진 SDL `.app` 하나입니다. Windows/Linux도 게임이 직접 실행됩니다.
- F2 드랍, F3 RC, F4 기록/영안실, F5 백업, F6 복원, F7 클라우드를 원본 SDL 위젯으로 표시합니다. 파일·폴더 선택도 인게임에서 처리합니다.
- `crawl-ref/source/hns-native{,-pack,-cloud,-migrate}.cc`가 프로필 잠금·세이브·백업·로그인·HTTPS·동기화를 담당합니다. `HNS_NATIVE_DESKTOP=1`인 PC 배포 빌드에만 C++17/libcurl을 연결합니다. 기존 C++11·Android·MSVC 조합은 `hns-native-stub.cc`를 사용합니다.
- JSON 3.12.0/PicoSHA2 1.0.1을 라이선스와 함께 `contrib/hns-native`에 고정했습니다. Windows는 MSYS2 curl의 종속 DLL과 CA 인증서·라이선스도 패키징합니다. macOS 최소 버전은 11입니다.
- `mobile/scripts/build-desktop.mjs`는 네이티브 앱을 직접 패키징합니다. PC 빌드에 Vite/WASM/npm 설치가 필요하지 않습니다. Electron 의존성과 앱 진입점·서비스 코드를 삭제했습니다. 모바일 웹 UI는 기존대로 동작합니다.

## 데이터와 동기화

- 정본: 기존 사용자 폴더의 `native/crawl`. macOS는 `~/Library/Application Support/DCSS HNS`, Windows는 `%APPDATA%/DCSS HNS`, Linux는 `$XDG_CONFIG_HOME/DCSS HNS` 또는 `~/.config/DCSS HNS`입니다.
- 로그인·동기화 기준은 `native/state`, 최근 복구 사본 10개는 `native/archives`입니다. 로그인 키는 권한 0600 파일에 보관하며 비밀번호 원문은 디스크에 저장하지 않습니다.
- 기존 Electron 로그인은 정확한 앱 origin/key의 LevelDB CURRENT/MANIFEST·활성 WAL/SST를 읽기 전용으로 이전합니다. CRC32C·Snappy·최신 시퀀스·삭제 tombstone을 처리하며, 폐기된 테이블의 로그인이나 로그아웃 이전 키를 되살리지 않습니다. 원본 브라우저 프로필은 보존합니다.
- 기존 `menu.pzsave` 복구 저널도 사본을 남기고 복구합니다. 기존 앱의 활성 PID나 잠금이 남아 있으면 같은 프로필을 동시에 열지 않습니다.
- 로그인 후 시작 시 최대 4초간 양쪽 변경을 비교합니다. 읽을 수 있는 실제 캐릭터 저장 형식인지 SDL 엔진에서 검사한 뒤 최신 진행을 반영합니다. 수정 시각을 보존하며 같은 시각·삭제 충돌이면 양쪽을 보존합니다.
- 플레이 중 1분 주기·창 전환에 안전한 로컬 체크포인트를 만든 뒤 백그라운드 업로드합니다. 다른 기기의 변경을 발견하면 플레이 중 다운로드하지 않습니다. 정상 종료 시 파일·DB를 닫은 뒤 최대 8초간 최종 동기화를 시도합니다. 강제 종료/전원 차단은 마지막 완료 체크포인트까지만 보장합니다.
- 수동 `Local -> Cloud` / `Cloud -> Local`은 확인 후 전체 목적지를 교체합니다. 먼저 양쪽 복구 사본을 남기고 서버의 원자적 해시 비교로 동시 쓰기를 차단합니다. 백업은 Android와 같은 PZSAVE1 형식, 최대 32MiB입니다.
- HTTPS 인증서·호스트 검증을 사용합니다. 실제 서버 응답·로그인 키·비밀번호를 UI/로그에 노출하지 않습니다. 테스트 서버 변경은 명시한 일회용 프로필과 UI 테스트 모드에서 loopback만 허용합니다.

## 로컬 검증

- macOS Apple Silicon C++ SDL 컴파일, 단독 앱 서명 검증과 ZIP 생성 성공. 앱 약 53MB, ZIP 약 31MB입니다.
- 패키징된 SDL 메뉴 77단계 성공: 원본 데이터/폰트 초기화, 인게임 파일 선택, 옵션·드랍, Android HnsSmoke 백업 왕복의 캐릭터 바이트 일치, 모의 클라우드 로그인·자동 업로드·두 방향 복사·취소·비밀번호 마스킹.
- macOS 앱 최초 실행과 두 번 재실행 성공: F2/F7, 캐릭터 바이트 일치, RC 450 유지, SDL 단일 프로세스. Electron/저장 서비스 자식 프로세스 없음.
- `npm run test:native-backend`: SHA-256·백업 경계/경로 검사·최신 병합·삭제 충돌·파일 교체·캐시/수정 시각 보존·로그인 이전·CAS 경쟁·오프라인 보존·복구·잠금·로그아웃 검증. 실제 Chromium의 가짜 로그인 fixture도 통과했습니다.
- `npm run typecheck`, 모바일 단위 검사 1,753개 성공(4개 생략). 워크플로 actionlint와 CI 실행 계획/패키지 검사도 로컬 검증합니다.
- Ubuntu 24.04 x64에서도 GCC 13/libcurl로 저장 백엔드를 컴파일하고 충돌·자동 업로드·복구 검사를 통과했습니다.
- Windows/Linux/macOS Intel의 전체 앱 최종 컴파일·패키징은 푸시 후 GitHub Actions 결과를 확인해야 합니다. 기본 CI는 컴파일·패키징만 실행하며 테스트는 수동 `tests`/`extended` 선택 시 실행합니다. SDL 실행 검사를 기본 빌드에 다시 넣지 않았습니다.

## 빌드와 검사 명령

```sh
cd mobile
npm run build:desktop
# 별도 경로: HNS_DESKTOP_OUTPUT=/absolute/output npm run build:desktop
# 컴파일 결과를 CI에서 전달받은 경우:
node scripts/build-desktop.mjs --prebuilt-native
npm run test:native-backend
# npm 설치와 Android HnsSmoke fixture가 준비된 로컬에서만:
HNS_DESKTOP_EXECUTABLE='/absolute/DCSS HNS.app/Contents/MacOS/DCSS HNS' npm run test:desktop
HNS_DESKTOP_APP='/absolute/DCSS HNS.app' npm run test:desktop-relaunch
```

- macOS 빌드 시 Python/PyYAML, SDL 의존성과 서브모듈이 필요합니다. 로컬 PyYAML venv는 `/tmp/dcss-hns-build-venv/bin`입니다.
- 배포 기본 경로는 `mobile/build/desktop`; 실행 중인 사용자 앱 경로는 `mobile/build/desktop-mac-latest`입니다. 실제 앱 교체 전에는 플레이 중인지 확인하고 정상 종료해야 합니다.
- 이전 Dock 고정 항목이 `Contents/Resources/native/DCSS HNS.app`을 가리킬 수 있습니다. 단독 앱으로 교체할 때 고정 대상을 바깥 단일 `.app`으로 갱신해야 합니다.
- 테스트 프로필·스크린샷·빌드 산출물은 추적하지 않습니다. 실제 사용자 프로필이나 기존 앱을 자동 테스트 대상으로 사용하지 마세요.
