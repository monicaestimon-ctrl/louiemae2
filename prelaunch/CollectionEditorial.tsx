const assets = '/images/prelaunch/editorial/';

function PhotoStrip({ file, descriptions, className = '' }: { file: string; descriptions: string[]; className?: string }) {
  return <div className={`lm-photo-strip lm-photo-strip-${descriptions.length} ${className}`}>
    {descriptions.map((description, index) => <div className="lm-photo-panel" key={description}>
      <img src={`${assets}${file}`} alt={description} width="1536" height="1024" loading="lazy" decoding="async"
        style={{ objectPosition: `${index * 100 / (descriptions.length - 1)}% center` }} />
    </div>)}
  </div>;
}

export function CollectionEditorial() {
  return <div className="lm-editorial" id="collection-preview">
    <section className="lm-editorial-intro" aria-labelledby="editorial-title">
      <p className="lm-eyebrow">The Mae Collective / A first look</p>
      <h2 id="editorial-title">A little slower.<br /><em>A little closer to home.</em></h2>
      <p>Easy silhouettes. Romantic details. Pieces for the everyday moments you’ll want to remember.</p>
    </section>

    <section className="lm-beige-story" aria-labelledby="beige-title">
      <img src={`${assets}beige-dining-original.png`} alt="Beige tie-front top and matching long skirt, photographed beside a rustic dining table and woven wooden chairs" width="527" height="543" loading="lazy" />
      <div className="lm-copy">
        <p className="lm-eyebrow">At home, in your own rhythm</p>
        <h2 id="beige-title">For mornings<br />that linger.</h2>
        <span className="lm-rule" aria-hidden="true" />
        <p>Soft neutrals, an easy matching set, and a familiar place at the table. A glimpse of the life behind the collection.</p>
        <a className="lm-editorial-link" href="#waitlist">Be part of our first chapter <span aria-hidden="true">↗</span></a>
      </div>
    </section>

    <section className="lm-editorial-chapter" aria-labelledby="women-preview-title">
      <div className="lm-editorial-heading"><p className="lm-eyebrow">For you</p><h2 id="women-preview-title">Days with a little romance.</h2><p>Ivory, soft sage, delicate florals, and room to be yourself.</p></div>
      <PhotoStrip file="women-garden.webp" descriptions={[
        'Editorial preview of a white square-neck puff-sleeve maxi dress in a coastal garden',
        'Editorial preview of a sage tie-shoulder gathered dress among olive trees',
        'Editorial preview of a cream floral button-front dress with delicate white edging',
        'Editorial preview of an ivory button-front vest and matching bubble-hem skirt',
      ]} />
      <p className="lm-editorial-caption">The Mae Collective <span>Selected looks from our upcoming collection</span></p>
    </section>

    <section className="lm-editorial-chapter lm-kids-chapter" aria-labelledby="kids-preview-title">
      <div className="lm-editorial-heading"><p className="lm-eyebrow">Louie Kids &amp; Co.</p><h2 id="kids-preview-title">For their little world.</h2><p>Flowers gathered. Gardens explored. Everyday moments, wonderfully theirs.</p></div>
      <PhotoStrip file="kids-garden.webp" descriptions={[
        'Editorial preview of a navy sailor top and white embroidered trousers with red shoes',
        'Editorial preview of an ivory collared dress with blue bows and a ruffled hem',
        'Editorial preview of a sage layered dress with a blue petal collar',
        'Editorial preview of a pale yellow striped dress with a mustard cardigan',
      ]} />
      <PhotoStrip file="little-details.webp" className="lm-little-details" descriptions={[
        'Editorial preview of a brown zip jacket, striped top, and oatmeal cuffed trousers on a wooden chair',
        'Editorial preview of a blue striped shirt and light blue shorts worn in a garden',
        'Editorial preview of blush and sage floral baby rompers with white-edged ruffles',
      ]} />
      <p className="lm-editorial-caption">Little details. Lasting memories. <a href="#waitlist">Join the waitlist <span aria-hidden="true">↗</span></a></p>
    </section>

    <section className="lm-pottery-story" aria-labelledby="pottery-title">
      <div className="lm-editorial-heading"><p className="lm-eyebrow">Collected for your home</p><h2 id="pottery-title">Beauty in the quiet details.</h2><p>Sculptural shapes, earthy textures, and branches gathered along the way.</p></div>
      <img src={`${assets}ceramic-still-life.webp`} alt="Editorial still life of five textured ivory ceramic vessels on aged wood with branching stems" width="1536" height="1024" loading="lazy" decoding="async" />
    </section>
  </div>;
}
