# DCSS HNS

원본: [crawl/crawl](https://github.com/crawl/crawl)

기준 커밋: `2a00050befbedc033ed8b964f20b63dcabf03cb7` (`master`, 2026-10-17)

## 아이템 생성량 3배

일반 던전 바닥에 무작위로 배치되는 아이템의 생성 횟수를 원본의 3배로
늘립니다. 평범한 층은 6~30회에서 18~90회로, 보물이 많은 층은
9~88회에서 27~264회로 증가합니다. 생성되는 물건에는 장비, 소모품, 금화가
포함됩니다. 아이템 금지 분기의 생성량은 계속 0입니다.

몬스터가 착용한 장비, 상점 재고, 신의 선물, 획득의 두루마리, 맵에 명시된
보상은 수량 배율의 적용 대상이 아닙니다. 이 게임은 일반적인 몬스터별 전리품
확률표 대신 던전 생성 시 배치한 아이템과 몬스터의 실제 소지품을 사용합니다.
배치 가능한 바닥이나 아이템 슬롯이 부족하면 실제 생성량은 줄어들 수 있습니다.

## 생성 품질 인자 2배

같은 일반 바닥 아이템에 전달하는 `item_level`을 분기별 보정 이후 2배로
높입니다. 원본의 일반 아이템 품질 상한인 50은 유지합니다.
`item_level`은 0부터 시작하므로 D:1의 품질 인자 0은 그대로입니다.

이 인자는 장비 종류, 강화 수치, 브랜드, 아티팩트 생성 등 여러 확률식에
사용됩니다. 따라서 실제 강화 수치나 아티팩트 확률이 일률적으로 정확히
2배가 되는 것은 아닙니다. 품질 인자를 사용하지 않는 아이템에는 품질
배율이 영향을 주지 않습니다. 몬스터의 장비 품질도 바뀌지 않습니다.

수량과 품질 배율은 `source/dungeon.cc`의 `_builder_items()`에서 조정합니다.

## 던전의 악의 제거

새 지형을 발견할 때 발생하던 악의 확률 판정과 낙하, 강제 순간이동,
경보 효과를 제거했습니다. 관련 지연 실행 상태, 위저드 명령, 힌트,
Ashenzari의 악의 방어 안내도 정리했습니다.

맵에 배치된 함정, 몬스터의 능력, 지옥 효과, Zot 시간 제한은 별개의
시스템이므로 기존 규칙을 따릅니다. 힌트 열거형의 기존 번호는 저장 파일
호환성을 위해 예약 상태로 유지합니다.

## 빌드 및 검증

Ubuntu / Debian 콘솔 빌드의 예입니다.
태그가 없는 체크아웃에서는 포함된 `source/util/release_ver` 파일의
`0.35-a0-hns`를 빌드 버전으로 사용합니다.

```sh
sudo apt-get update
sudo apt-get install build-essential pkg-config libncursesw5-dev \
    liblua5.4-dev libsqlite3-dev libpcre3-dev zlib1g-dev bison flex python3-yaml
git clone https://github.com/jackrevol/dcss-hns.git
cd dcss-hns/crawl-ref/source
make -j4
./crawl
```

테스트 및 코드 스타일 검사:

```sh
make -j4 catch2-tests
util/checkwhite -n
util/unbrace -n
```

타일 버전과 Windows 빌드는 [원본 설치 안내](../INSTALL.md)를 참고하세요.
원본과 같은 GPLv2+ 라이선스를 적용하며 기존 저작권 및 라이선스 고지를
유지합니다.

### 검증 기록 (2026-10-17)

- Ubuntu 22.04 / GCC 11.4.0에서 콘솔 실행 파일과 Catch2 테스트를 빌드했습니다.
- Catch2: 67개 테스트, 9,299개 검증을 모두 통과했습니다.
- 기존 `seed_explorer.lua` 스크립트로 시드 1~5의 D:1~D:5를 생성하고
  바닥 아이템 배치를 확인했습니다.
- 수정 파일의 `checkwhite`, `unbrace`, `git diff --check`를 통과했습니다.
- Windows 및 타일 버전은 빌드하지 않았습니다.
