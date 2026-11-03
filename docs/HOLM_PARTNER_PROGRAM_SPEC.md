# House of Louie Mae partner program: remaining build spec

Version 1.0 · November 3, 2026 · Approved for implementation. All decisions were answered by the owner on November 3, 2026. This spec is ready to implement.

## 1. What this covers

Partners promote Louie Mae products through their own links (boards, product posts, stories, pins, PDFs, QR codes, plain links). When someone they sent buys, the sale is credited to that partner and they earn a commission at a rate set by their tier and the type of product (furniture, home décor or clothing). Partners are either **creators** (anyone, no business needed) or **trade partners** (verified businesses, who also buy at trade/B2B pricing).

This spec lists what is already built, what is missing, how each missing part should work, and the order to build it in.

## 2. Status today

### Built and live

| Area | What works |
| --- | --- |
| Joining | Any signed-in member can join from the Partner Hub (on **Your quotes**) after accepting the terms. They get a referral code. |
| Links | The Hub builds links to the home page, any piece, or a page, tagged by channel: story, pin, post, pdf, link, share, qr. Shared boards and bundle links (`/b/…`) carry the owner's code. |
| Click tracking | A visit through a partner link is recorded once per visitor per partner per day. The code is remembered on that device for 30 days. |
| Attribution | Only on **/trade quote requests at retail price**. The last partner link clicked in the last 30 days wins. Self-referral is blocked (same account or same email). |
| Commission | Created when the project is paid, at the partner's tier rate on merchandise (not delivery or tax). It clears after 30 days and is voided if the project is cancelled, refunded or disputed. An hourly job does this. |
| Tiers | Base 10%, Active 12%, Top 15%, Elite 18%, with a 23% ceiling. **Set by hand only** in Admin → Partners. |
| Referral credit | $100 store credit when a business that signed up through the partner's link is verified and pays an order of $500 or more. **Recorded and shown, but it cannot be spent.** |
| Payouts | The partner uploads a W-9. The admin approves it, pays outside the site and records the payout with a reference. The partner is emailed. |
| Hub stats | Clicks by channel, per-board views, visits, orders and commission, referrals, credit balance, payout history. |
| Trade (B2B) | Verified trade accounts see 25% off retail (held at a margin floor), plus a further 3% off when a project's trade subtotal is $10,000 or more and 5% when it's $25,000 or more. They can send their own clients marked-up quotes. Trade-priced orders never earn commission. |

### Missing or wrong

1. **Sales on louiemae.com earn nothing.** The main storefront cart (Stripe Checkout) ignores partner links entirely. A partner who shares a piece that the customer buys from the regular site gets no credit. This is the core gap.
2. **Some share buttons drop the partner code.** The product page's **Copy link** and **Save to Pinterest** buttons never include the code, even for partners.
3. **Referral credit can't be used**, and there's no choice between spending and saving it.
4. **Tiers never change on their own.** There are no rules for moving up or down.
5. **The copy doesn't match the program.** The Trade page's on-screen membership card (the card graphic with the member's name, not a physical card) says "12% commission on client orders" and "$100 credit for every referral", and its earnings calculator uses 12%. The real program starts at 10%, and the $100 needs the referred business to be verified and to pay an order of $500 or more.
6. **No published partner terms.** Partners agree to one sentence. There's no terms page covering rates, attribution, clearing, clawbacks, disclosure and payouts.
7. **The Hub only counts /trade quotes**, so it can't show earnings from storefront orders.

## 3. Definitions

- **Partner:** any member who joined the program. **Creators** are partners who aren't verified businesses; **trade partners** are partners with a verified trade account.
- **Product type:** furniture, home décor or clothing. It sets the commission rate column (section 5A.3).
- **Trade account:** a business verified by the team (certificate or licence). Gets trade pricing and client quotes.
- **Partner link:** any louiemae.com URL with `?ref=CODE` (and optionally `&ch=channel`), or a shared board or bundle link that carries the owner's code.
- **Attributed order:** a paid order whose buyer arrived through a partner link within the attribution window.
- **Commissionable amount:** merchandise after discounts and after any store credit used. Excludes delivery, tax and refunds.

## 4. Link tracking across the whole site (fixes gaps 1, 2 and 7)

### 4.1 One link format everywhere

- `?ref=CODE&ch=channel` works on **every** louiemae.com page: the storefront, collections, product pages, `/trade`, shared boards and bundles.
- The storefront (`App.tsx` entry) reads `ref` and `ch` on load, the same way `/trade` does today, and records the click through `holmPartners.recordClick`.
- Both apps are on the same origin, so they share one stored code and one visitor id. Use one storage key for both (today `/trade` uses its own key), so a visitor who lands on the storefront and later buys on `/trade` is still credited, and the reverse.
- Remove `ref` and `ch` from the address bar after reading them, so a visitor who copies the URL doesn't pass the code on.

### 4.2 Every share surface carries the code

When the person sharing is a partner, every share action adds their code and the right channel:

| Share action | Channel |
| --- | --- |
| Product **Copy link** | link |
| **Save to Pinterest** (its destination link) | pin |
| Hub link builder | the channel picked |
| Share sheet: story, pin, post, PDF, QR, native share | story / pin / post / pdf / qr / share |
| Shared boards and bundles | already carry the code (keep) |

Pinterest's **Save** button today links to `/retail-furniture`. Point it at the piece itself instead, with the code.

Client quotes (the designer's marked-up quote to their own client) **do not** carry a partner code. The designer earns through their markup, not commission.

### 4.3 Attribution rules

- **Window:** 30 days from the last partner link click on that device.
- **Last click wins:** if a visitor clicks two partners' links, the later one gets the sale.
- **Signed-in buyers:** when a visitor signs in, copy the active code to their account, so a purchase on another device within the window still counts.
- **One partner per order.**
- **No self-referral:** never credit an order whose buyer is the partner (same account, same email, or same payment card fingerprint where Stripe exposes it).
- **Trade-priced orders earn nothing.** The partner's own trade discount is already the better price.

### 4.4 Storefront checkout (new)

1. When the cart creates a Stripe Checkout session (`convex/http.ts`), send the stored code and visitor id with it, and keep them on the checkout record (and in the session metadata). The server resolves attribution with the existing `resolveAttribution` and stores the partner, code, channel and board on the order. Never trust a partner id from the browser.
2. On `checkout.session.completed`, run `resolveAttribution` again with the buyer's email from the session (`customer_details.email`) and any signed-in user id, because a guest's email is only known after checkout. Create a **pending** commission only if attribution still resolves to the same partner. Work it out line by line: each line's rate comes from the partner's tier at that moment and the line's product type (section 5A.3), capped by the margin guard (section 5A.4). Lock the tier, type, rate and amount on each line.
3. **Exactly once per order:** commission creation is keyed by the Checkout session id (one commission per session). A repeated or late webhook delivery finds the existing record and changes nothing.
4. On `charge.refunded` or `charge.dispute.created`, void the pending commission. A partial refund reduces it pro rata.
5. After 30 days, the same hourly job clears it, as it does for /trade.
6. If an order is refunded **after** the commission was paid, record a negative adjustment that comes off the partner's next payout.

The `holmCommissions` table gets a `source` field (`house_quote` or `storefront_order`), an order reference and per-line detail (product, type, rate, amount), so both kinds sit in one ledger. The existing /trade quote reconciliation switches to the same line-by-line calculation.

**Decided (November 3, 2026):** every product on louiemae.com earns commission, except products or collections on an admin exclusion list (for sale items, gift cards and thin-margin categories).

### 4.5 Partner Hub additions

- **Orders list:** every attributed order (storefront and /trade) with date, amount, commission, status (pending, cleared, paid, void) and the channel and board it came from. Each order can expand to its lines with product type and rate. No buyer names or emails.
- **Totals:** pending, cleared (ready to pay) and paid to date.
- **Link builder for any page:** paste any louiemae.com URL and get it back with the partner's code and a chosen channel, plus a QR code.
- **Tier progress** (section 5) and the **credit toggle** (section 6).

## 5. Commission tiers (fixes gap 4)

### 5.1 Today's tiers

Today there's one rate per tier, used for everything: Base 10%, Active 12%, Top 15%, Elite 18%. Under this spec those become the **furniture** rates, and home décor and clothing get their own columns (section 5A.3).

### 5.2 Rules for moving between tiers

Based on the partner's **attributed paid sales in the last 12 months** (commissionable amount, after refunds):

| Tier | Sales in the last 12 months |
| --- | --- |
| Base | $0 – $14,999 |
| Active | $15,000 – $49,999 |
| Top | $50,000 – $99,999 |
| Elite | $100,000 and up |

Sales of every product type count toward the tier. The rates for each tier are in section 5A.3.

- **Moving up:** checked nightly. A partner moves up as soon as they cross a threshold, and orders paid from then on earn the new rate.
- **Moving down:** checked once a quarter, at most one tier at a time, so a slow month never cuts a rate suddenly.
- **Rate is locked per order** when it's paid. The tier in effect at payment is stored on the order (for /trade quotes, when the invoice payment is verified; for storefront orders, in the checkout webhook), so a tier change before the hourly job runs can't change it. The order that crosses a threshold is paid at the tier held before it; the new tier applies from the next order. A later tier change never changes past commissions.
- **Admin override:** the team can set a tier by hand (for example to start a well-known designer at Top) with a reason and an optional end date. While an override is active, automatic changes don't apply.
- **Hub display:** "Active · 12% furniture, 9% décor, 6% clothing · $3,200 more in sales to reach Top".

Thresholds confirmed by the owner on November 3, 2026.

**Decided:** keep the 23% ceiling as room for future promotions.

### 5.3 Margin check

Commission comes out of retail margin. The margin guard (section 5A.4) protects every line automatically. Add a column to Admin → Pricing: **margin after Elite commission** for the product's type, and flag any product under 20%, so the team can exclude it or reprice it.

## 5A. Creators, and rates by product type

### 5A.1 Two kinds of partner, one program

- **Creators:** anyone who promotes Louie Mae on their socials, blog or links, without being a business. They join from louiemae.com (not only /trade), get a **Creator Hub** with links, earnings, credit and payouts, and earn commission on everything they send, including clothing and home décor.
- **Trade partners (dealers):** verified businesses. They have everything a creator has, plus trade (B2B) pricing, project pricing and client quotes on /trade.

Both share the same tier ladder (section 5.2). What changes the rate is **the type of product sold**, because margins differ by product type.

### 5A.2 Margins by product type

| Product type | How it's priced | Profit after supplier and shipping | After card fees (2.9% + 30¢) |
| --- | --- | --- | --- |
| Furniture (House, Ashcroft) | House: 2–6× supplier cost; Ashcroft: retail price including freight | about 45–80% of price | about 42–77% |
| Clothing (CJ) | 2 × item cost + shipping + supplier fees, rounded up to .99 | about 28–41% of price | about 24–38% |
| Home décor (CJ) | same as clothing | about 28–41% of price | about 24–38% |

Clothing and décor examples, using the CJ formula:

| Item cost | Shipping | Price | Our profit | After card fees | Share of price |
| --- | --- | --- | --- | --- | --- |
| $6 | $7 | $19.99 | $6.99 | $6.11 | 31% |
| $12 | $7 | $31.99 | $12.99 | $11.76 | 37% |
| $8 (bulky décor) | $15 | $31.99 | $8.99 | $7.76 | 24% |
| $25 (décor) | $12 | $62.99 | $25.99 | $23.86 | 38% |

Clothing also has the most returns, and a refunded order voids its commission.

### 5A.3 Rates

| Tier (12-month sales) | Furniture | Home décor | Clothing |
| --- | --- | --- | --- |
| Base ($0–$14,999) | 10% | 8% | 5% |
| Active ($15,000+) | 12% | 9% | 6% |
| Top ($50,000+) | 15% | 10% | 7% |
| Elite ($100,000+) | 18% | 12% | 8% |

### 5A.4 Margin guard

On any order line, commission never exceeds **40% of our profit on that line** (price minus supplier cost, shipping, supplier fees and card fees). We always keep at least 60% of the profit. This only affects thin items. For example, the $8 bulky décor piece above earns $2.56 at the 8% Base rate, but at most $3.10 (9.7%) at any tier, so the 10% and 12% rates are held to $3.10. Lines with no known cost earn the base rate for their type, and the Pricing tab flags them.

Example: a Base creator sends a $31.99 dress. They earn $1.60 (5%), and we keep $10.16 of the $11.76 profit.

### 5A.5 What it needs

- Each product's type (furniture, décor or clothing) from its collection, with an admin override.
- The rate table in `lib/holmPartners.ts`, keyed by tier and type.
- Commission worked out per order line, with the guard, and the type and rate stored on each line.
- **Creator Hub on louiemae.com:** join (terms and disclosure), link builder for any page, QR codes, earnings by order, tier progress, credit toggle and Stripe payouts. It's the same Hub as /trade, without the trade tools.
- **Copy:** "Earn 10–18% on furniture, 8–12% on home décor and 5–8% on clothing", with the viewer's own rates once they join.

**Decided (November 3, 2026):** the rate table above (décor 8–12%, clothing 5–8%) and the 40% guard.

**Note:** clothing and décor commission starts when those products can be bought on louiemae.com. Today the cart only accepts Ashcroft furniture and shows everything else as Coming Soon.

## 6. Referral credit (fixes gap 3)

### 6.1 How partners earn it (unchanged)

$100 when a business that signed up through the partner's link is verified and pays an order of $500 or more.

### 6.2 The toggle

In the Partner Hub, under **Store credit**:

- **Apply to my next order** (on): the full available balance, up to the merchandise total, comes off the partner's next order automatically.
- **Save it** (off, the default): the credit builds up until they switch it on.

At checkout (storefront cart) and in the quote request (/trade tray), the partner also sees "Use my $X credit" as a checkbox, pre-set from the toggle, so they can change their mind on any single order.

### 6.3 Rules

- Credit only comes off merchandise. It never reduces delivery or tax, and it can't make an order negative.
- Any unused part stays in the balance.
- It's never paid out as cash and can't be transferred.
- If an order that used credit is cancelled or refunded, the credit returns to the balance.
- Commission is calculated after credit (this only matters if another partner's link sent the buyer).

### 6.4 How it's applied

- **Credit ledger:** `holmCredits` becomes a ledger with earned (+), reserved, used (−) and restored (+) entries. Balance = earned − used − reserved.
- **Storefront order:** when the Checkout session is created, reserve the amount and add a one-off Stripe discount for it. Mark it used when the session completes, or release it if the session expires.
- **/trade quote:** reserve the amount on the quote request and show it as a "Store credit" line on the project. The Stripe invoice gets a matching negative line. Mark it used when the invoice is paid, or release it if the quote is cancelled or expires.

**Decided:** credit doesn't expire while the account is active.

## 7. Trade (B2B) buying

The existing trade buying (25% off, project pricing, client quotes with the designer's own markup) stays as is. Remaining items:

- In the Hub, explain plainly that the partner earns through trade pricing and markup when they buy for a client, and through commission when the client buys from louiemae.com through their link.
- A partner who isn't a verified trade account sees **Apply for trade pricing** in the Hub.

## 8. Truthful copy (fixes gap 5)

- Replace the fixed "12%" and "$100 for every referral" text on the Trade page's membership card and the earnings calculator with values from `lib/holmPartners.ts`:
  - **Signed-out visitors and new partners:** "Earn 10–18% on furniture, 8–12% on home décor and 5–8% on clothing".
  - **Signed-in partners:** their own rates, for example "Your rates (Active): 12% furniture, 9% décor, 6% clothing".
  - **Referral line:** "$100 credit when a business you refer is verified and pays an order of $500 or more".
- Remove the hard-coded `COMMISSION = 0.12` in `trade/app.ts`. The /trade calculator is about furniture, so it uses the viewer's furniture rate, or 10% labelled "starting rate".
- Add a check (a test) that the copy reads its numbers from the config, so the page and the program can't drift apart again.

## 9. Partner terms page (fixes gap 6)

Publish `/trade#partner-terms`, linked from the join checkbox, the Hub footer and the payout email. It covers:

- who can join, and that the team can remove a partner for misuse;
- rates by tier and product type (sections 5 and 5A), the margin guard, and that rates are locked per order line;
- what counts: paid orders at retail price through the partner's link within 30 days, last click wins, no self-purchases, no trade-priced orders;
- clearing (30 days), voids on refunds and disputes, and clawback after payout;
- payouts: monthly on the 15th for cleared balances of $50 or more, by Stripe to the bank account the partner connects (section 9.1);
- store credit rules (section 6);
- disclosure: partners must label paid posts ("#ad" or "I earn a commission"), as the FTC requires;
- tax: commissions are reported as nonemployee compensation on Form 1099-NEC. For payments made in 2026 and later the federal threshold is $2,000 a year (it was $600 before 2026, and may be adjusted for inflation from 2027). Confirm with an accountant before the first filing.

**Decided:** monthly payouts on the 15th, for cleared balances of $50 or more, paid automatically through Stripe Connect.

### 9.1 Automatic payouts through Stripe Connect

Customers already pay through the owner's Stripe account (storefront Checkout and quote invoices). Stripe Connect lets the same account send money out to partners, so incoming sales and outgoing commissions are both in one Stripe dashboard.

**Partner setup (once):**

1. In the Partner Hub, the partner clicks **Set up payouts**.
2. The site creates a Stripe Connect **Express** account for them and sends them to Stripe's own sign-up page. Stripe collects their legal name, tax ID (the W-9 information) and bank account. Louie Mae never sees or stores bank details.
3. They come back to the Hub, which shows "Payouts ready" or what Stripe still needs.

**Each month on the 15th (scheduled job):**

1. For each partner with payouts ready and $50 or more cleared, the job sends one Stripe **transfer** from the Louie Mae balance to the partner's connected account, with an idempotency key per partner per month, so a retry can never pay twice.
2. The cleared commissions are marked paid against that transfer, and the partner is emailed.
3. Stripe then pays the money into the partner's bank on its normal schedule.
4. Partners under $50, or who haven't finished setup, carry their balance to the next month. The Hub tells them why.

**Refunds after payout:** a negative adjustment comes off the next transfer. If the partner has no further earnings, the team can reverse the transfer in Stripe or settle it by hand.

**Taxes:** Stripe Connect can file and deliver 1099-NEC forms for connected accounts, which replaces the W-9 upload and manual 1099s. The W-9 upload stays only for partners paid by hand.

**Fallback:** the existing **Record payout** (pay outside the site, record the reference) stays for partners who can't use Stripe.

**Owner setup before building:**

- Turn on Connect in the Stripe dashboard, choose Express accounts, and complete Stripe's platform questions.
- Keep enough available balance on the 15th to cover the month's transfers. Commissions only clear 30 days after the sale, so that money has normally arrived.
- Check the current Connect fees on Stripe's pricing page. Stripe charges per active connected account and per payout, and separately for 1099 filing.

## 10. Admin additions

- **Partners tab:** tier override with reason and end date; each partner's 12-month sales and next-tier threshold; a commission ledger with source, order, rate and status; manual adjustments (with a required note); each partner's Stripe payout status; a "Due on the 15th" total; transfer history with Stripe links; and a CSV export.
- **Pricing tab:** the margin-after-Elite-commission column (section 5.3).
- **Exclusions:** the list of products or collections that don't earn commission (section 4.4).

## 11. Other open work on the trade site (not partner program)

- [monicaestimon-ctrl/louiemae2#210](https://github.com/monicaestimon-ctrl/louiemae2/pull/210): fixes silent inventory publishing failures and related admin actions. Open, not merged.
- [monicaestimon-ctrl/louiemae2#197](https://github.com/monicaestimon-ctrl/louiemae2/pull/197): an alternative hero that builds each room as you scroll. Open, not merged. Decide whether to keep or close it.
- Commerce release gates (`COMMERCE_PUBLISHING_ENABLED`, `COMMERCE_INVOICES_ENABLED`, `COMMERCE_INVOICE_DUE_DAYS`) and the staging tests in `docs/commerce-implementation-status.md`. Their production state needs checking in the Convex dashboard.
- Publishing to Pinterest from the site was removed until a Pinterest developer app is set up. Pin import still works.

## 12. Build order

1. **Truthful copy** (section 8). Small, and fixes a misleading claim right away.
2. **Share buttons carry the code** (section 4.2) and **shared storage across both apps** (section 4.1).
3. **Rates by product type and the margin guard** (section 5A.3–5A.5): product types, the rate table, line-by-line commission (also for /trade quotes).
4. **Storefront attribution and commission** (sections 4.3–4.5), with the Hub orders list.
5. **Creator Hub on louiemae.com** (section 5A.5) and the **partner terms page** (section 9).
6. **Automatic tiers** (section 5) and tier progress in the Hub.
7. **Credit toggle and spending** (section 6).
8. **Stripe Connect payouts** (section 9.1). Needs Connect turned on first.
9. **Admin additions** (section 10).

Each step ships as its own PR with tests.

Clothing and décor commission only starts once those products can be bought on louiemae.com. Opening the storefront cart to them is separate work, not part of this spec.

## 13. Acceptance tests

- A visitor opens a partner's product link on louiemae.com, buys from the cart, and the partner's Hub shows a pending commission at their rate on the merchandise amount only.
- An order with a sofa, a vase and a dress from a Base partner's link earns 10% on the sofa, 8% on the vase and 5% on the dress.
- A thin-margin line never earns more than 40% of our profit on it. A line with no known cost earns its type's base rate and is flagged.
- Someone with no business joins as a creator from louiemae.com, gets links and sees their own rates without ever seeing trade pricing.
- The same visitor buys again 31 days after the click: no commission.
- Two partners' links clicked: the later one is credited.
- Stripe delivers `checkout.session.completed` twice for the same order: exactly one commission exists.
- A partner checks out as a guest with their own email through their own link: no commission.
- The partner buys through their own link: no commission.
- A storefront order is fully refunded before clearing: the commission is voided. A partial refund reduces it pro rata. A refund after payout creates a negative adjustment on the next payout.
- A visitor clicks a link on their phone, signs in, and buys on a laptop within 30 days: credited.
- The **Copy link**, **Save to Pinterest** and every Share sheet route include the code for partners and not for others.
- Crossing $15,000 in 12-month sales moves a partner to Active the next night; $50,000 to Top; $100,000 to Elite. Earlier commissions keep their old rate.
- On the 15th, a partner with $50+ cleared and payouts set up receives exactly one Stripe transfer; a rerun of the job pays nothing extra; a partner under $50 carries the balance over.
- With **Apply to my next order** on, $100 credit comes off the next order's merchandise, never off delivery or tax. With it off, the balance grows. Cancelling the order restores the credit.
- Signed-out visitors see the real rate ranges (10–18% furniture, 8–12% décor, 5–8% clothing), partners see their own rates, and no page says "12%" or "for every referral" unless that's true.
- Public queries never expose buyer names, emails or other partners' data.
