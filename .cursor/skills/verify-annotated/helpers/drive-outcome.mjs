export function classifyQuietList({
  httpStatus,
  title,
  expectedTitle,
  listCount,
  emptyVisible,
  unavailableVisible,
}) {
  const httpOk = Number.isInteger(httpStatus) && httpStatus >= 200 && httpStatus < 300;
  if (!httpOk) return { result: "fail", exitCode: 1, reason: "http" };
  if (title !== expectedTitle) return { result: "fail", exitCode: 1, reason: "title" };
  if (unavailableVisible) return { result: "fail", exitCode: 1, reason: "unavailable" };
  if (listCount > 0 && !emptyVisible) return { result: "pass", exitCode: 0, reason: "cards" };
  if (listCount === 0 && emptyVisible) return { result: "pass-empty", exitCode: 2, reason: "empty" };
  return { result: "fail", exitCode: 1, reason: "unrecognized" };
}
