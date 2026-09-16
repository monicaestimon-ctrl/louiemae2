const assets = '/images/prelaunch/editorial/';

export function EditorialPhoto({ file, index = 0, panels = 1, description }: { file: string; index?: number; panels?: number; description: string }) {
  return <div className="lm-selected-photo" style={{ aspectRatio: panels === 1 ? '527 / 543' : `${3 / panels} / 2` }}>
    <img src={`${assets}${file}`} alt={description} loading="lazy" decoding="async"
      style={{ width: `${panels * 100}%`, left: `${-index * 100}%` }} />
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
      <div className="lm-editorial-heading"><p className="lm-eyebrow">For you</p><h2 id="women-preview-title">Days with a little romance.</h2><p>Ivory, soft sage, warm neutrals, and room to be yourself.</p></div>
      <div className="lm-photo-strip lm-selected-strip">
        <EditorialPhoto file="women-garden.webp" panels={4} index={0} description="White square-neck puff-sleeve maxi dress in a coastal garden" />
        <EditorialPhoto file="women-garden.webp" panels={4} index={1} description="Sage tie-shoulder gathered dress among olive trees" />
        <EditorialPhoto file="beige-dining-original.png" description="Beige matching set in its original setting beside a rustic dining table and woven chairs" />
        <EditorialPhoto file="women-garden.webp" panels={4} index={3} description="Ivory button-front vest and matching bubble-hem skirt" />
      </div>
      <p className="lm-editorial-caption">The Mae Collective <span>Selected looks from our upcoming collection</span></p>
    </section>

    <section className="lm-editorial-chapter lm-kids-chapter" aria-labelledby="kids-preview-title">
      <div className="lm-editorial-heading"><p className="lm-eyebrow">Louie Kids &amp; Co.</p><h2 id="kids-preview-title">For their little world.</h2><p>Flowers gathered. Gardens explored. Everyday moments, wonderfully theirs.</p></div>
      <div className="lm-photo-strip lm-selected-strip">
        <EditorialPhoto file="kids-garden.webp" panels={4} index={0} description="Navy sailor top and white embroidered trousers with red shoes" />
        <EditorialPhoto file="kids-garden.webp" panels={4} index={3} description="Pale yellow striped dress with a mustard cardigan" />
        <EditorialPhoto file="little-details.webp" panels={3} index={0} description="Brown zip jacket, striped top, and oatmeal cuffed trousers on a wooden chair" />
        <EditorialPhoto file="little-details.webp" panels={3} index={1} description="Blue striped shirt and light blue shorts worn in a garden" />
      </div>
      <p className="lm-editorial-caption">Little details. Lasting memories. <a href="#waitlist">Join the waitlist <span aria-hidden="true">↗</span></a></p>
    </section>

    <section className="lm-pottery-story" aria-labelledby="pottery-title">
      <div className="lm-editorial-heading"><p className="lm-eyebrow">Collected for your home</p><h2 id="pottery-title">Beauty in the quiet details.</h2><p>Sculptural shapes, earthy textures, and branches gathered along the way.</p></div>
      <img src={`${assets}ceramic-still-life.webp`} alt="Editorial still life of five textured ivory ceramic vessels on aged wood with branching stems" width="1536" height="1024" loading="lazy" decoding="async" />
    </section>
  </div>;
}
