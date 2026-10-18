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

앱을 열고 **New game**에서 캐릭터를 만듭니다. 첫 실행 시 APK 내부의 게임
데이터를 준비하며 인터넷 연결은 필요하지 않습니다. 세이브는 오프라인 로비의
**Backup → Export**로 `.pzsave`에 보관하고, **Import**로 복원합니다.

Android 6(API 23) 이상과 최신 Android System WebView가 필요합니다.
Android 뒤로 가기는 Escape 키로 동작합니다. 앱 업데이트 시 세이브는
유지되며, 앱 삭제·데이터 초기화 전에는 백업을 내보내세요.

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

GitHub Actions의 **Mobile Android** 워크플로는 UI 검사, 현재 HNS 엔진
컴파일, 브라우저 통합 테스트, APK 빌드를 실행하고 APK와 전체 소스 스냅샷을
artifact로 올립니다. `npm run package:source`는 현재 작업 트리와 Lua·폰트
소스를 포함한 배포용 소스 압축 파일을 생성합니다.

## 라이선스

UI는 [AGPL-3.0-or-later](LICENSE), 게임 엔진과 WASM 포트는 루트의
[GPL-2.0-or-later](../LICENSE)입니다. 배포 시 두 라이선스와
[저작권·출처 안내](ATTRIBUTION.md), 해당 빌드의 전체 대응 소스를 함께
제공하세요. 가져온 버전과 수정 범위는 [UPSTREAM.md](UPSTREAM.md)에
기록했습니다.
