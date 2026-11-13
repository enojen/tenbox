# The lane files

All three files live in the lane directory that the project file names. Fill the angle
brackets.

## The lane file `<name>.md`

```markdown
# <name>

<one line on what the lane is>.

## Tasks

In this order. The state of a task is in the tracker, not here.

1. [<task name>](<task link>)
2. [<task name>](<task link>): after <task>, when it waits for one

## Task notes

- <task>: where the change is; what must not change.

## Log

- <UTC date and time> · <task> · <a failure or a workaround of tenbox, the cluster or the project>

## Next step

1. <what to do next, in order>

Open spoken decisions: <what the user said that is not yet a file or a task, such as "leave it for now">
Running Jobs: <Job name> waits for <what>
```

The log is append-only. The two lines `Open spoken decisions:` and `Running Jobs:` are always
there, also when they are empty.

## The inbox `inbox-<name>.md`

One line per note:

```markdown
- <UTC date> · from <lane> · <the note>
```

Other lanes only append. The owner of the lane marks a line done and never deletes it.

## The lessons `lessons.md`

One file for the lane directory, append-only, one line per lesson:

```markdown
- <date> · <lane> · <task> · general|project · <lesson> · <reason>
```
