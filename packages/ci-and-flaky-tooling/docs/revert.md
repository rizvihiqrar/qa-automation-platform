# Undoing a Bad Merge: Revert, Don't Rewrite

A bad change is merged into the shared branch and the suite goes red. There are two ways out. One adds a commit. The other rewrites the branch. This page is built from a script that runs both in a throwaway repository (`npm run revert-demo`, tested in `test/revert.test.ts`).

## The Right Way: git revert

```bash
git revert -m 1 <the merge commit>   # a new commit that undoes the merge
git push origin main                 # an ordinary push: no --force
```

`-m 1` is needed for a merge commit: it says which side to keep (parent 1 is main, so the revert removes what the branch added). The revert is a new commit on top, so nobody's clone stops fitting.

What the script shows, in a scratch repository with a local "origin" and two clones:

| Step | Suite |
|---|---|
| The good commit is on main | green |
| A bad change is merged and pushed | red |
| A teammate pulls it and commits their own work on top | not run |
| The merge is reverted and pushed with an ordinary push | green |
| The teammate pulls: their commit stays and the revert arrives | green |

The history still shows the bad merge, then the revert: `Revert "Merge pull request: tweak total"`, `Merge pull request: tweak total`, `Tweak total`, `Add total and its tests`. That is on purpose: the record of what went wrong stays, and so does the way it was undone.

## The Wrong Way: reset and force-push

```bash
git reset --hard <the commit before the merge>
git push --force origin main
```

The suite goes green and the history looks clean, but only for the person who pushed. In the script, the teammate who had pulled the bad merge and committed on top of it:

- sees no error: `git pull` says they are up to date, because the shared branch is now an ancestor of theirs;
- pushes their next commit as usual, and git accepts it as a fast-forward;
- and that push puts the bad merge back on the shared branch. The suite is red again.

Anyone who has already pulled the old history has to find out by themselves, and a force-push can also throw away a commit someone pushed in between. So on a shared branch, nobody rewrites history; a revert is the fix. (A branch only you have pushed is yours to rewrite.)

## Measure

The script times the gap from the bad merge being pushed to the suite going green after the revert. On the scratch repository that is about a second, almost all of it the two suite runs. It stands in for CI: on a real pipeline the figure is the revert, the push, the queue and the run time, and it is the number to watch (the quality report's time to fix a red main measures it from real runs).

## A Rule for the Team

- Red main: revert first, find the cause afterwards. The fix can come back as a new pull request.
- `--force` is not used on a shared branch. A force-push to main is blocked by the repository's ruleset.
- A revert of a merge needs `-m 1`. Without it git refuses: it cannot know which side to keep.
