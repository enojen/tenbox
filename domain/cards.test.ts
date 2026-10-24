import { expect, test } from "bun:test";
import {
  type Card,
  canAutoAnswer,
  chosenOption,
  findAnswer,
  findCard,
  findNewest,
  getCard,
  isOpen,
  NEVER_AUTO_AREAS,
  nextCardId,
  QUESTION_AREA,
  type QuestionArea,
  type QuestionCard,
  readCard,
} from "./cards.ts";

const AT = "2026-10-22T09:06:00Z";
const FILE = "cards/0002-question.json";

/* The cards of the card model scenario, as the code reads them. */

const task = {
  id: 1,
  kind: "task",
  by: "tenbox",
  at: AT,
  task: "DEMO-7",
  title: "GET /health returns the app version",
  tracker: "linear",
  url: "https://linear.app/x",
};

const versionSource = {
  id: 2,
  kind: "question",
  by: "planner",
  at: AT,
  title: "Version source",
  area: "technical",
  options: [
    { text: "package.json", effect: "no deploy change" },
    { text: "env APP_VERSION", effect: "one more deploy variable" },
  ],
  taken: 1,
  reason: "package.json is already read at boot.",
};

const dbStatus = { ...versionSource, id: 3, title: "Should /health also report db status?" };

const plan = {
  id: 4,
  kind: "plan",
  by: "planner",
  at: AT,
  taskKind: "small",
  parts: [{ id: "01", difficulty: "easy" }],
  examples: [
    { part: "01", title: "health returns version", before: "404", after: "200 { version }" },
  ],
  lenses: [],
  groups: [],
  questions: [2, 3],
};

const envAnswer = { id: 5, kind: "answer", by: "user", at: AT, replyTo: 2, option: 2 };
const sameAnswer = { id: 6, kind: "answer", by: "user", at: AT, replyTo: 3, option: 1 };
const note = { id: 7, kind: "note", by: "user", at: AT, text: "Version bump happens in CI." };
const approval = { id: 8, kind: "approval", by: "user", at: AT, replyTo: 4, sha: "3f9a" };

const lockedFile = {
  id: 9,
  kind: "question",
  by: "worker",
  at: AT,
  round: 1,
  part: "01",
  title: "APP_VERSION needs a line in .env.example, which is locked",
  area: "locked-file",
  options: [
    { text: "add the line to .env.example", effect: "one locked file changes" },
    { text: "document it in README only", effect: "locked file untouched" },
  ],
  reason: "The example file is what devs copy.",
  auto: false,
};

const review = {
  id: 11,
  kind: "review",
  by: "reviewer",
  at: AT,
  round: 1,
  lenses: ["contract"],
  mustFix: ["src/health.ts:12 returns 200 with an empty version"],
  niceToHave: [],
  attention: [".env.example: locked file, one line added (answer 10)"],
  unproven: [],
};

const prQuestion = {
  id: 15,
  kind: "question",
  by: "user",
  at: AT,
  round: 2,
  path: "src/health.ts",
  line: 12,
  thread: 1883,
  area: "technical",
  title: "Why is APP_VERSION read on every request?",
};

const userReview = {
  id: 17,
  kind: "review",
  by: "user",
  at: AT,
  round: 2,
  pr: 12,
  questions: [15],
};

const workerAnswer = {
  id: 18,
  kind: "answer",
  by: "worker",
  at: AT,
  replyTo: 15,
  text: "No reason; reading once at boot would do.",
};

const SCENARIO: object[] = [
  task,
  versionSource,
  dbStatus,
  plan,
  envAnswer,
  sameAnswer,
  note,
  approval,
  lockedFile,
  review,
  prQuestion,
  userReview,
  workerAnswer,
];

const read = (card: object): Card => readCard(JSON.stringify(card), FILE);
const cards = SCENARIO.map(read);
const question = (card: object): QuestionCard => {
  const value = read(card);
  if (value.kind !== "question") throw new Error("not a question");
  return value;
};

test.each(SCENARIO)("card $id ($kind by $by) of the scenario matches its schema", (card) => {
  expect<object>(read(card)).toEqual(card);
});

test("a card that is not JSON, has no kind or an unknown kind is bad-file with the file name", () => {
  const badFile = expect.objectContaining({
    code: "bad-file",
    message: expect.stringContaining(FILE),
  });
  expect(() => readCard("{", FILE)).toThrow(badFile);
  expect(() => read({ id: 1, by: "user", at: AT })).toThrow(badFile);
  expect(() => read({ ...note, kind: "memo" })).toThrow(badFile);
});

test("a review by anyone but the reviewer or the user is bad-file", () => {
  expect(() => read({ ...review, by: "worker" })).toThrow(
    expect.objectContaining({ code: "bad-file" }),
  );
});

test("a question's taken must be the number of one of its options", () => {
  expect(() => read({ ...versionSource, taken: 3 })).toThrow(
    expect.objectContaining({ code: "bad-file" }),
  );
  expect(() => read({ ...prQuestion, taken: 1 })).toThrow(
    expect.objectContaining({ code: "bad-file" }),
  );
  expect(read({ ...prQuestion, options: [{ text: "a", effect: "b" }], taken: 1 })).toMatchObject({
    taken: 1,
  });
});

test("a question's deadline needs auto: true", () => {
  const deadline = "2026-10-22T10:42:00Z";
  expect(() => read({ ...lockedFile, deadline })).toThrow(
    expect.objectContaining({ code: "bad-file" }),
  );
  expect(read({ ...lockedFile, area: "scope", auto: true, deadline })).toMatchObject({ deadline });
});

test("an answer needs an option or a text", () => {
  expect(() => read({ id: 5, kind: "answer", by: "user", at: AT, replyTo: 2 })).toThrow(
    expect.objectContaining({ code: "bad-file" }),
  );
});

test("findCard gives null and getCard throws no-card for a missing id", () => {
  expect(findCard(cards, 1)).toEqual(read(task));
  expect(findCard(cards, 10)).toBeNull();
  expect(getCard(cards, 4)).toEqual(read(plan));
  expect(() => getCard(cards, 10)).toThrow(expect.objectContaining({ code: "no-card" }));
});

test("findNewest gives the card of a kind with the largest id, whatever the order", () => {
  expect(findNewest(cards, "review")?.id).toBe(17);
  expect(findNewest([...cards].reverse(), "review")?.id).toBe(17);
  expect(findNewest(cards, "plan")?.id).toBe(4);
  expect(findNewest([], "plan")).toBeNull();
});

test("findAnswer gives the newest answer to a question, null when nobody answered", () => {
  const later = read({ ...envAnswer, id: 12, option: 1 });
  expect(findAnswer(cards, question(versionSource))?.id).toBe(5);
  expect(findAnswer([...cards, later], question(versionSource))?.id).toBe(12);
  expect(findAnswer(cards, question(lockedFile))).toBeNull();
});

test("chosenOption is the newest answer's option, else taken, else null", () => {
  expect(chosenOption(cards, question(versionSource))).toBe(2);
  expect(chosenOption(cards, question(dbStatus))).toBe(1);
  expect(chosenOption([], question(versionSource))).toBe(1);
  expect(chosenOption(cards, question(lockedFile))).toBeNull();
  expect(chosenOption(cards, question(prQuestion))).toBeNull();
});

test("a question is open with no taken and no answer", () => {
  expect(isOpen(cards, question(lockedFile))).toBe(true);
  expect(isOpen(cards, question(prQuestion))).toBe(false);
  expect(isOpen([], question(prQuestion))).toBe(true);
  expect(isOpen([], question(versionSource))).toBe(false);
});

const AUTO_AREAS = QUESTION_AREA.filter((area) => !NEVER_AUTO_AREAS.includes(area));

test.each([...NEVER_AUTO_AREAS])("area %s is never auto-answered", (area: QuestionArea) => {
  expect(canAutoAnswer(question({ ...lockedFile, area, auto: true }))).toBe(false);
});

test.each(AUTO_AREAS)("area %s with auto true may be auto-answered", (area: QuestionArea) => {
  expect(canAutoAnswer(question({ ...lockedFile, area, auto: true }))).toBe(true);
  expect(canAutoAnswer(question({ ...lockedFile, area, auto: false }))).toBe(false);
  expect(canAutoAnswer(question({ ...prQuestion, area }))).toBe(false);
});

test("nextCardId is the largest id plus one, 1 for no cards", () => {
  expect(nextCardId(cards)).toBe(19);
  expect(nextCardId([read(task)])).toBe(2);
  expect(nextCardId([])).toBe(1);
});
