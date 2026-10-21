import { MessageCircleIcon } from "lucide-react";

export default function NoConversation() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
      <MessageCircleIcon className="size-12 text-primary/40" />
      <p>Choose a conversation to start chatting.</p>
    </div>
  );
}
