const directory = '/images/prelaunch/furniture/';

function RoomPhoto({ file, alt, caption }: { file: string; alt: string; caption: string }) {
  return <figure className="lm-room-photo">
    <img src={`${directory}${file}.webp`} alt={alt} width="1536" height="1024" loading="lazy" decoding="async" />
    <figcaption>{caption}</figcaption>
  </figure>;
}

export function FurnitureEditorial() {
  return <section className="lm-furniture-editorial" aria-labelledby="furniture-editorial-title">
    <div className="lm-editorial-heading">
      <p className="lm-eyebrow">The home collection / A first look</p>
      <h2 id="furniture-editorial-title">Earthy textures.<br /><em>A warmth that stays.</em></h2>
      <p>Quiet corners, sculptural shapes, and pieces that make a room feel like your own.</p>
    </div>

    <RoomPhoto file="terracotta-curved-sofa" alt="Rust-colored curved sofa with matching cushions in a sunlit plaster room beside aged wooden doors" caption="A softer place to land." />

    <div className="lm-room-pair">
      <RoomPhoto file="cognac-lounge-chair" alt="Cognac sling-style lounge chair with an angular dark wood frame, staged beside linen curtains" caption="Warm tones. Beautiful lines." />
      <RoomPhoto file="ivory-wood-chair" alt="Cream upholstered lounge chair with a slim wood frame on a circular woven rug" caption="Your quiet corner." />
    </div>

    <div className="lm-room-pair">
      <RoomPhoto file="walnut-coffee-table" alt="Round walnut-toned coffee table with a fluted drum base on a natural woven rug" caption="Texture at the center." />
      <RoomPhoto file="woven-counter-stools" alt="Three oatmeal woven upholstered counter stools with curved backs and walnut-toned frames beside a pale stone island" caption="Room for one more." />
    </div>

    <RoomPhoto file="ochre-sofa" alt="Golden ochre sofa with rounded arms, divided back and matching bolster cushions in an earthy plaster interior" caption="A little color. A lot of warmth." />

    <div className="lm-room-pair">
      <RoomPhoto file="rattan-ceiling" alt="Woven rattan semi-flush ceiling light with black hardware above a rustic dining space" caption="Light, woven into the everyday." />
      <RoomPhoto file="brass-floor-lamp" alt="Slender curved brass floor lamp with a white tapered shade beside an oatmeal sofa" caption="The finishing touch." />
    </div>
    <div className="lm-room-invitation"><p>A glimpse of the pieces we’re gathering.</p><a className="lm-editorial-link" href="#waitlist">Join the waitlist for launch news <span aria-hidden="true">↗</span></a></div>
  </section>;
}
