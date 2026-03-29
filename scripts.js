const DEFAULT_SEARCH_RADIUS_KM = 10;
const WRITE_LIMIT_PER_BROWSER = 5;
const WRITE_COUNT_STORAGE_KEY = "fuelLagbeWriteCount";

const firebaseConfig = getFirebaseConfig();

const placeAnchors = [
  { name: "Dhanmondi, Dhaka", lat: 23.7461, lng: 90.3742 },
  { name: "Motijheel, Dhaka", lat: 23.7332, lng: 90.4177 },
  { name: "Uttara, Dhaka", lat: 23.8759, lng: 90.3795 },
  { name: "Gazipur Chowrasta", lat: 24.0023, lng: 90.4266 },
  { name: "Narayanganj Sadar", lat: 23.6238, lng: 90.5 },
  { name: "Chattogram GEC", lat: 22.3569, lng: 91.8221 },
  { name: "Agrabad, Chattogram", lat: 22.3248, lng: 91.8123 },
  { name: "Sylhet Zindabazar", lat: 24.8967, lng: 91.8719 },
  { name: "Rajshahi New Market", lat: 24.3745, lng: 88.6042 },
  { name: "Khulna Sonadanga", lat: 22.8456, lng: 89.5403 },
  { name: "Barishal Sadar Road", lat: 22.7004, lng: 90.3666 },
  { name: "Rangpur Jahaj Company Mor", lat: 25.7466, lng: 89.2517 },
  { name: "Mymensingh Ganginarpar", lat: 24.7471, lng: 90.4203 },
  { name: "Comilla Kandirpar", lat: 23.4607, lng: 91.1809 },
  { name: "Cox's Bazar Kolatoli", lat: 21.439, lng: 91.983 },
  { name: "Jessore Railgate", lat: 23.1664, lng: 89.2062 },
];

const placeInput = document.getElementById("placeInput");
const searchBtn = document.getElementById("searchBtn");
const radiusInput = document.getElementById("radiusInput");
const addFuelPlaceBtn = document.getElementById("addFuelPlaceBtn");
const myLocationBtn = document.getElementById("myLocationBtn");
const searchStatus = document.getElementById("searchStatus");
const subtitleText = document.getElementById("subtitleText");
const nearbyHeading = document.getElementById("nearbyHeading");
const nearbyStationsList = document.getElementById("nearbyStationsList");

const map = L.map("map", {
  zoomControl: true,
  minZoom: 6,
  maxZoom: 18,
}).setView([23.685, 90.3563], 7);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const stationLayer = L.layerGroup().addTo(map);
let focusCircle = null;
let searchMarker = null;
let stations = [];
let currentSearchCenter = { lat: 23.685, lng: 90.3563 };
let db = null;
let addFuelMode = false;
let myLocationMarker = null;
let draftFuelMarker = null;
let searchRadiusKm = DEFAULT_SEARCH_RADIUS_KM;

renderAllStations();
refreshPanels(currentSearchCenter);
bootstrapFirebaseData();
updateRangeLabels();

searchBtn.addEventListener("click", () => {
  if (!syncRangeFromPreset()) {
    return;
  }
  const query = placeInput.value.trim();
  if (!query) {
    pinCurrentLocation();
    return;
  }
  searchPlace(query);
});

placeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    if (!syncRangeFromPreset()) {
      return;
    }
    const query = placeInput.value.trim();
    if (!query) {
      pinCurrentLocation();
      return;
    }
    searchPlace(query);
  }
});

addFuelPlaceBtn.addEventListener("click", () => {
  addFuelMode = !addFuelMode;
  addFuelPlaceBtn.classList.toggle("active", addFuelMode);

  if (addFuelMode) {
    addFuelPlaceBtn.textContent = "Add Fuel Place (ON)";
    setStatus("Add mode ON: map e click kore draft pin boshan, tarpor popup e info diye OK din.");
  } else {
    addFuelPlaceBtn.textContent = "Add Fuel Place";
    clearDraftFuelMarker();
    setStatus("Add mode OFF.");
  }
});

myLocationBtn.addEventListener("click", pinCurrentLocation);

map.on("click", async (event) => {
  if (!addFuelMode) {
    return;
  }

  showDraftFuelMarker(event.latlng.lat, event.latlng.lng);
});

async function bootstrapFirebaseData() {
  db = initFirebase();
  if (!db) {
    setStatus("Firebase not configured. Add real firebaseConfig values.", true);
    return;
  }

  setStatus("Connecting to Firebase...");

  try {
    watchStationsRealtime();
  } catch (error) {
    stations = [];
    renderAllStations();
    refreshPanels(currentSearchCenter);
    setStatus(
      `Firebase connection failed: ${humanizeFirebaseError(error)}`,
      true,
    );
  }
}

function initFirebase() {
  if (!window.firebase || !window.firebase.apps) {
    console.error("Firebase SDK not loaded.");
    return null;
  }

  if (!isFirebaseConfigValid(firebaseConfig)) {
    console.error(
      "Firebase config is invalid or still contains placeholders.",
      firebaseConfig,
    );
    return null;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  return firebase.firestore();
}

function getFirebaseConfig() {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  };
}

function watchStationsRealtime() {
  db.collection("stations").onSnapshot(
    (snapshot) => {
      stations = snapshot.docs
        .map((doc) => normalizeStationDoc(doc.id, doc.data()))
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));

      renderAllStations();
      refreshPanels(currentSearchCenter);
      setStatus("Live data loaded from Firebase.");
    },
    (error) => {
      setStatus(
        `Could not sync live updates: ${humanizeFirebaseError(error)}`,
        true,
      );
    },
  );
}

async function searchPlace(query) {
  if (!query) {
    setStatus("Please type a place name.", true);
    return;
  }

  setStatus("Searching Bangladesh location...");

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "bd");
    url.searchParams.set("bounded", "1");
    url.searchParams.set("viewbox", "88.0,26.8,92.8,20.5");
    url.searchParams.set("addressdetails", "1");

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch location");
    }

    const results = await response.json();
    if (!Array.isArray(results) || !results.length) {
      setStatus(
        "Location not found in Bangladesh. Try a different name.",
        true,
      );
      return;
    }

    const result = results[0];
    const lat = Number(result.lat);
    const lng = Number(result.lon);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      setStatus("Could not parse this location. Try another one.", true);
      return;
    }

    if (!isWithinBangladesh(lat, lng)) {
      setStatus("Search result Bangladesh er baire geche. Onno query din.", true);
      return;
    }

    currentSearchCenter = { lat, lng };
    map.flyTo([lat, lng], 13, { duration: 1.1 });
    showSearchMarker(lat, lng, result.display_name);
    showSearchRadius(lat, lng);
    renderAllStations();
    refreshPanels(currentSearchCenter);
    setStatus(
      `Showing fuel stations within ${searchRadiusKm} km of ${query}.`,
    );
  } catch {
    setStatus("Search failed. Please check internet and try again.", true);
  }
}

function showSearchMarker(lat, lng, label) {
  if (searchMarker) {
    searchMarker.remove();
  }

  searchMarker = L.marker([lat, lng]).addTo(map);
  searchMarker.bindPopup(
    `<strong>Search Location</strong><br>${escapeHtml(label)}`,
  );
  searchMarker.openPopup();
}

function showSearchRadius(lat, lng) {
  if (focusCircle) {
    focusCircle.remove();
  }

  focusCircle = L.circle([lat, lng], {
    radius: searchRadiusKm * 1000,
    color: "#0e7490",
    weight: 2,
    fillColor: "#67e8f9",
    fillOpacity: 0.12,
  }).addTo(map);
}

function renderAllStations() {
  stationLayer.clearLayers();

  const nearbyStations = getNearbyStations(
    currentSearchCenter,
    searchRadiusKm,
  );
  const nearbyIds = new Set(nearbyStations.map((s) => s.id));

  stations.forEach((station) => {
    if (!nearbyIds.has(station.id)) {
      return;
    }

    const marker = L.circleMarker([station.lat, station.lng], {
      radius: 9,
      color: "#991b1b",
      fillColor: "#ef4444",
      fillOpacity: 0.88,
      weight: 2,
    });

    marker.bindPopup(getPopupHtml(station), { minWidth: 260 });
    marker.on("popupopen", () => {
      attachPopupHandlers(station.id);
    });
    marker.addTo(stationLayer);
  });
}

function refreshPanels(center) {
  renderNearbyStationList(center, searchRadiusKm);
}

function renderNearbyStationList(center, radiusKm) {
  const nearbyStations = getNearbyStations(center, radiusKm);

  if (!nearbyStations.length) {
    nearbyStationsList.innerHTML =
      `<li>No fuel station markers in this ${searchRadiusKm} km radius.</li>`;
    return;
  }

  nearbyStationsList.innerHTML = nearbyStations
    .map((station) => {
      const badge = station.fuelAvailable
        ? '<span class="badge badge-ok">Fuel Available</span>'
        : '<span class="badge badge-no">No Fuel</span>';
      const priceText = Number(station.price).toFixed(2);

      return `<li>
				<strong>${escapeHtml(station.name)}</strong>${badge}
				<div class="meta-line">Distance: ${station.distanceKm.toFixed(2)} km</div>
				<div class="meta-line">Price: ৳${priceText} / liter</div>
				<div class="meta-line">Last update: ${escapeHtml(station.lastUpdate)}</div>
			</li>`;
    })
    .join("");
}

function getNearbyStations(center, radiusKm) {
  return stations
    .map((station) => ({
      ...station,
      distanceKm: haversineDistance(
        center.lat,
        center.lng,
        station.lat,
        station.lng,
      ),
    }))
    .filter((station) => station.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

function getPopupHtml(station) {
  const checkedYes = station.fuelAvailable ? "selected" : "";
  const checkedNo = !station.fuelAvailable ? "selected" : "";
  const priceValue = Number(station.price).toFixed(2);

  return `
		<div class="popup-card" data-station-id="${station.id}">
			<div class="popup-title">${escapeHtml(station.name)}</div>

			<div class="popup-row">
				<label>Fuel Status</label>
				<select class="js-fuel-status">
					<option value="yes" ${checkedYes}>Fuel Available</option>
					<option value="no" ${checkedNo}>No Fuel</option>
				</select>
			</div>

			<div class="popup-row">
				<label>Price (Tk/liter)</label>
				<input class="js-fuel-price" type="number" min="0" step="0.1" value="${priceValue}">
			</div>

			<div class="popup-row">
				<label>Last Update</label>
				<input class="js-last-update" type="text" value="${escapeHtml(station.lastUpdate)}" readonly>
			</div>

			<div class="popup-actions">
				<button class="update-btn js-update-btn">Update</button>
			</div>
		</div>
	`;
}

function attachPopupHandlers(stationId) {
  const card = document.querySelector(
    `.popup-card[data-station-id="${stationId}"]`,
  );
  if (!card) {
    return;
  }

  const statusEl = card.querySelector(".js-fuel-status");
  const priceEl = card.querySelector(".js-fuel-price");
  const lastUpdateEl = card.querySelector(".js-last-update");
  const updateBtn = card.querySelector(".js-update-btn");

  if (!statusEl || !priceEl || !lastUpdateEl || !updateBtn) {
    return;
  }

  if (window.L && L.DomEvent) {
    L.DomEvent.disableClickPropagation(card);
    L.DomEvent.disableScrollPropagation(card);
  }

  if (updateBtn.dataset.bound === "1") {
    return;
  }
  updateBtn.dataset.bound = "1";

  updateBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (!canWriteToFirebase()) {
      return;
    }

    const station = stations.find((item) => item.id === stationId);
    if (!station) {
      return;
    }

    const parsedPrice = Number(priceEl.value);
    if (Number.isNaN(parsedPrice) || parsedPrice < 0 || parsedPrice > 500) {
      alert("Please enter a valid non-negative fuel price.");
      return;
    }

    const nextUpdate = formatNow();
    lastUpdateEl.value = nextUpdate;

    if (!db) {
      setStatus("Firebase not configured. Update was not shared.", true);
      return;
    }

    try {
      await db
        .collection("stations")
        .doc(stationId)
        .set(
          {
            name: station.name,
            lat: station.lat,
            lng: station.lng,
            fuelAvailable: statusEl.value === "yes",
            price: Number(parsedPrice.toFixed(2)),
            lastUpdate: nextUpdate,
          },
          { merge: true },
        );
      registerSuccessfulWrite();
      setStatus(`${station.name} updated on Firebase.`);
    } catch (error) {
      setStatus(`Update failed: ${humanizeFirebaseError(error)}`, true);
    }
  });
}

function isFirebaseConfigValid(config) {
  if (!config) {
    return false;
  }

  const required = [
    "apiKey",
    "authDomain",
    "projectId",
    "storageBucket",
    "messagingSenderId",
    "appId",
  ];

  return required.every((key) => {
    const value = String(config[key] ?? "").trim();
    return value.length > 0;
  });
}

function humanizeFirebaseError(error) {
  const code = error?.code || "";
  const message = error?.message || "Unknown error";
  const lowerMessage = String(message).toLowerCase();

  if (
    code === "permission-denied" ||
    lowerMessage.includes("missing or insufficient permissions")
  ) {
    return "permission denied by Firestore rules";
  }

  if (code === "unavailable") {
    return "Firestore unavailable/network blocked";
  }

  if (code === "failed-precondition") {
    return "Firestore may not be enabled in Firebase project";
  }

  if (code === "invalid-argument") {
    return "invalid Firestore data format";
  }

  return message;
}

function setStatus(text, isError = false) {
  searchStatus.textContent = text;
  searchStatus.style.color = isError ? "#b91c1c" : "#475569";
}

function showDraftFuelMarker(lat, lng) {
  clearDraftFuelMarker();

  draftFuelMarker = L.marker([lat, lng], { draggable: false }).addTo(map);
  draftFuelMarker.on("popupopen", () => {
    attachCreatePopupHandlers();
  });
  draftFuelMarker.bindPopup(getCreatePopupHtml()).openPopup();
}

function clearDraftFuelMarker() {
  if (draftFuelMarker) {
    draftFuelMarker.remove();
    draftFuelMarker = null;
  }
}

function getCreatePopupHtml() {
  return `
    <div class="popup-card" data-create-popup="true">
      <div class="popup-title">Add New Fuel Place</div>

      <div class="popup-row">
        <label>Fuel Place Name</label>
        <input class="js-create-name" type="text" value="New Fuel Point">
      </div>

      <div class="popup-row">
        <label>Fuel Status</label>
        <select class="js-create-status">
          <option value="yes" selected>Fuel Available</option>
          <option value="no">No Fuel</option>
        </select>
      </div>

      <div class="popup-row">
        <label>Price (Tk/liter)</label>
        <input class="js-create-price" type="number" min="0" step="0.1" value="132">
      </div>

      <div class="popup-actions">
        <button class="update-btn js-create-ok-btn">OK</button>
      </div>
    </div>
  `;
}

function attachCreatePopupHandlers() {
  const card = document.querySelector('.popup-card[data-create-popup="true"]');
  if (!card) {
    return;
  }

  if (window.L && L.DomEvent) {
    L.DomEvent.disableClickPropagation(card);
    L.DomEvent.disableScrollPropagation(card);
  }

  const nameEl = card.querySelector(".js-create-name");
  const statusEl = card.querySelector(".js-create-status");
  const priceEl = card.querySelector(".js-create-price");
  const okBtn = card.querySelector(".js-create-ok-btn");

  if (!nameEl || !statusEl || !priceEl || !okBtn) {
    return;
  }

  if (okBtn.dataset.bound === "1") {
    return;
  }
  okBtn.dataset.bound = "1";

  okBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const name = nameEl.value.trim() || "Unnamed Fuel Point";
    const parsedPrice = Number(priceEl.value);
    const fuelAvailable = statusEl.value === "yes";

    if (name.length > 120) {
      setStatus("Fuel place name is too long.", true);
      return;
    }

    if (Number.isNaN(parsedPrice) || parsedPrice < 0 || parsedPrice > 500) {
      setStatus("Valid non-negative price din.", true);
      return;
    }

    if (!draftFuelMarker) {
      setStatus("Draft pin missing. Map e abar click korun.", true);
      return;
    }

    const pos = draftFuelMarker.getLatLng();
    const saved = await createFuelStationAt(
      pos.lat,
      pos.lng,
      name,
      parsedPrice,
      fuelAvailable,
    );

    if (saved) {
      currentSearchCenter = { lat: pos.lat, lng: pos.lng };
      showSearchRadius(pos.lat, pos.lng);
      map.flyTo([pos.lat, pos.lng], 14, { duration: 0.8 });
      clearDraftFuelMarker();
      addFuelMode = false;
      addFuelPlaceBtn.classList.remove("active");
      addFuelPlaceBtn.textContent = "Add Fuel Place";
    }
  });
}

async function createFuelStationAt(lat, lng, name, price, fuelAvailable) {
  if (!canWriteToFirebase()) {
    return false;
  }

  if (!isWithinBangladesh(lat, lng)) {
    setStatus("Pin must be inside Bangladesh.", true);
    return false;
  }

  const stationId = `st-${Date.now()}`;
  const payload = {
    name: String(name).trim().slice(0, 120) || "Unnamed Fuel Point",
    lat,
    lng,
    fuelAvailable,
    price: Number(price.toFixed(2)),
    lastUpdate: formatNow(),
  };

  if (db) {
    try {
      await db.collection("stations").doc(stationId).set(payload);
      registerSuccessfulWrite();
      setStatus(`${name} added to Firebase.`);
      return true;
    } catch (error) {
      setStatus(`Firebase add failed: ${humanizeFirebaseError(error)}`, true);
      return false;
    }
  }

  setStatus("Firebase is not connected. Could not add fuel place.", true);
  return false;
}

function pinCurrentLocation() {
  if (!navigator.geolocation) {
    setStatus("Geolocation not supported by this browser.", true);
    return;
  }

  setStatus("Getting your current location...");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      if (myLocationMarker) {
        myLocationMarker.remove();
      }

      myLocationMarker = L.circleMarker([lat, lng], {
        radius: 9,
        color: "#1d4ed8",
        fillColor: "#3b82f6",
        fillOpacity: 0.92,
        weight: 2,
      }).addTo(map);
      myLocationMarker.bindPopup("You are here").openPopup();
      map.flyTo([lat, lng], 14, { duration: 1 });

      currentSearchCenter = { lat, lng };
      showSearchRadius(lat, lng);
      renderAllStations();
      refreshPanels(currentSearchCenter);
      setStatus(`Current location pinned. ${searchRadiusKm} km nearby fuel points shown.`);
    },
    () => {
      setStatus("Could not access current location. Allow location permission.", true);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function formatNow() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthKm * c;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isWithinBangladesh(lat, lng) {
  return lat >= 20.5 && lat <= 26.8 && lng >= 88.0 && lng <= 92.8;
}

function syncRangeFromPreset() {
  const allowed = new Set([1, 5, 10, 25, 50, 100]);
  const value = Number(radiusInput.value);
  if (!allowed.has(value)) {
    setStatus("Please select a valid range option.", true);
    return false;
  }

  searchRadiusKm = value;
  updateRangeLabels();

  showSearchRadius(currentSearchCenter.lat, currentSearchCenter.lng);
  renderAllStations();
  refreshPanels(currentSearchCenter);
  return true;
}

function updateRangeLabels() {
  if (subtitleText) {
    subtitleText.textContent = `Search any place in Bangladesh and instantly see fuel stations within ${searchRadiusKm} km.`;
  }
  if (nearbyHeading) {
    nearbyHeading.textContent = `Nearby Fuel Stations (${searchRadiusKm} km)`;
  }
}

function normalizeStationDoc(id, raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const name = String(raw.name ?? "").trim();
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  const price = Number(raw.price);
  const fuelAvailable = Boolean(raw.fuelAvailable);
  const lastUpdate = String(raw.lastUpdate ?? "").trim();

  if (!name || name.length > 120) {
    return null;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isWithinBangladesh(lat, lng)) {
    return null;
  }
  if (!Number.isFinite(price) || price < 0 || price > 500) {
    return null;
  }

  return {
    id,
    name,
    lat,
    lng,
    fuelAvailable,
    price,
    lastUpdate: lastUpdate || "N/A",
  };
}

function getWriteCount() {
  try {
    const raw = localStorage.getItem(WRITE_COUNT_STORAGE_KEY);
    const count = Number(raw);
    if (!Number.isFinite(count) || count < 0) {
      return 0;
    }
    return Math.floor(count);
  } catch {
    return 0;
  }
}

function canWriteToFirebase() {
  const used = getWriteCount();
  if (used >= WRITE_LIMIT_PER_BROWSER) {
    setStatus("Write limit reached for this browser (max 5).", true);
    return false;
  }
  return true;
}

function registerSuccessfulWrite() {
  const used = getWriteCount();
  const next = Math.min(WRITE_LIMIT_PER_BROWSER, used + 1);
  try {
    localStorage.setItem(WRITE_COUNT_STORAGE_KEY, String(next));
  } catch {
    // Ignore storage failures and keep app functional.
  }
}
