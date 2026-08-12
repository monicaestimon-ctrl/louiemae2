import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Loader2 } from 'lucide-react';
import { useAction } from 'convex/react';
import { api } from '../convex/_generated/api';
import { ChatMessage } from '../types';

export const AiConcierge: React.FC = () => {
  const generateConciergeResponse = useAction(api.ai.generateConciergeResponse);
  const [clientToken] = useState(() => {
    const storageKey = 'louie-mae-concierge-token';
    const existing = window.sessionStorage.getItem(storageKey);
    const generated = typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (!existing) window.sessionStorage.setItem(storageKey, generated);
    return existing || generated;
  });
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'model', text: 'Welcome to Louie Mae. I am your personal design concierge. How may I assist you in curating your space or style today?' }
  ]);
  const [isLoading, setIsLoading] = useState(false);
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
    setMessages(prev => [...prev, { role: 'user', text: userText }]);
    setIsLoading(true);

    try {
      const reply = await generateConciergeResponse({
        userMessage: userText,
        history: messages.map(({ role, text }) => ({ role, text })),
        clientToken,
      });
      setMessages(prev => [...prev, { role: 'model', text: reply }]);
    } catch (error) {
      console.error('Concierge request failed:', error);
      setMessages(prev => [...prev, {
        role: 'model',
        text: 'I am currently assisting other clients. Please try again in a moment.',
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {/* Chat Window */}
      {isOpen && (
        <div className="glass-panel w-[90vw] md:w-96 h-[500px] mb-4 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fade-in-up">
          {/* Header */}
          <div className="bg-earth text-cream p-4 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-bronze" />
              <h3 className="font-serif text-lg tracking-wide">Concierge</h3>
            </div>
            <button onClick={() => setIsOpen(false)} className="hover:text-bronze transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-cream/50" ref={scrollRef}>
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] p-3 text-sm rounded-lg leading-relaxed ${msg.role === 'user'
                      ? 'bg-bronze text-white rounded-br-none'
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
                  <span className="text-xs text-earth/60 font-sans">Curating response...</span>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-4 bg-white border-t border-sand">
            <div className="relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask about decor, sizing, or styling..."
                className="w-full bg-cream-dark/50 border border-sand rounded-full py-3 pl-4 pr-12 text-sm text-earth focus:outline-none focus:border-bronze transition-colors placeholder:text-earth/40"
              />
              <button
                onClick={handleSend}
                disabled={isLoading}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-earth rounded-full text-white hover:bg-bronze transition-colors disabled:opacity-50"
              >
                <Send className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="group relative flex items-center justify-center w-14 h-14 bg-earth text-white rounded-full shadow-lg hover:bg-bronze transition-all duration-300 hover:scale-105"
      >
        <div className="absolute inset-0 bg-white/10 rounded-full animate-pulse"></div>
        {isOpen ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
      </button>
    </div>
  );
};
