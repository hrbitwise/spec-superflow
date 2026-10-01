# Isolate Preflight Details (Full / legacy Hotfix)

按需加载资产：由 build-executor 入口在 Full / legacy Hotfix 隔离预检时读取。
非零退出即 STOP、`--force` 须经用户明确批准等硬门禁在入口正文恒可见；本文件只补充隔离行为细节。

`ssf isolate <change-dir>` on `main`/`master` creates a git worktree (preferred) or a new branch, and exits non-zero unless it can isolate or you approve `--force`.

On success, make all edits in the isolated branch/worktree:

- When a `.gitmodules` exists, submodules are recursively initialized.
- A non-zero exit also covers failed submodule initialization after the context was created — the worktree may be half-initialized; never implement on it.
- A cwd-persistence warning (isolation path + mandatory `cd` prefix) is appended to `<change-dir>/.superpowers/sdd/progress.md` so later calls do not silently edit the trunk.
