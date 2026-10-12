import { useEffect, useRef } from "react";
import { QuestionForm } from "../../src/features/sessions/ui/QuestionForm";
import type { UserQuestionPrompt, UserQuestionReply } from "../../src/features/sessions/model/userQuestion";

export function QuestionCard({ prompt, disabled, onAnswer, onInteraction }: {
  prompt: UserQuestionPrompt;
  disabled: boolean;
  onAnswer: (requestId: number, reply: UserQuestionReply) => void;
  onInteraction: (requestId: number) => Promise<unknown>;
}) {
  const interaction = useRef<Promise<unknown> | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return <fieldset className="phone-question" disabled={disabled} aria-label="Answer the agent">
    <QuestionForm prompt={prompt} onInteraction={id => {
      // Hold the deadline once, without interrupting the initial tap or typing.
      interaction.current ??= onInteraction(id).finally(() => { interaction.current = undefined; });
    }} onReply={(id, reply) => {
      // A submit can share the first interaction event. Serialize behind it so
      // the native journal never holds two mutations at once.
      void Promise.resolve(interaction.current).then(() => { if (mounted.current) onAnswer(id, reply); });
    }} />
  </fieldset>;
}
