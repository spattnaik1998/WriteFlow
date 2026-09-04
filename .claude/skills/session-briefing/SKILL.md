---
name: session-briefing
description: Produce an end-of-session briefing on the development work just done — what changed, what was decided, what is unfinished, and what to pick up next. Use when the user says they are wrapping up, ending the session, stopping for the day, or asks for a recap, briefing, or summary of the session's work. Also offer it unprompted when a stretch of work reaches a natural close.
---

# Session briefing

Close a working session the way WriteFlow closes a reading session: state what
actually happened, name the threads worth keeping, and leave a clear handle to
pick up next time.

This mirrors `generateSessionRecap` in `services/openai.js` — stats, what you
were working on, key threads, where to pick up — applied to development work
instead of reading notes.

## Gather the evidence first

Never write the briefing from memory of the conversation. Run these and report
what they say:

```bash
git log --oneline <first-commit-of-session>~1..HEAD   # or: --since="6 hours ago"
git diff --stat <first-commit-of-session>~1..HEAD
git status --short                                    # uncommitted work
git log origin/master..HEAD --oneline                 # unpushed commits
npm test                                              # current, not remembered, state
```

In this repo also check, because both matter to the user's next move:

```bash
git worktree list                                     # master vs stable positions
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health   # writing copy
ls -t backups/ | head -3                              # most recent restore point
```

If a command fails or you skip one, say so in the briefing rather than
quietly leaving that line out.

## Structure

Four sections, in this order. Keep the whole thing scannable — the point is to
be readable at the end of a long session, not exhaustive.

**Stats.** One short table or line: commits, files changed, lines added/removed,
test result. Numbers from the commands above, not estimates.

**What you were working on.** Two or three sentences of plain narrative. What
the session was actually about, in terms of the problem — not a list of file
edits. This is the part the user reads first.

**Key threads.** Three to five bullets covering what was *decided* or
*discovered*, not what was typed. A bug's root cause, a design choice and why it
went that way, an assumption that turned out wrong, a measurement that changed
the plan. If a commit only moved code around, it does not belong here.

**To pick up where you left off.** The single most useful next action, then any
decisions waiting on the user. Every item names what is blocked and why.

## Rules

**Every claim traces to something checkable.** A commit SHA, a `file:line`, a
test result, a measured number. If you did not verify it this session, do not
assert it — say what you assumed and what would confirm it.

**Report what is unfinished as prominently as what is done.** Work left broken,
scope you cut, a test you did not write, a decision you deferred. A briefing
that reads as uniformly successful is not useful. If something failed, quote the
failure.

**Separate what shipped from what is only local.** Uncommitted changes and
unpushed commits are not finished work; say which is which.

**Flag anything that touched shared or irreversible state.** In this repo that
means: writes to Supabase (one project, shared by both worktrees, no undo at the
database layer), deletions, schema changes, and whether a backup was taken
first. Also say whether `stable` moved — the user writes in that worktree on
port 3000 and needs to know if it changed under them.

**No filler.** No "great progress", no restating the request back, no
congratulation. Warm and precise, like a colleague who watched the work — the
tone the app's own recap prompt asks for.

**Say the boring truth.** If the session produced little, say that and why.
