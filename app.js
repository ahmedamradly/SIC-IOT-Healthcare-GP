// --- 1. FIREBASE INITIALIZATION ---
const firebaseConfig = {
  apiKey: "AIzaSyCa0PnO-hBUtVUoBKKNCBvC59_ZDIGJIQY",
  authDomain: "sic-task1-lab-2.firebaseapp.com",
  databaseURL: "https://sic-task1-lab-2-default-rtdb.firebaseio.com",
  projectId: "sic-task1-lab-2",
  storageBucket: "sic-task1-lab-2.firebasestorage.app",
  messagingSenderId: "305141697364",
  appId: "1:305141697364:web:8c5b084e7235a39eb88034"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// --- 2. DOM REFERENCES ---
const tempDisplay = document.getElementById("temp-display");
const bpmDisplay = document.getElementById("bpm-display");
const spo2Display = document.getElementById("spo2-display");
const lastUpdateDisplay = document.getElementById("last-update");
const deviceBadge = document.getElementById("device-status-badge");

const wearBadge = document.getElementById("wear-badge");
const wearDescription = document.getElementById("wear-description");
const wearIcon = document.getElementById("wear-icon");

const conditionBadge = document.getElementById("patient-condition-badge");
const conditionAdvice = document.getElementById("condition-advice");
const emergencyBanner = document.getElementById("emergency-banner");

const activeUserSelect = document.getElementById("active-user-select");
const statsTargetName = document.getElementById("stats-target-name");
const chartTitle = document.getElementById("chart-title");

const registeredConditionBadge = document.getElementById("registered-condition-badge");
const registeredConditionDesc = document.getElementById("registered-condition-desc");

const statAvg = document.getElementById("stat-avg");
const statStd = document.getElementById("stat-std");
const statMin = document.getElementById("stat-min");
const statMax = document.getElementById("stat-max");

let currentActiveMetric = "temperature";
let selectedUserId = "";
let registeredUsersMap = {};
let cachedHistory = [];
let latestLivePoint = null;
let historyRefSubscription = null;

// --- 3. CHART CONFIGURATION ---
const ctx = document.getElementById("telemetryChart").getContext("2d");
const telemetryChart = new Chart(ctx, {
  type: "line",
  data: {
    labels: [],
    datasets: [{
      label: "Temperature (°C)",
      data: [],
      borderColor: "#38bdf8",
      backgroundColor: "rgba(56, 189, 248, 0.15)",
      borderWidth: 2,
      fill: true,
      tension: 0.35,
      pointRadius: 4
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { ticks: { color: "#94a3b8" }, grid: { color: "#24304f" } },
      y: { ticks: { color: "#94a3b8" }, grid: { color: "#24304f" } }
    },
    plugins: {
      legend: { labels: { color: "#f8fafc" } }
    }
  }
});

// Metric Tabs
document.querySelectorAll(".chart-tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".chart-tab").forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    currentActiveMetric = button.dataset.metric;
    renderAggregatedData();
  });
});

// --- 4. WEAR STATUS LOGIC ---
function updateWearUI(isWearing) {
  if (!wearBadge) return;
  if (isWearing) {
    wearBadge.className = "badge-wear wearing";
    wearBadge.textContent = "Wearing";
    if (wearDescription) wearDescription.textContent = "Sensor firmly attached and acquiring pulse signal.";
    if (wearIcon) wearIcon.textContent = "🫀";
  } else {
    wearBadge.className = "badge-wear not-wearing";
    wearBadge.textContent = "Not Wearing";
    if (wearDescription) wearDescription.textContent = "Sensor detached or no finger/wrist contact detected.";
    if (wearIcon) wearIcon.textContent = "⚠️";
  }
}

db.ref("iot/wear_status").on("value", (snapshot) => {
  const val = snapshot.val();
  if (val !== null) {
    const isWearing = typeof val === "object" ? Boolean(val.is_wearing) : Boolean(val);
    updateWearUI(isWearing);
  }
});

// --- 5. CLINICAL CONDITION EVALUATION ---
function evaluateHealthConditions(temp, bpm, spo2) {
  let isCritical = false;
  let isAttention = false;
  let advice = "All tracked vitals within healthy thresholds.";

  if ((temp && temp >= 39.0) || (bpm && (bpm >= 120 || bpm <= 45)) || (spo2 && spo2 < 90)) {
    isCritical = true;
    advice = "Alert: Critical vitals detected! Seek urgent medical assistance.";
  } else if ((temp && temp >= 37.5) || (bpm && (bpm >= 100 || bpm <= 55)) || (spo2 && spo2 < 95)) {
    isAttention = true;
    advice = "Attention: Elevated vital readings observed. Monitor closely.";
  }

  if (isCritical) {
    conditionBadge.className = "condition-badge state-critical";
    conditionBadge.textContent = "CRITICAL";
    emergencyBanner.classList.remove("hidden");
  } else if (isAttention) {
    conditionBadge.className = "condition-badge state-attention";
    conditionBadge.textContent = "NEEDS ATTENTION";
    emergencyBanner.classList.add("hidden");
  } else {
    conditionBadge.className = "condition-badge state-normal";
    conditionBadge.textContent = "NORMAL";
    emergencyBanner.classList.add("hidden");
  }
  conditionAdvice.textContent = advice;
}

// --- 6. LIVE TELEMETRY INGESTION ---
db.ref("iot/current").on("value", (snapshot) => {
  const data = snapshot.val();
  if (!data) return;

  const rawTemp = data.temperature !== undefined ? data.temperature : data.temp;
  const temp = (rawTemp !== undefined && rawTemp !== null) ? Number(rawTemp) : null;

  const rawBpm = data.heart_rate !== undefined ? data.heart_rate : 
                 (data.bpm !== undefined ? data.bpm : 
                 (data.hr !== undefined ? data.hr : 
                 (data.pulse !== undefined ? data.pulse : data.heartRate)));
  const bpm = (rawBpm !== undefined && rawBpm !== null) ? Number(rawBpm) : null;

  const rawSpo2 = data.spo2 !== undefined ? data.spo2 : 
                  (data.SpO2 !== undefined ? data.SpO2 : 
                  (data.o2 !== undefined ? data.o2 : data.oxygen));
  const spo2 = (rawSpo2 !== undefined && rawSpo2 !== null) ? Number(rawSpo2) : null;

  if (temp !== null && !isNaN(temp)) tempDisplay.textContent = `${temp.toFixed(1)} °C`;
  if (bpm !== null && !isNaN(bpm)) bpmDisplay.textContent = `${Math.round(bpm)} BPM`;
  if (spo2 !== null && !isNaN(spo2)) spo2Display.textContent = `${Math.round(spo2)} %`;

  if (data.is_wearing !== undefined || data.wearing !== undefined || data.finger_detected !== undefined) {
    const isWearing = Boolean(data.is_wearing ?? data.wearing ?? data.finger_detected);
    updateWearUI(isWearing);
  }

  const rawTime = data.timestamp || data.time;
  if (rawTime) {
    lastUpdateDisplay.textContent = `Last sync: ${new Date(rawTime).toLocaleTimeString()}`;
  }

  deviceBadge.className = "badge online";
  deviceBadge.textContent = "Device: Online";

  evaluateHealthConditions(temp, bpm, spo2);

  latestLivePoint = {
    temperature: temp,
    bpm: bpm,
    spo2: spo2,
    timestamp: rawTime || Date.now()
  };

  renderAggregatedData();
});

// --- 7. PATIENT SELECTOR & DYNAMIC HISTORY DATA PATH ---
function switchPatientTelemetry(userId) {
  selectedUserId = userId;

  // Unsubscribe old listener
  if (historyRefSubscription) {
    historyRefSubscription.off();
  }

  let patientName = "Global / Device";
  let historyPath = "iot/history";
  let baselineState = "Normal";

  if (selectedUserId && registeredUsersMap[selectedUserId]) {
    const user = registeredUsersMap[selectedUserId];
    patientName = user.name;
    baselineState = user.condition || "Normal";
    historyPath = `patients/${selectedUserId}/history`;
    if (registeredConditionDesc) {
      registeredConditionDesc.textContent = `Baseline assigned to ${user.name} (${user.age} yrs).`;
    }
  } else {
    if (registeredConditionDesc) {
      registeredConditionDesc.textContent = "Global default state / No patient selected.";
    }
  }

  // Update Registered Baseline Card Badge
  if (registeredConditionBadge) {
    const safeTagClass = baselineState.toLowerCase().includes("crit") ? "state-critical" :
                         baselineState.toLowerCase().includes("attent") ? "state-attention" : "state-normal";
    registeredConditionBadge.className = `condition-badge ${safeTagClass}`;
    registeredConditionBadge.textContent = baselineState.toUpperCase();
  }

  statsTargetName.textContent = patientName;
  chartTitle.textContent = `${patientName} - Telemetry Trend`;

  // Update active highlight in directory
  document.querySelectorAll(".user-list li").forEach((li) => {
    li.classList.toggle("active-row", li.dataset.uid === selectedUserId);
  });

  // Attach listener to historical records for this patient
  historyRefSubscription = db.ref(historyPath).limitToLast(20);
  historyRefSubscription.on("value", (snapshot) => {
    const historyData = snapshot.val();
    cachedHistory = [];

    if (historyData) {
      Object.values(historyData).forEach((entry) => {
        if (typeof entry !== "object" || entry === null) return;

        const rawTemp = entry.temperature !== undefined ? entry.temperature : entry.temp;
        const tempVal = (rawTemp !== undefined && rawTemp !== null && !isNaN(rawTemp)) ? Number(rawTemp) : null;

        const rawBpm = entry.heart_rate !== undefined ? entry.heart_rate : 
                       (entry.bpm !== undefined ? entry.bpm : 
                       (entry.hr !== undefined ? entry.hr : 
                       (entry.pulse !== undefined ? entry.pulse : entry.heartRate)));
        const bpmVal = (rawBpm !== undefined && rawBpm !== null && !isNaN(rawBpm)) ? Number(rawBpm) : null;

        const rawSpo2 = entry.spo2 !== undefined ? entry.spo2 : 
                        (entry.SpO2 !== undefined ? entry.SpO2 : 
                        (entry.o2 !== undefined ? entry.o2 : entry.oxygen));
        const spo2Val = (rawSpo2 !== undefined && rawSpo2 !== null && !isNaN(rawSpo2)) ? Number(rawSpo2) : null;

        cachedHistory.push({
          temperature: tempVal,
          bpm: bpmVal,
          spo2: spo2Val,
          timestamp: entry.timestamp || entry.time || null
        });
      });
    }

    renderAggregatedData();
  });
}

// Dropdown change listener
activeUserSelect.addEventListener("change", (e) => {
  switchPatientTelemetry(e.target.value);
});

// --- 8. STATISTICAL CALCULATION & CHART UPDATING ---
function renderAggregatedData() {
  const metricConfigs = {
    temperature: { label: "Temperature (°C)", color: "#38bdf8", fill: "rgba(56, 189, 248, 0.15)", unit: "°C" },
    bpm: { label: "Heart Rate (BPM)", color: "#f43f5e", fill: "rgba(244, 63, 94, 0.15)", unit: "BPM" },
    spo2: { label: "SpO2 Oxygen (%)", color: "#22c55e", fill: "rgba(34, 197, 94, 0.15)", unit: "%" }
  };

  const currentCfg = metricConfigs[currentActiveMetric];
  telemetryChart.data.datasets[0].label = currentCfg.label;
  telemetryChart.data.datasets[0].borderColor = currentCfg.color;
  telemetryChart.data.datasets[0].backgroundColor = currentCfg.fill;

  const combinedRecords = [...cachedHistory];
  // Include latest live point only for device-wide telemetry or when active
  if (!selectedUserId && latestLivePoint && latestLivePoint[currentActiveMetric] !== null && !isNaN(latestLivePoint[currentActiveMetric])) {
    combinedRecords.push(latestLivePoint);
  }

  const validLabels = [];
  const validData = [];

  combinedRecords.forEach((row) => {
    const val = row[currentActiveMetric];
    if (val !== null && !isNaN(val)) {
      const timeStr = row.timestamp 
        ? new Date(row.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : "--:--";
      validLabels.push(timeStr);
      validData.push(val);
    }
  });

  telemetryChart.data.labels = validLabels;
  telemetryChart.data.datasets[0].data = validData;
  telemetryChart.update();

  if (validData.length === 0) {
    statAvg.textContent = "--";
    statStd.textContent = "--";
    statMin.textContent = "--";
    statMax.textContent = "--";
    return;
  }

  const count = validData.length;
  const min = Math.min(...validData);
  const max = Math.max(...validData);
  const mean = validData.reduce((acc, curr) => acc + curr, 0) / count;
  const variance = validData.reduce((acc, curr) => acc + Math.pow(curr - mean, 2), 0) / count;
  const stdDev = Math.sqrt(variance);

  statAvg.textContent = `${mean.toFixed(1)} ${currentCfg.unit}`;
  statStd.textContent = `±${stdDev.toFixed(1)}`;
  statMin.textContent = `${min.toFixed(1)} ${currentCfg.unit}`;
  statMax.textContent = `${max.toFixed(1)} ${currentCfg.unit}`;
}

// --- 9. USER MANAGEMENT & PROFILE DIRECTORY ---
const userForm = document.getElementById("user-form");
const userList = document.getElementById("user-list");

if (userForm) {
  userForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("user-name").value;
    const age = document.getElementById("user-age").value;
    const gender = document.getElementById("user-gender").value;
    const baseline = document.getElementById("user-baseline-condition").value;

    db.ref("users").push({
      name,
      age,
      gender,
      condition: baseline,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });

    userForm.reset();
  });
}

db.ref("users").on("value", (snapshot) => {
  if (!userList) return;
  userList.innerHTML = "";
  registeredUsersMap = {};

  const currentSelection = activeUserSelect.value;
  activeUserSelect.innerHTML = `<option value="">-- Device / Global View --</option>`;

  const users = snapshot.val();
  if (!users) return;

  Object.entries(users).forEach(([userId, user]) => {
    registeredUsersMap[userId] = user;

    // Add option to dropdown selector
    const opt = document.createElement("option");
    opt.value = userId;
    opt.textContent = `${user.name} (${user.age} yrs)`;
    activeUserSelect.appendChild(opt);

    // Add entry to sidebar directory
    const li = document.createElement("li");
    li.dataset.uid = userId;
    if (userId === selectedUserId) li.classList.add("active-row");

    const tagClass = (user.condition || "Normal").replace(/\s+/g, '-');
    li.innerHTML = `
      <span><strong>${user.name}</strong> (${user.age} yrs, ${user.gender || 'N/A'})</span>
      <span class="user-tag ${tagClass}">${user.condition}</span>
    `;

    // Clicking a profile activates that patient's session
    li.addEventListener("click", () => {
      activeUserSelect.value = userId;
      switchPatientTelemetry(userId);
    });

    userList.appendChild(li);
  });

  if (currentSelection && registeredUsersMap[currentSelection]) {
    activeUserSelect.value = currentSelection;
  }
});

// Start on Global/Device mode
switchPatientTelemetry("");