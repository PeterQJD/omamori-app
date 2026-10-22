'use strict';

// Map helpers, using Leaflet (in vendor/leaflet) with OpenStreetMap's map
// tiles and its Nominatim place search. Both need an internet connection;
// everything else in the app works offline.
const Maps = (() => {
  const JAPAN = { center: [36.2, 138.3], zoom: 5 };
  let current = [];    // maps on the current screen, removed when leaving it
  let lastSearch = 0;  // Nominatim asks for at most one search per second

  return {
    JAPAN,

    // A map inside element el. { still: true } makes a small map that doesn't move.
    create(el, { still = false } = {}) {
      const map = L.map(el, still
        ? { zoomControl: false, dragging: false, touchZoom: false, doubleClickZoom: false, scrollWheelZoom: false, boxZoom: false, keyboard: false }
        : {});
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      current.push(map);
      return map;
    },

    removeAll() {
      current.forEach(map => map.remove());
      current = [];
    },

    // The map pin. count > 1 shows how many omamori share the place.
    pinIcon(count = 1) {
      return L.divIcon({
        className: 'pin-icon',
        html: '<span class="pin"></span>' + (count > 1 ? `<span class="pin-count">${count}</span>` : ''),
        iconSize: [24, 24],
        iconAnchor: [12, 29],
        popupAnchor: [0, -28],
      });
    },

    // Up to five places matching the text: [{ lat, lng, name }]. Searches Japan only unless japan is false.
    async search(text, { japan = true } = {}) {
      const wait = lastSearch + 1100 - Date.now();
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      lastSearch = Date.now();
      const params = { q: text, format: 'jsonv2', limit: '5', 'accept-language': 'en,ja' };
      if (japan) params.countrycodes = 'jp';
      const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams(params);
      const res = await fetch(url);
      if (!res.ok) throw new Error('Search failed (' + res.status + ')');
      return (await res.json()).map(p => ({ lat: Number(p.lat), lng: Number(p.lon), name: p.display_name }));
    },
  };
})();
