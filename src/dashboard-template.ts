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
      <button class="pill" type="button" data-go="foot"><svg class="ic" aria-hidden="true"><use href="#i-cal"></use></svg><span class="t"><span data-sample-text="t0025">{{sample:t0025}}</span></span></button>
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
      <div>
        <div class="seg" role="tablist" id="period" aria-label="Period"><button role="tab" type="button" aria-selected="true" data-period="today">Today</button><button role="tab" type="button" aria-selected="false" data-period="yday">Yesterday</button><button role="tab" type="button" aria-selected="false" data-period="7d">7 days</button><button role="tab" type="button" aria-selected="false" data-period="30d">30 days</button><button role="tab" type="button" aria-selected="false" data-period="pick" id="pickbtn" aria-haspopup="dialog" aria-label="Pick a day or dates"><svg class="ic" aria-hidden="true"><use href="#i-cal"/></svg><span id="picklbl">Dates</span></button></div>
        <span class="eyebrow" id="eyebrow"><span data-sample-text="t0032">{{sample:t0032}}</span></span>
        <h1><span id="greeting" data-sample-text="t0033">{{sample:t0033}}</span></h1>
        <p class="sub" id="sub"><span id="sub1"><span data-sample-text="t0034">{{sample:t0034}}</span></span><span id="subrv"></span></p>
        <div class="counts" id="counts"></div>
      </div>
      <div class="radar" id="radar" role="img"></div>
    </div>

    <div class="four">
      <button class="tile coral stat" data-k="net" data-state="sofar" data-g="hero" data-src="shopify" data-source="shopify" data-mode="sample">
        <span class="sl"><span data-sample-text="t0036">{{sample:t0036}}</span><span class="per"><span data-sample-text="t0037">{{sample:t0037}}</span></span></span>
        <span class="sv big" data-n="{{sample:t0001}}" data-pre="£" data-sample-attributes="{&quot;data-n&quot;:&quot;t0001&quot;}"><span data-sample-text="t0038">{{sample:t0038}}</span></span>
        <span class="spark" data-spark="{{sample:t0002}}" aria-hidden="true" data-sample-attributes="{&quot;data-spark&quot;:&quot;t0002&quot;}"></span>
        <span class="ss"><span data-sample-text="t0039">{{sample:t0039}}</span></span>
      </button>
      <button class="tile stat" data-k="orders" data-state="sofar" data-g="hero" data-src="shopify" data-source="shopify" data-mode="sample">
        <span class="sl"><span data-sample-text="t0040">{{sample:t0040}}</span><span class="per"><span data-sample-text="t0041">{{sample:t0041}}</span></span></span>
        <span class="sv big" data-n="{{sample:t0003}}" data-sample-attributes="{&quot;data-n&quot;:&quot;t0003&quot;}"><span data-sample-text="t0042">{{sample:t0042}}</span></span>
        <span class="ss"><span data-sample-text="t0043">{{sample:t0043}}</span></span>
      </button>
      <button class="tile stat" data-k="cr" data-state="sofar" data-g="hero" data-src="shopify" data-source="shopify" data-mode="sample">
        <span class="sl"><span data-sample-text="t0044">{{sample:t0044}}</span><span class="per"><span data-sample-text="t0045">{{sample:t0045}}</span></span></span>
        <span class="sv big" data-n="{{sample:t0004}}" data-dp="1" data-suf="%" data-sample-attributes="{&quot;data-n&quot;:&quot;t0004&quot;}"><span data-sample-text="t0046">{{sample:t0046}}</span></span>
        <span class="ss"><span data-sample-text="t0047">{{sample:t0047}}</span></span>
      </button>
      <button class="tile solid stat" data-k="spend" data-state="sofar" data-g="hero" data-source="meta google-ads tiktok" data-mode="sample">
        <span class="sl"><span data-sample-text="t0048">{{sample:t0048}}</span><span class="per"><span data-sample-text="t0049">{{sample:t0049}}</span></span></span>
        <span class="sv big" data-n="{{sample:t0005}}" data-pre="£" data-sample-attributes="{&quot;data-n&quot;:&quot;t0005&quot;}"><span data-sample-text="t0050">{{sample:t0050}}</span></span>
        <span class="ss"><span data-sample-text="t0051">{{sample:t0051}}</span></span>
      </button>
      <button class="tile stat" data-k="roas" data-state="info" data-g="hero" data-source="shopify meta google-ads" data-mode="sample">
        <span class="sl"><span data-sample-text="t0052">{{sample:t0052}}</span><span class="per"><span data-sample-text="t0053">{{sample:t0053}}</span></span></span>
        <span class="sv" data-n="{{sample:t0006}}" data-dp="2" data-suf="×" data-sample-attributes="{&quot;data-n&quot;:&quot;t0006&quot;}"><span data-sample-text="t0054">{{sample:t0054}}</span></span>
        <span class="ss"><span data-sample-text="t0055">{{sample:t0055}}</span></span>
      </button>
    </div>

    <div class="quad">
      <button class="tile dial" data-k="ukcpo" data-src="meta" data-g="meta" data-dial="{{widget:w001}}" data-source="meta shopify" data-mode="sample" data-model-id="w001"></button>
      <button class="tile dial" data-k="uscpo" data-src="meta" data-g="meta" data-dial="{{widget:w002}}" data-source="meta shopify" data-mode="sample" data-model-id="w002"></button>
      <button class="tile stat" data-k="margin" data-state="est" data-g="hero" data-source="shopify meta google-ads github-hq" data-mode="sample">
        <span class="sl"><span data-sample-text="t0056">{{sample:t0056}}</span><span class="per"><span data-sample-text="t0057">{{sample:t0057}}</span></span></span>
        <span class="sv" data-n="{{sample:t0007}}" data-suf="%" data-sample-attributes="{&quot;data-n&quot;:&quot;t0007&quot;}"><span data-sample-text="t0058">{{sample:t0058}}</span></span>
        <span class="ss"><span data-sample-text="t0059">{{sample:t0059}}</span></span>
      </button>
      <button class="tile stat" data-k="profit" data-state="est" data-g="hero" data-source="shopify meta google-ads github-hq" data-mode="sample">
        <span class="sl">Net profit · <span class="per"></span></span>
        <span class="sv" data-pre="£" data-dp="2"></span>
        <span class="ss"></span>
      </button>
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

<section class="glass tbl" id="table">
  <div class="sh"><h2><span data-sample-text="t0123">{{sample:t0123}}</span></h2><span class="shm" id="deckcount"><span data-sample-text="t0124">{{sample:t0124}}</span></span></div>
  <div class="deck" id="deck">

    <article class="dcard" data-state="alarm" data-id="slabs" data-source="shopify github-hq" data-mode="sample">
      <div class="rhead">
        <span class="chip alarm"><span data-sample-text="t0125">{{sample:t0125}}</span></span>
        <span class="src" aria-hidden="true"><svg class="ic"><use href="#i-box"></use></svg></span>
        <button class="rt" type="button" aria-expanded="false"><h3><span data-sample-text="t0126">{{sample:t0126}}</span></h3><span class="rec"><span data-sample-text="t0127">{{sample:t0127}}</span></span></button>
        <div class="nums"><div><b><span data-sample-text="t0128">{{sample:t0128}}</span></b><span><span data-sample-text="t0129">{{sample:t0129}}</span></span></div><div><b><span data-sample-text="t0130">{{sample:t0130}}</span></b><span><span data-sample-text="t0131">{{sample:t0131}}</span></span></div><div><b><span data-sample-text="t0132">{{sample:t0132}}</span></b><span><span data-sample-text="t0133">{{sample:t0133}}</span></span></div></div>
        <div class="acts">
          <button class="act primary" type="button" disabled title="Copy message to Helen · Not built yet" aria-label="Copy message to Helen · Not built yet">Not built yet</button>
          <button class="act" type="button" disabled title="{{sample:t0008}}" aria-label="{{sample:t0009}}" data-sample-attributes="{&quot;title&quot;:&quot;t0008&quot;,&quot;aria-label&quot;:&quot;t0009&quot;}">Not built yet</button>
        </div>
      </div>
      <p class="why" hidden><span data-sample-text="t0134">{{sample:t0134}}</span></p>


    </article>

    <article class="dcard" data-state="decide" data-id="news" data-source="meta" data-mode="sample">
      <div class="rhead">
        <span class="chip decide"><span data-sample-text="t0135">{{sample:t0135}}</span></span>
        <span class="src" aria-hidden="true"><svg class="ic"><use href="#i-meta"></use></svg></span>
        <button class="rt" type="button" aria-expanded="false"><h3><span data-sample-text="t0136">{{sample:t0136}}</span></h3><span class="rec"><span data-sample-text="t0137">{{sample:t0137}}</span></span></button>
        <div class="nums"><div><b><span data-sample-text="t0138">{{sample:t0138}}</span></b><span><span data-sample-text="t0139">{{sample:t0139}}</span></span></div><div><b><span data-sample-text="t0140">{{sample:t0140}}</span></b><span><span data-sample-text="t0141">{{sample:t0141}}</span></span></div><div><b><span data-sample-text="t0142">{{sample:t0142}}</span></b><span><span data-sample-text="t0143">{{sample:t0143}}</span></span></div></div>
        <div class="acts">
          <button class="act primary" type="button" disabled title="Pause ad set · Not built yet" aria-label="Pause ad set · Not built yet">Not built yet</button>
          <button class="act" type="button" disabled title="Leave it a day · Not built yet" aria-label="Leave it a day · Not built yet">Not built yet</button>
        </div>
      </div>
      <p class="why" hidden><span data-sample-text="t0144">{{sample:t0144}}</span></p>


    </article>

    <article class="dcard" data-state="decide" data-id="google" data-source="google-ads github-hq" data-mode="sample">
      <div class="rhead">
        <span class="chip decide"><span data-sample-text="t0145">{{sample:t0145}}</span></span>
        <span class="src" aria-hidden="true"><svg class="ic"><use href="#i-google"></use></svg></span>
        <button class="rt" type="button" aria-expanded="false"><h3><span data-sample-text="t0146">{{sample:t0146}}</span></h3><span class="rec"><span data-sample-text="t0147">{{sample:t0147}}</span></span></button>
        <div class="nums"><div><b><span data-sample-text="t0148">{{sample:t0148}}</span></b><span><span data-sample-text="t0149">{{sample:t0149}}</span></span></div><div><b><span data-sample-text="t0150">{{sample:t0150}}</span></b><span><span data-sample-text="t0151">{{sample:t0151}}</span></span></div><div><b><span data-sample-text="t0152">{{sample:t0152}}</span></b><span><span data-sample-text="t0153">{{sample:t0153}}</span></span></div></div>
        <div class="acts">
          <button class="act wa" type="button" disabled title="WhatsApp Laszlo · Not built yet" aria-label="WhatsApp Laszlo · Not built yet">Not built yet</button>
          <button class="act" type="button" disabled title="{{sample:t0010}}" aria-label="{{sample:t0011}}" data-sample-attributes="{&quot;title&quot;:&quot;t0010&quot;,&quot;aria-label&quot;:&quot;t0011&quot;}">Not built yet</button>
        </div>
      </div>
      <p class="why" hidden><span data-sample-text="t0154">{{sample:t0154}}</span></p>


    </article>

    <article class="dcard" data-state="decide" data-id="laszlo-us" data-source="meta" data-mode="sample">
      <div class="rhead">
        <span class="chip decide"><span data-sample-text="t0155">{{sample:t0155}}</span></span>
        <span class="src" aria-hidden="true"><svg class="ic"><use href="#i-meta"></use></svg></span>
        <button class="rt" type="button" aria-expanded="false"><h3><span data-sample-text="t0156">{{sample:t0156}}</span></h3><span class="rec"><span data-sample-text="t0157">{{sample:t0157}}</span></span></button>
        <div class="nums"><div><b><span data-sample-text="t0158">{{sample:t0158}}</span></b><span><span data-sample-text="t0159">{{sample:t0159}}</span></span></div><div><b><span data-sample-text="t0160">{{sample:t0160}}</span></b><span><span data-sample-text="t0161">{{sample:t0161}}</span></span></div><div><b><span data-sample-text="t0162">{{sample:t0162}}</span></b><span><span data-sample-text="t0163">{{sample:t0163}}</span></span></div></div>
        <div class="acts">
          <button class="act wa" type="button" disabled title="WhatsApp Laszlo · Not built yet" aria-label="WhatsApp Laszlo · Not built yet">Not built yet</button>
          <button class="act" type="button" disabled title="{{sample:t0012}}" aria-label="{{sample:t0013}}" data-sample-attributes="{&quot;title&quot;:&quot;t0012&quot;,&quot;aria-label&quot;:&quot;t0013&quot;}">Not built yet</button>
        </div>
      </div>
      <p class="why" hidden><span data-sample-text="t0164">{{sample:t0164}}</span></p>


    </article>

    <article class="dcard" data-state="decide" data-id="mailchimp" data-source="mailchimp" data-mode="sample">
      <div class="rhead">
        <span class="chip decide"><span data-sample-text="t0165">{{sample:t0165}}</span></span>
        <span class="src" aria-hidden="true"><svg class="ic"><use href="#i-mail"></use></svg></span>
        <button class="rt" type="button" aria-expanded="false"><h3><span data-sample-text="t0166">{{sample:t0166}}</span></h3><span class="rec"><span data-sample-text="t0167">{{sample:t0167}}</span></span></button>
        <div class="nums"><div><b><span data-sample-text="t0168">{{sample:t0168}}</span></b><span><span data-sample-text="t0169">{{sample:t0169}}</span></span></div><div><b><span data-sample-text="t0170">{{sample:t0170}}</span></b><span><span data-sample-text="t0171">{{sample:t0171}}</span></span></div><div><b><span data-sample-text="t0172">{{sample:t0172}}</span></b><span><span data-sample-text="t0173">{{sample:t0173}}</span></span></div></div>
        <div class="acts">
          <button class="act primary" type="button" disabled title="Add contact blocks · Not built yet" aria-label="Add contact blocks · Not built yet">Not built yet</button>
          <button class="act" type="button" disabled title="Move up a tier · Not built yet" aria-label="Move up a tier · Not built yet">Not built yet</button>
        </div>
      </div>
      <p class="why" hidden><span data-sample-text="t0174">{{sample:t0174}}</span></p>


    </article>

    <article class="dcard" data-state="decide" data-id="dates" data-source="shopify github-hq" data-mode="sample">
      <div class="rhead">
        <span class="chip decide"><span data-sample-text="t0175">{{sample:t0175}}</span></span>
        <span class="src" aria-hidden="true"><svg class="ic"><use href="#i-bag"></use></svg></span>
        <button class="rt" type="button" aria-expanded="false"><h3><span data-sample-text="t0176">{{sample:t0176}}</span></h3><span class="rec"><span data-sample-text="t0177">{{sample:t0177}}</span></span></button>
        <div class="nums"><div><b><span data-sample-text="t0178">{{sample:t0178}}</span></b><span><span data-sample-text="t0179">{{sample:t0179}}</span></span></div><div><b><span data-sample-text="t0180">{{sample:t0180}}</span></b><span><span data-sample-text="t0181">{{sample:t0181}}</span></span></div><div><b><span data-sample-text="t0182">{{sample:t0182}}</span></b><span><span data-sample-text="t0183">{{sample:t0183}}</span></span></div></div>
        <div class="acts">
          <button class="act primary" type="button" disabled title="Keep Automated · Not built yet" aria-label="Keep Automated · Not built yet">Not built yet</button>
          <button class="act" type="button" disabled title="Revert to Manual · Not built yet" aria-label="Revert to Manual · Not built yet">Not built yet</button>
        </div>
      </div>
      <p class="why" hidden><span data-sample-text="t0184">{{sample:t0184}}</span></p>


    </article>

  </div>
</section>

<section class="glass revs" id="reviews" aria-label="New reviews">
  <div class="rvhead">
    <span class="src" aria-hidden="true"><svg class="ic"><use href="#i-review"></use></svg></span>
    <div><h2><span data-sample-text="t0185">{{sample:t0185}}</span><span class="chip decide" id="rvcount"><span data-sample-text="t0186">{{sample:t0186}}</span></span></h2><span class="shm"><span data-sample-text="t0187">{{sample:t0187}}</span></span></div>
    <button class="act" type="button" disabled title="All in Judge.me · Not built yet" aria-label="All in Judge.me · Not built yet">Not built yet</button>
  </div>
  <div class="rvlist">
  <article class="rv" data-state="warn" data-id="rv1" data-source="judgeme" data-mode="sample">
    <div class="rvr">
      <span class="rvs"><span class="stars" data-stars="{{sample:t0014}}" data-sample-attributes="{&quot;data-stars&quot;:&quot;t0014&quot;}"></span><span class="chip warn"><span data-sample-text="t0188">{{sample:t0188}}</span></span></span>
      <button class="rt" type="button" data-sheet="{{widget:w003}}" data-model-id="w003"><h3><span data-sample-text="t0189">{{sample:t0189}}</span></h3><span class="rec"><span data-sample-text="t0190">{{sample:t0190}}</span></span></button>
      <div class="rvm"><span class="age"><span data-sample-text="t0191">{{sample:t0191}}</span></span><div class="acts"><button class="act primary" type="button" disabled title="Read in Judge.me · Not built yet" aria-label="Read in Judge.me · Not built yet">Not built yet</button></div></div>
    </div>


  </article>
  <article class="rv" data-state="decide" data-id="rv2" data-source="judgeme" data-mode="sample">
    <div class="rvr">
      <span class="rvs"><span class="stars" data-stars="{{sample:t0015}}" data-sample-attributes="{&quot;data-stars&quot;:&quot;t0015&quot;}"></span><span class="chip decide"><span data-sample-text="t0192">{{sample:t0192}}</span></span></span>
      <button class="rt" type="button" data-sheet="{{widget:w004}}" data-model-id="w004"><h3><span data-sample-text="t0193">{{sample:t0193}}</span></h3><span class="rec"><span data-sample-text="t0194">{{sample:t0194}}</span></span></button>
      <div class="rvm"><span class="age"><span data-sample-text="t0195">{{sample:t0195}}</span></span><div class="acts"><button class="act" type="button" disabled title="Open · Not built yet" aria-label="Open · Not built yet">Not built yet</button></div></div>
    </div>


  </article>
  <article class="rv" data-state="decide" data-id="rv3" data-source="judgeme" data-mode="sample">
    <div class="rvr">
      <span class="rvs"><span class="stars" data-stars="{{sample:t0016}}" data-sample-attributes="{&quot;data-stars&quot;:&quot;t0016&quot;}"></span><span class="chip decide"><span data-sample-text="t0196">{{sample:t0196}}</span></span></span>
      <button class="rt" type="button" data-sheet="{{widget:w005}}" data-model-id="w005"><h3><span data-sample-text="t0197">{{sample:t0197}}</span></h3><span class="rec"><span data-sample-text="t0198">{{sample:t0198}}</span></span></button>
      <div class="rvm"><span class="age"><span data-sample-text="t0199">{{sample:t0199}}</span></span><div class="acts"><button class="act" type="button" disabled title="Open · Not built yet" aria-label="Open · Not built yet">Not built yet</button></div></div>
    </div>


  </article>
  </div>
</section>

<section class="glass tests" id="tests">
  <div class="sh"><h2><span data-sample-text="t0200">{{sample:t0200}}</span></h2><span class="shm" id="testcount"><span data-sample-text="t0201">{{sample:t0201}}</span></span></div>
  <article class="tcard" data-state="info" data-g="growth" data-id="t1" data-kind="coin" data-test="{{widget:w006}}" data-source="shopify" data-mode="sample" data-model-id="w006">
    <div class="thead"><span class="tlane"><span data-sample-text="t0202">{{sample:t0202}}</span></span><span class="src" aria-hidden="true"><svg class="ic"><use href="#i-bag"></use></svg></span><button class="rt" type="button" data-sheet="{{widget:w007}}" data-model-id="w007"><h3><span data-sample-text="t0203">{{sample:t0203}}</span></h3><span class="rec"><span data-sample-text="t0204">{{sample:t0204}}</span></span></button><span class="chip info" data-tchip><span data-sample-text="t0205">{{sample:t0205}}</span></span></div>
    <div class="tbody"><div class="tbars" data-bars></div><div class="tsure" data-sure></div></div>
    <p class="tsay" data-say></p>
    <div class="tfoot"><span class="tprog" data-prog></span><div class="acts"><button class="act" data-call type="button" disabled title="{{sample:t0017}}" aria-label="{{sample:t0018}}" data-sample-attributes="{&quot;title&quot;:&quot;t0017&quot;,&quot;aria-label&quot;:&quot;t0018&quot;}">Not built yet</button></div></div>


  </article>
  <div class="tsub"><span data-sample-text="t0206">{{sample:t0206}}</span></div>
  <div class="trows">
      <div class="trow" data-source="github-hq" data-mode="sample"><span class="chip warn"><span data-sample-text="t0207">{{sample:t0207}}</span></span><span class="src" aria-hidden="true"><svg class="ic"><use href="#i-meta"></use></svg></span><button class="rt" type="button" data-sheet="{{widget:w008}}" data-model-id="w008"><h3><span data-sample-text="t0208">{{sample:t0208}}</span></h3><span class="rec"><span data-sample-text="t0209">{{sample:t0209}}</span></span></button><span class="d"><span data-sample-text="t0210">{{sample:t0210}}</span></span></div>
      <div class="trow" data-source="github-hq" data-mode="sample"><span class="chip decide"><span data-sample-text="t0211">{{sample:t0211}}</span></span><span class="src" aria-hidden="true"><svg class="ic"><use href="#i-bag"></use></svg></span><button class="rt" type="button" data-sheet="{{widget:w009}}" data-model-id="w009"><h3><span data-sample-text="t0212">{{sample:t0212}}</span></h3><span class="rec"><span data-sample-text="t0213">{{sample:t0213}}</span></span></button><button class="act" type="button" data-goto="dates"><span data-sample-text="t0214">{{sample:t0214}}</span></button></div>
  </div>
  <div class="tsub"><span data-sample-text="t0215">{{sample:t0215}}</span></div>
  <div class="trows">
      <div class="trow" data-source="github-hq" data-mode="sample"><span class="chip decide"><span data-sample-text="t0216">{{sample:t0216}}</span></span><span class="src" aria-hidden="true"><svg class="ic"><use href="#i-meta"></use></svg></span><button class="rt" type="button" data-sheet="{{widget:w010}}" data-model-id="w010"><h3><span data-sample-text="t0217">{{sample:t0217}}</span></h3><span class="rec"><span data-sample-text="t0218">{{sample:t0218}}</span></span></button><span class="d"><span data-sample-text="t0219">{{sample:t0219}}</span></span></div>
      <div class="trow" data-source="github-hq" data-mode="sample"><span class="chip info"><span data-sample-text="t0220">{{sample:t0220}}</span></span><span class="src" aria-hidden="true"><svg class="ic"><use href="#i-meta"></use></svg></span><button class="rt" type="button" data-sheet="{{widget:w011}}" data-model-id="w011"><h3><span data-sample-text="t0221">{{sample:t0221}}</span></h3><span class="rec"><span data-sample-text="t0222">{{sample:t0222}}</span></span></button><span class="d"><span data-sample-text="t0223">{{sample:t0223}}</span></span></div>
      <div class="trow wait" data-source="github-hq" data-mode="sample"><span class="chip info"><span data-sample-text="t0224">{{sample:t0224}}</span></span><span class="src" aria-hidden="true"><svg class="ic"><use href="#i-bag"></use></svg></span><button class="rt" type="button" data-sheet="{{widget:w012}}" data-model-id="w012"><h3><span data-sample-text="t0225">{{sample:t0225}}</span></h3><span class="rec"><span data-sample-text="t0226">{{sample:t0226}}</span></span></button><span class="d"><span data-sample-text="t0227">{{sample:t0227}}</span></span></div>
      <div class="trow wait" data-source="github-hq" data-mode="sample"><span class="chip info"><span data-sample-text="t0228">{{sample:t0228}}</span></span><span class="src" aria-hidden="true"><svg class="ic"><use href="#i-bag"></use></svg></span><button class="rt" type="button" data-sheet="{{widget:w013}}" data-model-id="w013"><h3><span data-sample-text="t0229">{{sample:t0229}}</span></h3><span class="rec"><span data-sample-text="t0230">{{sample:t0230}}</span></span></button><span class="d"><span data-sample-text="t0231">{{sample:t0231}}</span></span></div>
  </div>
  <div class="tsub"><span data-sample-text="t0232">{{sample:t0232}}</span></div>
  <div class="trows">
      <div class="trow" data-source="github-hq" data-mode="sample"><span class="chip good"><span data-sample-text="t0233">{{sample:t0233}}</span></span><span class="src" aria-hidden="true"><svg class="ic"><use href="#i-meta"></use></svg></span><button class="rt" type="button" data-sheet="{{widget:w014}}" data-model-id="w014"><h3><span data-sample-text="t0234">{{sample:t0234}}</span></h3><span class="rec"><span data-sample-text="t0235">{{sample:t0235}}</span></span></button><span class="d"><span data-sample-text="t0236">{{sample:t0236}}</span></span></div>
      <div class="trow" data-source="github-hq" data-mode="sample"><span class="chip info"><span data-sample-text="t0237">{{sample:t0237}}</span></span><span class="src" aria-hidden="true"><svg class="ic"><use href="#i-meta"></use></svg></span><button class="rt" type="button" data-sheet="{{widget:w015}}" data-model-id="w015"><h3><span data-sample-text="t0238">{{sample:t0238}}</span></h3><span class="rec"><span data-sample-text="t0239">{{sample:t0239}}</span></span></button><span class="d"><span data-sample-text="t0240">{{sample:t0240}}</span></span></div>
      <div class="trow" data-source="github-hq" data-mode="sample"><span class="chip good"><span data-sample-text="t0241">{{sample:t0241}}</span></span><span class="src" aria-hidden="true"><svg class="ic"><use href="#i-mail"></use></svg></span><button class="rt" type="button" data-sheet="{{widget:w016}}" data-model-id="w016"><h3><span data-sample-text="t0242">{{sample:t0242}}</span></h3><span class="rec"><span data-sample-text="t0243">{{sample:t0243}}</span></span></button><span class="d"><span data-sample-text="t0244">{{sample:t0244}}</span></span></div>
  </div>
</section>

<section class="glass dials" id="dials">
  <div class="sh"><h2><span data-sample-text="t0245">{{sample:t0245}}</span></h2><span class="shm" id="dialcount"><span data-sample-text="t0246">{{sample:t0246}}</span></span></div>
  <div class="tabs" id="tabs" role="tablist">
    <button class="tab" role="tab" data-tab="ads" aria-selected="true"><svg class="ic"><use href="#i-meta"></use></svg><span class="t"><span data-sample-text="t0247">{{sample:t0247}}</span></span><span class="dot info"></span></button>
    <button class="tab" role="tab" data-tab="store" aria-selected="false"><svg class="ic"><use href="#i-bag"></use></svg><span class="t"><span data-sample-text="t0248">{{sample:t0248}}</span></span><span class="dot info"></span></button>
    <button class="tab" role="tab" data-tab="growth" aria-selected="false"><svg class="ic"><use href="#i-growth"></use></svg><span class="t"><span data-sample-text="t0249">{{sample:t0249}}</span></span><span class="dot info"></span></button>
    <button class="tab" role="tab" data-tab="stock" aria-selected="false"><svg class="ic"><use href="#i-box"></use></svg><span class="t"><span data-sample-text="t0250">{{sample:t0250}}</span></span><span class="dot info"></span></button>
  </div>

  <div class="panel" id="p-ads" data-panel="ads">
    <div class="grid">
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
    <div class="tabs-foot"><span class="pn"><span data-sample-text="t0257">{{sample:t0257}}</span></span><button class="btn" id="livesets"><span data-sample-text="t0258">{{sample:t0258}}</span></button></div>
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
  <div class="feeds" id="feeds"><span class="sample-section-note"><span data-sample-text="t0292">{{sample:t0292}}</span><a href="/sources">Actual source health</a></span>
    <span><i></i><span data-sample-text="t0293">{{sample:t0293}}</span></span><span><i></i><span data-sample-text="t0294">{{sample:t0294}}</span></span><span><i></i><span data-sample-text="t0295">{{sample:t0295}}</span></span><span><i></i><span data-sample-text="t0296">{{sample:t0296}}</span></span><span><i></i><span data-sample-text="t0297">{{sample:t0297}}</span></span><span><i></i><span data-sample-text="t0298">{{sample:t0298}}</span></span><span><span data-sample-text="t0299">{{sample:t0299}}</span></span>
  </div>
  <div class="log" id="log"><strong>Sample activity</strong><ul id="loglist"><li class="mut"><span data-sample-text="t0300">{{sample:t0300}}</span><a href="/audit">Open the application audit log</a></li></ul></div>
  <p class="note"><span data-sample-text="t0301">{{sample:t0301}}</span></p>
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
      <tr data-source="meta" data-mode="sample"><td><span data-sample-text="t0311">{{sample:t0311}}</span></td><td class="n"><span data-sample-text="t0312">{{sample:t0312}}</span></td><td class="n"><span data-sample-text="t0313">{{sample:t0313}}</span></td><td><span class="chip decide"><span data-sample-text="t0314">{{sample:t0314}}</span></span></td><td><span class="flow"><button class="act primary" type="button" disabled title="Pause · Not built yet" aria-label="Pause · Not built yet">Not built yet</button></span></td></tr>
      <tr data-source="meta" data-mode="sample"><td><span data-sample-text="t0315">{{sample:t0315}}</span><span class="mut"><span data-sample-text="t0316">{{sample:t0316}}</span></span></td><td class="n"><span data-sample-text="t0317">{{sample:t0317}}</span></td><td class="n"><span data-sample-text="t0318">{{sample:t0318}}</span></td><td><span class="chip warn"><span data-sample-text="t0319">{{sample:t0319}}</span></span></td><td><span class="flow"><span class="mut"><span data-sample-text="t0320">{{sample:t0320}}</span></span></span></td></tr>
      <tr data-source="meta" data-mode="sample"><td><span data-sample-text="t0321">{{sample:t0321}}</span></td><td class="n"><span data-sample-text="t0322">{{sample:t0322}}</span></td><td class="n"><span data-sample-text="t0323">{{sample:t0323}}</span></td><td><span class="chip warn"><span data-sample-text="t0324">{{sample:t0324}}</span></span></td><td><span class="flow"><span class="mut"><span data-sample-text="t0325">{{sample:t0325}}</span></span></span></td></tr>
      <tr data-source="meta" data-mode="sample"><td><span data-sample-text="t0326">{{sample:t0326}}</span></td><td class="n"><span data-sample-text="t0327">{{sample:t0327}}</span></td><td class="n"><span data-sample-text="t0328">{{sample:t0328}}</span></td><td><span class="chip warn"><span data-sample-text="t0329">{{sample:t0329}}</span></span></td><td><span class="flow"><span class="mut"><span data-sample-text="t0330">{{sample:t0330}}</span></span></span></td></tr>
      <tr data-source="meta" data-mode="sample"><td><span data-sample-text="t0331">{{sample:t0331}}</span></td><td class="n"><span data-sample-text="t0332">{{sample:t0332}}</span></td><td class="n"><span data-sample-text="t0333">{{sample:t0333}}</span></td><td><span class="chip good"><span data-sample-text="t0334">{{sample:t0334}}</span></span></td><td></td></tr>
      <tr data-source="meta" data-mode="sample"><td><span data-sample-text="t0335">{{sample:t0335}}</span></td><td class="n"><span data-sample-text="t0336">{{sample:t0336}}</span></td><td class="n"><span data-sample-text="t0337">{{sample:t0337}}</span></td><td><span class="chip warn"><span data-sample-text="t0338">{{sample:t0338}}</span></span></td><td><span class="flow"><span class="mut"><span data-sample-text="t0339">{{sample:t0339}}</span></span></span></td></tr>
      <tr data-source="meta" data-mode="sample"><td><span data-sample-text="t0340">{{sample:t0340}}</span><span class="mut"><span data-sample-text="t0341">{{sample:t0341}}</span></span></td><td class="n"><span data-sample-text="t0342">{{sample:t0342}}</span></td><td class="n"><span data-sample-text="t0343">{{sample:t0343}}</span></td><td><span class="chip good"><span data-sample-text="t0344">{{sample:t0344}}</span></span></td><td></td></tr>
      <tr data-source="meta" data-mode="sample"><td><span data-sample-text="t0345">{{sample:t0345}}</span><span class="mut"><span data-sample-text="t0346">{{sample:t0346}}</span></span></td><td class="n"><span data-sample-text="t0347">{{sample:t0347}}</span></td><td class="n"><span data-sample-text="t0348">{{sample:t0348}}</span></td><td><span class="chip good"><span data-sample-text="t0349">{{sample:t0349}}</span></span></td><td><span class="flow"><button class="act" type="button" disabled title="{{sample:t0019}}" aria-label="{{sample:t0020}}" data-sample-attributes="{&quot;title&quot;:&quot;t0019&quot;,&quot;aria-label&quot;:&quot;t0020&quot;}">Not built yet</button></span></td></tr>
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
