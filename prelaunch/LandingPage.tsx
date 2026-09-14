/* global HTMLDialogElement */
import { useRef, useState, type FormEvent } from 'react';

const assets = '/images/prelaunch/';

export function LandingPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const submitting = useRef(false);
  const privacy = useRef<HTMLDialogElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    submitting.current = true;
    setStatus('sending');
    setMessage('');
    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), consent: true, website: form.get('website') || '' }),
        signal: window.AbortSignal.timeout(20000),
      });
      const result = await response.json().catch(() => ({error:'We couldn’t confirm your signup. Please try again shortly.'}));
      if (!response.ok || !result.ok) throw new Error(result.error || 'We couldn’t save your email. Please try again.');
      setStatus('success');
      setEmail('');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error && error.name !== 'TimeoutError' && error.name !== 'TypeError'
        ? error.message : 'We couldn’t confirm your signup. Please check your connection and try again.');
    } finally { submitting.current = false; }
  }

  return <div className="lm-page">
    <a className="lm-skip" href="#main">Skip to content</a>
    <header className="lm-header">
      <a className="lm-wordmark" href="/" aria-label="Louie Mae home">LOUIE MAE</a>
      <nav aria-label="Main navigation"><a href="#our-story">Our story</a><a href="#waitlist">Join the waitlist</a></nav>
    </header>
    <main id="main">
      <section className="lm-hero" aria-labelledby="welcome-title">
        <img className="lm-hero-image" src={`${assets}welcome.webp`} alt="Sunlit archway, olive branches, and a ceramic vase on an aged wood console" width="1536" height="1024" fetchPriority="high" />
        <div className="lm-hero-copy">
          <img className="lm-monogram" src={`${assets}monogram.png`} alt="" width="200" height="220" />
          <p className="lm-eyebrow">Welcome to</p>
          <h1 id="welcome-title">LOUIE MAE</h1>
          <span className="lm-rule" aria-hidden="true" />
          <p className="lm-motto">Live the life you love.<br className="lm-mobile-break" /> Love the life you live.</p>
          <a className="lm-button" href="#waitlist">Join the waitlist</a>
          <p className="lm-coming">A new chapter is coming</p>
        </div>
      </section>

      <section className="lm-story lm-split" id="our-story" aria-labelledby="story-title">
        <img src={`${assets}faith.webp`} alt="An open book, olive branch, antique brass bookmark, and velvet ribbon on soft linen" width="1024" height="1536" loading="lazy" />
        <div className="lm-copy">
          <p className="lm-eyebrow">The heart of Louie Mae</p>
          <h2 id="story-title">Rooted in faith.<br />Gathered around family.</h2>
          <span className="lm-rule" aria-hidden="true" />
          <p>Born from a love of faith, family, and making a home, Louie Mae brings together pieces for the life you’re building.</p>
          <p>Furniture and home accents. Clothing for you. Thoughtful finds for your little ones. A collection gathered with intention, and a story we can’t wait to share.</p>
          <span className="lm-signature">Welcome to our next chapter.</span>
        </div>
      </section>

      <section className="lm-home" aria-labelledby="home-title">
        <img src={`${assets}interior.webp`} alt="Louie Mae’s rustic wood coffee table surrounded by soft neutral sofas in a warmly layered living room" width="640" height="640" loading="lazy" />
        <div><p className="lm-eyebrow">A glimpse of what’s to come</p><h2 id="home-title">For the spaces<br />we call home.</h2></div>
      </section>
      <section className="lm-collections" aria-label="A preview of the Louie Mae collections">
        <figure><img src={`${assets}sideboard.webp`} alt="Black sideboard with natural woven cane doors" width="640" height="640" loading="lazy" /><figcaption><span className="lm-eyebrow">01 / Home</span><h3>Beautifully lived in.</h3></figcaption></figure>
        <figure><img src={`${assets}dress.webp`} alt="Cream button-front dress with delicate lace detailing" width="533" height="800" loading="lazy" /><figcaption><span className="lm-eyebrow">02 / The Mae Collective</span><h3>Thoughtfully dressed.</h3></figcaption></figure>
        <figure><img src={`${assets}romper.webp`} alt="Sage cotton romper laid on natural linen" width="640" height="640" loading="lazy" /><figcaption><span className="lm-eyebrow">03 / Louie Kids & Co.</span><h3>Little everyday wonders.</h3></figcaption></figure>
      </section>

      <section className="lm-gather" aria-labelledby="gather-title">
        <div className="lm-gather-heading"><p className="lm-eyebrow">The moments that make a life</p><h2 id="gather-title">For your home. Your people. Your story.</h2></div>
        <img src={`${assets}gathering.webp`} alt="Family and friends passing a ceramic serving bowl around a shared table" width="1536" height="1024" loading="lazy" />
      </section>

      <section className="lm-waitlist lm-split" id="waitlist" aria-labelledby="waitlist-title">
        <img src={`${assets}flowers.webp`} alt="Two people arranging delicate flowers together in a ceramic vase" width="1024" height="1536" loading="lazy" />
        <div className="lm-copy">
          <p className="lm-eyebrow">You’re invited</p>
          <h2 id="waitlist-title">For the life<br />you’re building.</h2>
          <p className="lm-subtitle">And the people you share it with.</p>
          <span className="lm-rule" aria-hidden="true" />
          <p>Be part of our first chapter. Join the waitlist for first looks and our official launch announcement.</p>
          {status === 'success' ? <div className="lm-success" role="status"><h3>You’re on the list.</h3><p>Thank you for being here. We’ll be in touch when Louie Mae launches.</p></div> :
            <form onSubmit={submit} aria-label="Join the launch waitlist">
              <label htmlFor="waitlist-email">Email address</label>
              <div className="lm-form-row"><input id="waitlist-email" name="email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" disabled={status === 'sending'} aria-describedby="waitlist-consent waitlist-message" /><button className="lm-button" type="submit" disabled={status === 'sending'}>{status === 'sending' ? 'Joining…' : 'Join the waitlist'}</button></div>
              <div className="lm-trap" aria-hidden="true"><label htmlFor="website">Leave this field empty</label><input id="website" name="website" tabIndex={-1} autoComplete="off" /></div>
              <p id="waitlist-message" className="lm-error" role="alert">{message}</p>
              <p id="waitlist-consent" className="lm-fine">By joining, you agree to receive launch news and occasional updates from Louie Mae. You can unsubscribe at any time.</p>
            </form>}
          <button type="button" className="lm-text-button" onClick={() => privacy.current?.showModal()}>Your privacy</button>
        </div>
      </section>
    </main>
    <footer className="lm-footer"><a href="/" className="lm-wordmark">LOUIE MAE</a><p>Rooted in faith. Gathered around family.</p><div><span>© {new Date().getFullYear()} Louie Mae</span><a href="mailto:hello@louiemae.com">Say hello</a><button className="lm-text-button" onClick={() => privacy.current?.showModal()}>Privacy</button></div></footer>
    <dialog className="lm-privacy" ref={privacy} aria-labelledby="privacy-title" onClick={e => { if (e.target === e.currentTarget) privacy.current?.close(); }}>
      <button className="lm-dialog-close" onClick={() => privacy.current?.close()} aria-label="Close privacy notice">×</button>
      <p className="lm-eyebrow">Louie Mae</p><h2 id="privacy-title">Your privacy matters.</h2>
      <p>When you join, we save your email address, signup date, and agreement to receive Louie Mae launch news and occasional updates. We use this information to manage the waitlist and contact you about Louie Mae.</p>
      <p>Our hosting and database providers process this information for us. We also keep a hashed network identifier briefly to help prevent automated abuse. We don’t sell your email address.</p>
      <p>To unsubscribe or request removal of your information, email <a href="mailto:hello@louiemae.com?subject=Waitlist%20unsubscribe">hello@louiemae.com</a> from the address you used to sign up.</p>
      <button className="lm-button" onClick={() => privacy.current?.close()}>Back to Louie Mae</button>
    </dialog>
  </div>;
}
