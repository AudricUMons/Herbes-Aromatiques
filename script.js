const manualPageOverrides = {
  "Essence_de_fleur_d'oranger": "Eau_de_fleur_d'oranger",
  "Cassia": "Cannelle_de_Chine",
  "citron_vert":"Lime_(fruit)",
  "Achillée":"Achillée_millefeuille"
};

// Variables globales
let herbList = [];
let herbDataList = [];
let searchTimeout;
let container, searchInput, loader;

let isEmptyState = false;
let flyAnimationTimeout, iconSpawnInterval;

// Affichage du loader
function showLoader() { loader?.classList.remove('hidden'); }
function hideLoader() { loader?.classList.add('hidden'); }

  // Charge la liste des herbes depuis Wikipédia
  async function loadHerbNamesFromWiki() {
    const page = "Liste_d'herbes_et_aromates_de_cuisine";
    const url = `https://fr.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=text&section=1&format=json&origin=*`;
    const res = await fetch(url);
    const json = await res.json();
    const html = json.parse.text['*'];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const items = doc.querySelectorAll('ul li');
    const list = Array.from(items).map(li => {
      const a = li.querySelector('a');
      if (!a) return null;
      const name = a.textContent.trim();
      let pageKey = a.getAttribute('href').split('/wiki/')[1] || name;
      pageKey = decodeURIComponent(pageKey);
      return { name, page: pageKey };
    }).filter(Boolean);
    const seen = new Set();
    return list.filter(item => !seen.has(item.name) && seen.add(item.name));
  }
  
  // Suit les redirects et retourne le titre canonique
  async function resolvePageTitle(pageKey) {
    const url = new URL('https://fr.wikipedia.org/w/api.php');
    url.search = new URLSearchParams({ action:'query', titles: pageKey, redirects:'1', format:'json', origin:'*' });
    const res = await fetch(url);
    const pages = (await res.json()).query.pages;
    return pages[Object.keys(pages)[0]].title;
  }
  
  // Récupère résumé + vignette du summary REST
  async function fetchWikiSummary(lang, pageTitle) {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}?redirect=true&width=300`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw 0;
      return await res.json();
    } catch {
      return null;
    }
  }
  
  // Extrait le contenu culinaire (entier ou filtré)
 // Extrait le contenu culinaire (paragraphes ET listes)
// Extrait le contenu culinaire (paragraphes, listes, puis fallback « Utilisations », puis « cuisine »)
async function fetchCulinaryParagraph(pageTitle) {
    const secRes = await fetch(
      `https://fr.wikipedia.org/w/api.php?${new URLSearchParams({
        action: 'parse',
        page: pageTitle,
        prop: 'sections',
        format: 'json',
        origin: '*'
      })}`
    );
    const sections = (await secRes.json()).parse.sections;
  
    const primary = [
      /^Cuisine$/i,
      /^Usages? culinaires?$/i,
      /^Alimentation et gastronomie$/i,
      /alimentaire/i,
      /Gastronomie/i,
      /^Utilisation culinaire$/i
    ];
  
    let sectionInfo = null;
    for (const re of primary) {
      const matches = sections.filter(s => re.test(s.line));
      if (matches.length) {
        sectionInfo = matches.reduce(
          (a, b) => parseInt(a.level) > parseInt(b.level) ? a : b
        );
        break;
      }
    }
  
    if (sectionInfo) {
      const textRes = await fetch(
        `https://fr.wikipedia.org/w/api.php?${new URLSearchParams({
          action: 'parse',
          page: pageTitle,
          prop: 'text',
          section: sectionInfo.index,
          format: 'json',
          origin: '*'
        })}`
      );
      const html = (await textRes.json()).parse.text['*'];
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const nodes = Array.from(doc.querySelectorAll('p, ul'))
        .filter(node => node.textContent.trim());
      const cleaned = nodes.map(node => {
        node.querySelectorAll('sup').forEach(s => s.remove());
        node.querySelectorAll('a').forEach(a => {
          const txt = document.createTextNode(a.textContent);
          a.replaceWith(txt);
        });
        return node.outerHTML;
      });
      if (cleaned.length) return cleaned.join('');
    }
  
    const utilSec = sections.find(s => /^Utilisations?$/i.test(s.line));
    if (utilSec) {
      const utilRes = await fetch(
        `https://fr.wikipedia.org/w/api.php?${new URLSearchParams({
          action: 'parse',
          page: pageTitle,
          prop: 'text',
          section: utilSec.index,
          format: 'json',
          origin: '*'
        })}`
      );
      const html2 = (await utilRes.json()).parse.text['*'];
      const doc2 = new DOMParser().parseFromString(html2, 'text/html');
      const paras = Array.from(doc2.querySelectorAll('p'))
        .filter(p => /cuis/i.test(p.textContent));
      if (paras.length) {
        const firstP = paras[0];
        const nodes = [ firstP ];
        const next = firstP.nextElementSibling;
        if (next && next.tagName.toLowerCase() === 'ul') nodes.push(next);
        const cleaned2 = nodes.map(node => {
          node.querySelectorAll('sup').forEach(s => s.remove());
          node.querySelectorAll('a').forEach(a => {
            const txt = document.createTextNode(a.textContent);
            a.replaceWith(txt);
          });
          return node.outerHTML;
        });
        if (cleaned2.length) return cleaned2.join('');
      }
    }
  
    const fullRes = await fetch(
      `https://fr.wikipedia.org/w/api.php?${new URLSearchParams({
        action: 'parse',
        page: pageTitle,
        prop: 'text',
        format: 'json',
        origin: '*'
      })}`
    );
    const fullHtml = (await fullRes.json()).parse.text['*'];
    const fullDoc = new DOMParser().parseFromString(fullHtml, 'text/html');
    const para = Array.from(fullDoc.querySelectorAll('p'))
      .find(p => /cuisine/i.test(p.textContent));
    if (para) {
      para.querySelectorAll('sup').forEach(s => s.remove());
      para.querySelectorAll('a').forEach(a => {
        const txt = document.createTextNode(a.textContent);
        a.replaceWith(txt);
      });
      return para.outerHTML;
    }
  
    return null;
  }
  
  // Récupère la première image d'intro
  async function fetchLeadImage(pageTitle) {
    const url1 = new URL('https://fr.wikipedia.org/w/api.php');
    url1.search = new URLSearchParams({ action:'parse', page: pageTitle, prop:'images', section:'0', format:'json', origin:'*' });
    const imgs = (await fetch(url1).then(r => r.json())).parse.images;
    if (!imgs.length) return null;
    const file = imgs[0];
    const url2 = new URL('https://fr.wikipedia.org/w/api.php');
    url2.search = new URLSearchParams({ action:'query', titles: `File:${file}`, prop:'imageinfo', iiprop:'url', format:'json', origin:'*' });
    const pages = (await fetch(url2).then(r => r.json())).query.pages;
    return pages[Object.keys(pages)[0]].imageinfo?.[0]?.url || null;
  }
  
  // Récupère toutes les données d'une herbe
  async function fetchHerbData({ name, page }) {

    fetchHerbData.cache = fetchHerbData.cache || {};
    if (fetchHerbData.cache[name]) return fetchHerbData.cache[name];

    if (name === 'citron vert') {
      page = 'Lime_(fruit)';
    }
  
    const pageKey = manualPageOverrides[page] || page;
    const realTitle = await resolvePageTitle(pageKey);
  
    const frData = await fetchWikiSummary('fr', realTitle);
    const extract = frData?.extract || 'Aucune description disponible.';
    const img = frData?.thumbnail?.source || await fetchLeadImage(realTitle) || `https://source.unsplash.com/300x150/?${encodeURIComponent(name)}`;
  
    const culinaryHTML = await fetchCulinaryParagraph(realTitle);
    const data = { name, extract, img, culinaryHTML };
    fetchHerbData.cache[name] = data;
    return data;
  }
  
  // Affiche les cartes
  function renderCards(herbs) {
    container.innerHTML = '';
    herbs.forEach(h => {
      const card = document.createElement('div');
      card.className = 'herb-card';
      card.innerHTML = `
        ${h.culinaryHTML ? '<div class="banner">Voir plus</div>' : ''}
        <img src="${h.img}" alt="${h.name}" onerror="this.onerror=null;this.src='indisp.png';" />
        <div class="content">
          <h2>${h.name}</h2>
          <p>${h.extract}</p>
        </div>
        ${h.culinaryHTML ? `<div class="details hidden">${h.culinaryHTML}</div>` : ''}
      `;
      if (h.culinaryHTML) {
        card.addEventListener('click', () => {
          card.classList.toggle('expanded');
          const details = card.querySelector('.details');
          const banner  = card.querySelector('.banner');
          const hidden  = details.classList.toggle('hidden');
          banner.textContent = hidden ? 'Voir plus' : 'Voir moins';
        });
      }
      container.appendChild(card);
    });
    hideLoader();
  }


// Fonctions d'animations révisées
function clearEmptyStateAnimations() {
  clearTimeout(flyAnimationTimeout);
  clearInterval(iconSpawnInterval);

  const head = document.getElementById('gadget-head');
  head.classList.remove('fly', 'peek', 'hide', 'side-left', 'side-right', 'side-bottom');
}

function animateIcon(icon) {
  const { width, height } = container.getBoundingClientRect();
  icon.style.transition = 'none';
  icon.style.left = `${Math.random() * (width - icon.clientWidth)}px`;
  icon.style.top = `${Math.random() * (height - icon.clientHeight)}px`;

  requestAnimationFrame(() => {
    icon.style.transition = 'left 1s ease, top 1s ease';
    moveAndShakeIcon(icon);
    setInterval(() => moveAndShakeIcon(icon), 4000);
  });
}

function moveAndShakeIcon(icon) {
  const { width, height } = container.getBoundingClientRect();
  icon.classList.remove('shake');
  icon.style.left = `${Math.random() * (width - icon.clientWidth)}px`;
  icon.style.top = `${Math.random() * (height - icon.clientHeight)}px`;
  icon.addEventListener('transitionend', () => icon.classList.add('shake'), { once: true });
}

function spawnGadgetHead() {
  const head = document.getElementById('gadget-head');
  head.style.display = 'block';
  const W = window.outerWidth;
  const H = window.outerHeight;

  const sides = ['left', 'bottom', 'right'];
  const side = sides[Math.floor(Math.random() * sides.length)];

  let x, y;
  if (side === 'left' || side === 'right') {
    y = 0.1 * H + Math.random() * 0.7 * H;
    head.style.setProperty('--gadget-y', `${y}px`);
    head.style.removeProperty('--gadget-x');
  } else {
    x = 0.1 * W + Math.random() * 0.7 * W;
    head.style.setProperty('--gadget-x', `${x}px`);
    head.style.removeProperty('--gadget-y');
  }

  head.classList.remove('side-left', 'side-right', 'side-bottom', 'peek', 'hide');
  head.classList.add(`side-${side}`);

  requestAnimationFrame(() => {
    head.classList.add('peek');
    head.classList.remove('hide');
    setTimeout(() => {
      if (head.classList.contains('fly')) return;
      head.classList.remove('peek');
      head.classList.add('hide');
    }, 2000);
  });
}

function startEmptyStateAnimations() {
  const head = document.getElementById('gadget-head');
  const maxLoupes = 5;

  function spawnIconsAndHead() {
    if (!isEmptyState) return;

    const containerLoupeZone = container.querySelector('.no-results');
    const existingLoupes = containerLoupeZone.querySelectorAll('.icon');

    if (existingLoupes.length >= maxLoupes) return;

    const icon = document.createElement('div');
    icon.className = 'icon';
    icon.textContent = '🔍';
    containerLoupeZone.appendChild(icon);
    animateIcon(icon);

    spawnGadgetHead();
  }

  iconSpawnInterval = setInterval(spawnIconsAndHead, 5000);

  flyAnimationTimeout = setTimeout(() => {
    if (!isEmptyState) return;
    head.classList.add('fly');
  }, 30000);
}


// Observateur DOM
document.addEventListener('DOMContentLoaded', () => {
  container = document.getElementById('herb-container');
  const observer = new MutationObserver(() => {
    const isNowEmpty = container.classList.contains('empty');
    if (isNowEmpty && !isEmptyState) {
      isEmptyState = true;
      startEmptyStateAnimations();
    } else if (!isNowEmpty && isEmptyState) {
      isEmptyState = false;
      clearEmptyStateAnimations();
    }
  });
  observer.observe(container, { attributes: true, attributeFilter: ['class'] });
});

function startIconSearchAnim() {
  const icon = container.querySelector('.no-results .icon');
  if (!icon) return;
  animateIcon(icon);
}

function initDisplayEmpty() {
  const theme = document.getElementById('gadget-theme');
  if (theme) {
    theme.currentTime = 0;
    theme.pause();
  }

  container.classList.add('empty');
  container.innerHTML = `
    <div class="no-results">
      <div class="icon">🔍</div>
      <p>Aucun résultat trouvé</p>
    </div>
  `;
  hideLoader();
  startIconSearchAnim();

  spawnGadgetHead();
}

document.addEventListener('DOMContentLoaded', async ()=>{

  const observer = new MutationObserver(() => {
    const isNowEmpty = container.classList.contains('empty');
    if (isNowEmpty && !isEmptyState) {
      isEmptyState = true;
      startEmptyStateAnimations();
    } else if (!isNowEmpty && isEmptyState) {
      isEmptyState = false;
      clearEmptyStateAnimations();
    }
  });
  observer.observe(container, { attributes: true, attributeFilter: ['class'] });

  container     = document.getElementById('herb-container');
  searchInput   = document.getElementById('search-input');
  const filterItalian = document.getElementById('filter-italian');
  const filterIndian  = document.getElementById('filter-indian');
  const filterAsian   = document.getElementById('filter-asian');
  const filterFrench  = document.getElementById('filter-french');
  const themeSelect   = document.getElementById('theme-select');
  loader        = document.getElementById('loader');

  herbList = await loadHerbNamesFromWiki();
  herbList.splice(-2,2);
  showLoader();
  herbDataList = await Promise.all(herbList.map(fetchHerbData));
  hideLoader();
  renderCards(herbDataList);

  function applyFilters() {
    const q           = searchInput.value.toLowerCase().trim();
    const onlyIt      = filterItalian.checked;
    const onlyIn      = filterIndian.checked;
    const onlyAs      = filterAsian.checked;
    const onlyFr      = filterFrench.checked;

    let filtered = herbDataList.filter(h =>
      h.name.toLowerCase().startsWith(q)
    );

    if (!(onlyIt || onlyIn || onlyAs || onlyFr)) {
      const theme = document.getElementById('gadget-theme');
      theme.currentTime = 0;
      theme.pause();
      const head = document.getElementById('gadget-head');
      head.classList.remove('fly');
      container.classList.remove('empty');
      return filtered.length
        ? renderCards(filtered)
        : initDisplayEmpty();
    }

    filtered = filtered.filter(h => {
      const text = (h.extract + ' ' + (h.culinaryHTML || '')).toLowerCase();
      const matchIt = onlyIt && text.includes('italien');
      const matchIn = onlyIn && (text.includes('indien') || text.includes('inde'));
      const asianKeywords = ['asiatique','japonais','japon','chinois','chine','thaï','thail','vietnamien','vietnam','pékinois','mandarin','coréen','korean','indonésien','indonésie','malais','malaisie','philippin','philippines','singapour','népalais','nepal'];
      const frenchKeywords = ['français','france','provençal','provence','breton','bretagne','bourgogne','normand','bordeaux','alsacien','alsace','catalan','languedoc','gastronom','bistronom','bistrot','gastronomie française'];
      const matchAs = onlyAs && asianKeywords.some(k => text.includes(k));
      const matchFr = onlyFr && frenchKeywords.some(k => text.includes(k));
      return matchIt || matchIn || matchAs || matchFr;
    });

    renderCards(filtered);
  }

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(applyFilters, 50);
  });
  filterItalian.addEventListener('change', applyFilters);
  filterIndian .addEventListener('change', applyFilters);
  filterAsian  .addEventListener('change', applyFilters);
  filterFrench .addEventListener('change', applyFilters);

  let theme = localStorage.getItem('theme') || 'light';
  document.documentElement.classList.toggle(theme, true);
  themeSelect.value = theme;
  themeSelect.addEventListener('change', () => {
    document.documentElement.classList.replace(theme, themeSelect.value);
    theme = themeSelect.value;
    localStorage.setItem('theme', theme);
  });
});
