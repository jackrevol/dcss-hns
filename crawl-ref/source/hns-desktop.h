#pragma once

// PC 관리 창의 저장 요청을 안전한 입력 시점에 처리합니다.
void hns_desktop_checkpoint(bool background = false);

// 저장 또는 게임 종료로 확정된 파일을 PC 관리 창에 전달합니다.
void hns_desktop_saved();
