#include "AppHdr.h"

#include "hns-revival.h"

#include <map>
#include <chrono>

#include "files.h"
#include "json-wrapper.h"
#include "level-id.h"
#include "message.h"
#include "options.h"
#include "package.h"
#include "player.h"
#include "prompt.h"
#include "state.h"
#include "stringutil.h"
#include "syscalls.h"
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

bool hns_copy_checkpoint(package &save, const string &filename)
{
    if (!hns_has_checkpoint(save))
        return false;
    if (filename == save.get_filename())
        throw std::runtime_error("A recovery copy must not replace its source.");

    const string temporary = filename + ".hns-tmp-recovery";
    try
    {
        {
            package copy(temporary.c_str(), true, true);
            for (const auto &name : save.list_chunks())
                if (starts_with(name, checkpoint_prefix))
                {
                    const auto bytes = _read_chunk(save, name);
                    _write_chunk(copy, name.substr(checkpoint_prefix.size()), bytes);
                    _write_chunk(copy, name, bytes);
                }
            copy.commit();
        }
        if (rename_u(temporary.c_str(), filename.c_str()))
            throw std::runtime_error("Could not commit the death recovery copy.");
    }
    catch (...)
    {
        unlink_u(temporary.c_str());
        throw;
    }
    return true;
}

bool hns_keep_death_recovery()
{
    if (!Options.hns_revival || Options.no_save || !you.save
        || crawl_state.test || crawl_state.game_is_tutorial()
        || !hns_has_checkpoint(*you.save))
    {
        return true;
    }
    try
    {
        string directory = catpath(get_parent_directory(you.save->get_filename()),
                                   "recovery");
        if (!check_mkdir("Death recovery directory", &directory, true))
            throw std::runtime_error("Could not create the death recovery directory.");
        const string filename = catpath(directory,
                                       get_base_filename(you.save->get_filename()));
        hns_copy_checkpoint(*you.save, filename);
        JsonWrapper metadata(json_mkobject());
        json_append_member(metadata.node, "name", json_mkstring(you.your_name));
        const double when = std::chrono::duration<double, std::milli>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        json_append_member(metadata.node, "when", json_mknumber(when));
        json_append_member(metadata.node, "checkpoint", json_mkbool(true));
        const string text = metadata.to_string();
        const string info = change_file_extension(filename, ".json");
        const string temporary = info + ".hns-tmp-recovery";
        FILE *file = fopen_u(temporary.c_str(), "wb");
        if (!file)
            throw std::runtime_error("Could not write death recovery details.");
        const bool written = fwrite(text.data(), 1, text.size(), file) == text.size();
        const bool closed = fclose(file) == 0;
        if (!written || !closed || rename_u(temporary.c_str(), info.c_str()))
        {
            unlink_u(temporary.c_str());
            throw std::runtime_error("Could not commit death recovery details.");
        }
        mpr("A recovery copy was kept. Use Death recovery on the start screen.");
        return true;
    }
    catch (const std::exception &)
    {
        mprf(MSGCH_ERROR, "Could not keep a death recovery copy. Your existing saved game will be kept.");
        return false;
    }
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
