[![DCSS HNS](https://github.com/jackrevol/dcss-hns/actions/workflows/ci.yml/badge.svg)](https://github.com/jackrevol/dcss-hns/actions/workflows/ci.yml)

# DCSS HNS

> PC 클라이언트는 원본 SDL 메뉴와 조작을 사용합니다. 플랫폼별 검증 현황과
> 다른 컴퓨터에서의 재개 방법은 [인수인계 문서](HANDOFF.md)를 확인하세요.

[Dungeon Crawl Stone Soup](https://github.com/crawl/crawl)의 HNS 포크입니다.
일반 바닥 아이템 보상을 조절하고, 사망하면 마지막 층 진입 시점으로
돌아갈 수 있습니다. [PocketZot](https://github.com/pocketzot/pocketzot)의 모바일
UI를 적용한 Android 앱으로 인터넷 없이 플레이할 수 있습니다.

## 플랫폼별 릴리즈 파일

**[DCSS HNS](.github/workflows/ci.yml)** 하나에서 검사·빌드·릴리즈를 처리합니다.
`master`에 push한 커밋으로 엔진과 UI를 한 번 빌드하고, 결과를
Android와 PC 패키징에 공유합니다. 모든 배포 패키지의 빌드가
성공하면 `v0.35-a0-hns.<순번>` 태그로 새 릴리즈를 생성하고 아래 파일을
함께 게시합니다. 실패한 빌드나 PR·다른 브랜치의 빌드는 자동 게시하지 않습니다.

| 플랫폼 | 파일 이름 (`<version>` 예: `0.35-a0-hns.1`) | 실행 방법 |
| --- | --- | --- |
| Android | `dcss-hns-<version>-android-debug.apk` | APK 설치 |
| Windows x64 | `dcss-hns-<version>-windows-x64.zip` | 압축 해제 후 `DCSS HNS.exe` 실행 |
| Linux x64 | `dcss-hns-<version>-linux-x64.tar.gz` | 압축 해제 후 `DCSS HNS` 실행 |
| macOS Intel | `dcss-hns-<version>-macos-x64.zip` | 압축 해제 후 `DCSS HNS.app` 실행 |
| macOS Apple Silicon | `dcss-hns-<version>-macos-arm64.zip` | 압축 해제 후 `DCSS HNS.app` 실행 |

버전은 `0.35-a0-hns.1`, `0.35-a0-hns.2`처럼 마지막 순번만 증가합니다.
앱 표시·릴리즈 제목·플랫폼 파일명에 같은 버전을 사용하고, 커밋 해시와
엔진 캐시 식별자는 상세 빌드 정보에 보관합니다. 같은 커밋을 다시 빌드하면
이미 게시한 버전을 재사용합니다.

전체 대응 소스(`dcss-hns-<version>-source.tar.gz`)와 `SHA256SUMS.txt`도 함께 제공합니다.
데스크톱 앱은 엔진과 게임 데이터를 포함하며 별도 Node.js 설치 없이 실행됩니다.
Windows·Linux·macOS는 원본 DCSS의 시작 메뉴·타일 UI·키보드와 마우스 조작을
사용합니다. 원본 메인에 **F2 드랍 설정 · F3 옵션 · F4 기록/영안실 · F5 백업 ·
F6 복원 · F7 클라우드** 메뉴를 통합했습니다. 모든 설정과 계정 화면은 게임과
같은 SDL 창에서 원본 메뉴·입력 위젯으로 열립니다. 파일 선택도 인게임에서
처리합니다. Electron이나 별도 런처 없이 SDL 앱 하나로 실행하며, 기존 PC 앱의
세이브와 로그인 데이터를 이어받습니다.
PC는 로그인 후 시작할 때 최신 세이브를 자동으로 비교하고, 플레이 중과 종료 시
클라우드에 저장합니다. 수동 복사는 F7의 **Local -> Cloud / Cloud -> Local**에서
선택합니다. 이전 진행은 복구 사본으로 보관하고, 계정·복구 기능은 하위 메뉴에 모았습니다.
Actions의 **DCSS HNS → Run workflow**에서 `tag`를 비워 두면 선택한
브랜치의 커밋을 수동으로 릴리즈할 수 있습니다. 기존 태그를 지정하면 해당
커밋을 빌드하여 릴리즈를 생성하거나 기존 첨부 파일을 교체합니다. 릴리즈를
직접 게시해도 해당 태그에 파일을 자동 첨부합니다. 대상 커밋에는 데스크톱 앱과
릴리즈 빌드 스크립트가 포함되어 있어야 합니다.

일반 실행은 Android APK와 PC 4종의 컴파일·패키징만 수행합니다.
단위·클라우드·오프라인 플레이·SDL 메뉴 테스트와 추가 GCC/Clang·MSVC 검사는
수동 실행에서 `tests`를 선택할 때 수행합니다. `extended`는 이 테스트들과
원본의 전체 컴파일 조합·레거시 플랫폼 검사를 함께 실행합니다.
WASM과 PC 네이티브 엔진을 동시에 컴파일하고, 완성된 결과로 Android·PC를
패키징합니다. 릴리즈 단계에서는 다시 빌드하지 않습니다.
PC 단독 앱에는 컴파일된 네이티브 엔진만 전달하며, 테스트 세이브는 `tests` 선택 시에만 전달합니다.
테스트를 생략해도 엔진의 커밋·버전·플랫폼과 필수 타일·폰트·설정 파일은 패키징 전에 확인합니다.
SDK·npm·Gradle·컴파일 캐시를 재사용하고, PR의 이전 실행은 취소합니다.
WASM 데이터 식별자는 수정 시각 대신 내용으로 계산하여 같은 데이터의
체크아웃이 컴파일 캐시를 무효화하지 않게 합니다. 첫 실행에서 캐시를 채운 뒤
재실행부터 적중률과 전체 실행 시간으로 효과를 확인할 수 있습니다.

| 실행 | 동작 |
| --- | --- |
| master 코드 변경 | 전체 앱 빌드·패키징 후 릴리즈 게시 |
| PR | 같은 앱 빌드·패키징, 게시 생략 |
| 문서만 변경 | 빌드·테스트·게시 생략 |
| 수동 `publish` 해제 | 게시 없이 앱 빌드 |
| 수동 `tests` 선택 | 단위·클라우드·게임 실행 테스트 및 추가 컴파일 검사 |
| 수동 `extended` 선택 | `tests`와 전체 컴파일·헤더 조합, 범용 macOS, MinGW, 레거시 Android, 웹 서버·문서 검사 실행 |

master·수동 릴리즈는 버전 순번 충돌을 막기 위해 순서대로 실행합니다.
최종 **전체 결과**에서 실패·취소와 의도한 생략을 구분하여 확인할 수 있습니다.

## Android 다운로드 및 실행

**[최신 릴리스](https://github.com/jackrevol/dcss-hns/releases/latest)** ·
**[Android APK 다운로드](https://github.com/jackrevol/dcss-hns/releases/download/v0.35-a0-hns-mobile.1/dcss-hns-mobile-0.35-a0-hns-mobile.1-debug.apk)**

1. 릴리스의 `.apk` 파일을 Android 기기에 다운로드하고 설치합니다.
2. 앱을 열고 **New game**에서 캐릭터를 만듭니다. 첫 실행에 필요한 엔진과
   타일은 APK에 포함되어 있어 인터넷 연결이 필요하지 않습니다.
3. 세이브를 옮기거나 보관하려면 오프라인 로비의 **Backup → Export**로
   `.pzsave`를 저장하고, **Import**로 복원합니다.

Android 6(API 23) 이상과 최신 Android System WebView가 필요합니다.
현재 릴리스는 **디버그 서명 APK**이며, 전체 대응 소스와 SHA-256 체크섬도
릴리스에 첨부합니다. 앱 ID는 `io.github.jackrevol.dcsshns`입니다.
기존 SDL Android 앱과 별도로 설치되며, 세이브를 자동으로 가져오지 않습니다.
앱 업데이트 시 세이브는 유지되지만 앱 삭제·데이터 초기화 시에는 사라집니다.

## HNS 기능

- **바닥 아이템 보상 조절:** 기본 생성량 3배, 품질 인자 2배.
- **층 진입 시점으로 무제한 부활:** 사망 확인창에서 부활을 선택하면
  캐릭터와 던전 상태를 마지막 층 진입 시점으로 되돌립니다.
- **던전의 악의 제거:** 탐험 중 무작위로 발생하던 낙하·강제 순간이동·경보를
  제거합니다. 맵의 함정과 몬스터 능력은 기존 규칙을 따릅니다.
- **모바일 조작:** 세로 화면, 터치 방향키와 상황별 명령, ASCII/타일 전환,
  캐릭터별 저장, 앱 전환 시 저장, Android 파일 선택창을 통한 백업·복원.

HNS 규칙은 앱의 오프라인 게임에 적용합니다. 공개 WebTiles 서버에 접속하면
해당 서버의 게임 규칙을 사용합니다.

## 아이템 드랍 설정

오프라인 로비의 **아이템 드랍 → 설정**에서 변경합니다.
PC에서는 원본 시작 메뉴의 **F2 → 아이템 드랍 설정**으로 엽니다.

| 설정 | 기본값 | 범위 |
| --- | ---: | ---: |
| 바닥 아이템 생성량 | 3배 | 0–10배 |
| 아이템 품질 인자 | 2배 | 0–10배 |
| 최소 품질 단계 | 0 | 0–50 |
| 우수 아이템 추가 확률 | 0% | 0–100% |
| 랜덤 아티팩트 추가 확률 | 0% | 0–100% |
| 골드 묶음 수량 | 1배 | 0.01–10배 |
| 소모품 묶음 수량 | 1배 | 0.01–10배 |

**HNS 기본값**과 **원본 드랍값** 버튼으로 기본 설정을 불러올 수 있습니다.
소모품 묶음 수량은 금고·특수방을 포함한 새 바닥 아이템에 적용합니다.
나머지 옵션은 일반 랜덤 바닥 아이템만 대상으로 하며, 몬스터 소지품·상점·신의 선물은
기존 규칙을 따릅니다. 변경값은 저장 후 게임을 시작·재개하면 새로 생성하는
아이템부터 적용합니다. 이미 생성된 층의 아이템은 바뀌지 않습니다.
설정은 기기 내 모든 오프라인 캐릭터가 공유합니다.

품질 배수는 강화 수치 자체의 배수가 아닙니다. D:1의 기본 품질 인자 0을
높이려면 **최소 품질 단계**를 설정하세요. 아티팩트 추가 확률은
무기·방어구·장신구·탈리스만에 적용하며, 불가능한 종류는 우수 아이템으로
대체합니다.

## 아이템 합계 검색

게임의 **Ctrl-F** 검색에서 감정된 장비의 저항·스탯 합계를 비교할 수 있습니다.

- `res>=3`: 저항 합계 3 이상. rF·rC·rN·rPois·rElec·rCorr·rMut·Will의
  단계를 합산하며, `Will+`는 1로 계산합니다.
- `stat>=10`: 힘·지능·민첩 보너스 합계 10 이상.
- `armour && res>=3 && stat>=6`: 두 합계 조건을 만족하는 방어구.

`=`, `!=`, `>`, `>=`, `<`, `<=`를 지원합니다. 기본 장비·에고·아티팩트의
보너스를 포함하고, 저항 약점과 음수 스탯은 합계에서 뺍니다. 미감정 장비와
일시적인 효과는 제외하며, 인벤토리·바닥·상점 재고에 같은 기준을 적용합니다.

## 소스와 빌드

- [HNS 규칙 및 네이티브 빌드](crawl-ref/docs/hns.md): `init.txt` 옵션과 부활 규칙.
- [모바일 개발 및 Android 빌드](mobile/README.md): Emscripten 엔진, UI, APK 빌드.
- [통합 빌드·릴리즈](.github/workflows/ci.yml): 엔진 컴파일, APK·PC와 전체 소스 패키징.
  단위·실행 테스트는 수동 `tests` 옵션으로 실행.
- [가져온 소스 버전 및 수정 범위](mobile/UPSTREAM.md),
  [저작권·출처 안내](mobile/ATTRIBUTION.md).

엔진은 GPL-2.0-or-later, 모바일 UI는 AGPL-3.0-or-later입니다.
릴리스에 포함된 전체 대응 소스와 각 라이선스 고지를 함께 제공합니다.

## 원본 DCSS 안내

Dungeon Crawl Stone Soup is a game of dungeon exploration, combat and magic, involving characters of diverse skills, worshipping deities of great power and caprice. To win, you'll need to be a master of tactics and strategy, and prevail against overwhelming odds.

## Contents

1. [How to Play](#how-to-play)
3. [Community](#community)
5. [How you can help](#how-you-can-help)
4. [License and history information](#license-and-history-information)

## How to Play

For information on how to install the game, please visit [the installation documentation](crawl-ref/INSTALL.md).

If you'd like to dive in immediately, we suggest one of:

* Start a game and pick a tutorial (select tutorial in the game menu),
* Read [quickstart.md](crawl-ref/docs/quickstart.md) (in the [docs/](crawl-ref/docs/) directory), or
* For the studious, [read Crawl's full manual](crawl-ref/docs/crawl_manual.rst).

There is also an ingame list of frequently asked questions which you can access by typing
`?Q`.

#### Internet Play

You can play Crawl online, competing with other players or watching them. Click "Play Online Now!" on [the Crawl homepage](https://crawl.develz.org/) to find your closest server. You can play in your browser or over SSH.

#### Offline Play

Both classical ASCII and tiles (GUI) versions of Crawl are available to [download for Linux, Windows and OS X](https://crawl.develz.org/download.htm).

## Community

* Our official homepage: [crawl.develz.org](https://crawl.develz.org/)
  * Online webtiles play
  * Offline downloads
  * Our community forum: [tavern.dcss.io](https://tavern.dcss.io/)
* [/r/roguelikes Discord](https://discord.gg/S5F2H32)
* The [/r/dcss subreddit](https://www.reddit.com/r/dcss/)
* IRC: #crawl on Libera (or #crawl-dev to chat development)

## How you can help

If you like the game and you want to help make it better, there are a number
of ways to do so. For a detailed guide to the crawl workflow, look at
the [contributor's guide](crawl-ref/docs/develop/contribution-process.md).

### Reporting bugs

At any time, there will be bugs -- finding and reporting them is a great help.
Many of the online servers host the regularly updated development version. Bugs
should be reported to [our github issue
tracker](https://github.com/crawl/crawl/issues). Thoughtful ideas on how to
improve interface or gameplay are welcome, but it's often best to
[discuss](#community) changes before opening an issue or pull request.

### Map making
Crawl creates levels by combining many hand-made (but often randomised) maps,
known as *vaults*. Making them is fun and easy. It's best to start with simple
entry vaults: see [simple.des](crawl-ref/source/dat/des/arrival/simple.des) for
examples. You can also read [the level-design manual](crawl-ref/docs/develop/levels/introduction.txt) for more help.

If you're ambitious, you can create new vaults for anywhere in the game. If
you've made some vaults, you can test them on your own system (no compiling
needed) and submit them via a github pull request. See the [contributor's guide](crawl-ref/docs/develop/contribution-process.md) for details.

### Monster Speech & Item Descriptions
Monster speech provides a lot of flavour. Just like vaults, varied speech depends
upon a large set of entries. Speech syntax is effective but unusual, so you may want to read [the formatting guide](crawl-ref/docs/develop/monster_speech.txt).

Current item descriptions can be read in-game with `?/` or out-of-game
them in [dat/descript/](crawl-ref/source/dat/descript/). The following conventions should be more or less obeyed:
* Descriptions ought to contain flavour text, ideally pointing out major weaknesses/strengths.
* No numbers, please.
* Citations are okay, but try to stay away from the most generic ones.

### Tiles
We're always open to improvements to existing tiles or variants of often-used
tiles (eg floor tiles). If you want to give this a shot, please [contact us](#community). In case you drew some tiles of your own, you can simply share
them with a developer or submit them via a github pull request. See the
[contributor's guide](crawl-ref/docs/develop/contribution-process.md) for
details.

### Patches
For developers (both existing & aspiring!), you can download/fork the source code and write patches. Bug fixes as well as new features are very much welcome.

For large changes, it's always a good idea to [talk with the dev team](#community) first, to see if any plans already exist and if your suggestion is likely to be accepted.

Please be sure to read [docs/develop/coding_conventions.md](crawl-ref/docs/develop/coding_conventions.md) too.

## License and history information

Crawl is licensed as GPLv2+. See [LICENSE](LICENSE) for the full text.

Crawl is a descendant of Linley's Dungeon Crawl. The final alpha of Linley's Dungeon Crawl (v4.1) was released by Brent Ross in 2005. Since 2006, the Dungeon Crawl Stone Soup team has continued development. [CREDITS.txt](crawl-ref/CREDITS.txt) contains a full list of contributors.

Crawl uses the following open source packages; thanks to their developers:

* The Lua scripting language, for in-game functionality and user macros ([license](crawl-ref/docs/license/lualicense.txt)).
* The PCRE library, for regular expressions ([license](crawl-ref/docs/license/pcre_license.txt)).
* The SQLite library, as a database engine ([license](https://www.sqlite.org/copyright.html)).
* The SDL and SDL_image libraries, for tiles display ([license](crawl-ref/docs/license/lgpl.txt)).
* The libpng library, for tiles image loading ([license](crawl-ref/docs/license/libpng-LICENSE.txt)).

Thank you, and have fun crawling!
