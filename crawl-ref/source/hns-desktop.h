#pragma once

// PC 관리 창의 저장 요청을 안전한 입력 시점에 처리합니다.
void hns_desktop_checkpoint(bool background = false);

// 저장 또는 게임 종료로 확정된 파일을 PC 관리 창에 전달합니다.
void hns_desktop_saved();

// 원본 메인 메뉴와 같은 SDL 창에서 HNS 설정·저장 기능을 엽니다.
bool hns_desktop_menu(int menu);
bool hns_desktop_menu_busy();
