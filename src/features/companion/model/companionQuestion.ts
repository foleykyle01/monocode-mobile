import { CUSTOM_OPTION_ID, isCustomSelection, questionIsComplete, type UserQuestionPrompt, type UserQuestionReply } from "../../sessions/model/userQuestion";

/** Never shorten a question or choice: the phone must answer what the Mac asked. */
export function companionQuestion(prompt: UserQuestionPrompt | undefined) {
  if (!prompt || !Number.isSafeInteger(prompt.requestId) || !prompt.questions.length
    || prompt.questions.length > 20 || JSON.stringify(prompt).length > 32_768
    || prompt.questions.some(question => question.options.length > 50)) return undefined;
  return prompt;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid question reply");
  return value as Record<string, unknown>;
}

export function validateQuestionReply(prompt: UserQuestionPrompt, value: unknown): UserQuestionReply {
  const reply = record(value);
  if (reply.kind === "skipped" && Object.keys(reply).length === 1) return { kind: "skipped" };
  if (reply.kind !== "answered" || Object.keys(reply).some(key => !["kind", "answers", "custom"].includes(key)))
    throw new Error("Invalid question reply");
  const answers = record(reply.answers);
  const custom = reply.custom === undefined ? {} : record(reply.custom);
  const ids = new Set([...Object.keys(answers), ...Object.keys(custom)]);
  if (!ids.size || JSON.stringify(value).length > 32_768) throw new Error("Invalid question reply");
  for (const id of ids) {
    const question = prompt.questions.find(entry => entry.id === id);
    if (!question) throw new Error("Invalid question ID");
    const selected = Object.prototype.hasOwnProperty.call(answers, id) ? answers[id] : [];
    const free = Object.prototype.hasOwnProperty.call(custom, id) ? custom[id] : undefined;
    if (!Array.isArray(selected) || selected.length > 50 || new Set(selected).size !== selected.length
      || selected.some(option => typeof option !== "string" || (!question.options.some(entry => entry.id === option)
        && !(option === CUSTOM_OPTION_ID && question.allowCustom)))) throw new Error("Invalid question choice");
    if (selected.some(option => isCustomSelection(question, option)) && !question.allowCustom)
      throw new Error("Custom answers are unavailable for this question");
    if (free !== undefined && (typeof free !== "string" || !free.trim() || free.length > 8_192 || !question.allowCustom
      || (selected.length > 0 && !selected.some(option => isCustomSelection(question, option)))))
      throw new Error("Invalid custom answer");
    if (!questionIsComplete(question, { [id]: selected }, typeof free === "string" ? { [id]: free } : {}))
      throw new Error("Question answer is incomplete");
  }
  return { kind: "answered", answers: answers as Record<string, string[]>, ...(reply.custom === undefined ? {} : { custom: custom as Record<string, string> }) };
}
