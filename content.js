(() => {
  'use strict';

  const ROOT_CLASS = 'sgx-announcement';
  const MOTION_DURATION = 300;
  const MISSION_IMAGE_HOSTS = new Set(['images.sg.zone', 'i.ibb.co', 'i.imgur.com']);
  const ICON_TYPES = new Map([
    ['sg-calendar', 'day'],
    ['sg-users', 'factions'],
    ['sg-car', 'vehicles'],
    ['sg-map', 'map'],
    ['sg-cloud', 'weather'],
    ['sg-eye', 'mission'],
    ['sg-info', 'description']
  ]);

  const text = (node) => node?.textContent?.replace(/\s+/g, ' ').trim() || '';
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function element(tagName, className, value) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function itemType(item) {
    const icon = item.querySelector('.mission-icon i');
    if (!icon) return null;
    for (const className of icon.classList) {
      if (ICON_TYPES.has(className)) return ICON_TYPES.get(className);
    }
    return null;
  }

  function itemContent(item) {
    return [...item.children].find((child) => !child.classList.contains('mission-icon')) || null;
  }

  function safeClone(source) {
    const clone = source.cloneNode(true);
    clone.querySelectorAll('script, style, iframe, object, embed, form, input, button, a').forEach((node) => node.remove());
    for (const node of [clone, ...clone.querySelectorAll('*')]) {
      for (const attribute of [...node.attributes]) {
        if (/^on/iu.test(attribute.name)) node.removeAttribute(attribute.name);
      }
    }
    return clone;
  }

  // Copy formatting only; never copy executable markup or resource URLs.
  function cloneDescription(source) {
    const allowed = new Set(['DIV', 'P', 'BR', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'SMALL', 'FONT', 'UL', 'OL', 'LI', 'BLOCKQUOTE']);
    const blocked = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SVG', 'MATH']);
    const copy = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
      const fragment = document.createDocumentFragment();
      if (node.nodeType !== Node.ELEMENT_NODE || blocked.has(node.tagName)) return fragment;
      const target = allowed.has(node.tagName) ? document.createElement(node.tagName === 'FONT' ? 'span' : node.tagName.toLowerCase()) : fragment;
      if (target.nodeType === Node.ELEMENT_NODE) {
        const color = node.style.color || (node.tagName === 'FONT' ? node.getAttribute('color') : '');
        if (color && CSS.supports('color', color)) target.style.color = color;
        for (const property of ['font-weight', 'font-style', 'text-decoration', 'text-align']) {
          const value = node.style.getPropertyValue(property);
          if (value) target.style.setProperty(property, value);
        }
      }
      for (const child of node.childNodes) target.append(copy(child));
      return target;
    };
    const result = element('div', 'sgx-description');
    for (const child of source.childNodes) result.append(copy(child));
    return result;
  }

  function normalizeMissionUrl(value) {
    try {
      const url = new URL(value, location.origin);
      return url.origin === location.origin && /^\/mission\/\d+\/?$/u.test(url.pathname) ? url.href : '';
    } catch {
      return '';
    }
  }

  function missionImageCandidates(imageUrl) {
    if (imageUrl.hostname !== 'i.imgur.com') return [imageUrl.href];
    const id = imageUrl.pathname.match(/^\/([a-z0-9]+)(?:_[a-z])?\.(?:jpe?g|png|webp|gif)$/iu)?.[1];
    if (!id) return [imageUrl.href];
    return [
      `https://i.imgur.com/${id}_d.webp?maxwidth=1520&fidelity=grand`,
      `https://i.imgur.com/${id}h.jpg`,
      imageUrl.href
    ];
  }

  function requestExtensionImage(candidates) {
    return new Promise((resolve) => {
      if (!globalThis.chrome?.runtime?.sendMessage) {
        resolve(null);
        return;
      }
      chrome.runtime.sendMessage(
        { type: 'sgx:load-mission-image', candidates },
        (response) => {
          if (chrome.runtime.lastError || !response?.ok || typeof response.dataUrl !== 'string') {
            resolve(null);
            return;
          }
          resolve(response.dataUrl);
        }
      );
    });
  }

  function parsePanel(panel, fallbackTitle) {
    const mobileTitle = panel.querySelector(':scope > .mobile-item');
    const content = [...panel.children].find((child) => child !== mobileTitle);
    if (!content) return null;

    const mission = {
      title: text(mobileTitle) || fallbackTitle,
      day: '',
      map: '',
      weather: '',
      description: '',
      missionUrl: '',
      servers: []
    };
    let server = null;

    for (const child of content.children) {
      if (!child.classList.contains('mission-desc-item')) {
        const match = text(child).match(/^(?:Server|Сервер)\s*[#№]?\s*(\d+)$/iu);
        if (match) {
          server = { number: Number(match[1]), factions: null, vehicles: null };
          mission.servers.push(server);
        }
        continue;
      }

      const type = itemType(child);
      const value = itemContent(child);
      if (!type || !value) continue;
      if (type === 'day') mission.day = text(value);
      if (type === 'map') mission.map = text(value);
      if (type === 'weather') mission.weather = text(value);
      if (type === 'description') mission.description = cloneDescription(value);
      if (type === 'mission') mission.missionUrl = normalizeMissionUrl(value.querySelector('a[href*="/mission/"]')?.href);
      if (type === 'factions' && server) server.factions = safeClone(value);
      if (type === 'vehicles' && server) server.vehicles = safeClone(value);
    }

    return mission;
  }

  function createFact(label, value) {
    if (!value) return null;
    const fact = element('span', 'sgx-fact');
    fact.append(element('strong', '', label), document.createTextNode(value));
    return fact;
  }

  function createSideContent(source, className) {
    const wrapper = element('div', className);
    if (source) wrapper.append(source.cloneNode(true));
    return wrapper;
  }

  function createMissionView(mission) {
    const view = element('section', 'sgx-mission-view');
    const overview = element('div', 'sgx-overview');
    const summary = element('div', 'sgx-summary');
    const heading = element('div', 'sgx-heading');
    heading.append(element('strong', '', mission.title));
    if (mission.day) heading.append(element('span', '', mission.day));
    summary.append(heading);

    for (const server of mission.servers) {
      summary.append(createSideContent(server.factions, 'sgx-factions'));
    }
    overview.append(summary);

    const coverSlot = element('div', 'sgx-cover-slot');
    overview.append(coverSlot);
    view.append(overview);

    const toggle = element('button', 'sgx-details-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Показать подробности миссии');
    toggle.innerHTML = '<span aria-hidden="true"></span>';
    view.append(toggle);

    const details = element('div', 'sgx-details');
    details.hidden = true;
    const vehicles = element('div', 'sgx-vehicles');
    const vehicleContent = element('div', 'sgx-vehicle-content');
    const serverTabs = element('div', 'sgx-server-tabs');
    let selectedServer = 0;

    const updateServer = () => {
      const server = mission.servers[selectedServer];
      vehicleContent.replaceChildren();
      if (server?.vehicles) vehicleContent.append(server.vehicles.cloneNode(true));
      if (!reducedMotion()) {
        vehicleContent.classList.remove('sgx-server-switching');
        requestAnimationFrame(() => vehicleContent.classList.add('sgx-server-switching'));
        setTimeout(() => vehicleContent.classList.remove('sgx-server-switching'), MOTION_DURATION);
      }
      serverTabs.querySelectorAll('button').forEach((button, index) => {
        const selected = index === selectedServer;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
    };

    mission.servers.forEach((server, index) => {
      const button = element('button', '', `Сервер ${server.number}`);
      button.type = 'button';
      button.addEventListener('click', () => {
        selectedServer = index;
        updateServer();
      });
      serverTabs.append(button);
    });

    vehicles.append(vehicleContent, serverTabs);
    details.append(vehicles);
    const facts = element('div', 'sgx-facts');
    const map = createFact('Карта', mission.map);
    const weather = createFact('Условия', mission.weather);
    if (map) facts.append(map);
    if (weather) facts.append(weather);
    if (facts.childElementCount) details.append(facts);
    if (mission.description) {
      const description = mission.description;
      details.append(description);
    }
    if (mission.missionUrl) {
      const link = element('a', 'sgx-mission-link', 'Открыть миссию');
      link.href = mission.missionUrl;
      details.append(link);
    }
    updateServer();
    view.append(details);

    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-label', expanded ? 'Скрыть подробности миссии' : 'Показать подробности миссии');
      if (reducedMotion()) {
        details.hidden = !expanded;
        return;
      }

      if (expanded) {
        details.hidden = false;
        details.style.height = '0px';
        details.style.opacity = '0';
        requestAnimationFrame(() => {
          details.style.height = `${details.scrollHeight}px`;
          details.style.opacity = '1';
        });
        setTimeout(() => {
          if (toggle.getAttribute('aria-expanded') === 'true') details.style.height = 'auto';
        }, MOTION_DURATION);
      } else {
        details.style.height = `${details.scrollHeight}px`;
        details.style.opacity = '1';
        requestAnimationFrame(() => {
          details.style.height = '0px';
          details.style.opacity = '0';
        });
        setTimeout(() => {
          if (toggle.getAttribute('aria-expanded') === 'false') {
            details.hidden = true;
            details.style.height = '';
            details.style.opacity = '';
          }
        }, MOTION_DURATION);
      }
    });

    if (mission.missionUrl) loadMissionCover(mission.missionUrl, coverSlot);
    return view;
  }

  async function loadMissionCover(missionUrl, slot) {
    try {
      const url = new URL(missionUrl, location.origin);
      if (url.origin !== location.origin || !/^\/mission\/\d+\/?$/u.test(url.pathname)) return;
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) return;
      const html = await response.text();
      const source = new DOMParser()
        .parseFromString(html, 'text/html')
        .querySelector('.mission-short-info .center > img[src]')
        ?.getAttribute('src');
      if (!source) return;
      const imageUrl = new URL(source, location.origin);
      if (imageUrl.protocol !== 'https:' || !MISSION_IMAGE_HOSTS.has(imageUrl.hostname)) return;
      const image = element('img', 'sgx-cover');
      image.alt = `Изображение миссии ${slot.closest('.sgx-mission-view')?.querySelector('.sgx-heading strong')?.textContent || ''}`.trim();
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      const candidates = missionImageCandidates(imageUrl);
      let candidateIndex = 0;
      let imageLoaded = false;
      image.addEventListener('load', () => {
        imageLoaded = true;
        slot.classList.remove('sgx-cover-error');
      });
      image.addEventListener('error', () => {
        candidateIndex += 1;
        if (candidateIndex < candidates.length) {
          image.src = candidates[candidateIndex];
        } else {
          image.removeAttribute('src');
          slot.classList.add('sgx-cover-error');
        }
      });
      slot.append(image);
      image.src = candidates[candidateIndex];
      void requestExtensionImage(candidates).then((localImage) => {
        if (localImage && !imageLoaded && image.isConnected) image.src = localImage;
      });
    } catch {
      // Анонс остаётся полностью доступным, если у миссии нет обложки.
    }
  }

  function enhanceAnnouncement(article) {
    if (article.classList.contains(ROOT_CLASS)) return;
    const originalContent = article.querySelector('.feed-ann-content');
    const originalTabs = article.querySelector('.tabs');
    if (!originalContent || !originalTabs) return;

    const panels = [...originalContent.children].filter((child) => child.classList.contains('feed-padding'));
    const originalButtons = [...originalTabs.querySelectorAll(':scope > button, :scope > a')];
    if (!panels.length) return;

    const titles = originalButtons.map((button) => text(button.querySelector('.desktop-item')) || text(button));
    const missions = panels.map((panel, index) => parsePanel(panel, titles[index] || `Миссия ${index + 1}`));
    if (missions.some((mission) => !mission)) return;

    const tabs = element('div', 'sgx-tabs');
    const content = element('div', 'sgx-content');
    const views = missions.map(createMissionView);
    let selectedMission = 0;
    let switching = false;

    const updateTabState = (selectedIndex) => {
      tabs.style.setProperty('--sgx-tab-index', String(selectedIndex));
      tabs.querySelectorAll('button').forEach((button, index) => {
        const selected = index === selectedIndex;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
    };

    const selectMission = (selectedIndex, immediate = false) => {
      if (selectedIndex === selectedMission && !immediate) return;
      if (immediate || reducedMotion()) {
        views.forEach((view, index) => {
          view.hidden = index !== selectedIndex;
        });
        selectedMission = selectedIndex;
        updateTabState(selectedIndex);
        return;
      }
      if (switching) return;
      switching = true;

      const previous = views[selectedMission];
      const next = views[selectedIndex];
      const startHeight = content.offsetHeight;
      next.hidden = false;
      next.classList.add('sgx-measuring');
      const nextHeight = next.offsetHeight;
      next.classList.remove('sgx-measuring');

      content.style.height = `${startHeight}px`;
      previous.classList.add('sgx-view-leave');
      next.classList.add('sgx-view-enter');
      requestAnimationFrame(() => {
        content.style.height = `${nextHeight}px`;
        next.classList.add('sgx-view-enter-active');
      });

      selectedMission = selectedIndex;
      updateTabState(selectedIndex);
      setTimeout(() => {
        views.forEach((view, index) => {
          view.hidden = index !== selectedMission;
          view.classList.remove('sgx-view-leave', 'sgx-view-enter', 'sgx-view-enter-active');
        });
        content.style.height = '';
        switching = false;
      }, MOTION_DURATION);
    };

    missions.forEach((mission, index) => {
      const button = element('button', '', mission.title);
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.addEventListener('click', () => selectMission(index));
      tabs.append(button);
      content.append(views[index]);
    });

    tabs.setAttribute('role', 'tablist');
    originalTabs.hidden = true;
    originalContent.hidden = true;
    originalTabs.insertAdjacentElement('afterend', tabs);
    originalContent.insertAdjacentElement('afterend', content);
    article.classList.add(ROOT_CLASS);
    selectMission(0, true);
  }

  function findAnnouncements(root = document) {
    root.querySelectorAll('article.feed-item').forEach((article) => {
      const title = text(article.querySelector('.section-header-title'));
      if (article.querySelector('.feed-ann-content') && /(?:анонс игр|games announcement)/iu.test(title)) {
        enhanceAnnouncement(article);
      }
    });
  }

  function navigateFromArea(event, link) {
    if (event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        event.target.closest('a, button, input, textarea, select, label')) {
      return;
    }
    location.assign(link.href);
  }

  function enhanceForumNavigation(root = document) {
    root.querySelectorAll('.forum__topics').forEach((row) => {
      if (row.dataset.sgxForumEnhanced === 'true') return;
      const mainArea = row.querySelector(':scope > .forum__name');
      const latestArea = row.querySelector(':scope > .forum__last__post');
      const latestLink = latestArea?.querySelector('a[href^="/topic/"]');
      const primaryLink = mainArea?.querySelector('a[href^="/forum/"], a[href^="/topic/"]');
      if (!mainArea || !primaryLink) return;

      row.dataset.sgxForumEnhanced = 'true';
      row.classList.add('sgx-forum-row');
      mainArea.classList.add('sgx-forum-main');
      mainArea.addEventListener('click', (event) => navigateFromArea(event, primaryLink));

      if (latestArea && latestLink) {
        latestArea.classList.add('sgx-forum-latest');
        latestArea.addEventListener('click', (event) => navigateFromArea(event, latestLink));
      }

      if (primaryLink.matches('a[href^="/topic/"]') && latestLink) {
        primaryLink.dataset.sgxOriginalHref = primaryLink.getAttribute('href') || '';
        primaryLink.href = latestLink.href;
        primaryLink.title = 'Открыть последнее сообщение';
      }
    });
  }

  function enhancePage(root = document) {
    findAnnouncements(root);
    enhanceForumNavigation(root);
  }

  enhancePage();
  new MutationObserver((records) => {
    if (records.some((record) => record.addedNodes.length)) enhancePage();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();

