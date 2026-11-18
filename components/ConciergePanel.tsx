import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Loader2 } from 'lucide-react';
import { useAction } from 'convex/react';
import { api } from '../convex/_generated/api';
import { ChatMessage } from '../types';

export const ConciergePanel: React.FC<{ open: boolean; onClose: () => void }> = ({
  open: isOpen,
  onClose,
}) => {
  const generateConciergeResponse = useAction(api.ai.generateConciergeResponse);
  const [clientToken] = useState(() => {
    const storageKey = 'louie-mae-concierge-token';
    try {
      const existing = window.sessionStorage.getItem(storageKey);
      if (existing) return existing;
    } catch {
      /* Current-visit token works without storage. */
    }
    const generated =
      typeof window.crypto.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      window.sessionStorage.setItem(storageKey, generated);
    } catch {
      /* Storage is optional. */
    }
    return generated;
  });
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'model',
      text: 'Welcome to Louie Mae. I am your personal design concierge. How may I assist you in curating your space or style today?',
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userText = input;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: userText }]);
    setIsLoading(true);

    try {
      const reply = await generateConciergeResponse({
        userMessage: userText,
        history: messages.slice(-8).map(({ role, text }) => ({ role, text })),
        clientToken,
      });
      setMessages((prev) => [...prev, { role: 'model', text: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'model',
          text: 'I am currently assisting other clients. Please try again in a moment.',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;
  return (
    <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 md:bottom-24 md:right-6 z-50 flex flex-col items-end">
      {/* Chat Window */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Louie Mae concierge"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              onClose();
            }
          }}
          className="glass-panel w-[calc(100vw-2rem)] sm:w-96 h-[min(500px,calc(100svh-7.5rem))] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fade-in-up"
        >
          {/* Header */}
          <div className="bg-earth text-cream p-4 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-bronze" />
              <h2 className="font-serif text-lg tracking-wide">Concierge</h2>
            </div>
            <button
              onClick={onClose}
              aria-label="Close the concierge"
              className="-mr-2 min-h-11 min-w-11 p-2 hover:text-bronze transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages */}
          <div
            role="log"
            tabIndex={0}
            aria-label="Conversation"
            aria-live="polite"
            aria-relevant="additions"
            className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-4 bg-cream/50"
            ref={scrollRef}
          >
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] p-3 text-sm rounded-lg leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-earth text-cream rounded-br-none'
                      : 'bg-white border border-sand text-earth rounded-bl-none shadow-sm'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white border border-sand p-3 rounded-lg rounded-bl-none shadow-sm flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-bronze" />
                  <span className="text-xs text-muted-earth font-sans">Curating response...</span>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-4 bg-white border-t border-sand">
            <div className="relative">
              <input
                ref={inputRef}
                maxLength={800}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleSend()}
                placeholder="Ask about decor, sizing, or styling..."
                aria-label="Ask the concierge"
                enterKeyHint="send"
                className="w-full bg-cream-dark/50 border border-sand rounded-full py-3 pl-4 pr-12 text-base sm:text-sm text-earth focus:outline-none focus:border-bronze transition-colors placeholder-readable"
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                aria-label="Send"
                className="absolute right-2 top-1/2 -translate-y-1/2 min-h-11 min-w-11 p-2 bg-earth rounded-full text-white hover:bg-bronze transition-colors disabled:opacity-50"
              >
                <Send className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
