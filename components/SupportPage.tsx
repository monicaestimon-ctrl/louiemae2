
import React, { useState, useEffect } from 'react';
import { FadeIn } from './FadeIn';
import {
    Truck, RotateCcw, HelpCircle, Mail, Shield, ChevronDown,
    Clock, Package, AlertCircle, Heart, Send, CheckCircle
} from 'lucide-react';

// --- FAQ Data ---
const FAQ_ITEMS = [
    {
        q: 'How long does shipping take?',
        a: 'Ashcroft orders use Economy delivery. Timing depends on stock, processing, destination, and carrier scheduling. We will share tracking and delivery updates once your order ships.'
    },
    {
        q: 'Do you offer free shipping?',
        a: 'Delivery is charged per item: lighting $19; benches, dining chairs, and stools $29; ottomans $39; accent chairs $49; dining tables and sofas $79; sectionals $99. Each product shows its delivery fee, and your cart shows the combined charge before payment.'
    },
    {
        q: 'What is your return policy?',
        a: 'We accept returns within 15 days of delivery. Items must be unworn, unwashed, and in their original condition with tags attached. Please visit the Shipping & Returns section above for full details.'
    },
    {
        q: 'How do I know what size to order?',
        a: "Because we curate pieces from different makers and vendors, sizing can vary slightly between items. We recommend checking the size chart on each product page and, when in doubt, sizing up. If something doesn't fit just right, our return policy has you covered."
    },
    {
        q: 'Are your products made by Louie Mae?',
        a: "Currently, we personally curate every single piece in our collection from trusted vendors and artisans around the world. Each item is hand-selected to meet our standards for quality, style, and craftsmanship. Our dream is to one day offer exclusive Louie Mae-designed pieces alongside our curated selections — stay tuned!"
    },
    {
        q: 'How do I track my order?',
        a: "Once your order ships, you'll receive a confirmation email with a tracking number. You can use this to follow your package every step of the way. If you don't see a tracking email, check your spam folder or reach out to us at withlove@louiemae.com."
    },
    {
        q: 'Can I cancel or modify my order?',
        a: "We process orders quickly to get them to you fast! If you need to make a change, please contact us within 24 hours of placing your order and we'll do our best to accommodate. After that window, we may not be able to modify or cancel."
    },
    {
        q: 'Is my payment information secure?',
        a: 'Absolutely. We use industry-standard SSL encryption to protect your personal and payment information. We never store your full credit card details — all transactions are processed securely through our trusted payment partners.'
    },
    {
        q: 'Do you ship internationally?',
        a: "At this time, we ship within the United States. International shipping is something we're actively working toward — sign up for The Mae Letter to be the first to know when we expand!"
    },
    {
        q: 'What if my item arrives damaged?',
        a: "We're so sorry if that happens! Please contact us at withlove@louiemae.com within 48 hours of delivery with photos of the damage, and we'll make it right — whether that's a replacement or a full refund."
    },
];

// --- Section Nav ---
const SECTIONS = [
    { id: 'shipping', label: 'Shipping & Returns', icon: Truck },
    { id: 'faq', label: 'FAQ', icon: HelpCircle },
    { id: 'contact', label: 'Contact Us', icon: Mail },
    { id: 'privacy', label: 'Privacy Policy', icon: Shield },
];

interface SupportPageProps {
    section?: string;
}

export const SupportPage: React.FC<SupportPageProps> = ({ section }) => {
    const [openFaq, setOpenFaq] = useState<number | null>(null);
    const [contactForm, setContactForm] = useState({ name: '', email: '', subject: '', message: '' });
    const [contactStatus, setContactStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

    const prevSectionRef = React.useRef<string | undefined>(undefined);

    // Scroll to the correct section whenever the section prop changes
    useEffect(() => {
        if (section && section !== prevSectionRef.current) {
            prevSectionRef.current = section;
            // Use requestAnimationFrame to ensure DOM is painted
            requestAnimationFrame(() => {
                const el = document.getElementById(`support-${section}`);
                if (el) {
                    el.scrollIntoView({ behavior: 'instant', block: 'start' });
                }
            });
        }
    }, [section]);

    const handleContactSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!contactForm.email || !contactForm.message) return;
        setContactStatus('sending');
        // Simulate sending (in production, connect to a backend/email service)
        setTimeout(() => {
            setContactStatus('sent');
            setContactForm({ name: '', email: '', subject: '', message: '' });
        }, 1500);
    };

    const scrollToSection = (id: string) => {
        const el = document.getElementById(`support-${id}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    return (
        <div className="bg-cream min-h-screen pt-32 md:pt-40 pb-20">

            {/* Hero */}
            <div className="text-center px-6 mb-16">
                <FadeIn>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-bronze mb-5 mx-auto">We're Here For You</p>
                    <h1 className="font-serif text-5xl md:text-7xl text-earth mb-6">Support</h1>
                    <p className="font-sans text-earth/60 text-sm max-w-lg mx-auto leading-relaxed">
                        Everything you need to know about shopping with Louie Mae — from shipping and returns to getting in touch.
                    </p>
                </FadeIn>
            </div>

            {/* Section Quick Nav */}
            <FadeIn delay={100}>
                <div className="flex flex-wrap justify-center gap-3 px-6 mb-20">
                    {SECTIONS.map((s) => (
                        <button
                            key={s.id}
                            onClick={() => scrollToSection(s.id)}
                            className="flex items-center gap-2 px-5 py-2.5 border border-earth/10 rounded-full text-[10px] uppercase tracking-widest text-earth/60 hover:text-earth hover:border-earth/30 hover:bg-white/50 transition-all"
                        >
                            <s.icon className="w-3.5 h-3.5" />
                            {s.label}
                        </button>
                    ))}
                </div>
            </FadeIn>

            <div className="max-w-3xl mx-auto px-6 space-y-24">

                {/* ═══════════════════════════════════════════
                SHIPPING & RETURNS
            ═══════════════════════════════════════════ */}
                <section id="support-shipping">
                    <FadeIn>
                        <div className="flex items-center gap-3 mb-8">
                            <div className="w-10 h-10 rounded-full bg-earth/5 flex items-center justify-center">
                                <Truck className="w-5 h-5 text-bronze" />
                            </div>
                            <h2 className="font-serif text-3xl md:text-4xl text-earth">Shipping & Returns</h2>
                        </div>

                        {/* Shipping */}
                        <div className="mb-12">
                            <h3 className="font-serif text-xl text-earth mb-4 flex items-center gap-2">
                                <Package className="w-4 h-4 text-bronze/60" /> Shipping
                            </h3>
                            <div className="bg-white/60 rounded-2xl border border-earth/5 p-6 md:p-8 space-y-4">
                                <p className="font-sans text-earth/80 text-sm leading-relaxed">
                                    Our Ashcroft collection ships with <strong>Economy delivery</strong>. Each piece shows its delivery fee, and delivery is added per item in your cart before payment.
                                </p>
                                <p className="font-sans text-earth/80 text-sm leading-relaxed">
                                    Timing depends on availability, order processing, destination, and carrier scheduling. Contact us before ordering if you need a specific arrival date or special delivery arrangements.
                                </p>
                                <div className="flex items-start gap-3 bg-cream/80 rounded-xl p-4 mt-4">
                                    <Clock className="w-4 h-4 text-bronze mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="font-sans text-earth text-xs font-medium uppercase tracking-wider mb-1">Estimated Delivery</p>
                                        <p className="font-sans text-earth/70 text-sm">Tracking and delivery updates provided after dispatch</p>
                                    </div>
                                </div>
                                <p className="font-sans text-earth/60 text-xs italic">
                                    Once your order ships, you'll receive a tracking number via email so you can follow it every step of the way.
                                </p>
                            </div>
                        </div>

                        {/* Returns */}
                        <div>
                            <h3 className="font-serif text-xl text-earth mb-4 flex items-center gap-2">
                                <RotateCcw className="w-4 h-4 text-bronze/60" /> Returns
                            </h3>
                            <div className="bg-white/60 rounded-2xl border border-earth/5 p-6 md:p-8 space-y-4">
                                <p className="font-sans text-earth/80 text-sm leading-relaxed">
                                    We want you to love every piece you receive. If something isn't quite right, we accept returns within <strong>15 days of delivery</strong>.
                                </p>
                                <div className="space-y-3">
                                    <p className="font-sans text-earth text-xs font-medium uppercase tracking-wider">To be eligible for a return:</p>
                                    <ul className="space-y-2">
                                        {[
                                            'Items must be unworn, unwashed, and in their original condition',
                                            'All original tags must be attached',
                                            'Items must be returned in their original packaging',
                                            'Return must be initiated within 15 days of delivery date',
                                        ].map((item, i) => (
                                            <li key={i} className="flex items-start gap-2 text-sm text-earth/70">
                                                <span className="w-1.5 h-1.5 rounded-full bg-bronze/40 mt-1.5 flex-shrink-0" />
                                                {item}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                                <div className="flex items-start gap-3 bg-cream/80 rounded-xl p-4 mt-4">
                                    <AlertCircle className="w-4 h-4 text-earth/50 mt-0.5 flex-shrink-0" />
                                    <p className="font-sans text-earth/60 text-sm">
                                        To start a return, please email us at <a href="mailto:withlove@louiemae.com" className="text-bronze hover:underline">withlove@louiemae.com</a> with your order number and reason for return. We'll guide you through the process.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </FadeIn>
                </section>

                {/* Decorative divider */}
                <div className="flex items-center justify-center gap-4">
                    <div className="h-px w-16 bg-earth/10" />
                    <div className="w-1.5 h-1.5 rounded-full bg-bronze/30" />
                    <div className="h-px w-16 bg-earth/10" />
                </div>

                {/* ═══════════════════════════════════════════
                FAQ
            ═══════════════════════════════════════════ */}
                <section id="support-faq">
                    <FadeIn>
                        <div className="flex items-center gap-3 mb-8">
                            <div className="w-10 h-10 rounded-full bg-earth/5 flex items-center justify-center">
                                <HelpCircle className="w-5 h-5 text-bronze" />
                            </div>
                            <h2 className="font-serif text-3xl md:text-4xl text-earth">Frequently Asked Questions</h2>
                        </div>

                        <div className="space-y-3">
                            {FAQ_ITEMS.map((faq, idx) => (
                                <div key={idx} className="bg-white/60 rounded-xl border border-earth/5 overflow-hidden">
                                    <button
                                        onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                                        className="w-full flex items-center justify-between p-5 text-left group"
                                    >
                                        <span className="font-serif text-base text-earth group-hover:text-bronze transition-colors pr-4">{faq.q}</span>
                                        <ChevronDown
                                            className={`w-4 h-4 text-earth/30 flex-shrink-0 transition-transform duration-300 ${openFaq === idx ? 'rotate-180 text-bronze' : ''}`}
                                        />
                                    </button>
                                    <div
                                        className={`overflow-hidden transition-all duration-300 ${openFaq === idx ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}
                                    >
                                        <div className="px-5 pb-5 border-t border-earth/5 pt-4">
                                            <p className="font-sans text-earth/70 text-sm leading-relaxed">{faq.a}</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </FadeIn>
                </section>

                {/* Decorative divider */}
                <div className="flex items-center justify-center gap-4">
                    <div className="h-px w-16 bg-earth/10" />
                    <div className="w-1.5 h-1.5 rounded-full bg-bronze/30" />
                    <div className="h-px w-16 bg-earth/10" />
                </div>

                {/* ═══════════════════════════════════════════
                CONTACT US
            ═══════════════════════════════════════════ */}
                <section id="support-contact">
                    <FadeIn>
                        <div className="flex items-center gap-3 mb-8">
                            <div className="w-10 h-10 rounded-full bg-earth/5 flex items-center justify-center">
                                <Mail className="w-5 h-5 text-bronze" />
                            </div>
                            <h2 className="font-serif text-3xl md:text-4xl text-earth">Contact Us</h2>
                        </div>

                        <div className="bg-white/60 rounded-2xl border border-earth/5 p-6 md:p-8 mb-8">
                            <p className="font-sans text-earth/80 text-sm leading-relaxed mb-6">
                                We'd love to hear from you! Whether you have a question about an order, need help with sizing, or just want to say hello — we're here and happy to help.
                            </p>

                            <div className="flex items-center gap-3 bg-cream/80 rounded-xl p-4 mb-8">
                                <Mail className="w-4 h-4 text-bronze flex-shrink-0" />
                                <div>
                                    <p className="font-sans text-earth text-xs font-medium uppercase tracking-wider mb-0.5">Email Us Directly</p>
                                    <a href="mailto:withlove@louiemae.com" className="font-serif text-bronze text-lg hover:underline">withlove@louiemae.com</a>
                                </div>
                            </div>

                            {/* Contact Form */}
                            {contactStatus === 'sent' ? (
                                <div className="text-center py-12">
                                    <CheckCircle className="w-12 h-12 text-green-600/70 mx-auto mb-4" />
                                    <h3 className="font-serif text-2xl text-earth mb-2">Message Sent!</h3>
                                    <p className="font-sans text-earth/60 text-sm mb-6">Thank you for reaching out. We'll get back to you as soon as possible.</p>
                                    <button
                                        onClick={() => setContactStatus('idle')}
                                        className="text-[10px] uppercase tracking-widest text-bronze hover:text-earth transition-colors border-b border-bronze/30 pb-1"
                                    >
                                        Send Another Message
                                    </button>
                                </div>
                            ) : (
                                <form onSubmit={handleContactSubmit} className="space-y-5">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        <div>
                                            <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">Your Name</label>
                                            <input
                                                type="text"
                                                value={contactForm.name}
                                                onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                                                className="w-full bg-cream/50 p-3 border border-earth/10 rounded-lg font-sans text-sm text-earth focus:outline-none focus:border-bronze/40 transition-colors"
                                                placeholder="First & last name"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">Email *</label>
                                            <input
                                                type="email"
                                                required
                                                value={contactForm.email}
                                                onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                                                className="w-full bg-cream/50 p-3 border border-earth/10 rounded-lg font-sans text-sm text-earth focus:outline-none focus:border-bronze/40 transition-colors"
                                                placeholder="your@email.com"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">Subject</label>
                                        <input
                                            type="text"
                                            value={contactForm.subject}
                                            onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })}
                                            className="w-full bg-cream/50 p-3 border border-earth/10 rounded-lg font-sans text-sm text-earth focus:outline-none focus:border-bronze/40 transition-colors"
                                            placeholder="How can we help?"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-widest text-earth/40 mb-2">Message *</label>
                                        <textarea
                                            required
                                            rows={5}
                                            value={contactForm.message}
                                            onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                                            className="w-full bg-cream/50 p-3 border border-earth/10 rounded-lg font-sans text-sm text-earth focus:outline-none focus:border-bronze/40 transition-colors resize-none"
                                            placeholder="Tell us what's on your mind..."
                                        />
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={contactStatus === 'sending'}
                                        className="w-full bg-earth text-cream py-4 rounded-lg text-[10px] uppercase tracking-[0.2em] hover:bg-bronze transition-colors flex items-center justify-center gap-2 disabled:opacity-70"
                                    >
                                        {contactStatus === 'sending' ? (
                                            'Sending...'
                                        ) : (
                                            <><Send className="w-3.5 h-3.5" /> Send Message</>
                                        )}
                                    </button>
                                </form>
                            )}
                        </div>
                    </FadeIn>
                </section>

                {/* Decorative divider */}
                <div className="flex items-center justify-center gap-4">
                    <div className="h-px w-16 bg-earth/10" />
                    <div className="w-1.5 h-1.5 rounded-full bg-bronze/30" />
                    <div className="h-px w-16 bg-earth/10" />
                </div>

                {/* ═══════════════════════════════════════════
                PRIVACY POLICY
            ═══════════════════════════════════════════ */}
                <section id="support-privacy">
                    <FadeIn>
                        <div className="flex items-center gap-3 mb-8">
                            <div className="w-10 h-10 rounded-full bg-earth/5 flex items-center justify-center">
                                <Shield className="w-5 h-5 text-bronze" />
                            </div>
                            <h2 className="font-serif text-3xl md:text-4xl text-earth">Privacy Policy</h2>
                        </div>

                        <div className="bg-white/60 rounded-2xl border border-earth/5 p-6 md:p-8 space-y-8">
                            <p className="font-sans text-earth/60 text-xs italic">Last updated: February 2026</p>

                            {/* Policy Sections */}
                            {[
                                {
                                    title: 'Information We Collect',
                                    content: 'When you visit louiemae.com or make a purchase, we may collect information you provide directly, including your name, email address, shipping address, phone number, and payment information. We also automatically collect certain information about your device and browsing activity, such as your IP address, browser type, pages visited, and referring URL.'
                                },
                                {
                                    title: 'How We Use Your Information',
                                    content: 'We use the information we collect to process and fulfill your orders, communicate with you about your purchases, send you marketing communications (with your consent), improve our website and customer experience, prevent fraud and protect our business, and comply with legal obligations.'
                                },
                                {
                                    title: 'Information Sharing',
                                    content: 'We do not sell, trade, or rent your personal information to third parties. We may share your information with trusted service providers who assist us in operating our website, processing payments, and fulfilling orders — but only to the extent necessary for them to perform these services. We may also disclose information if required by law or to protect our rights.'
                                },
                                {
                                    title: 'Payment Security',
                                    content: 'All payment transactions are processed through secure, PCI-compliant payment gateways. We do not store your full credit card information on our servers. Your payment data is encrypted using industry-standard SSL (Secure Socket Layer) technology during transmission.'
                                },
                                {
                                    title: 'Cookies & Tracking',
                                    content: 'We use cookies and similar tracking technologies to enhance your browsing experience, analyze site traffic, and understand how visitors interact with our website. You can control cookie preferences through your browser settings. Disabling cookies may affect some features of our site.'
                                },
                                {
                                    title: 'Your Rights',
                                    content: 'You have the right to access, update, or delete your personal information at any time. You may opt out of marketing communications by clicking the "unsubscribe" link in any email or by contacting us directly. If you are a California resident, you may have additional rights under the CCPA, including the right to know what personal information we collect and the right to request its deletion.'
                                },
                                {
                                    title: 'Data Retention',
                                    content: 'We retain your personal information for as long as necessary to fulfill the purposes outlined in this policy, unless a longer retention period is required by law. Order and transaction data is retained for accounting and legal compliance purposes.'
                                },
                                {
                                    title: 'Children\'s Privacy',
                                    content: 'Our website is not intended for children under the age of 13. We do not knowingly collect personal information from children under 13. If we become aware that we have collected such information, we will take steps to delete it promptly.'
                                },
                                {
                                    title: 'Changes to This Policy',
                                    content: 'We may update this Privacy Policy from time to time to reflect changes in our practices or applicable laws. Any changes will be posted on this page with an updated "Last updated" date. We encourage you to review this policy periodically.'
                                },
                            ].map((s, idx) => (
                                <div key={idx}>
                                    <h3 className="font-serif text-lg text-earth mb-2">{s.title}</h3>
                                    <p className="font-sans text-earth/70 text-sm leading-relaxed">{s.content}</p>
                                </div>
                            ))}

                            <div className="border-t border-earth/10 pt-6">
                                <h3 className="font-serif text-lg text-earth mb-2">Questions?</h3>
                                <p className="font-sans text-earth/70 text-sm leading-relaxed">
                                    If you have any questions about this Privacy Policy or how we handle your data, please reach out to us at{' '}
                                    <a href="mailto:withlove@louiemae.com" className="text-bronze hover:underline">withlove@louiemae.com</a>.
                                </p>
                            </div>
                        </div>
                    </FadeIn>
                </section>

                {/* ═══════════════════════════════════════════
                THANK YOU
            ═══════════════════════════════════════════ */}
                <FadeIn>
                    <div className="text-center py-12 border-t border-earth/10">
                        <Heart className="w-6 h-6 text-bronze/40 mx-auto mb-4" />
                        <h3 className="font-serif text-2xl md:text-3xl text-earth mb-3">Thank You</h3>
                        <p className="font-sans text-earth/60 text-sm max-w-md mx-auto leading-relaxed mb-2">
                            Thank you for being part of the Louie Mae family. We are truly grateful for your support and trust. Every order, every message, and every visit means the world to us.
                        </p>
                        <p className="font-serif text-earth/40 text-base italic mt-4">
                            simply, mae
                        </p>
                    </div>
                </FadeIn>

            </div>
        </div>
    );
};
