# DCSS HNS Mobile

HNS 게임 엔진에 [PocketZot](https://github.com/pocketzot/pocketzot)의 모바일
UI를 연결합니다. 세로 화면, 터치 방향키, 상황별 명령, ASCII/타일 전환,
캐릭터별 저장, 세이브 백업·복원을 지원합니다.

Android 앱에는 **이 저장소에서 빌드한 HNS 엔진과 타일**이 포함됩니다.
첫 실행부터 인터넷 없이 플레이할 수 있습니다. 기존 SDL Android 앱과는
다른 앱(`io.github.jackrevol.dcsshns`)으로 설치됩니다.
기존 SDL 앱의 세이브가 자동으로 이전되지는 않습니다.
공개 WebTiles 서버에 접속하면 해당 서버의 게임 규칙을 사용합니다.

## APK 설치 및 실행

**[최신 Android 릴리스](https://github.com/jackrevol/dcss-hns/releases/latest)**에서
`.apk` 파일을 다운로드하여 설치합니다. 현재 배포 파일은 디버그 서명 APK이며,
전체 대응 소스와 `SHA256SUMS.txt`도 함께 제공합니다.

앱을 열고 **New game**에서 캐릭터를 만듭니다. 게임 엔진·타일·초기 데이터를 APK에 미리 포함하므로 별도 데이터
다운로드 없이 첫 실행부터 인터넷 없이 플레이할 수 있습니다. 세이브는 오프라인 로비의
**Backup → Export**로 `.pzsave`에 보관하고, **Import**로 복원합니다.

Android 6(API 23) 이상과 최신 Android System WebView가 필요합니다.
Android 뒤로 가기는 Escape 키로 동작합니다. 앱 업데이트 시 세이브는
유지되며, 앱 삭제·데이터 초기화 전에는 백업을 내보내세요.

## 클라우드 세이브

Android·웹에서는 오프라인 로비의 **클라우드 세이브 → 설정**에서 아이디·비밀번호로
회원가입하고 로그인합니다. Supabase 대시보드 계정과 게임 계정은 별개입니다.
회원가입 즉시 로그인됩니다. 로그인은 기기에서 로그아웃할 때까지 유지되며,
앱 재실행·오프라인 전환으로 만료되지 않습니다. 아이디는 영문·숫자·밑줄 3~32자이며 대소문자를 구분하지 않습니다.
**이 계정에 기기 세이브 연결**을 누르면 현재 기기의 세이브를 계정과
동기화합니다. 다른 기기에서도 같은 게임 계정으로 로그인하고 연결합니다.

게임은 항상 기기의 세이브로 실행합니다. 로그인·인터넷·서버 응답 없이도
새 게임, 저장, 이어하기가 가능하며 동기화 실패가 플레이를 막지 않습니다.
온라인에서는 저장 체크포인트를 최대 1분 단위로 묶어 업로드하고,
저장·종료 시 동기화합니다. 연결이 복구되면 업로드를 다시 시도합니다.
다른 기기로 옮기기 전 로비에서 **지금 동기화**를 눌러 완료를 확인하고,
옮긴 기기에서도 **지금 동기화**로 최신 진행을 내려받으세요.
플레이 중에는 클라우드의 진행을 기기 세이브에 덮어쓰지 않습니다.

Android·웹에서 양쪽 기기의 같은 캐릭터를 진행하면 자동으로 덮어쓰지 않습니다.
양쪽 복구 사본을 보관하고 충돌 파일에 사용할 기기/클라우드 진행을
선택합니다. 최근 복구 사본 10개는 이 기기에 보관하며 복구나 `.pzsave`
내보내기가 가능합니다. 클라우드는 세이브·기록·옵션 파일을 동기화하며,
기기별 UI 설정과 캐릭터 이미지 캐시는 포함하지 않습니다.
로그아웃해도 기기의 세이브는 유지됩니다.

PC에서는 원본 메인 메뉴의 **F7 클라우드**에서 로그인하면 자동 저장을 사용합니다.
앱 시작 시 로컬과 클라우드의 변경 내역을 비교하며, 양쪽에서 진행했으면 실제
저장 시각이 더 최근인 캐릭터를 선택합니다. 클라우드가 최신이면 게임 시작 전에
내려받고, 로컬이 최신이면 업로드합니다. 타임스탬프를 판별할 수 없거나 삭제와
진행이 충돌하면 양쪽 사본을 보존하고 수동 선택을 기다립니다.
인터넷 확인은 시작 시 최대 4초 동안 시도하며, 실패하면 로컬 게임을 시작합니다.
플레이 중에는 1분 주기와 창 전환 시 로컬 체크포인트를 저장해 업로드하고,
종료 시 다시 동기화합니다. 실행 중인 게임에는 클라우드 파일을 덮어쓰지 않습니다.

수동 선택은 **Local -> Cloud (업로드)**와 **Cloud -> Local (다운로드)** 두 가지입니다.
수동 복사는 확인 후 선택한 쪽의 세이브 전체로 목적지를 교체하며 자동 병합하지
않습니다. 덮어쓰기 전에 복구 사본을 남깁니다. 로그아웃과 이전 사본 복원·내보내기는
**Account / recovery**에 모았습니다. 파일을 복사하거나 다운로드할 때 원래 저장
시각을 보존하므로 오래된 세이브를 새 진행으로 잘못 취급하지 않습니다.
PC는 빌드 해시가 달라도 SDL 엔진의 읽기 전용 `-save-version` 검사에서 실제
저장 형식이 호환되면 동기화합니다. UI 변경이나 플랫폼 차이로 생긴 해시 차이는
허용하되, 현재 엔진보다 새로운 저장 형식과 잘못된 세이브는 차단합니다.

서버 설치: [supabase/cloud-saves.sql](supabase/cloud-saves.sql)을 Supabase
SQL Editor에서 실행합니다. 게임 테이블 `hns_game_saves`에는 **아이디(id),
비밀번호 해시(password_hash), 세이브(save)** 세 열만 있습니다.
Supabase Auth는 사용하지 않으며 Email provider는 꺼 둡니다.
이메일·전화번호·프로필·서버 세션·로그인 이력·시도 제한을 저장하지 않습니다.
비밀번호는 기기에서 아이디와 함께 SHA-256으로 로그인 키를 만들고,
서버는 해당 키를 랜덤 salt를 사용하는 bcrypt(cost 12)로 해시해 저장합니다.
기기는 로그인 키만 보관하고 비밀번호 원문은 저장하지 않습니다.
키는 세이브 접근 권한을 가지며 웹/앱에서는 localStorage, 터미널에서는
권한 0600의 account.json에 보관합니다. 로그아웃하면 해당 기기의 키를 지웁니다.
서버 만료·세션 토큰·로그인 재요청 없이 각 동기화 RPC에서 키를 확인합니다.
다른 기기의 로그인에는 영향을 주지 않습니다.

테이블 직접 접근은 차단하며 비밀번호가 확인된 함수에서만 세이브를
읽고 씁니다. 동시 저장은 원자적 해시 비교로 충돌을 감지합니다.
계정당 세이브는 최대 32 MB이며 데이터베이스 용량을 사용합니다.
공개 프로젝트 URL/키는 `src/cloud/project.ts`에 있으며 다른 프로젝트는
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`로 빌드 시 지정합니다.
웹 배포의 `public/_headers` CSP `connect-src`도 해당 프로젝트 URL로
변경해야 합니다. `service_role`/secret 키는 앱에 넣지 마세요.
비밀번호 분실 시 메일 복구 기능은 없습니다.
Android 앱, macOS 독립 앱, Windows/Linux/macOS 브라우저는 같은 계정과
세이브 형식으로 동기화합니다. Web Locks가 없는 브라우저는 IndexedDB
잠금을 사용합니다. 비정상 종료 후 잠금 기록이 남으면 다른 게임 창을
모두 종료한 뒤 클라우드 설정의 잠금 해제 버튼을 사용하세요.

`npm run test:cloud-db`는 외부 서버 없이 PostgreSQL WASM에서
세 열만 저장하는 구조, bcrypt, 잘못된 비밀번호 차단, 사용자 격리,
동시 저장 충돌, 제한 없는 반복 로그인, SQL 재실행을 검증합니다.

## Windows/Linux/macOS 독립 앱

플랫폼별 검증 현황과 재개 방법은 [인수인계 문서](../HANDOFF.md)에 정리했습니다.

PC 앱은 원본 DCSS의 시작 메뉴·캐릭터 선택·SDL 타일 화면·키보드와 마우스
조작을 그대로 사용합니다. 원본 메인에 **F2 드랍 · F3 옵션 · F4 기록/영안실 ·
F5 백업 · F6 복원 · F7 클라우드** 메뉴를 배치합니다. 모든 설정·계정 화면을
같은 SDL 창에서 원본 위젯으로 열며, 파일 선택만 운영체제 대화상자를 사용합니다.
Android의 모바일 로비·터치 조작은 Android 앱에 유지합니다.

`npm run build:desktop`은 SDL 엔진과 화면 없는 저장 서비스를 포함한 독립 앱과 배포 압축 파일을 생성합니다.
PC 패키지에는 모바일 화면의 HTML·CSS·게임 UI 번들을 넣지 않습니다.
PC 서비스 빌드는 모바일 화면·터치 UI·CSS·WASM이 섞이면 실패하며,
배포 검사에서도 서비스 파일 목록과 모바일 진입점 미포함을 확인합니다.
백업 파일명은 `dcss-hns-YYYY-MM-DD.pzsave`이며 기존 백업 형식과 호환됩니다.
현재 호스트의 플랫폼/CPU를 기본으로 사용하며, `HNS_DESKTOP_PLATFORM`
(`darwin`, `win32`, `linux`), `HNS_DESKTOP_ARCH`는 호스트와 일치해야 합니다.
먼저 모든 서브모듈과 [네이티브 빌드 의존성](../crawl-ref/INSTALL.md)을 준비하세요.
Windows는 MSYS2 MINGW64 셸에서 실행하며, Linux는 `LINUXDEPLOY`에
linuxdeploy AppImage 경로를 지정합니다. Linux 게임 엔진은 추출한 AppDir로
포함하므로 FUSE가 필요하지 않습니다. PC 빌드에는 WASM 엔진이 필요하지 않습니다.
`HNS_DESKTOP_OUTPUT`으로 배포 결과 폴더를 지정하면 실행 중인 앱을 덮어쓰지 않고
새 빌드를 검증할 수 있습니다. 기본값은 `build/desktop`입니다.
CI에서는 `node scripts/build-sdl.mjs`로 먼저 컴파일하고, 압축·전달한 결과를
`node scripts/build-desktop.mjs --prebuilt-native`로 재컴파일 없이 패키징합니다.
이 옵션은 엔진의 커밋·버전·플랫폼·CPU가 현재 소스와 일치할 때만 허용합니다.
네이티브 결과는 tar로 전달해 실행 권한과 심볼릭 링크를 보존합니다.
새 옵션을 지원하지 않는 기존 태그는 CI에서 종전 빌드 경로로 처리합니다.
릴리즈에서는 각 플랫폼의 호스트에서 패키징하고 필수 타일·폰트·설정 파일을 확인합니다.
게임 실행 검사는 빌드에 포함하지 않습니다. SDL 초기화만 따로 검사하려면
`node scripts/build-sdl.mjs --verify`를 사용합니다.
macOS Apple Silicon 결과는 `build/desktop/DCSS-HNS-<version>-mac-arm64.zip`입니다.
Windows x64는 `build/desktop/DCSS-HNS-<version>-windows-x64.zip`, Linux x64는
`build/desktop/DCSS-HNS-<version>-linux-x64.tar.gz`입니다. 압축을 풀고 플랫폼에 맞는
`DCSS HNS.app`, `DCSS HNS.exe`, `DCSS HNS`를 실행합니다. 별도 웹 서버나 Node.js 없이
오프라인 플레이와 앱 내 클라우드 동기화를 사용할 수 있습니다.
게임 엔진·타일·초기 데이터가 앱에 미리 포함되어 별도 다운로드 버튼 없이
바로 플레이할 수 있습니다. 로그인과 세이브는 앱 전용 사용자 데이터 폴더에 보관합니다.
기존 앱과 같은 사용자 데이터 폴더·저장 형식·클라우드 로직을 사용합니다.
SDL 엔진의 저장 체크포인트를 기존 IndexedDB에 반영하여 백업과 동기화에
동일한 진행을 제공합니다. 비정상 종료 시 네이티브 사본을 먼저 복구하며,
저장 반영을 확인하기 전에는 복구 사본을 지우지 않습니다.
`npm run test:desktop`은 원본 SDL 메인과 드랍 설정·백업/복원·클라우드 입력창,
포함한 엔진·타일·폰트·데이터 초기화 및 모바일 화면 미포함을 검증합니다.
`npm run test:desktop-menu`는 실제 SDL 메인 화면에서 여섯 메뉴, 드랍 입력,
백업·복원, 옵션 갱신과 클라우드 입력창을 검사하고 원본 창의 스크린샷을 남깁니다.
일회용 프로필과 모의 클라우드에서 로그인 직후 자동 업로드, 두 방향 복사와 취소,
다운로드 후 캐릭터 목록 갱신을 검사하며 실제 클라우드 서버에는 접속하지 않습니다.
원본 타이틀 화면에서 Enter를 누른 뒤 메뉴 검사를 시작합니다.
`HNS_DESKTOP_PACK`으로 `HnsSmoke` Android 테스트 백업의 절대 경로를 지정하면
복원 후 캐릭터 목록과 재수출한 세이브의 바이트 일치까지 검사합니다.
실패 진단을 보존하려면 `HNS_DESKTOP_KEEP_TEST_PROFILE=1`을 설정합니다.

웹 클라이언트도 빌드 시 게임 데이터 전체를 설치 목록에 포함합니다.
최초 접속/설치 시 자동으로 함께 캐시하며 별도 게임 데이터 다운로드는
필요하지 않습니다. 웹의 최초 설치에는 인터넷이 필요하지만 설치 후에는
인터넷 없이 다시 열고 플레이할 수 있습니다. `npm run test:bundled-web`은
별도 다운로드 없이 설치한 웹 클라이언트의 완전 오프라인 이어하기를 검증합니다.

## 버전 표기

[version.json](version.json)의 원본 버전과 HNS 순번을 기준으로
`0.35-a0-hns.1` 형식을 사용합니다. 자동 릴리즈는 마지막 게시 태그의
순번을 증가시키고, 같은 커밋의 재빌드는 기존 버전을 재사용합니다.
릴리즈 제목은 `DCSS HNS 0.35-a0-hns.1`, 태그는 `v0.35-a0-hns.1`이며
파일명에는 `v`를 제외한 버전을 넣습니다. 순번 충돌을 막기 위해 플랫폼
릴리즈 워크플로는 순서대로 실행합니다.

개발 빌드의 기본 순번은 `version.json`에 있으며 `HNS_RELEASE_VERSION`으로
지정할 수 있습니다. 엔진·Android·PC를 같은 값으로 빌드하세요.
Android `versionName`과 원본 엔진의 표시 버전은 동일한 문자열을 사용합니다.
플랫폼의 숫자 버전 필드는 `0.35.1`처럼 변환하고 Android `versionCode`는
원본 주·부 버전과 순번을 조합해 다음 원본 버전에서도 증가하도록 합니다.
전체 소스 압축 파일에는 재빌드에 사용할 `release-info.json`도 포함합니다.

## 기존 네이티브/터미널 엔진

Node.js 22.12 이상이 필요합니다. 같은 소스의 네이티브 엔진을 빌드하고
앱·브라우저와 동일한 클라우드에 연결하는 실행기를 사용합니다.

```sh
cd mobile
npm ci
npm run build:native
npm run native -- signup          # 아이디·비밀번호를 터미널에서 입력
npm run native -- link            # 현재 기기 세이브를 계정에 연결
npm run native -- sync            # 다른 기기의 최신 진행 받기
npm run native -- play -name Hero # 네이티브 엔진으로 실행
```

기존 계정은 `signup` 대신 `login`을 실행합니다. 비밀번호는 표시하지 않고
입력받으며 명령 인자로 받지 않습니다. 로그인 없이 `play`도 가능합니다.
게임 시작은 네트워크를 기다리지 않으며, 저장·종료 후 동기화합니다.
세이브는 `~/.dcss-hns-native/crawl`, 복구 사본은 `archives`에 보관합니다.
앱/브라우저 세이브와 구분되는 기기 저장소이므로 기기 간 전환 전후에
`sync`로 완료를 확인하세요. `HNS_NATIVE_HOME`으로 저장 위치를 바꿀 수
있으며, `HNS_NATIVE_BINARY`로 다른 실행 파일을 지정할 수 있습니다.
동기화는 빌드 시 기록한 실행 파일 해시와 앱 엔진 빌드를 확인합니다.
실행 파일을 교체하면 `build:native`로 함께 다시 빌드하세요.

기존 터미널 엔진의 세이브 폴더는 아래 명령으로 원본을 유지하며 가져옵니다.
엔진을 직접 실행한 기존 세이브가 자동으로 이동되지는 않습니다.

```sh
npm run native -- import-native /path/to/old/saves
npm run native -- export /path/to/backup.pzsave
npm run native -- import /path/to/backup.pzsave
```

충돌 시 양쪽 복구 사본을 먼저 남깁니다. `sync --local` 또는
`sync --remote`로 충돌 파일에 사용할 진행을 선택합니다.
`archives`로 복구 사본 해시를 보고 `restore <hash>`로 복구할 수 있습니다.
실행 중인 게임과 동기화는 파일 잠금으로 구분하며, 비정상 종료 후에는
게임 프로세스가 종료된 것을 확인하고 `unlock`을 실행하세요.

## 아이템 드랍 설정

오프라인 로비에서 **아이템 드랍 → 설정**을 엽니다. 바닥 생성량·품질 배수,
최소 품질, 우수 아이템·랜덤 아티팩트 추가 확률, 골드·소모품 묶음 수량을
조절할 수 있습니다. 기존 HNS와 같은 일반 바닥 아이템만 대상으로 합니다.
**HNS 기본값**과 **원본 드랍값** 버튼으로 기본 설정을 불러올 수 있습니다.
원본 드랍값은 아이템 설정만 변경합니다.

저장 후 게임을 시작하거나 재개하면 적용됩니다. 이미 생성된 층의 아이템은
바뀌지 않으므로 바닥 생성량은 새 층에서 확인하세요. 설정은 기기의 오프라인
캐릭터 전체에 적용되며 백업의 `init.txt`에도 포함됩니다. 공개 서버에는
적용되지 않습니다. 수동 RC 편집과 자세한 적용 범위는
[HNS 설정 안내](../crawl-ref/docs/hns.md)를 참고하세요.

## 개발 환경

- Node.js 22.12 이상, npm
- 네이티브 C++ 빌드 도구, make, flex, bison, pkg-config, Python 3 + PyYAML
- ncurses, libpng, SQLite, zlib 개발 라이브러리
- Emscripten **5.0.7** (`emsdk install 5.0.7`, `emsdk activate 5.0.7`, 환경 활성화)
- Android: JDK **17**, SDK Platform **36**, Build Tools **36.0.0**

Ubuntu에서 게임 빌드 의존성을 설치하는 예:

```sh
sudo apt-get install build-essential flex bison pkg-config python3-yaml \
  libncurses-dev libpng-dev libsqlite3-dev zlib1g-dev
```

macOS에서는 Xcode Command Line Tools와 Homebrew의 `pkgconf libpng sqlite`,
가상 환경에 설치한 PyYAML을 사용할 수 있습니다. Lua와 폰트는 빌드 스크립트가
이 저장소에 고정된 서브모듈을 초기화합니다.

## 엔진과 UI 빌드

릴리스의 전체 대응 소스를 사용하거나 해당 태그를 체크아웃합니다.
첫 모바일 릴리스의 소스를 가져오는 예입니다.

```sh
git clone --depth 1 --branch v0.35-a0-hns-mobile.1 --recurse-submodules \
  https://github.com/jackrevol/dcss-hns.git
cd dcss-hns
```

```sh
source /path/to/emsdk/emsdk_env.sh
cd mobile
npm ci
npm run build:engine
npm test
npm run build
npm run preview -- --host 127.0.0.1
```

`JOBS=4 npm run build:engine`으로 병렬 컴파일 수를 조절합니다.
기본값은 8입니다. 선택적으로 `WASM_JSPI=1`을 설정하면 최신 WebView용
JSPI 엔진도 함께 빌드합니다. 기본 Asyncify 엔진만으로도 플레이 가능합니다.

엔진은 `crawl-ref/source/wasm/dist/`, 배포용 엔진과 타일은
`mobile/public/offline/`, `mobile/public/gamedata/local/`에 생성됩니다.
생성물은 Git에서 제외되며, HNS 부활 소스를 포함한 오브젝트 목록도 매번
현재 Makefile에서 생성합니다. 게임 소스나 데이터가 바뀌면 엔진을 다시
빌드해야 합니다. 개발 서버는 `npm run dev`로 시작할 수 있습니다.

## Android APK

`ANDROID_HOME`을 SDK 위치로 설정하거나 `mobile/android/local.properties`에
`sdk.dir=/path/to/android/sdk`를 기록합니다. SDK 라이선스를 수락하고
필요한 패키지를 설치합니다.

```sh
sdkmanager 'platforms;android-36' 'build-tools;36.0.0' 'platform-tools'
cd mobile
npm run build:android
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

`build:android`는 UI를 새로 빌드하고 Gradle Wrapper로 디버그 서명 APK를
생성합니다. 엔진이 없거나 HNS 엔진 표시가 없으면 패키징을 거부합니다.
Android Studio에서는 `mobile/android`를 엽니다. 먼저 엔진/UI 빌드를
완료해야 합니다. 배포용 서명 키는 포함하지 않습니다.
릴리스 APK는 Android Studio에서 본인 키로 서명할 수 있습니다.

최소 설치 버전은 Android 6(API 23)입니다. 실제 플레이에는 WebAssembly,
Workers, CacheStorage, DecompressionStream을 지원하는 최신 Android System
WebView가 필요합니다. Android 버전만으로 WebView 기능이 보장되지는 않습니다.

앱은 HNS 오프라인 로비에서 시작합니다. 첫 캐릭터 생성 시 APK 내부의
데이터를 기기 캐시에 준비하며, 이 과정에는 인터넷이 필요하지 않습니다.
Android 뒤로 가기는 Escape 키입니다. 홈/앱 전환 시 안전한 입력 시점에
저장을 요청합니다. 앱 업데이트 시 세이브는 유지됩니다. 앱 삭제/데이터
초기화 시에는 없어지므로 Backup으로 `.pzsave`를 보관하세요.
백업 내보내기는 Android 파일 저장창, 복원은 파일 선택창을 사용합니다.

GitHub Actions의 **[DCSS HNS](../.github/workflows/ci.yml)**는 현재 HNS 엔진
컴파일, APK·PC 패키징과 릴리즈를 한 실행에서 처리합니다.
WASM·웹 결과는 한 번만 빌드합니다. PC 네이티브 컴파일은 WASM과
동시에 시작하고, 완료 후 같은 엔진 버전 정보로 패키징합니다.
PC에는 WASM을 전달하지 않으며, 테스트 세이브는 수동 `tests` 선택 시에만 전달합니다.
APK와 전체 소스 스냅샷도 artifact로 올립니다. `npm run package:source`는 현재 작업 트리와 Lua·폰트
소스를 포함한 배포용 소스 압축 파일을 생성합니다.

통합 워크플로는 공유 저장 서비스와 같은 소스
커밋에서 빌드한 원본 SDL 엔진을 Windows x64, Linux x64,
macOS Intel/Apple Silicon 앱으로 패키징합니다.
Android와 PC 배포 패키지가 모두 빌드되면
`v0.35-a0-hns.<순번>` 태그로 릴리즈를 생성하여 APK, 데스크톱 압축 파일
4개, 전체 대응 소스와 SHA-256 체크섬을 함께 게시합니다.
수동 실행에서 `tag`를 비워 두면 선택한 브랜치의 커밋으로 새 릴리즈를 만들고,
기존 태그를 지정하면 해당 태그의 커밋을 빌드합니다. 릴리즈를 직접 게시해도
해당 태그에 첨부 파일을 추가하며, 재실행하면 같은 이름의 파일을 교체합니다.
기존 Android 전용 첫 릴리즈 태그에는 데스크톱 빌드 스크립트가 없어
이 자동화를 사용하려면 새 스크립트가 포함된 태그가 필요합니다.
`publish`를 해제하면 게시 없이 빌드합니다. 일반 빌드는 테스트를 실행하지 않으며,
수동 `tests`를 선택하면 단위·클라우드·오프라인 플레이·SDL 메뉴와 추가 컴파일 검사를
수행합니다. `extended`는 이 테스트들과 원본의 전체 컴파일·헤더 조합 및 레거시
플랫폼 검사를 함께 실행합니다. 문서만 변경하면 빌드·테스트·게시를 생략합니다.
필수 배포 파일 누락, 버전·커밋 불일치와 컴파일·패키징 실패는 계속 게시를 막습니다.
기존 태그 재빌드는 해당 태그의 스크립트를 사용하므로 이전 스크립트에 포함된 검사가 실행될 수 있습니다.
SDK·npm·Gradle·컴파일 캐시를 재사용하며 PR의 오래된 실행은 자동 취소합니다.
WASM의 데이터 식별자는 배포하는 dat/docs의 경로·내용으로 계산하고,
`files.o`에만 컴파일 옵션으로 넣습니다. 파일 시각 변경은 무시하며 데이터 내용이
바뀌면 해당 객체와 최종 링크를 갱신합니다. prewarm 식별자는 엔진 해시도 포함해
엔진이 바뀌면 파생 캐시를 다시 넣습니다. 사용자 세이브의 수정 시각은 유지합니다.

## 라이선스

UI는 [AGPL-3.0-or-later](LICENSE), 게임 엔진과 WASM 포트는 루트의
[GPL-2.0-or-later](../LICENSE)입니다. 배포 시 두 라이선스와
[저작권·출처 안내](ATTRIBUTION.md), 해당 빌드의 전체 대응 소스를 함께
제공하세요. 가져온 버전과 수정 범위는 [UPSTREAM.md](UPSTREAM.md)에
기록했습니다.
