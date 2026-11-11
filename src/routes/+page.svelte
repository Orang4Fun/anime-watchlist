<script>
  import { onMount } from 'svelte';
  import Swal from 'sweetalert2';

  // Svelte 5 state
  let animeList = $state([]);
  let searchTerm = $state('');
  let showWatched = $state(true);
  let showNotWatched = $state(true);
  let currentAnime = $state(null);

  // Load from server database on start
  onMount(async () => {
    try {
      const res = await fetch('/api/anime');
      if (res.ok) {
        animeList = await res.json();
      }
    } catch (err) {
      console.error('Failed to load anime:', err);
    }
  });

  // Persist changes to server database
  async function save() {
    try {
      await fetch('/api/anime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(animeList)
      });
    } catch (err) {
      console.error('Failed to save anime:', err);
    }
  }

  // Filter logic (Svelte 5 $derived)
  let filteredAnime = $derived(animeList.filter(anime => {
    const matchesSearch = anime.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesWatched = (showWatched && anime.wasWatched) || (showNotWatched && !anime.wasWatched);
    return matchesSearch && matchesWatched;
  }));

  // SweetAlert2 in cyberpunk look (styles live in style.css)
  const Alert = Swal.mixin({
    buttonsStyling: false,
    reverseButtons: true,
    confirmButtonText: 'OK',
    cancelButtonText: 'Cancel',
    customClass: {
      popup: 'cyber-popup',
      title: 'cyber-title',
      input: 'cyber-input',
      inputLabel: 'cyber-label',
      confirmButton: 'cyber-confirm',
      cancelButton: 'cyber-cancel',
      image: 'cyber-swal-img'
    }
  });

  // ---------- AniList (official public GraphQL API, no key needed) ----------
  const ANILIST_QUERY = `
    query ($search: String) {
      Page(perPage: 12) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          id
          seasonYear
          format
          title { romaji english }
          coverImage { large extraLarge }
          description(asHtml: false)
        }
      }
    }`;

  async function searchAniList(term) {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: ANILIST_QUERY, variables: { search: term } })
    });
    if (!res.ok) throw new Error('AniList request failed');
    const json = await res.json();
    return (json.data?.Page?.media ?? []).filter((m) => m.coverImage?.extraLarge || m.coverImage?.large);
  }

  const escapeHtml = (str) =>
    String(str ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const cleanDescription = (html) =>
    (html ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  // Lets the user pick a cover from AniList or enter an image URL manually.
  // Returns { image, description } or null if the user cancelled.
  async function chooseCover(term) {
    let results = [];
    let failed = false;

    Alert.fire({
      title: 'Searching AniList…',
      allowOutsideClick: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading()
    });
    try {
      results = await searchAniList(term);
    } catch {
      failed = true;
    }

    if (results.length > 0) {
      let pickedIndex = null;
      const cards = results
        .map((m, i) => {
          const title = m.title.english || m.title.romaji;
          const meta = [m.seasonYear, m.format?.replace('_', ' ')].filter(Boolean).join(' · ');
          return `
            <button type="button" class="cover-option" data-index="${i}" title="${escapeHtml(title)}">
              <img src="${escapeHtml(m.coverImage.large || m.coverImage.extraLarge)}" alt="${escapeHtml(title)}" loading="lazy" />
              <span class="cover-title">${escapeHtml(title)}</span>
              <span class="cover-meta">${escapeHtml(meta)}</span>
            </button>`;
        })
        .join('');

      const result = await Alert.fire({
        title: 'Choose a cover',
        html: `<div class="cover-grid">${cards}</div><p class="cover-source">Data from AniList</p>`,
        width: 'min(760px, 94vw)',
        showConfirmButton: false,
        showDenyButton: true,
        denyButtonText: 'Enter image URL',
        showCancelButton: true,
        customClass: { popup: 'cyber-popup', title: 'cyber-title', denyButton: 'cyber-cancel', cancelButton: 'cyber-cancel' },
        didOpen: (popup) => {
          popup.querySelectorAll('.cover-option').forEach((el) => {
            el.addEventListener('click', () => {
              pickedIndex = Number(el.dataset.index);
              Swal.close();
            });
          });
        }
      });

      if (pickedIndex !== null) {
        const m = results[pickedIndex];
        return {
          image: m.coverImage.extraLarge || m.coverImage.large,
          description: cleanDescription(m.description)
        };
      }
      if (!result.isDenied) return null; // cancelled
    } else {
      await Alert.fire({
        icon: failed ? 'error' : 'info',
        title: failed ? 'AniList is not reachable' : 'No results on AniList',
        text: 'You can enter an image URL manually instead.'
      });
    }

    // Manual fallback
    const { value: imageUrl } = await Alert.fire({
      title: 'Enter image URL',
      input: 'url',
      inputLabel: 'URL of the cover image',
      inputPlaceholder: 'https://...',
      showCancelButton: true
    });
    if (!imageUrl) return null;
    return { image: imageUrl, description: '' };
  }

  // Add a new anime
  async function showAlert() {
    const { value: animeName } = await Alert.fire({
      title: 'Add anime',
      input: 'text',
      inputLabel: 'Anime name',
      inputPlaceholder: 'e.g. Naruto',
      showCancelButton: true
    });
    if (!animeName) return;

    const cover = await chooseCover(animeName);
    if (!cover) return;

    const { value: description } = await Alert.fire({
      title: 'Enter a description',
      input: 'textarea',
      inputValue: cover.description.slice(0, 700),
      inputPlaceholder: 'What is this anime about?',
      showCancelButton: true
    });

    const newAnime = {
      name: animeName,
      image: cover.image,
      description: description || "",
      wasWatched: false,
      id: Date.now()
    };

    animeList = [...animeList, newAnime];
    save();

    Alert.fire({
      title: 'Added!',
      imageUrl: cover.image,
      imageHeight: 300
    });
  }

  // Change the cover of the currently opened anime
  async function changeCover() {
    const cover = await chooseCover(currentAnime.name);
    if (!cover) return;
    currentAnime.image = cover.image;
    animeList = animeList.map((a) => (a.id === currentAnime.id ? currentAnime : a));
    save();
  }

  function openDetail(anime) {
    currentAnime = anime;
  }

  function goBack() {
    currentAnime = null;
    save();
  }

  function deleteAnime() {
    animeList = animeList.filter(a => a.id !== currentAnime.id);
    currentAnime = null;
    save();
  }

  function toggleWatched(e) {
    currentAnime.wasWatched = e.target.checked;
    animeList = animeList.map(a => a.id === currentAnime.id ? currentAnime : a);
    save();
  }

  // ===== CITY START =====================================================
  // The city is generated procedurally but deterministically (fixed seeds):
  // server and browser therefore render exactly the same SVG.
  const W = 1600;
  const H = 900;

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const f = (n) => Math.round(n * 10) / 10;
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

  // cyan, pink, amber, violet, cold white
  const NEON = ['#00f0ff', '#ff2a85', '#ffb84d', '#b58cff', '#eaf4ff'];
  const WIN_WEIGHTS = [0.32, 0.22, 0.24, 0.14, 0.08];
  const H_SIGNS = ['ネオン', '電脳', 'ラーメン', 'NEON', 'RAMEN', '酒', 'ANIME', 'サイバー', '未来', 'BAR', 'ホテル', 'CYBER', 'カラオケ', '24H'];
  const BOARD_SIGNS = ['ネオン・シティ', 'NEO CITY', '電脳ラーメン', 'SUSHI 24H', 'アニメ祭', 'CYBER BAR'];
  const V_SIGNS = ['ラーメン', '電脳街', 'カラオケ', 'ホテル', 'アニメ', '酒場', 'ネオン', '薬局'];

  function weighted(r) {
    const t = r();
    let s = 0;
    for (let i = 0; i < WIN_WEIGHTS.length; i++) {
      s += WIN_WEIGHTS[i];
      if (t < s) return i;
    }
    return 0;
  }

  function buildLayer(o) {
    const r = rng(o.seed);
    const out = [];
    let x = o.from;

    while (x < o.to) {
      const tall = r() < o.tallChance;
      const w = o.minW + r() * (o.maxW - o.minW);
      const h = tall ? o.tallMin + r() * (o.tallMax - o.tallMin) : o.minH + r() * (o.maxH - o.minH);
      const y = H - h;
      const kind = tall ? r() * 0.26 : r();

      // Roof shape (slanted roofs)
      let yl = y;
      let yr = y;
      if (kind > 0.74) {
        const s = 12 + r() * 24;
        if (r() < 0.5) yl += s; else yr += s;
      }
      const roofTop = Math.min(yl, yr);

      const b = { x: f(x), y: f(y), w: f(w), h: f(h) };
      b.d = `M${f(x)} ${H}V${f(yl)}L${f(x + w)} ${f(yr)}V${H}Z`;
      b.top = `M${f(x)} ${f(yl)}L${f(x + w)} ${f(yr)}`;
      b.rim = NEON[[0, 1, 3][Math.floor(r() * 3)]];
      b.antenna = null;
      b.cap = null;
      b.dish = null;
      b.light = null;
      b.bits = [];
      b.neon = null;
      b.sign = null;
      b.vsign = null;
      b.board = null;

      // Rooftop structures
      if (kind < 0.26) {
        const ax = x + w * (0.25 + r() * 0.5);
        const ah = 22 + r() * (tall ? 70 : 40);
        b.antenna = { x: f(ax), y1: f(roofTop - ah), y2: f(roofTop + 1) };
        b.light = { x: f(ax), y: f(roofTop - ah), delay: f(r() * 2) };
      } else if (kind < 0.44) {
        const cw = w * (0.4 + r() * 0.25);
        const ch = 8 + r() * 14;
        b.cap = { x: f(x + (w - cw) / 2), y: f(roofTop - ch), w: f(cw), h: f(ch) };
      } else if (kind < 0.56) {
        b.dish = { x: f(x + w * (0.2 + r() * 0.5)), y: f(roofTop) };
      }
      const nb = Math.floor(r() * 3);
      for (let i = 0; i < nb; i++) {
        const bw = 6 + r() * 12;
        const bh = 4 + r() * 7;
        const bx = x + 3 + r() * Math.max(1, w - bw - 6);
        const ry = yl + (yr - yl) * ((bx - x) / w);
        b.bits.push({ x: f(bx), y: f(ry - bh + 0.6), w: f(bw), h: f(bh) });
      }

      // Windows: one single path per colour (keeps the DOM small)
      const wa = o.win;
      const pad = 5;
      const top = Math.max(yl, yr) + 14;
      const cols = Math.max(1, Math.floor((w - pad * 2 + (wa.gx - wa.w)) / wa.gx));
      const rows = Math.max(1, Math.floor((H - top - 16) / wa.gy));
      const offX = pad + (w - pad * 2 - (cols * wa.gx - (wa.gx - wa.w))) / 2;
      const paths = NEON.map(() => '');
      let dim = '';
      const blink = [];

      for (let rr = 0; rr < rows; rr++) {
        const rowLit = (r() < 0.55 ? 0.9 : 0.25) * o.lit * 1.4;
        const rowColor = weighted(r);
        for (let c = 0; c < cols; c++) {
          const cx = f(x + offX + c * wa.gx);
          const cy = f(top + rr * wa.gy);
          const d = `M${cx} ${cy}h${wa.w}v${wa.h}h-${wa.w}z`;
          if (r() < rowLit) {
            const ci = r() < 0.7 ? rowColor : weighted(r);
            paths[ci] += d;
            if (blink.length < o.blinks && r() < 0.012) {
              blink.push({ x: cx, y: cy, w: wa.w, h: wa.h, c: NEON[ci], delay: f(r() * 6), dur: f(3 + r() * 5) });
            }
          } else if (r() < 0.5) {
            dim += d;
          }
        }
      }
      b.win = paths.map((d, i) => ({ c: i, d })).filter((p) => p.d);
      b.dim = dim;
      b.blink = blink;

      // Neon strips on the facade
      if (r() < o.neonChance) {
        const nx = r() < 0.5 ? x + 2.5 : x + w - 2.5;
        const y1 = Math.max(yl, yr) + 8;
        b.neon = { x: f(nx), y1: f(y1), y2: f(y1 + (H - y1) * (0.35 + r() * 0.5)), c: NEON[[0, 1, 3, 2][Math.floor(r() * 4)]] };
      }

      // Horizontal sign
      if (r() < o.signChance && w > 60) {
        const txt = pick(r, H_SIGNS);
        const len = [...txt].length;
        const sw = Math.min(w - 12, 22 + len * 13.5);
        const sy = y + 30 + r() * Math.max(10, h * 0.35);
        b.sign = {
          x: f(x + (w - sw) / 2), y: f(sy), w: f(sw), h: 22,
          tx: f(x + w / 2), ty: f(sy + 15.5), txt,
          c: NEON[[0, 1, 2, 3][Math.floor(r() * 4)]],
          delay: f(r() * 6), dur: f(4 + r() * 6)
        };
      }

      // Hanging vertical sign
      if (r() < o.vChance && w > 50) {
        const chars = [...pick(r, V_SIGNS)];
        const vx = r() < 0.5 ? x + w - 4 : x - 12;
        const vy = y + 24 + r() * Math.max(10, h * 0.3);
        b.vsign = {
          x: f(vx), y: f(vy), w: 16, h: f(10 + chars.length * 13),
          tx: f(vx + 8), ty: f(vy + 14), chars,
          c: NEON[[0, 1, 2, 3][Math.floor(r() * 4)]],
          delay: f(r() * 6), dur: f(4 + r() * 6)
        };
      }

      // Large billboard on the roof
      if (r() < o.boardChance && w > 95 && !b.antenna && !b.cap) {
        const txt = pick(r, BOARD_SIGNS);
        const bw = w * 0.82;
        const bh = 34 + r() * 12;
        b.board = {
          x: f(x + (w - bw) / 2), y: f(roofTop - bh - 16), w: f(bw), h: f(bh),
          base: f(roofTop + 1), txt,
          fs: f(Math.min(20, (bw - 14) / [...txt].length)),
          c: NEON[[0, 1, 3][Math.floor(r() * 3)]],
          delay: f(r() * 6), dur: f(5 + r() * 5)
        };
      }

      out.push(b);
      x += w + (o.gapMax ? r() * o.gapMax - 3 : -2);
    }
    return out;
  }

  const farBuildings = buildLayer({
    seed: 11, from: -30, to: 1640, minW: 38, maxW: 84, minH: 170, maxH: 380,
    tallChance: 0.1, tallMin: 400, tallMax: 520, gapMax: 0,
    win: { w: 3, h: 4.5, gx: 9, gy: 12 }, lit: 0.5, blinks: 0,
    neonChance: 0.1, signChance: 0, vChance: 0, boardChance: 0
  });
  const midBuildings = buildLayer({
    seed: 29, from: -40, to: 1650, minW: 54, maxW: 118, minH: 230, maxH: 430,
    tallChance: 0.14, tallMin: 470, tallMax: 640, gapMax: 0,
    win: { w: 3.4, h: 5, gx: 8.5, gy: 12 }, lit: 0.55, blinks: 4,
    neonChance: 0.3, signChance: 0.18, vChance: 0.16, boardChance: 0
  });
  const nearBuildings = buildLayer({
    seed: 47, from: -60, to: 1660, minW: 70, maxW: 150, minH: 130, maxH: 320,
    tallChance: 0.12, tallMin: 350, tallMax: 440, gapMax: 10,
    win: { w: 4, h: 5.5, gx: 10, gy: 13.5 }, lit: 0.6, blinks: 5,
    neonChance: 0.45, signChance: 0.35, vChance: 0.3, boardChance: 0.3
  });

  // Stars
  const stars = (() => {
    const r = rng(5);
    return Array.from({ length: 140 }, () => ({
      x: f(r() * W), y: f(r() * 430), r: f(0.5 + r() * 1.1),
      o: f(0.3 + r() * 0.7), tw: r() < 0.15, d: f(r() * 5)
    }));
  })();

  // Flying cars
  const CAR = { cyan: '#00f0ff', pink: '#ff2a85', amber: '#ffb84d', violet: '#b58cff', white: '#eaf4ff' };
  const CAR_KEYS = ['cyan', 'pink', 'cyan', 'amber', 'violet', 'pink', 'white'];

  function makeCars(seed, n, o) {
    const r = rng(seed);
    return Array.from({ length: n }, (_, i) => {
      const dur = o.dMin + r() * (o.dMax - o.dMin);
      return {
        k: pick(r, CAR_KEYS),
        y: f(o.yMin + (o.yMax - o.yMin) * ((i + r() * 0.7) / n)),
        s: f(o.sMin + r() * (o.sMax - o.sMin)),
        dur: f(dur),
        delay: -f(r() * dur),
        rev: i % 2 === 1,
        o: o.op,
        x0: Math.round(r() * 1500),
        bob: f(2 + r() * 2),
        amp: f(1.5 + r() * 1.5)
      };
    });
  }

  const carsFar = makeCars(71, 6, { yMin: 150, yMax: 440, sMin: 0.3, sMax: 0.45, dMin: 42, dMax: 70, op: 0.8 });
  const carsMid = makeCars(83, 6, { yMin: 210, yMax: 560, sMin: 0.55, sMax: 0.8, dMin: 24, dMax: 38, op: 0.95 });
  const carsNear = makeCars(97, 4, { yMin: 330, yMax: 700, sMin: 1.0, sMax: 1.45, dMin: 9, dMax: 15, op: 1 });

  // Monorail pylons
  const pylons = Array.from({ length: 11 }, (_, i) => 30 + i * 170);
  // ===== CITY END =======================================================
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=Noto+Sans+JP:wght@700&display=swap"
  />
  <link rel="stylesheet" href="/style.css" />
</svelte:head>

<!-- ============ CYBERPUNK BACKGROUND: skyline, neon signs, flying cars ============ -->
<div class="cyberpunk-bg" aria-hidden="true">
  <svg class="city" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">

    <!-- ---------- Reusable building blocks ---------- -->
    {#snippet car(c)}
      {@const col = CAR[c.k]}
      <g transform="translate(0 {c.y})" opacity={c.o}>
        <!-- gentle hovering -->
        <animateTransform attributeName="transform" type="translate" additive="sum"
          values="0 0;0 {-c.amp};0 0;0 {c.amp * 0.6};0 0" dur="{c.bob}s" begin="{c.delay}s" repeatCount="indefinite" />
        <g>
          <!-- flight across the screen (SMIL, independent of CSS) -->
          <animateTransform attributeName="transform" type="translate"
            from={c.rev ? '1920 0' : '-320 0'} to={c.rev ? '-320 0' : '1920 0'}
            dur="{c.dur}s" begin="{c.delay}s" repeatCount="indefinite" />
          <g transform="scale({c.rev ? -c.s : c.s} {c.s})">
            <!-- light trail, underglow, headlight beam -->
            <rect x="-120" y="8.6" width="122" height="7" rx="3.5" fill="url(#trail-{c.k})" opacity=".35" />
            <rect x="-96" y="11.2" width="98" height="1.8" rx=".9" fill="url(#trail-{c.k})" />
            <ellipse cx="32" cy="19.5" rx="38" ry="6" fill="url(#glow-{c.k})" opacity=".8" />
            <path d="M63 11.3L132 0V27L63 14.7Z" fill="url(#beam-{c.k})" opacity=".5">
              <animateTransform attributeName="transform" type="rotate"
                values="-3.5 63 13;3.5 63 13;-3.5 63 13" dur="{c.bob * 1.3}s" begin="{c.delay}s" repeatCount="indefinite" />
              <animate attributeName="opacity" values=".35;.7;.35" dur="{c.bob * 0.8}s" begin="{c.delay}s" repeatCount="indefinite" />
            </path>
            <!-- tail fin -->
            <path d="M3 10.5L-3 3.5L8 8.6Z" fill="#150c2c" stroke={col} stroke-width=".5" stroke-opacity=".7" />
            <!-- thrusters -->
            <rect x="8" y="16" width="14" height="3.4" rx="1.7" fill="#0b0618" stroke={col} stroke-width=".6" />
            <rect x="42" y="16" width="14" height="3.4" rx="1.7" fill="#0b0618" stroke={col} stroke-width=".6" />
            <rect x="9.5" y="19" width="11" height="1.2" rx=".6" fill={col} opacity=".9" />
            <rect x="43.5" y="19" width="11" height="1.2" rx=".6" fill={col} opacity=".9" />
            <!-- body + canopy -->
            <path
              d="M1 13.5C1 10.5 5 9 11 8.2L23 7L30 2.6C34 .4 41 .4 45 2.8L50 7.5L58 9.4C62 10.2 64 11.6 64 13.5C64 16 62 17 58 17L7 17C3 17 1 16 1 13.5Z"
              fill="url(#carBody)" stroke={col} stroke-width=".6" stroke-opacity=".75"
            />
            <path d="M27 7L31.2 3.6C35 2.2 40 2.2 43.6 3.9L47.5 7.4Z" fill="url(#glass)" />
            <path d="M31 6.6L34 3.6" stroke="#fff" stroke-opacity=".55" stroke-width=".7" />
            <!-- neon stripe -->
            <path d="M3 12.6H60" stroke={col} stroke-width="2.6" stroke-opacity=".25" />
            <path d="M3 12.6H60" stroke={col} stroke-width=".9" />
            <!-- head- and tail light -->
            <circle cx="63" cy="12" r="4" fill="#fff" opacity=".25" />
            <rect x="60.6" y="11.2" width="3.6" height="1.8" rx=".9" fill="#fff" />
            <circle cx="1" cy="12.7" r="4.5" fill="url(#glow-pink)" opacity=".8" />
            <rect x="0" y="11.6" width="2.4" height="2.2" rx=".6" fill="#ff3355" />
          </g>
        </g>
      </g>
    {/snippet}

    {#snippet buildings(list, layer, wop)}
      {#each list as b}
        <path d={b.d} fill="url(#face-{layer})" />
        {#if b.cap}
          <rect x={b.cap.x} y={b.cap.y} width={b.cap.w} height={b.cap.h + 1} fill="url(#face-{layer})" />
        {/if}
        {#each b.bits as bit}
          <rect x={bit.x} y={bit.y} width={bit.w} height={bit.h} fill="#05020c" opacity=".85" />
        {/each}
        {#if b.antenna}
          <line x1={b.antenna.x} y1={b.antenna.y1} x2={b.antenna.x} y2={b.antenna.y2} stroke="#2a2050" stroke-width="1.4" />
          <line x1={b.antenna.x - 4} y1={b.antenna.y1 + 8} x2={b.antenna.x + 4} y2={b.antenna.y1 + 8} stroke="#2a2050" stroke-width="1" />
          <line x1={b.antenna.x - 6} y1={b.antenna.y1 + 15} x2={b.antenna.x + 6} y2={b.antenna.y1 + 15} stroke="#2a2050" stroke-width="1" />
        {/if}
        {#if b.dish}
          <path d="M{b.dish.x} {b.dish.y}q6 -13 14 -3z" fill="#1a1236" stroke="#3b2d6e" stroke-width=".6" />
        {/if}

        <!-- rim light top + right -->
        <path d={b.top} stroke={b.rim} stroke-opacity=".35" stroke-width="1" fill="none" />
        <rect x={b.x + b.w - 1.4} y={b.y} width="1.4" height={b.h} fill={b.rim} opacity=".35" />

        <!-- Windows -->
        <path d={b.dim} fill="#8f86ee" opacity=".09" />
        {#each b.win as p}
          <path d={p.d} fill={NEON[p.c]} opacity={wop} />
        {/each}
        {#each b.blink as w}
          <rect class="win-blink" x={w.x} y={w.y} width={w.w} height={w.h} fill={w.c} style="animation-delay:{w.delay}s;animation-duration:{w.dur}s" />
        {/each}

        <!-- Neon strip -->
        {#if b.neon}
          <line x1={b.neon.x} y1={b.neon.y1} x2={b.neon.x} y2={b.neon.y2} stroke={b.neon.c} stroke-width="8" stroke-opacity=".08" stroke-linecap="round" />
          <line x1={b.neon.x} y1={b.neon.y1} x2={b.neon.x} y2={b.neon.y2} stroke={b.neon.c} stroke-width="4" stroke-opacity=".2" stroke-linecap="round" />
          <line x1={b.neon.x} y1={b.neon.y1} x2={b.neon.x} y2={b.neon.y2} stroke={b.neon.c} stroke-width="1.4" stroke-linecap="round" />
        {/if}

        <!-- Horizontal sign -->
        {#if b.sign}
          {@const s = b.sign}
          <rect x={s.x} y={s.y} width={s.w} height={s.h} rx="2" fill="#06030e" stroke={s.c} stroke-width="1" />
          <rect x={s.x} y={s.y} width={s.w} height={s.h} rx="2" fill="none" stroke={s.c} stroke-opacity=".25" stroke-width="4" />
          <text class="sign-text flick" x={s.tx} y={s.ty} text-anchor="middle" font-size="13" fill={s.c} style="animation-delay:{s.delay}s;animation-duration:{s.dur}s">{s.txt}</text>
        {/if}

        <!-- Hanging vertical sign -->
        {#if b.vsign}
          {@const v = b.vsign}
          <rect x={v.x} y={v.y} width={v.w} height={v.h} rx="2" fill="#06030e" stroke={v.c} stroke-width="1" />
          <rect x={v.x} y={v.y} width={v.w} height={v.h} rx="2" fill="none" stroke={v.c} stroke-opacity=".25" stroke-width="4" />
          {#each v.chars as ch, i}
            <text class="sign-text flick" x={v.tx} y={v.ty + i * 13} text-anchor="middle" font-size="11" fill={v.c} style="animation-delay:{v.delay}s;animation-duration:{v.dur}s">{ch}</text>
          {/each}
        {/if}

        <!-- Billboard on the roof -->
        {#if b.board}
          {@const bd = b.board}
          <line x1={bd.x + 10} y1={bd.y + bd.h} x2={bd.x + 10} y2={bd.base} stroke="#1a1236" stroke-width="2" />
          <line x1={bd.x + bd.w - 10} y1={bd.y + bd.h} x2={bd.x + bd.w - 10} y2={bd.base} stroke="#1a1236" stroke-width="2" />
          <rect x={bd.x} y={bd.y} width={bd.w} height={bd.h} rx="2" fill="#07030f" stroke={bd.c} stroke-width="1.2" />
          <rect x={bd.x} y={bd.y} width={bd.w} height={bd.h} rx="2" fill="none" stroke={bd.c} stroke-opacity=".22" stroke-width="6" />
          <rect x={bd.x + 4} y={bd.y + 4} width={bd.w - 8} height={bd.h - 8} fill={bd.c} fill-opacity=".08" />
          <text class="sign-text flick" x={bd.x + bd.w / 2} y={bd.y + bd.h / 2 + bd.fs * 0.35} text-anchor="middle" font-size={bd.fs} fill={bd.c} style="animation-delay:{bd.delay}s;animation-duration:{bd.dur}s">{bd.txt}</text>
        {/if}

        <!-- Warning light -->
        {#if b.light}
          <circle cx={b.light.x} cy={b.light.y} r="7" fill="url(#glow-pink)" class="beacon" style="animation-delay:{b.light.delay}s" />
          <circle cx={b.light.x} cy={b.light.y} r="1.8" fill="#ff3355" class="beacon" style="animation-delay:{b.light.delay}s" />
        {/if}
      {/each}
    {/snippet}

    <!-- ---------- Gradients & masks ---------- -->
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#01000a" />
        <stop offset=".3" stop-color="#080519" />
        <stop offset=".55" stop-color="#1a0838" />
        <stop offset=".72" stop-color="#3b0e57" />
        <stop offset=".86" stop-color="#7a1465" />
        <stop offset="1" stop-color="#2a0a40" />
      </linearGradient>
      <radialGradient id="moonGlow">
        <stop offset="0" stop-color="#ff5fa8" stop-opacity=".45" />
        <stop offset="1" stop-color="#ff2a85" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="moonFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff0fa" />
        <stop offset=".5" stop-color="#ff8ac8" />
        <stop offset="1" stop-color="#ff2a85" />
      </linearGradient>
      <mask id="moonMask" maskUnits="userSpaceOnUse" x="1100" y="100" width="300" height="230">
        <rect x="1100" y="100" width="300" height="230" fill="#fff" />
        <rect x="1100" y="250" width="300" height="2" fill="#000" />
        <rect x="1100" y="262" width="300" height="3" fill="#000" />
        <rect x="1100" y="274" width="300" height="4" fill="#000" />
        <rect x="1100" y="287" width="300" height="5" fill="#000" />
        <rect x="1100" y="301" width="300" height="6" fill="#000" />
      </mask>
      <radialGradient id="cloud">
        <stop offset="0" stop-color="#7a3cff" stop-opacity=".28" />
        <stop offset="1" stop-color="#7a3cff" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="face-far" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#241552" />
        <stop offset="1" stop-color="#12082c" />
      </linearGradient>
      <linearGradient id="face-mid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#170c38" />
        <stop offset="1" stop-color="#0a0520" />
      </linearGradient>
      <linearGradient id="face-near" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0d0620" />
        <stop offset="1" stop-color="#04020b" />
      </linearGradient>
      <linearGradient id="beamSky" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#bfe9ff" stop-opacity=".35" />
        <stop offset="1" stop-color="#bfe9ff" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="fogGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#9b4dff" stop-opacity="0" />
        <stop offset=".5" stop-color="#9b4dff" stop-opacity=".22" />
        <stop offset="1" stop-color="#9b4dff" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="groundGlow" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ff2a85" stop-opacity="0" />
        <stop offset=".65" stop-color="#ff2a85" stop-opacity=".22" />
        <stop offset="1" stop-color="#00f0ff" stop-opacity=".3" />
      </linearGradient>
      <linearGradient id="holoBeam" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#00f0ff" stop-opacity=".3" />
        <stop offset="1" stop-color="#00f0ff" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="carBody" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#3a2d66" />
        <stop offset="1" stop-color="#130b26" />
      </linearGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#8ff0ff" />
        <stop offset="1" stop-color="#1a2a5a" />
      </linearGradient>
      {#each Object.entries(CAR) as [k, col]}
        <linearGradient id="trail-{k}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color={col} stop-opacity="0" />
          <stop offset="1" stop-color={col} stop-opacity=".95" />
        </linearGradient>
        <radialGradient id="glow-{k}">
          <stop offset="0" stop-color={col} stop-opacity=".7" />
          <stop offset="1" stop-color={col} stop-opacity="0" />
        </radialGradient>
        <linearGradient id="beam-{k}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color={col} stop-opacity=".55" />
          <stop offset="1" stop-color={col} stop-opacity="0" />
        </linearGradient>
      {/each}
    </defs>

    <!-- ---------- Sky ---------- -->
    <rect x="0" y="0" width={W} height={H} fill="url(#sky)" />

    {#each stars as s}
      <circle class:twinkle={s.tw} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={s.o} style={s.tw ? `animation-delay:${s.d}s` : ''} />
    {/each}

    <circle cx="1240" cy="215" r="260" fill="url(#moonGlow)" />
    <circle cx="1240" cy="215" r="98" fill="url(#moonFill)" mask="url(#moonMask)" />

    <g class="clouds">
      <ellipse cx="420" cy="330" rx="320" ry="38" fill="url(#cloud)" />
      <ellipse cx="1050" cy="400" rx="380" ry="44" fill="url(#cloud)" />
      <ellipse cx="760" cy="250" rx="260" ry="26" fill="url(#cloud)" opacity=".7" />
    </g>

    <!-- Hologram globe -->
    <g transform="translate(310 235)">
      <g class="bob">
        <polygon points="-12,42 12,42 80,270 -80,270" fill="url(#holoBeam)" />
        <circle r="40" fill="#00f0ff" fill-opacity=".05" />
        <circle r="40" fill="none" stroke="#00f0ff" stroke-opacity=".55" />
        <ellipse rx="40" ry="11" fill="none" stroke="#00f0ff" stroke-opacity=".5" />
        <ellipse cy="-20" rx="34.6" ry="9" fill="none" stroke="#00f0ff" stroke-opacity=".35" />
        <ellipse cy="20" rx="34.6" ry="9" fill="none" stroke="#00f0ff" stroke-opacity=".35" />
        <ellipse class="holo-ring" rx="40" ry="40" fill="none" stroke="#00f0ff" stroke-opacity=".55" style="animation-delay:0s" />
        <ellipse class="holo-ring" rx="40" ry="40" fill="none" stroke="#00f0ff" stroke-opacity=".4" style="animation-delay:-2s" />
        <ellipse class="holo-ring" rx="40" ry="40" fill="none" stroke="#00f0ff" stroke-opacity=".3" style="animation-delay:-4s" />
      </g>
    </g>

    <!-- Advertising blimp -->
    <g transform="translate(0 135)">
      <g class="blimp">
        <path d="M-64 0L-88 -17L-78 0L-88 17Z" fill="#150c2c" stroke="#b58cff" stroke-opacity=".5" stroke-width=".8" />
        <ellipse cx="0" cy="0" rx="66" ry="22" fill="#150c2c" stroke="#b58cff" stroke-opacity=".5" stroke-width=".8" />
        <rect x="-18" y="20" width="36" height="8" rx="3" fill="#0d0820" stroke="#b58cff" stroke-opacity=".4" stroke-width=".8" />
        <rect x="-40" y="-9" width="80" height="18" rx="2" fill="#2a0a2f" stroke="#ff2a85" stroke-width=".8" />
        <text class="sign-text flick" x="0" y="4" text-anchor="middle" font-size="11" fill="#ff5fa8">ネオ・シティ</text>
        <circle class="beacon" cx="60" cy="-6" r="1.8" fill="#ff3355" />
      </g>
    </g>

    <!-- Searchlights: four beams, each with its own speed, sweep path and pulse -->
    <g transform="translate(250 640)">
      <g class="sweep s1">
        <polygon class="pulse" points="0,0 -22,-600 22,-600" fill="url(#beamSky)" />
        <circle r="14" fill="#bfe9ff" opacity=".35" />
      </g>
    </g>
    <g transform="translate(640 650)">
      <g class="sweep s2">
        <polygon class="pulse p2" points="0,0 -30,-620 30,-620" fill="url(#beamSky)" />
        <circle r="16" fill="#bfe9ff" opacity=".3" />
      </g>
    </g>
    <g transform="translate(1010 645)">
      <g class="sweep s3">
        <polygon class="pulse p3" points="0,0 -18,-600 18,-600" fill="url(#beamSky)" />
        <circle r="12" fill="#bfe9ff" opacity=".35" />
      </g>
    </g>
    <g transform="translate(1390 640)">
      <g class="sweep s4">
        <polygon class="pulse p4" points="0,0 -26,-610 26,-610" fill="url(#beamSky)" />
        <circle r="14" fill="#bfe9ff" opacity=".3" />
      </g>
    </g>

    <!-- ---------- Far skyline ---------- -->
    {@render buildings(farBuildings, 'far', 0.55)}
    {#each carsFar as c}{@render car(c)}{/each}
    <rect class="fog" x="-200" y="470" width="2000" height="260" fill="url(#fogGrad)" />

    <!-- ---------- Mid skyline ---------- -->
    {@render buildings(midBuildings, 'mid', 0.8)}
    {#each carsMid as c}{@render car(c)}{/each}
    <rect class="fog slow" x="-200" y="560" width="2000" height="240" fill="url(#fogGrad)" />

    <!-- Monorail -->
    <g>
      {#each pylons as px}
        <rect x={px} y="675" width="10" height="230" fill="#0a0518" />
      {/each}
      <rect x="-50" y="668" width="1700" height="8" fill="#0a0518" />
      <rect x="-50" y="667" width="1700" height="1.4" fill="#00f0ff" opacity=".65" />
      <g transform="translate(0 650)">
        <g class="train">
          {#each [0, 78, 156] as tx}
            <rect x={tx} y="0" width="74" height="17" rx="6" fill="#1a1236" stroke="#00f0ff" stroke-opacity=".55" stroke-width=".8" />
            <line x1={tx + 7} y1="7" x2={tx + 67} y2="7" stroke="#00f0ff" stroke-width="5" stroke-dasharray="7 3" opacity=".85" />
          {/each}
          <circle cx="232" cy="9" r="4" fill="#fff" opacity=".3" />
          <rect x="229" y="8" width="4" height="2" rx="1" fill="#fff" />
        </g>
      </g>
    </g>

    <!-- ---------- Near skyline ---------- -->
    {@render buildings(nearBuildings, 'near', 1)}
    {#each carsNear as c}{@render car(c)}{/each}

    <!-- Neon glow at street level -->
    <rect x="0" y="690" width={W} height="210" fill="url(#groundGlow)" />
  </svg>

  <div class="bg-vignette"></div>
</div>

<main class="page">
  {#if !currentAnime}
    <!-- ================= LIST VIEW ================= -->
    <h1>Anime Watchlist</h1>

    <div class="toolbar">
      <button onclick={showAlert}>New Entry</button><br />
      <input type="text" bind:value={searchTerm} placeholder="Search anime..." aria-label="Search anime" /><br />

      <div class="checkbox-group">
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={showWatched} />
          <span>Watched</span>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={showNotWatched} />
          <span>To Watch</span>
        </label>
      </div>
    </div>

    <ul id="AnimeList">
      {#each filteredAnime as anime (anime.id)}
        <!-- Accessible button instead of a clickable <li> -->
        <li>
          <button type="button" class="anime-card-btn" onclick={() => openDetail(anime)}>
            <span class="img-wrapper">
              <img src={anime.image} alt={anime.name} loading="lazy" />
              <span class="badge" class:seen={anime.wasWatched}>{anime.wasWatched ? 'Watched' : 'To Watch'}</span>
            </span>
            <strong>{anime.name}</strong>
          </button>
        </li>
      {:else}
        <li class="empty">
          {animeList.length === 0
            ? 'No entries yet. Click “New Entry” to add your first anime.'
            : 'No matches. Adjust your search or filters.'}
        </li>
      {/each}
    </ul>

  {:else}
    <!-- ================= DETAIL VIEW ================= -->
    <button id="backButton" onclick={goBack}>Back</button>

    <h1 id="AnimeNameDisplay">{currentAnime.name}</h1>
    <img id="AnimePicture" src={currentAnime.image} alt={currentAnime.name} />
    <p id="AnimeDescription">{currentAnime.description}</p>

    <div class="checkbox-group">
      <label class="checkbox-label">
        <input type="checkbox" checked={currentAnime.wasWatched} onchange={toggleWatched} />
        <span>Watched</span>
      </label>
    </div>
    <br />
    <button id="changeCoverButton" onclick={changeCover}>Change Cover</button>
    <button id="deleteButton" onclick={deleteAnime}>Delete</button>
  {/if}
</main>