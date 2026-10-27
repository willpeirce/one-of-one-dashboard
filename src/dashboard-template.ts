/**
 * Port of docs/spec/mockup.html: the original body structure and SVG geometry.
 * Numeric and business copy is bound to server-only sample-dashboard.ts fixtures.
 * To refresh this port, copy the mockup body before its script, remove simulated
 * actions, extract data-* models to widgets and copy to textValues, then keep
 * matching {{widget:id}} / {{sample:id}} bindings here. Never inline fixture values.
 */
export const dashboardTemplate = `

<div class="sky" aria-hidden="true"></div>

<svg class="sym" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
  <symbol id="i-meta" viewBox="0 0 24 24"><path d="M12 12c-2-4-4-6-6.5-6S2 8.5 2 12s1 6 3.5 6 4.5-2 6.5-6 4-6 6.5-6S22 8.5 22 12s-1 6-3.5 6-4.5-2-6.5-6z"></path></symbol>
  <symbol id="i-google" viewBox="0 0 24 24"><path d="M19.8 7.5A9 9 0 1 0 21 12H12" stroke-width="3"></path></symbol>
  <symbol id="i-bag" viewBox="0 0 24 24"><path d="M6 7h12l1 14H5z M9 7a3 3 0 0 1 6 0"></path></symbol>
  <symbol id="i-growth" viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8 M15 7h6v6"></path></symbol>
  <symbol id="i-box" viewBox="0 0 24 24"><path d="M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10"></path></symbol>
  <symbol id="i-cal" viewBox="0 0 24 24"><path d="M4 5h16v15H4z M4 10h16 M8 3v4 M16 3v4"></path></symbol>
  <symbol id="i-search" viewBox="0 0 24 24"><path d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z M20 20l-4-4"></path></symbol>
  <symbol id="i-mail" viewBox="0 0 24 24"><path d="M3 6h18v12H3z M3 7l9 6 9-6"></path></symbol>
  <symbol id="i-home" viewBox="0 0 24 24"><path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z"></path></symbol>
  <symbol id="i-list" viewBox="0 0 24 24"><path d="M4 6h16 M4 12h16 M4 18h10"></path></symbol>
  <symbol id="i-dial" viewBox="0 0 24 24"><path d="M4 17a8 8 0 0 1 16 0 M12 17l4-5"></path></symbol>
  <symbol id="i-star" viewBox="0 0 24 24"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"></path></symbol>
  <symbol id="i-review" viewBox="0 0 24 24"><path d="M4 4h16v12H9l-5 4z M12 6.6l1.3 2.6 2.8.4-2 2 .5 2.8-2.6-1.4-2.6 1.4.5-2.8-2-2 2.8-.4z"></path></symbol>
  <symbol id="i-flask" viewBox="0 0 24 24"><path d="M9 3h6M10 3v6l-5.5 9.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3M7.5 15h9"></path></symbol>
</svg>

<header class="top">
  <div class="hin">
    <a class="logo" href="#hero" aria-label="One of One, control centre"><img src="/assets/logo.png" alt="One of One" width="500" height="312" decoding="async"></a>
    <nav class="pills" aria-label="Sections">
      <button class="pill" type="button" aria-current="true" data-go="hero"><svg class="ic" aria-hidden="true"><use href="#i-home"></use></svg><span class="t"><span data-sample-text="t0021">{{sample:t0021}}</span></span></button>
      <button class="pill" type="button" data-go="table"><svg class="ic" aria-hidden="true"><use href="#i-list"></use></svg><span class="t"><span data-sample-text="t0022">{{sample:t0022}}</span></span></button>
      <button class="pill" type="button" data-go="tests"><svg class="ic" aria-hidden="true"><use href="#i-flask"></use></svg><span class="t"><span data-sample-text="t0023">{{sample:t0023}}</span></span></button>
      <button class="pill" type="button" data-go="dials"><svg class="ic" aria-hidden="true"><use href="#i-dial"></use></svg><span class="t"><span data-sample-text="t0024">{{sample:t0024}}</span></span></button>
      <a class="pill" href="/audit" aria-label="Audit log"><svg class="ic" aria-hidden="true"><use href="#i-cal"></use></svg><span class="t"><span data-sample-text="t0025">{{sample:t0025}}</span></span></a>
    </nav>
    <div class="right">
      <label class="search"><svg class="ic" aria-hidden="true"><use href="#i-search"></use></svg><input id="q" type="search" placeholder="Find a dial" autocomplete="off" aria-label="Find a dial"></label>
      <span class="clock"><span data-sample-text="t0026">{{sample:t0026}}</span></span>
      <span class="avatar" aria-label="Will"><span data-sample-text="t0027">{{sample:t0027}}</span></span>
    </div>
  </div>
</header>

<main class="wrap">

<section class="hero" id="hero">
  <div class="left">
    <div class="glass greet">
        <div class="hero-controls"><div class="seg" role="tablist" id="period" aria-label="Period"><button role="tab" type="button" aria-selected="true" data-period="today">Today</button><button role="tab" type="button" aria-selected="false" data-period="yday">Yesterday</button><button role="tab" type="button" aria-selected="false" data-period="7d">7 days</button><button role="tab" type="button" aria-selected="false" data-period="30d">30 days</button><button role="tab" type="button" aria-selected="false" data-period="pick" id="pickbtn" aria-haspopup="dialog" aria-label="Pick a day or dates"><svg class="ic" aria-hidden="true"><use href="#i-cal"/></svg><span id="picklbl">Dates</span></button></div></div>
      <div>
        <span class="eyebrow" id="eyebrow"><span data-sample-text="t0032">{{sample:t0032}}</span></span>
        <h1><span id="greeting" data-sample-text="t0033">{{sample:t0033}}</span></h1>
        <p class="sub" id="sub"><span id="sub1"><span data-sample-text="t0034">{{sample:t0034}}</span></span><span id="subrv"></span></p>
        <div class="counts" id="counts"></div>
        <div class="drops" id="drops" aria-live="polite"></div>
      </div>
      <div class="hourly" id="hourly-orders"></div>
    </div>

    <div class="seg" role="tablist" id="market" aria-label="Market"><button role="tab" type="button" aria-selected="true" data-market="all">All</button><button role="tab" type="button" aria-selected="false" data-market="uk">UK</button><button role="tab" type="button" aria-selected="false" data-market="us">US</button></div>
    <div class="four hero-grid">
      <button type="button" class="tile coral stat" data-k="net" data-g="hero" data-src="shopify" data-state="info" data-source="shopify" data-mode="sample"><span class="sl">Net sales</span><span class="sv big"></span><span class="spark" aria-hidden="true"></span><span class="ss"></span></button>
      <button type="button" class="tile stat" data-k="orders" data-g="hero" data-src="shopify" data-state="info" data-source="shopify" data-mode="sample"><span class="sl">Orders</span><span class="sv"></span><span class="ss"></span></button>
      <button type="button" class="tile stat" data-k="aov" data-g="hero" data-src="shopify" data-state="info" data-source="shopify" data-mode="sample"><span class="sl">AOV</span><span class="sv"></span><span class="ss"></span></button>
      <button type="button" class="tile stat" data-k="cac" data-g="hero" data-state="info" data-source="shopify" data-mode="sample"><span class="sl">CAC</span><span class="sv"></span><span class="ss"></span></button>
      <button type="button" class="tile stat" data-k="cr" data-g="hero" data-src="shopify" data-state="info" data-source="shopify" data-mode="sample"><span class="sl">Conversion rate</span><span class="sv"></span><span class="ss"></span></button>
      <button type="button" class="tile solid stat" data-k="spend" data-g="hero" data-state="info" data-source="shopify" data-mode="sample"><span class="sl">Ad spend</span><span class="sv"></span><span class="ss"></span></button>
      <button type="button" class="tile stat" data-k="roas" data-g="hero" data-state="info" data-source="shopify" data-mode="sample"><span class="sl">Overall ROAS</span><span class="sv"></span><span class="ss"></span></button>
      <button type="button" class="tile stat" data-k="margin" data-g="hero" data-state="info" data-source="shopify" data-mode="sample"><span class="sl">Net margin</span><span class="sv"></span><span class="ss"></span></button>
    </div>
    <div class="profit-pair">
      <button type="button" class="profit-line" data-k="contribution" data-g="hero" data-state="est" data-source="shopify" data-mode="sample"><span class="sl">Contribution</span><span class="sv"></span><span class="ss"></span></button>
      <button type="button" class="profit-line" data-k="profit" data-g="hero" data-state="est" data-source="shopify meta google-ads tiktok" data-mode="sample"><span class="sl">Net profit</span><span class="sv"></span><span class="ss"></span></button>
    </div>
  </div>

  <aside class="glass score" id="score" aria-label="Live, wins and coming up">
    <div class="stabs" role="tablist">
      <button role="tab" type="button" aria-selected="true" data-st="live"><span class="livedot" aria-hidden="true"></span><span data-sample-text="t0060">{{sample:t0060}}</span></button>
      <button role="tab" type="button" aria-selected="false" data-st="wins"><span data-sample-text="t0061">{{sample:t0061}}</span></button>
      <button role="tab" type="button" aria-selected="false" data-st="soon"><span data-sample-text="t0062">{{sample:t0062}}</span></button>
    </div>
    <div class="srows" data-sp="live">
      <div class="srow" data-source="github-hq" data-mode="sample"><span class="v"><span data-sample-text="t0063">{{sample:t0063}}</span></span><span class="l"><span data-sample-text="t0064">{{sample:t0064}}</span><small><span data-sample-text="t0065">{{sample:t0065}}</span></small></span><span class="d up"><span data-sample-text="t0066">{{sample:t0066}}</span></span></div>
      <div class="srow" data-source="github-hq" data-mode="sample"><span class="v"><span data-sample-text="t0067">{{sample:t0067}}</span></span><span class="l"><span data-sample-text="t0068">{{sample:t0068}}</span><small><span data-sample-text="t0069">{{sample:t0069}}</span></small></span><span class="d"><span data-sample-text="t0070">{{sample:t0070}}</span></span></div>
      <div class="srow" data-source="github-hq" data-mode="sample"><span class="v"><span data-sample-text="t0071">{{sample:t0071}}</span></span><span class="l"><span data-sample-text="t0072">{{sample:t0072}}</span><small><span data-sample-text="t0073">{{sample:t0073}}</span></small></span><span class="d"><span data-sample-text="t0074">{{sample:t0074}}</span></span></div>
      <div class="srow" data-source="github-hq" data-mode="sample"><span class="v"><span data-sample-text="t0075">{{sample:t0075}}</span></span><span class="l"><span data-sample-text="t0076">{{sample:t0076}}</span><small><span data-sample-text="t0077">{{sample:t0077}}</span></small></span><span class="d up"><span data-sample-text="t0078">{{sample:t0078}}</span></span></div>
      <div class="srow" data-source="github-hq" data-mode="sample"><span class="v"><span data-sample-text="t0079">{{sample:t0079}}</span></span><span class="l"><span data-sample-text="t0080">{{sample:t0080}}</span><small><span data-sample-text="t0081">{{sample:t0081}}</span></small></span><span class="d"><span data-sample-text="t0082">{{sample:t0082}}</span></span></div>
    </div>
    <div class="srows" data-sp="wins" hidden>
      <div class="srow win" data-source="github-hq" data-mode="sample"><span class="v"><span data-sample-text="t0083">{{sample:t0083}}</span></span><span class="l"><span data-sample-text="t0084">{{sample:t0084}}</span><small><span data-sample-text="t0085">{{sample:t0085}}</span></small></span><svg class="star" aria-hidden="true"><use href="#i-star"></use></svg></div>
      <div class="srow win" data-source="github-hq" data-mode="sample"><span class="v"><span data-sample-text="t0086">{{sample:t0086}}</span></span><span class="l"><span data-sample-text="t0087">{{sample:t0087}}</span><small><span data-sample-text="t0088">{{sample:t0088}}</span></small></span><svg class="star" aria-hidden="true"><use href="#i-star"></use></svg></div>
      <div class="srow win" data-source="github-hq" data-mode="sample"><span class="v"><span data-sample-text="t0089">{{sample:t0089}}</span></span><span class="l"><span data-sample-text="t0090">{{sample:t0090}}</span><small><span data-sample-text="t0091">{{sample:t0091}}</span></small></span><svg class="star" aria-hidden="true"><use href="#i-star"></use></svg></div>
      <div class="srow win" data-source="github-hq" data-mode="sample"><span class="v"><span data-sample-text="t0092">{{sample:t0092}}</span></span><span class="l"><span data-sample-text="t0093">{{sample:t0093}}</span><small><span data-sample-text="t0094">{{sample:t0094}}</span></small></span><svg class="star" aria-hidden="true"><use href="#i-star"></use></svg></div>
      <div class="srow win" data-source="github-hq" data-mode="sample"><span class="v"><span data-sample-text="t0095">{{sample:t0095}}</span></span><span class="l"><span data-sample-text="t0096">{{sample:t0096}}</span><small><span data-sample-text="t0097">{{sample:t0097}}</span></small></span><svg class="star" aria-hidden="true"><use href="#i-star"></use></svg></div>
    </div>
    <div class="srows" data-sp="soon" hidden>
      <div class="srow soon" data-source="github-hq" data-mode="sample"><span class="td"><span data-sample-text="t0098">{{sample:t0098}}</span></span><span class="l"><span data-sample-text="t0099">{{sample:t0099}}</span><small><span data-sample-text="t0100">{{sample:t0100}}</span></small></span><span class="d"><span data-sample-text="t0101">{{sample:t0101}}</span></span></div>
      <div class="srow" data-source="github-hq" data-mode="sample"><span class="td"><span data-sample-text="t0102">{{sample:t0102}}</span></span><span class="l"><span data-sample-text="t0103">{{sample:t0103}}</span><small><span data-sample-text="t0104">{{sample:t0104}}</span></small></span><span class="d"><span data-sample-text="t0105">{{sample:t0105}}</span></span></div>
      <div class="srow" data-source="github-hq" data-mode="sample"><span class="td"><span data-sample-text="t0106">{{sample:t0106}}</span></span><span class="l"><span data-sample-text="t0107">{{sample:t0107}}</span><small><span data-sample-text="t0108">{{sample:t0108}}</span></small></span><span class="d"><span data-sample-text="t0109">{{sample:t0109}}</span></span></div>
      <div class="srow" data-source="github-hq" data-mode="sample"><span class="td"><span data-sample-text="t0110">{{sample:t0110}}</span></span><span class="l"><span data-sample-text="t0111">{{sample:t0111}}</span><small><span data-sample-text="t0112">{{sample:t0112}}</span></small></span><span class="d"><span data-sample-text="t0113">{{sample:t0113}}</span></span></div>
      <div class="srow" data-source="github-hq" data-mode="sample"><span class="td"><span data-sample-text="t0114">{{sample:t0114}}</span></span><span class="l"><span data-sample-text="t0115">{{sample:t0115}}</span><small><span data-sample-text="t0116">{{sample:t0116}}</span></small></span><span class="d"><span data-sample-text="t0117">{{sample:t0117}}</span></span></div>
      <div class="srow" data-source="github-hq" data-mode="sample"><span class="td"><span data-sample-text="t0118">{{sample:t0118}}</span></span><span class="l"><span data-sample-text="t0119">{{sample:t0119}}</span><small><span data-sample-text="t0120">{{sample:t0120}}</span></small></span><span class="d"><span data-sample-text="t0121">{{sample:t0121}}</span></span></div>
      <div class="sfoot"><button class="btn" type="button" id="alldates"><span data-sample-text="t0122">{{sample:t0122}}</span></button></div>
    </div>
  </aside>
</section>

<section class="chapter tbl" id="table" aria-labelledby="table-title">
  <header class="chapter-heading"><span class="chapter-number" aria-hidden="true">1</span><div class="chapter-copy"><p class="chapter-eyebrow">Decisions</p><h2 class="chapter-title" id="table-title"><span data-sample-text="t0123">{{sample:t0123}}</span></h2></div><span class="shm" id="deckcount"><span data-sample-text="t0124">{{sample:t0124}}</span></span></header>
  <div class="deck" id="deck"></div>
  <div id="creative-feedback" role="status" aria-live="polite"></div>
</section>

<section class="chapter revs" id="reviews" aria-labelledby="reviews-title"></section>

<section class="chapter tests" id="tests" aria-labelledby="tests-title">
  <header class="chapter-heading"><span class="chapter-number" aria-hidden="true">3</span><div class="chapter-copy"><p class="chapter-eyebrow">Experiments</p><h2 class="chapter-title" id="tests-title"><span data-sample-text="t0200">{{sample:t0200}}</span></h2></div><span class="shm" id="testcount"><span data-sample-text="t0201">{{sample:t0201}}</span></span></header>
  <article class="tcard" data-state="info" data-g="growth" data-id="t1" data-kind="coin" data-test="{{widget:w006}}" data-source="shopify" data-mode="sample" data-model-id="w006">
    <div class="thead"><span class="tlane">Featured · <span class="chip info ghost">Sample</span></span><span class="src" aria-hidden="true"><svg class="ic"><use href="#i-bag"></use></svg></span><button class="rt" type="button" data-sheet="{{widget:w007}}" data-model-id="w007"><h3 class="test-name"><span data-sample-text="t0203">{{sample:t0203}}</span></h3><span class="rec"><span data-sample-text="t0204">{{sample:t0204}}</span></span></button><span class="chip info" data-tchip><span data-sample-text="t0205">{{sample:t0205}}</span></span></div>
    <div class="tbody"><div class="tbars" data-bars></div><div class="tsure" data-sure></div></div>
    <p class="tsay" data-say></p>
    <div class="tfoot"><span class="tprog" data-prog></span><div class="acts"><button class="act" data-call type="button" disabled title="Call · Not built yet" aria-label="Call · Not built yet">Not built yet</button></div></div>


  </article>
  <div class="test-list"><span class="chip info ghost">Sample</span>
      <div class="trow" data-source="github-hq" data-mode="sample"><span class="test-stage">Next</span><button class="rt" type="button" data-sheet="{{widget:w008}}" data-model-id="w008"><h3 class="test-name"><span data-sample-text="t0208">{{sample:t0208}}</span></h3></button></div>
      <div class="trow" data-source="github-hq" data-mode="sample"><span class="test-stage">Won</span><button class="rt" type="button" data-sheet="{{widget:w014}}" data-model-id="w014"><h3 class="test-name"><span data-sample-text="t0234">{{sample:t0234}}</span></h3></button></div>
      <div class="trow" data-source="github-hq" data-mode="sample"><span class="test-stage">Draw</span><button class="rt" type="button" data-sheet="{{widget:w015}}" data-model-id="w015"><h3 class="test-name"><span data-sample-text="t0238">{{sample:t0238}}</span></h3></button></div>
  <details class="test-more"><summary>+6 more</summary><div class="trows">      <div class="trow" data-source="github-hq" data-mode="sample"><span class="chip decide"><span data-sample-text="t0211">{{sample:t0211}}</span></span><span class="src" aria-hidden="true"><svg class="ic"><use href="#i-bag"></use></svg></span><button class="rt" type="button" data-sheet="{{widget:w009}}" data-model-id="w009"><h3 class="test-name"><span data-sample-text="t0212">{{sample:t0212}}</span></h3><span class="rec"><span data-sample-text="t0213">{{sample:t0213}}</span></span></button></div>
      <div class="trow" data-source="github-hq" data-mode="sample"><span class="chip decide"><span data-sample-text="t0216">{{sample:t0216}}</span></span><span class="src" aria-hidden="true"><svg class="ic"><use href="#i-meta"></use></svg></span><button class="rt" type="button" data-sheet="{{widget:w010}}" data-model-id="w010"><h3 class="test-name"><span data-sample-text="t0217">{{sample:t0217}}</span></h3><span class="rec"><span data-sample-text="t0218">{{sample:t0218}}</span></span></button><span class="d"><span data-sample-text="t0219">{{sample:t0219}}</span></span></div>
      <div class="trow" data-source="github-hq" data-mode="sample"><span class="chip info"><span data-sample-text="t0220">{{sample:t0220}}</span></span><span class="src" aria-hidden="true"><svg class="ic"><use href="#i-meta"></use></svg></span><button class="rt" type="button" data-sheet="{{widget:w011}}" data-model-id="w011"><h3 class="test-name"><span data-sample-text="t0221">{{sample:t0221}}</span></h3><span class="rec"><span data-sample-text="t0222">{{sample:t0222}}</span></span></button><span class="d"><span data-sample-text="t0223">{{sample:t0223}}</span></span></div>
      <div class="trow wait" data-source="github-hq" data-mode="sample"><span class="chip info"><span data-sample-text="t0224">{{sample:t0224}}</span></span><span class="src" aria-hidden="true"><svg class="ic"><use href="#i-bag"></use></svg></span><button class="rt" type="button" data-sheet="{{widget:w012}}" data-model-id="w012"><h3 class="test-name"><span data-sample-text="t0225">{{sample:t0225}}</span></h3><span class="rec"><span data-sample-text="t0226">{{sample:t0226}}</span></span></button><span class="d"><span data-sample-text="t0227">{{sample:t0227}}</span></span></div>
      <div class="trow wait" data-source="github-hq" data-mode="sample"><span class="chip info"><span data-sample-text="t0228">{{sample:t0228}}</span></span><span class="src" aria-hidden="true"><svg class="ic"><use href="#i-bag"></use></svg></span><button class="rt" type="button" data-sheet="{{widget:w013}}" data-model-id="w013"><h3 class="test-name"><span data-sample-text="t0229">{{sample:t0229}}</span></h3><span class="rec"><span data-sample-text="t0230">{{sample:t0230}}</span></span></button><span class="d"><span data-sample-text="t0231">{{sample:t0231}}</span></span></div>
      <div class="trow" data-source="github-hq" data-mode="sample"><span class="chip good"><span data-sample-text="t0241">{{sample:t0241}}</span></span><span class="src" aria-hidden="true"><svg class="ic"><use href="#i-mail"></use></svg></span><button class="rt" type="button" data-sheet="{{widget:w016}}" data-model-id="w016"><h3 class="test-name"><span data-sample-text="t0242">{{sample:t0242}}</span></h3><span class="rec"><span data-sample-text="t0243">{{sample:t0243}}</span></span></button><span class="d"><span data-sample-text="t0244">{{sample:t0244}}</span></span></div></div></details></div>
</section>

<section class="chapter dials" id="dials" aria-labelledby="dials-title">
  <header class="chapter-heading"><span class="chapter-number" aria-hidden="true">4</span><div class="chapter-copy"><p class="chapter-eyebrow">By source</p><h2 class="chapter-title" id="dials-title"><span data-sample-text="t0245">{{sample:t0245}}</span></h2></div><span class="shm" id="dialcount"><span data-sample-text="t0246">{{sample:t0246}}</span></span></header>
  <div class="tabs" id="tabs" role="tablist">
    <button class="tab" role="tab" data-tab="ads" aria-label="Ads" aria-selected="true"><svg class="ic"><use href="#i-meta"></use></svg><span class="t"><span data-sample-text="t0247">{{sample:t0247}}</span></span><span class="dot info"></span></button>
    <button class="tab" role="tab" data-tab="store" aria-label="Store" aria-selected="false"><svg class="ic"><use href="#i-bag"></use></svg><span class="t"><span data-sample-text="t0248">{{sample:t0248}}</span></span><span class="dot info"></span></button>
    <button class="tab" role="tab" data-tab="growth" aria-label="Growth" aria-selected="false"><svg class="ic"><use href="#i-growth"></use></svg><span class="t"><span data-sample-text="t0249">{{sample:t0249}}</span></span><span class="dot info"></span></button>
    <button class="tab" role="tab" data-tab="stock" aria-label="Stock" aria-selected="false"><svg class="ic"><use href="#i-box"></use></svg><span class="t"><span data-sample-text="t0250">{{sample:t0250}}</span></span><span class="dot info"></span></button>
  </div>

  <div class="panel" id="p-ads" data-panel="ads">
    <div class="grid">
      <button type="button" class="tile dial" data-k="ukcpo" data-market-only="uk" data-src="meta" data-g="meta" data-dial="{{widget:w001}}" data-source="meta shopify" data-mode="sample" data-model-id="w001"></button>
      <button type="button" class="tile dial" data-k="uscpo" data-market-only="us" data-src="meta" data-g="meta" data-dial="{{widget:w002}}" data-source="meta shopify" data-mode="sample" data-model-id="w002"></button>
      <article class="tile series-pace" data-source="shopify" data-mode="sample" data-model-id="w017" aria-label="Series 1 sell-out pace"></article>
      <button class="tile dial" data-src="meta" data-dial="{{widget:w018}}" data-source="meta" data-mode="sample" data-model-id="w018"></button>
      <button class="tile dial" data-src="meta" data-dial="{{widget:w019}}" data-source="meta shopify" data-mode="sample" data-model-id="w019"></button>
      <button class="tile dial" data-src="meta" data-dial="{{widget:w020}}" data-source="meta" data-mode="sample" data-model-id="w020"></button>
      <button class="tile dial" data-src="meta" data-dial="{{widget:w021}}" data-source="meta" data-mode="sample" data-model-id="w021"></button>
      <button class="tile dial" data-src="meta" data-dial="{{widget:w022}}" data-source="meta" data-mode="sample" data-model-id="w022"></button>
      <button class="tile dial" data-src="meta" data-dial="{{widget:w023}}" data-source="meta" data-mode="sample" data-model-id="w023"></button>
      <button class="tile dial" data-src="google" data-g="google" data-dial="{{widget:w024}}" data-source="google-ads" data-mode="sample" data-model-id="w024"></button>
      <button class="tile dial" data-src="google" data-g="google" data-dial="{{widget:w025}}" data-source="google-ads" data-mode="sample" data-model-id="w025"></button>
      <button class="tile dial" data-src="google" data-g="google" data-dial="{{widget:w026}}" data-source="google-ads" data-mode="sample" data-model-id="w026"></button>
      <button class="tile stat" data-state="good" data-src="meta" data-detail="{{widget:w027}}" data-source="meta" data-mode="sample" data-model-id="w027">
        <span class="sl"><span data-sample-text="t0251">{{sample:t0251}}</span></span><span class="sv"><span data-sample-text="t0252">{{sample:t0252}}</span></span><span class="ss"><span data-sample-text="t0253">{{sample:t0253}}</span></span>
      </button>
      <button class="tile stat" data-state="good" data-src="meta" data-detail="{{widget:w028}}" data-source="meta google-ads tiktok" data-mode="sample" data-model-id="w028">
        <span class="sl"><span data-sample-text="t0254">{{sample:t0254}}</span></span><span class="sv"><span data-sample-text="t0255">{{sample:t0255}}</span></span><span class="ss"><span data-sample-text="t0256">{{sample:t0256}}</span></span>
      </button>
    </div>
    <div class="tabs-foot"><div id="adset-summary"></div><button class="btn" id="livesets"><span data-sample-text="t0258">{{sample:t0258}}</span></button></div>
  </div>

  <div class="panel" id="p-store" data-panel="store" hidden>
    <div class="grid">
      <button class="tile dial" data-src="shopify" data-dial="{{widget:w029}}" data-source="shopify" data-mode="sample" data-model-id="w029"></button>
      <button class="tile dial" data-src="shopify" data-dial="{{widget:w030}}" data-source="shopify" data-mode="sample" data-model-id="w030"></button>
      <button class="tile dial" data-src="shopify" data-dial="{{widget:w031}}" data-source="shopify" data-mode="sample" data-model-id="w031"></button>
      <button class="tile dial" data-dial="{{widget:w032}}" data-source="shopify" data-mode="sample" data-model-id="w032"></button>
      <button class="tile dial" data-src="shopify" data-dial="{{widget:w033}}" data-source="shopify meta google-ads" data-mode="sample" data-model-id="w033"></button>
      <button class="tile dial" data-src="shopify" data-dial="{{widget:w034}}" data-source="shopify" data-mode="sample" data-model-id="w034"></button>
      <button class="tile stat" data-state="info" data-src="shopify" data-detail="{{widget:w035}}" data-source="shopify" data-mode="sample" data-model-id="w035">
        <span class="sl"><span data-sample-text="t0259">{{sample:t0259}}</span></span><span class="sv"><span data-sample-text="t0260">{{sample:t0260}}</span></span><span class="ss"><span data-sample-text="t0261">{{sample:t0261}}</span></span>
      </button>
      <button class="tile stat" data-state="good" data-src="shopify" data-detail="{{widget:w036}}" data-source="shopify" data-mode="sample" data-model-id="w036">
        <span class="sl"><span data-sample-text="t0262">{{sample:t0262}}</span></span><span class="sv"><span data-sample-text="t0263">{{sample:t0263}}</span></span><span class="ss"><span data-sample-text="t0264">{{sample:t0264}}</span></span>
      </button>
      <button class="tile stat" data-state="warn" data-src="shopify" data-detail="{{widget:w037}}" data-source="shopify" data-mode="sample" data-model-id="w037">
        <span class="sl"><span data-sample-text="t0265">{{sample:t0265}}</span></span><span class="sv"><span data-sample-text="t0266">{{sample:t0266}}</span></span><span class="ss"><span data-sample-text="t0267">{{sample:t0267}}</span></span>
      </button>
    </div>
  </div>

  <div class="panel" id="p-growth" data-panel="growth" hidden>
    <div class="grid">
      <button class="tile dial" data-src="mail" data-g="email" data-dial="{{widget:w038}}" data-source="mailchimp" data-mode="sample" data-model-id="w038"></button>
      <button class="tile stat" data-state="good" data-src="mail" data-g="email" data-detail="{{widget:w039}}" data-source="mailchimp shopify" data-mode="sample" data-model-id="w039">
        <span class="sl"><span data-sample-text="t0268">{{sample:t0268}}</span></span><span class="sv"><span data-sample-text="t0269">{{sample:t0269}}</span></span><span class="ss"><span data-sample-text="t0270">{{sample:t0270}}</span></span>
      </button>
      <button class="tile ring" data-src="shopify" data-ring="{{widget:w040}}" data-source="shopify" data-mode="sample" data-model-id="w040"></button>
      <button class="tile stat" data-state="info" data-src="shopify" data-detail="{{widget:w041}}" data-source="shopify" data-mode="sample" data-model-id="w041">
        <span class="sl"><span data-sample-text="t0271">{{sample:t0271}}</span></span>
        <span class="abbar" aria-hidden="true"><span class="r uk"><span><span data-sample-text="t0272">{{sample:t0272}}</span></span><span class="bar"><i style="width:100%"></i></span><b><span data-sample-text="t0273">{{sample:t0273}}</span></b></span><span class="r us"><span><span data-sample-text="t0274">{{sample:t0274}}</span></span><span class="bar"><i style="width:81%"></i></span><b><span data-sample-text="t0275">{{sample:t0275}}</span></b></span></span>
        <span class="ss"><span data-sample-text="t0276">{{sample:t0276}}</span></span>
      </button>
      <button class="tile dial" data-src="meta" data-g="meta" data-dial="{{widget:w042}}" data-source="meta" data-mode="sample" data-model-id="w042"></button>
      <button class="tile stat" data-state="good" data-src="mail" data-g="email" data-detail="{{widget:w043}}" data-source="mailchimp shopify" data-mode="sample" data-model-id="w043">
        <span class="sl"><span data-sample-text="t0277">{{sample:t0277}}</span></span><span class="sv"><span data-sample-text="t0278">{{sample:t0278}}</span></span><span class="ss"><span data-sample-text="t0279">{{sample:t0279}}</span></span>
      </button>
      <button class="tile stat" data-state="good" data-src="mail" data-g="email" data-detail="{{widget:w044}}" data-source="mailchimp" data-mode="sample" data-model-id="w044">
        <span class="sl"><span data-sample-text="t0280">{{sample:t0280}}</span></span><span class="sv"><span data-sample-text="t0281">{{sample:t0281}}</span></span><span class="ss"><span data-sample-text="t0282">{{sample:t0282}}</span></span>
      </button>
      <button class="tile stat" data-state="good" data-src="mail" data-g="email" data-detail="{{widget:w045}}" data-source="mailchimp shopify" data-mode="sample" data-model-id="w045">
        <span class="sl"><span data-sample-text="t0283">{{sample:t0283}}</span></span><span class="sv"><span data-sample-text="t0284">{{sample:t0284}}</span></span><span class="ss"><span data-sample-text="t0285">{{sample:t0285}}</span></span>
      </button>
    </div>
  </div>

  <div class="panel" id="p-stock" data-panel="stock" hidden>
    <div class="grid">
      <button class="tile ring" data-src="stock" data-ring="{{widget:w046}}" data-source="shopify" data-mode="sample" data-model-id="w046"></button>
      <button class="tile ring" data-src="stock" data-ring="{{widget:w047}}" data-source="shopify" data-mode="sample" data-model-id="w047"></button>
      <button class="tile ring" data-src="stock" data-ring="{{widget:w048}}" data-source="shopify" data-mode="sample" data-model-id="w048"></button>
      <button class="tile ring" data-ring="{{widget:w049}}" data-source="github-hq" data-mode="sample" data-model-id="w049"></button>
      <button class="tile ring" data-ring="{{widget:w050}}" data-source="github-hq" data-mode="sample" data-model-id="w050"></button>
      <button class="tile ring" data-ring="{{widget:w051}}" data-source="github-hq" data-mode="sample" data-model-id="w051"></button>
      <button class="tile stat" data-state="good" data-src="stock" data-detail="{{widget:w052}}" data-source="shopify github-hq" data-mode="sample" data-model-id="w052">
        <span class="sl"><span data-sample-text="t0286">{{sample:t0286}}</span></span><span class="sv"><span data-sample-text="t0287">{{sample:t0287}}</span></span><span class="ss"><span data-sample-text="t0288">{{sample:t0288}}</span></span>
      </button>
      <button class="tile stat" data-state="info" data-src="stock" data-detail="{{widget:w053}}" data-source="shopify github-hq" data-mode="sample" data-model-id="w053">
        <span class="sl"><span data-sample-text="t0289">{{sample:t0289}}</span></span><span class="sv"><span data-sample-text="t0290">{{sample:t0290}}</span></span><span class="ss"><span data-sample-text="t0291">{{sample:t0291}}</span></span>
      </button>
    </div>
  </div>
</section>

<footer class="glass foot" id="foot">
  <span id="connection-status"></span><a href="/sources">Source health</a><a href="/audit">Audit log</a>
  <span id="update-status" role="status" aria-live="polite">Connecting…</span>
  <span id="auth-message" role="status" aria-live="polite"></span>
</footer>

</main>

<dialog id="sheet" aria-labelledby="sh-title">
  <div class="sheet">
    <div class="grab" aria-hidden="true"></div>
    <div class="ttl"><span class="dot info" id="sh-dot"><span data-sample-text="t0302">{{sample:t0302}}</span></span><h3 id="sh-title"></h3><button class="x" id="sh-x" aria-label="Close"><span data-sample-text="t0303">{{sample:t0303}}</span></button></div>
    <dl id="sh-dl"><dt><span data-sample-text="t0304">{{sample:t0304}}</span></dt><dd id="sh-why"></dd><dt><span data-sample-text="t0305">{{sample:t0305}}</span></dt><dd id="sh-rule"></dd><dt><span data-sample-text="t0306">{{sample:t0306}}</span></dt><dd id="sh-src"></dd></dl>
    <div id="sh-chart"></div>
    <div id="sh-extra"></div>
  </div>
</dialog>

<dialog id="picker" aria-labelledby="pk-title">
  <div class="sheet">
    <div class="grab" aria-hidden="true"></div>
    <div class="ttl"><svg class="ic" aria-hidden="true"><use href="#i-cal"/></svg><h3 id="pk-title">Pick a day or dates</h3><button class="x" id="pk-x" aria-label="Close">×</button></div>
    <div class="quick" id="pkquick"><button class="act" type="button" data-q="14">Last 14 days</button><button class="act" type="button" data-q="mtd">Month to date</button><button class="act" type="button" data-q="lm">Last month</button><button class="act" type="button" data-q="ytd">Year to date</button></div>
    <div class="calbar"><button class="nav" type="button" data-nav="-1" aria-label="Earlier month">‹</button><p id="pkhint" aria-live="polite"></p><button class="nav" type="button" data-nav="1" aria-label="Later month">›</button></div>
    <div class="cals" id="pkcal"></div>
    <p id="pkerror" role="status" aria-live="polite"></p>
    <div class="pkfoot"><span class="pknote" id="pkbounds"></span><button class="act" type="button" id="pkclear">Clear</button><button class="act primary" type="button" id="pkgo" disabled>Pick a day</button></div>
  </div>
</dialog>

<template id="t-livesets">
  <div class="tblwrap"><table>
    <thead><tr data-source="meta" data-mode="sample"><th><span data-sample-text="t0307">{{sample:t0307}}</span></th><th><span data-sample-text="t0308">{{sample:t0308}}</span></th><th><span data-sample-text="t0309">{{sample:t0309}}</span></th><th><span data-sample-text="t0310">{{sample:t0310}}</span></th><th></th></tr></thead>
    <tbody>
      <tr data-source="meta" data-mode="sample"><td><span data-sample-text="t0311">{{sample:t0311}}</span></td><td class="n"><span data-sample-text="t0312">{{sample:t0312}}</span></td><td class="n"><span data-sample-text="t0313">{{sample:t0313}}</span></td><td><span class="chip decide"><span data-sample-text="t0314">{{sample:t0314}}</span></span></td><td></td></tr>
      <tr data-source="meta" data-mode="sample"><td><span data-sample-text="t0315">{{sample:t0315}}</span><span class="mut"><span data-sample-text="t0316">{{sample:t0316}}</span></span></td><td class="n"><span data-sample-text="t0317">{{sample:t0317}}</span></td><td class="n"><span data-sample-text="t0318">{{sample:t0318}}</span></td><td><span class="chip warn"><span data-sample-text="t0319">{{sample:t0319}}</span></span></td><td><span class="flow"><span class="mut"><span data-sample-text="t0320">{{sample:t0320}}</span></span></span></td></tr>
      <tr data-source="meta" data-mode="sample"><td><span data-sample-text="t0321">{{sample:t0321}}</span></td><td class="n"><span data-sample-text="t0322">{{sample:t0322}}</span></td><td class="n"><span data-sample-text="t0323">{{sample:t0323}}</span></td><td><span class="chip warn"><span data-sample-text="t0324">{{sample:t0324}}</span></span></td><td><span class="flow"><span class="mut"><span data-sample-text="t0325">{{sample:t0325}}</span></span></span></td></tr>
      <tr data-source="meta" data-mode="sample"><td><span data-sample-text="t0326">{{sample:t0326}}</span></td><td class="n"><span data-sample-text="t0327">{{sample:t0327}}</span></td><td class="n"><span data-sample-text="t0328">{{sample:t0328}}</span></td><td><span class="chip warn"><span data-sample-text="t0329">{{sample:t0329}}</span></span></td><td><span class="flow"><span class="mut"><span data-sample-text="t0330">{{sample:t0330}}</span></span></span></td></tr>
      <tr data-source="meta" data-mode="sample"><td><span data-sample-text="t0331">{{sample:t0331}}</span></td><td class="n"><span data-sample-text="t0332">{{sample:t0332}}</span></td><td class="n"><span data-sample-text="t0333">{{sample:t0333}}</span></td><td><span class="chip good"><span data-sample-text="t0334">{{sample:t0334}}</span></span></td><td></td></tr>
      <tr data-source="meta" data-mode="sample"><td><span data-sample-text="t0335">{{sample:t0335}}</span></td><td class="n"><span data-sample-text="t0336">{{sample:t0336}}</span></td><td class="n"><span data-sample-text="t0337">{{sample:t0337}}</span></td><td><span class="chip warn"><span data-sample-text="t0338">{{sample:t0338}}</span></span></td><td><span class="flow"><span class="mut"><span data-sample-text="t0339">{{sample:t0339}}</span></span></span></td></tr>
      <tr data-source="meta" data-mode="sample"><td><span data-sample-text="t0340">{{sample:t0340}}</span><span class="mut"><span data-sample-text="t0341">{{sample:t0341}}</span></span></td><td class="n"><span data-sample-text="t0342">{{sample:t0342}}</span></td><td class="n"><span data-sample-text="t0343">{{sample:t0343}}</span></td><td><span class="chip good"><span data-sample-text="t0344">{{sample:t0344}}</span></span></td><td></td></tr>
      <tr data-source="meta" data-mode="sample"><td><span data-sample-text="t0345">{{sample:t0345}}</span><span class="mut"><span data-sample-text="t0346">{{sample:t0346}}</span></span></td><td class="n"><span data-sample-text="t0347">{{sample:t0347}}</span></td><td class="n"><span data-sample-text="t0348">{{sample:t0348}}</span></td><td><span class="chip good"><span data-sample-text="t0349">{{sample:t0349}}</span></span></td><td></td></tr>
      <tr data-source="meta" data-mode="sample"><td><span data-sample-text="t0350">{{sample:t0350}}</span></td><td class="n"><span data-sample-text="t0351">{{sample:t0351}}</span></td><td class="n"><span data-sample-text="t0352">{{sample:t0352}}</span></td><td><span class="chip good"><span data-sample-text="t0353">{{sample:t0353}}</span></span></td><td></td></tr>
    </tbody>
  </table></div>
  <p class="note" style="margin-top:10px"><span data-sample-text="t0354">{{sample:t0354}}</span></p>
</template>

<template id="t-dates">
  <div class="timeline">
    <div class="tl"><span class="td"><span data-sample-text="t0355">{{sample:t0355}}</span></span><span><span data-sample-text="t0356">{{sample:t0356}}</span></span><span class="tin"><span data-sample-text="t0357">{{sample:t0357}}</span></span></div>
    <div class="tl"><span class="td"><span data-sample-text="t0358">{{sample:t0358}}</span></span><span><span data-sample-text="t0359">{{sample:t0359}}</span></span><span class="tin"><span data-sample-text="t0360">{{sample:t0360}}</span></span></div>
    <div class="tl"><span class="td"><span data-sample-text="t0361">{{sample:t0361}}</span></span><span><span data-sample-text="t0362">{{sample:t0362}}</span></span><span class="tin"><span data-sample-text="t0363">{{sample:t0363}}</span></span></div>
    <div class="tl"><span class="td"><span data-sample-text="t0364">{{sample:t0364}}</span></span><span><span data-sample-text="t0365">{{sample:t0365}}</span></span><span class="tin"><span data-sample-text="t0366">{{sample:t0366}}</span></span></div>
    <div class="tl"><span class="td"><span data-sample-text="t0367">{{sample:t0367}}</span></span><span><span data-sample-text="t0368">{{sample:t0368}}</span></span><span class="tin"><span data-sample-text="t0369">{{sample:t0369}}</span></span></div>
    <div class="tl"><span class="td"><span data-sample-text="t0370">{{sample:t0370}}</span></span><span><span data-sample-text="t0371">{{sample:t0371}}</span></span><span class="tin"><span data-sample-text="t0372">{{sample:t0372}}</span></span></div>
    <div class="tl"><span class="td"><span data-sample-text="t0373">{{sample:t0373}}</span></span><span><span data-sample-text="t0374">{{sample:t0374}}</span></span><span class="tin"><span data-sample-text="t0375">{{sample:t0375}}</span></span></div>
    <div class="tl"><span class="td"><span data-sample-text="t0376">{{sample:t0376}}</span></span><span><span data-sample-text="t0377">{{sample:t0377}}</span></span><span class="tin"><span data-sample-text="t0378">{{sample:t0378}}</span></span></div>
    <div class="tl"><span class="td"><span data-sample-text="t0379">{{sample:t0379}}</span></span><span><span data-sample-text="t0380">{{sample:t0380}}</span></span><span class="tin"><span data-sample-text="t0381">{{sample:t0381}}</span></span></div>
    <div class="tl"><span class="td"><span data-sample-text="t0382">{{sample:t0382}}</span></span><span><span data-sample-text="t0383">{{sample:t0383}}</span></span><span class="tin"><span data-sample-text="t0384">{{sample:t0384}}</span></span></div>
    <div class="tl"><span class="td"><span data-sample-text="t0385">{{sample:t0385}}</span></span><span><span data-sample-text="t0386">{{sample:t0386}}</span></span><span class="tin"><span data-sample-text="t0387">{{sample:t0387}}</span></span></div>
    <div class="tl"><span class="td"><span data-sample-text="t0388">{{sample:t0388}}</span></span><span><span data-sample-text="t0389">{{sample:t0389}}</span></span><span class="tin"><span data-sample-text="t0390">{{sample:t0390}}</span></span></div>
  </div>
</template>
`;
