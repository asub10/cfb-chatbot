"use client";

import { useState, useRef, useEffect } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId] = useState(() => crypto.randomUUID());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, conversationId }),
      });

      if (!res.ok) {
        // Try to surface the API error message if the response is JSON.
        let apiError = `Request failed (${res.status})`;
        try {
          const errBody = await res.json();
          if (typeof errBody.error === "string") apiError = errBody.error;
        } catch {
          // non-JSON error body — keep the generic message
        }
        throw new Error(apiError);
      }

      if (!res.body) {
        throw new Error("No response body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let firstChunk = true;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        if (firstChunk) {
          firstChunk = false;
          setMessages((prev) => [...prev, { role: "assistant", content: chunk }]);
        } else {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            return [
              ...prev.slice(0, -1),
              { ...last, content: last.content + chunk },
            ];
          });
        }
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: message },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const lastIsAssistant =
    messages.length > 0 && messages[messages.length - 1].role === "assistant";

  return (
    <main className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="px-6 py-4 border-b border-zinc-800 shrink-0">
        <h1 className="text-lg font-semibold tracking-tight">CFB Chatbot</h1>
      </header>

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && (
          <p className="text-center text-zinc-500 text-sm mt-20">
            Ask anything about college football.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-blue-600 text-white rounded-br-sm"
                  : "bg-zinc-800 text-zinc-100 rounded-bl-sm"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {/* Show "Thinking…" only while waiting for the first token */}
        {loading && !lastIsAssistant && (
          <div className="flex justify-start">
            <div className="bg-zinc-800 text-zinc-400 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm">
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 flex items-center gap-3 px-4 py-4 border-t border-zinc-800"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message CFB Chatbot…"
          className="flex-1 bg-zinc-800 rounded-xl px-4 py-2.5 text-sm placeholder-zinc-500 outline-none focus:ring-2 focus:ring-blue-600"
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl px-4 py-2.5 text-sm font-medium transition-colors"
        >
          Send
        </button>
      </form>
    </main>
  );
}
