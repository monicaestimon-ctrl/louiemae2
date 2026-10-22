import React, { useState, useRef, useEffect } from 'react';
import { FadeIn } from './FadeIn';
import { useSite } from '../contexts/BlogContext';
import { ArrowLeft, Calendar, Clock, Share2, Facebook, Twitter, Link2, Mail, MessageCircle, Check, X } from 'lucide-react';
import { responsiveImage } from '../lib/responsiveImage';

interface BlogPostViewProps {
    postId: string;
}

export const BlogPostView: React.FC<BlogPostViewProps> = ({ postId }) => {
    const { posts } = useSite();
    const post = posts.find(p => p.id === postId);
    const [showShareMenu, setShowShareMenu] = useState(false);
    const [copied, setCopied] = useState(false);
    const shareMenuRef = useRef<HTMLDivElement>(null);

    // Close share menu on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) {
                setShowShareMenu(false);
            }
        };
        if (showShareMenu) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showShareMenu]);

    if (!post) {
        return (
            <div className="min-h-screen bg-cream flex items-center justify-center">
                <FadeIn>
                    <h1 className="font-serif text-4xl text-earth opacity-50">Post not found...</h1>
                    <button
                        onClick={() => { window.location.hash = '#blog'; }}
                        className="mt-6 mx-auto block text-xs uppercase tracking-[0.2em] text-earth/50 hover:text-bronze transition-colors"
                    >
                        ← Back to Blog
                    </button>
                </FadeIn>
            </div>
        );
    }

    // Estimate reading time
    const wordCount = post.content.replace(/<[^>]*>/g, '').split(/\s+/).filter(Boolean).length;
    const readingTime = Math.max(1, Math.ceil(wordCount / 200));

    const shareUrl = `https://louiemae.com/#blog/${post.id}`;
    const shareTitle = post.title;
    const shareText = post.excerpt || post.title;

    const handleNativeShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
            } catch (err) {
                if ((err as Error).name !== 'AbortError') setShowShareMenu(true);
            }
        } else {
            setShowShareMenu(true);
        }
    };

    const handleCopyLink = async () => {
        try {
            await navigator.clipboard.writeText(shareUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = shareUrl;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const shareLinks = {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
        twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareTitle)}&url=${encodeURIComponent(shareUrl)}`,
        pinterest: `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(shareUrl)}&description=${encodeURIComponent(shareTitle)}&media=${encodeURIComponent(post.image || '')}`,
        linkedin: `https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(shareTitle)}`,
        email: `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(`${shareText}\n\nRead more: ${shareUrl}`)}`,
        sms: `sms:?&body=${encodeURIComponent(`${shareTitle} — ${shareUrl}`)}`,
    };

    const openShareWindow = (url: string) => {
        window.open(url, '_blank', 'width=600,height=400,noopener,noreferrer');
        setShowShareMenu(false);
    };

    const ShareButtons = ({ size = 'normal' }: { size?: 'normal' | 'large' }) => {
        const iconSize = size === 'large' ? 'w-5 h-5' : 'w-4 h-4';
        const btnClass = size === 'large'
            ? 'p-3 rounded-full hover:scale-110 transition-all duration-300'
            : 'p-2.5 rounded-full hover:scale-110 transition-all duration-300';

        return (
            <div className="flex flex-wrap items-center justify-center gap-2 md:gap-3">
                <button onClick={() => openShareWindow(shareLinks.facebook)} className={`${btnClass} bg-[#1877F2]/10 text-[#1877F2] hover:bg-[#1877F2] hover:text-white`} title="Share on Facebook">
                    <Facebook className={iconSize} />
                </button>
                <button onClick={() => openShareWindow(shareLinks.twitter)} className={`${btnClass} bg-black/5 text-earth hover:bg-black hover:text-white`} title="Share on X">
                    <Twitter className={iconSize} />
                </button>
                <button onClick={() => openShareWindow(shareLinks.pinterest)} className={`${btnClass} bg-[#E60023]/10 text-[#E60023] hover:bg-[#E60023] hover:text-white`} title="Share on Pinterest">
                    <svg className={iconSize} viewBox="0 0 24 24" fill="currentColor"><path d="M12 0a12 12 0 0 0-4.373 23.17c-.07-.63-.133-1.596.028-2.284l1.157-4.903s-.295-.59-.295-1.464c0-1.372.795-2.396 1.784-2.396.841 0 1.247.632 1.247 1.389 0 .846-.538 2.111-.815 3.283-.232.98.491 1.778 1.457 1.778 1.749 0 3.092-1.844 3.092-4.504 0-2.355-1.693-4-4.112-4-2.8 0-4.445 2.1-4.445 4.272 0 .846.326 1.753.733 2.246a.294.294 0 0 1 .068.283c-.075.31-.241.98-.274 1.117-.043.18-.144.218-.332.132-1.24-.578-2.015-2.393-2.015-3.853 0-3.137 2.28-6.02 6.576-6.02 3.453 0 6.138 2.46 6.138 5.749 0 3.43-2.163 6.192-5.166 6.192-1.009 0-1.958-.524-2.283-1.144l-.62 2.365c-.225.865-.832 1.95-1.238 2.61A12 12 0 1 0 12 0" /></svg>
                </button>
                <button onClick={() => openShareWindow(shareLinks.linkedin)} className={`${btnClass} bg-[#0A66C2]/10 text-[#0A66C2] hover:bg-[#0A66C2] hover:text-white`} title="Share on LinkedIn">
                    <svg className={iconSize} viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></svg>
                </button>
                <div className="w-px h-6 bg-earth/10 hidden md:block" />
                <a href={shareLinks.email} className={`${btnClass} bg-earth/5 text-earth/60 hover:bg-bronze hover:text-white`} title="Share via Email">
                    <Mail className={iconSize} />
                </a>
                <a href={shareLinks.sms} className={`${btnClass} bg-green-500/10 text-green-600 hover:bg-green-500 hover:text-white`} title="Share via Text">
                    <MessageCircle className={iconSize} />
                </a>
                <div className="w-px h-6 bg-earth/10 hidden md:block" />
                <button onClick={handleCopyLink} className={`${btnClass} ${copied ? 'bg-green-500 text-white' : 'bg-earth/5 text-earth/60 hover:bg-earth hover:text-white'}`} title={copied ? 'Copied!' : 'Copy link'}>
                    {copied ? <Check className={iconSize} /> : <Link2 className={iconSize} />}
                </button>
            </div>
        );
    };

    return (
        <div className="bg-cream min-h-screen pb-20 w-full overflow-hidden">
            <style>{`@keyframes blogFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
            {/* Hero Image */}
            {post.image && (
                <div className="w-full aspect-[16/9] md:aspect-[3/1] overflow-hidden relative">
                    <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-cream z-10" />
                    <img
                        loading="lazy"
                        decoding="async"
                        {...responsiveImage(post.image, '100vw')}
                        alt={post.title}
                        className="w-full h-full object-cover"
                    />
                </div>
            )}

            {/* Back Button + Share */}
            <div className="max-w-3xl mx-auto px-6 md:px-8 pt-10">
                <FadeIn>
                    <div className="flex items-center justify-between mb-12">
                        <button
                            onClick={() => { window.location.hash = '#blog'; }}
                            className="group flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-earth/40 hover:text-bronze transition-colors"
                        >
                            <ArrowLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
                            Back to Blog
                        </button>
                        {/* Share Button */}
                        <div className="relative" ref={shareMenuRef}>
                            <button
                                onClick={handleNativeShare}
                                className="group flex items-center gap-2 px-4 py-2 rounded-full bg-earth/5 hover:bg-bronze/10 text-earth/50 hover:text-bronze transition-all"
                            >
                                <Share2 className="w-4 h-4" />
                                <span className="text-[10px] uppercase tracking-[0.15em] font-medium">Share</span>
                            </button>
                            {/* Desktop dropdown menu */}
                            {showShareMenu && (
                                <div className="absolute right-0 top-full mt-2 bg-white rounded-2xl shadow-2xl border border-earth/10 p-4 z-50 animate-fade-in min-w-[280px]">
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="text-[10px] uppercase tracking-[0.2em] text-earth/40 font-medium">Share this story</span>
                                        <button onClick={() => setShowShareMenu(false)} className="text-earth/30 hover:text-earth">
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <ShareButtons />
                                </div>
                            )}
                        </div>
                    </div>
                </FadeIn>
            </div>

            {/* Post Header */}
            <article className="max-w-3xl mx-auto px-6 md:px-8">
                <>
                    <div
                        className="text-center mb-8 md:mb-12"
                        style={{ animation: 'blogFadeIn 0.4s ease-out both' }}
                    >
                        {/* Category & Meta */}
                        <div className="flex flex-wrap items-center justify-center gap-2 md:gap-4 mb-6 text-bronze/80 text-[10px] uppercase tracking-widest font-sans">
                            <span>{post.category}</span>
                            <span className="w-1 h-1 rounded-full bg-bronze/40" />
                            <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {post.date}
                            </span>
                            <span className="w-1 h-1 rounded-full bg-bronze/40" />
                            <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {readingTime} min read
                            </span>
                        </div>

                        {/* Title */}
                        <h1 className="font-serif text-4xl md:text-6xl text-earth mb-6 leading-tight">
                            {post.title}
                        </h1>

                        {/* Excerpt */}
                        {post.excerpt && (
                            <p className="font-serif text-earth/60 text-base md:text-xl italic leading-relaxed max-w-2xl mx-auto">
                                {post.excerpt}
                            </p>
                        )}

                        {/* Decorative divider */}
                        <div className="flex items-center justify-center gap-3 mt-6 md:mt-10">
                            <div className="h-px w-16 bg-earth/10" />
                            <div className="w-1.5 h-1.5 rounded-full bg-bronze/30" />
                            <div className="h-px w-16 bg-earth/10" />
                        </div>
                    </div>
                </>

                {/* Post Content */}
                <FadeIn threshold={0.01}>
                    <div
                        className="prose-blog font-serif text-lg text-earth leading-relaxed mb-12"
                        dangerouslySetInnerHTML={{ __html: post.content }}
                    />
                </FadeIn>

                {/* Automatic Signature */}
                <FadeIn threshold={0.01} delay={150}>
                    <div className="mt-16 mb-16 flex flex-col items-start">
                        <div className="h-px w-12 bg-bronze/20 mb-6" />
                        <p className="font-serif text-earth/50 text-lg italic leading-relaxed">simply,</p>
                        <p className="font-serif text-earth/70 text-2xl italic mt-1">mae</p>
                    </div>
                </FadeIn>

                {/* Share Footer */}
                <FadeIn threshold={0.01} delay={300}>
                    <div className="border-t border-earth/10 pt-10 mt-10">
                        <div className="flex flex-col items-center gap-5">
                            <span className="text-[9px] uppercase tracking-[0.3em] text-earth/30">Share this story</span>
                            <ShareButtons size="large" />
                            <button
                                onClick={() => { window.location.hash = '#blog'; }}
                                className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-earth/50 hover:text-bronze transition-colors border-b border-earth/10 pb-1 hover:border-bronze mt-4"
                            >
                                <ArrowLeft className="w-3 h-3" />
                                All Stories
                            </button>
                        </div>
                    </div>
                </FadeIn>
            </article>
        </div>
    );
};
