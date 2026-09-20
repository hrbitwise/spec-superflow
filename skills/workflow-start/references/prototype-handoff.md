# Optional Prototype Handoff

On-demand procedure for the prototype route; load it only after the brief
shows explicit UI/UX/product-experience uncertainty and the user confirms a
prototype would reduce it.

When the user's brief explicitly contains UI, screen, interaction, layout, UX,
or product-experience uncertainty, ask once whether a prototype would reduce
uncertainty. Do not create a prototype handoff or enter a prototype worktree
until the user confirms. After confirmation:

```bash
ssf handoff create <change-dir> \
  --type prototype --objective "<confirmed objective>" \
  --expected-output "<expected evidence>" --acceptance "<completion criterion>"
ssf isolate <change-dir> prototype-<handoff-id>
```

Never suggest or enter this route automatically for backend, CLI, configuration,
or internal-refactor work. Never pass `--force` to `ssf isolate` for prototype
work.
