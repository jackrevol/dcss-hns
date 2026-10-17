#include "AppHdr.h"

#include "hns-revival.h"

#include <map>

#include "files.h"
#include "level-id.h"
#include "message.h"
#include "options.h"
#include "package.h"
#include "player.h"
#include "prompt.h"
#include "state.h"
#include "stringutil.h"
#include "unwind.h"

static const string checkpoint_prefix = "hns-revival/";

bool hns_has_checkpoint(package &save)
{
    return save.has_chunk(checkpoint_prefix + "you")
        && save.has_chunk(checkpoint_prefix + "chr");
}

static vector<char> _read_chunk(package &save, const string &name)
{
    vector<char> data;
    chunk_reader input(&save, name);
    input.read_all(data);
    return data;
}

static void _write_chunk(package &save, const string &name,
                         const vector<char> &data)
{
    chunk_writer output(&save, name);
    if (!data.empty())
        output.write(data.data(), data.size());
}

void hns_write_checkpoint(package &save)
{
    const auto chunks = save.list_chunks();
    for (const auto &name : chunks)
        if (starts_with(name, checkpoint_prefix))
            save.delete_chunk(name);

    // 다른 층도 함께 보관하여 층 이동 후 복원 시 아이템 복제를 막습니다.
    for (const auto &name : chunks)
        if (!starts_with(name, checkpoint_prefix))
            _write_chunk(save, checkpoint_prefix + name, _read_chunk(save, name));
    save.commit();
}

bool hns_restore_checkpoint(package &save)
{
    if (!hns_has_checkpoint(save))
        return false;

    // 읽기에 실패해도 현재 저장 상태를 건드리지 않도록 먼저 읽습니다.
    std::map<string, vector<char>> checkpoint;
    const auto chunks = save.list_chunks();
    for (const auto &name : chunks)
        if (starts_with(name, checkpoint_prefix))
        {
            checkpoint[name.substr(checkpoint_prefix.size())]
                = _read_chunk(save, name);
        }

    for (const auto &name : chunks)
        if (!starts_with(name, checkpoint_prefix))
            save.delete_chunk(name);
    for (const auto &entry : checkpoint)
        _write_chunk(save, entry.first, entry.second);
    save.commit();
    return true;
}

void hns_checkpoint()
{
    if (!Options.hns_revival || Options.no_save || !you.save
        || crawl_state.test || crawl_state.game_is_tutorial()
        || crawl_state.game_is_arena() || you.hp <= 0
        || you.pending_revival || !you.on_current_level)
    {
        return;
    }

    // 층 이동 도중의 턴 플래그를 로드 후에 다시 실행하지 않습니다.
    unwind_bool turn_over(you.turn_is_over, false);
    save_level(level_id::current());
    save_game(false);
    hns_write_checkpoint(*you.save);
}

void hns_offer_revival()
{
    if (!Options.hns_revival || Options.no_save || !you.save
        || crawl_state.test || crawl_state.game_is_tutorial()
        || crawl_state.seen_hups || !hns_has_checkpoint(*you.save))
    {
        return;
    }

    if (!yesno("Revive at the last level entry? Progress since then will be lost.",
               true, 'n'))
    {
        return;
    }

    const hns_revival revival = {get_base_filename(you.save->get_filename()),
                                crawl_state.type};
    hns_restore_checkpoint(*you.save);
    delete you.save;
    you.save = nullptr;
    crawl_state.need_save = false;
    throw revival;
}
