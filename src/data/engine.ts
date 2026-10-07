// ---- Types ----
export type NodeStatus = 'healthy' | 'warning' | 'critical' | 'offline';
export type Severity = 'CRITICAL' | 'WARNING' | 'NOTICE' | 'INFORMATION';
export type EventStatus = 'ACTIVE' | 'INVESTIGATING' | 'ACKNOWLEDGED' | 'RESOLVED';
export type NetworkState = 'LIVE' | 'DEGRADED' | 'PARTIAL OUTAGE';

export interface Reading {
  temperature: number; humidity: number; pressure: number; co2: number;
  pm1: number; pm25: number; pm10: number; aqi: number; light: number;
  windSpeed: number; windDir: number;
  rainfall: number; battery: number; signal: number;
}

/* Actual sensor stack */
export const SENSOR_STACK: { parameter: string; model: string }[] = [
  { parameter: 'Temperature & Humidity', model: 'SHT35' },
  { parameter: 'Barometric Pressure', model: 'BMP390' },
  { parameter: 'Rainfall', model: 'Tipping Bucket Rain Sensor' },
  { parameter: 'Light Intensity', model: 'BH1750' },
  { parameter: 'Particulate Matter (PM1, PM2.5, PM10)', model: 'PMS5003' },
  { parameter: 'CO₂', model: 'SCD41' },
  { parameter: 'Wind', model: 'Ultrasonic Anemometer' },
];

/* US EPA PM2.5 → AQI breakpoints (derived, not a separate sensor) */
function aqiFromPm25(pm: number): number {
  const bp: [number, number, number, number][] = [
    [0, 12.0, 0, 50], [12.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200], [150.5, 250.4, 201, 300], [250.5, 500.4, 301, 500],
  ];
  for (const [cLo, cHi, iLo, iHi] of bp) if (pm <= cHi) return Math.round(((iHi - iLo) / (cHi - cLo)) * (pm - cLo) + iLo);
  return 500;
}

export interface SensorNode {
  id: string; areaId: number; name: string; x: number; y: number;
  status: NodeStatus; firmware: string; uptimeDays: number; lastMaintenance: string;
  sensorIntegrity: number; packetLoss: number; lastSeenSec: number; baselineTemp: number;
  anomaly?: NodeStatus; signal: number; battery: number;
  reading: Reading; history: { t: string; temperature: number; humidity: number; pressure: number; aqi: number; co2: number; pm25: number }[];
}

export interface Area {
  id: number; label: string; x: number; y: number; path: string;
  status: 'HEALTHY' | 'ELEVATED' | 'CRITICAL';
}

export interface BlackBoxEvent {
  id: string; ts: number; areaId: number; nodeId: string; type: string;
  severity: Severity; status: EventStatus; measured: string; expected: string;
  deviation: string; duration: string; confidence: number; sensors: string[];
  explanation: { observed: string; expectedRange: string; deviation: string; probability: string; correlations: string[]; conclusion: string };
}

// ---- Deterministic PRNG for stable layout ----
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(42);
const rr = (a: number, b: number) => a + rnd() * (b - a);

// ---- Area blob paths on a 5x3 layout ----
const GRID: { cx: number; cy: number }[] = [];
for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) GRID.push({ cx: 120 + c * 170, cy: 100 + r * 140 });

function blob(cx: number, cy: number): string {
  const pts: string[] = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = 78 + rr(-14, 14);
    pts.push(`${(cx + Math.cos(a) * rad * 1.05).toFixed(1)},${(cy + Math.sin(a) * rad * 0.8).toFixed(1)}`);
  }
  return `M${pts[0]} ` + pts.slice(1).map(p => `L${p}`).join(' ') + ' Z';
}

export const AREAS: Area[] = GRID.map((g, i) => ({
  id: i + 1, label: `Area ${String(i + 1).padStart(2, '0')}`, x: g.cx, y: g.cy,
  path: blob(g.cx, g.cy),
  status: i === 12 ? 'CRITICAL' : i === 8 ? 'ELEVATED' : i === 3 ? 'ELEVATED' : 'HEALTHY',
}));

// ---- Nodes ----
const AREA_TEMP: Record<number, number> = { 1: 22, 2: 24, 3: 29, 4: 20, 5: 26, 6: 27, 7: 30, 8: 25, 9: 31, 10: 21, 11: 23, 12: 33, 13: 27, 14: 19, 15: 28 };

export const NODES: SensorNode[] = [];
let idc = 0;
AREAS.forEach((a) => {
  const count = a.id === 13 ? 8 : a.id === 4 ? 10 : a.id === 7 ? 11 : a.id === 9 ? 8 : a.id === 12 ? 10 : Math.floor(rr(6, 11));
  for (let n = 1; n <= count; n++) {
    idc++;
    const angle = rr(0, Math.PI * 2), dist = rr(10, 62);
    const x = a.x + Math.cos(angle) * dist * 1.4, y = a.y + Math.sin(angle) * dist * 0.85;
    const offline = rnd() < 0.03;
    const critical = a.id === 13 && n === 6;
    const warning = !critical && rnd() < 0.08;
    const status: NodeStatus = offline ? 'offline' : critical ? 'critical' : warning ? 'warning' : 'healthy';
    const base = AREA_TEMP[a.id] + rr(-2, 2);
    const pm25Base = Math.round(rr(5, 30));
    const reading: Reading = {
      temperature: critical ? 34.2 : base + rr(-1, 1),
      humidity: Math.max(20, Math.min(95, 75 - (AREA_TEMP[a.id] - 15) * 1.2 + rr(-6, 6))),
      pressure: 1003 + rr(-8, 8), co2: Math.round(rr(410, 700)),
      pm1: Math.round(pm25Base * rr(0.5, 0.8)), pm25: pm25Base, pm10: Math.round(pm25Base * rr(1.4, 2.2)),
      aqi: aqiFromPm25(pm25Base), light: Math.round(rr(150, 25000)),
      windSpeed: rr(0.5, 6.5), windDir: Math.round(rr(0, 359)),
      rainfall: a.id === 4 ? rr(1, 6) : rr(0, 1.5), battery: Math.round(rr(55, 100)), signal: Math.round(rr(-85, -50)),
    };
    if (a.id === 9 && n === 2) { reading.pm25 = 61; reading.pm10 = 83; reading.pm1 = 38; reading.aqi = aqiFromPm25(61); }
    const history = Array.from({ length: 24 }, (_, i) => ({
      t: `${String(13 + Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}:00`,
      temperature: +(reading.temperature - rr(0.6, 1.4)).toFixed(1),
      humidity: +(reading.humidity + rr(-3, 3)).toFixed(1),
      pressure: +(reading.pressure + rr(-1, 1)).toFixed(1),
      aqi: Math.round(reading.aqi + rr(-6, 6)), co2: Math.round(reading.co2 + rr(-20, 20)),
      pm25: Math.round(reading.pm25 + rr(-4, 4)),
    }));
    NODES.push({
      id: `A${String(a.id).padStart(2, '0')}-N${String(n).padStart(2, '0')}`, areaId: a.id,
      name: `Area ${String(a.id).padStart(2, '0')} · Node ${String(n).padStart(2, '0')}`,
      x, y, status, firmware: `v2.${Math.floor(rr(5, 8))}.${Math.floor(rr(10, 20))}`,
      uptimeDays: Math.floor(rr(5, 90)), lastMaintenance: `${Math.floor(rr(2, 30))} days ago`,
      sensorIntegrity: Math.round(rr(88, 100)), packetLoss: +rr(0.1, 2.4).toFixed(1),
      lastSeenSec: Math.round(rr(1, 5)), baselineTemp: base, anomaly: status === 'healthy' ? undefined : status,
      signal: reading.signal, battery: reading.battery, reading, history,
    });
  }
});

export const nodeById = (id: string) => NODES.find(n => n.id === id)!;
export const nodesInArea = (areaId: number) => NODES.filter(n => n.areaId === areaId);

// ---- Events ----
const now = Date.now();
const ago = (s: number) => now - s * 1000;
export const EVENTS: BlackBoxEvent[] = [
  { id: 'EVT-A13-N06-20261003-143208', ts: ago(222), areaId: 13, nodeId: 'A13-N06', type: 'Temperature spike', severity: 'CRITICAL', status: 'ACTIVE', measured: '34.2 °C', expected: '23.1–25.8 °C', deviation: '+9.1 °C', duration: '03m 42s', confidence: 96, sensors: ['Temperature', 'Humidity', 'Pressure', 'Wind'],
    explanation: { observed: '34.2 °C', expectedRange: '23.1–25.8 °C', deviation: '+9.1 °C', probability: '0.8 %', correlations: ['Humidity fell 11 %', 'Pressure fell 4 hPa', 'Wind direction shifted 31°', 'Adjacent Node 05 also reported +5.2 °C'], conclusion: 'Pattern differs significantly from the expected environmental baseline.' } },
  { id: 'EVT-A13-N04-20261003-141841', ts: ago(827), areaId: 13, nodeId: 'A13-N04', type: 'Humidity deviation', severity: 'WARNING', status: 'INVESTIGATING', measured: '91 %', expected: '60–72 %', deviation: '+19 %', duration: '12m 05s', confidence: 84, sensors: ['Humidity'],
    explanation: { observed: '91 %', expectedRange: '60–72 %', deviation: '+19 %', probability: '3.1 %', correlations: ['Local rainfall sensor dry', 'Pressure stable'], conclusion: 'Localized moisture increase without matching regional rainfall.' } },
  { id: 'EVT-A13-N07-20261003-135209', ts: ago(2399), areaId: 13, nodeId: 'A13-N07', type: 'Pressure anomaly', severity: 'NOTICE', status: 'RESOLVED', measured: '988 hPa', expected: '1000–1008 hPa', deviation: '-14 hPa', duration: '26m 10s', confidence: 78, sensors: ['Pressure'],
    explanation: { observed: '988 hPa', expectedRange: '1000–1008 hPa', deviation: '-14 hPa', probability: '6.4 %', correlations: ['Wind speed +6 km/h'], conclusion: 'Short-lived pressure dip, now returning to baseline.' } },
  { id: 'EVT-A09-N02-20261003-124721', ts: ago(6419), areaId: 9, nodeId: 'A09-N02', type: 'PM2.5 spike', severity: 'WARNING', status: 'MONITORING' as EventStatus, measured: '61 µg/m³', expected: '8–18 µg/m³', deviation: '3.8× baseline', duration: '47m 12s', confidence: 91, sensors: ['PM2.5', 'PM10', 'AQI'],
    explanation: { observed: '61 µg/m³', expectedRange: '8–18 µg/m³', deviation: '3.8× baseline', probability: '1.9 %', correlations: ['AQI rose to 143', 'PM10 +22 µg/m³', 'PM1 elevated', 'Downwind of Area 12'], conclusion: 'Particulate elevation consistent with a localized emission source.' } },
  { id: 'EVT-A04-N03-20261003-113219', ts: ago(9761), areaId: 4, nodeId: 'A04-N03', type: 'Unexpected rainfall', severity: 'NOTICE', status: 'RESOLVED', measured: '4.8 mm/hr', expected: '0 mm/hr', deviation: '+4.8 mm/hr', duration: '18m 44s', confidence: 88, sensors: ['Rainfall', 'Humidity', 'Light intensity'],
    explanation: { observed: '4.8 mm/hr', expectedRange: '0 mm/hr', deviation: '+4.8 mm/hr', probability: '4.7 %', correlations: ['Humidity +14 %', 'Light intensity +30 %'], conclusion: 'Isolated precipitation cell; network average unchanged.' } },
  { id: 'EVT-A12-N05-20261003-104406', ts: ago(12362), areaId: 12, nodeId: 'A12-N05', type: 'CO₂ deviation', severity: 'WARNING', status: 'ACKNOWLEDGED', measured: '812 ppm', expected: '410–520 ppm', deviation: '+290 ppm', duration: '1h 12m', confidence: 82, sensors: ['CO₂'],
    explanation: { observed: '812 ppm', expectedRange: '410–520 ppm', deviation: '+290 ppm', probability: '2.6 %', correlations: ['Night-time inversion likely', 'PM2.5 slightly elevated'], conclusion: 'CO₂ accumulation consistent with stagnant nighttime air.' } },
  { id: 'EVT-A07-N11-20261003-093355', ts: ago(18593), areaId: 7, nodeId: 'A07-N11', type: 'Wind anomaly', severity: 'NOTICE', status: 'RESOLVED', measured: '10.6 m/s', expected: '2–5 m/s', deviation: '+6.1 m/s', duration: '09m 31s', confidence: 74, sensors: ['Wind speed', 'Wind direction'],
    explanation: { observed: '10.6 m/s', expectedRange: '2–5 m/s', deviation: '+6.1 m/s', probability: '7.9 %', correlations: ['Direction shifted 45°'], conclusion: 'Gust front passage, self-corrected.' } },
];
// fix MONITORING status
EVENTS.forEach(e => { if ((e.status as string) === 'MONITORING') e.status = 'INVESTIGATING'; });

// ---- Simulation tick ----
export function tick() {
  const t = new Date();
  const time = t.toLocaleTimeString('en-GB');
  NODES.forEach(n => {
    if (n.status === 'offline') { n.lastSeenSec += 2; return; }
    n.lastSeenSec = Math.round(rr(1, 4));
    const r = n.reading;
    const drift = (v: number, amp: number, min: number, max: number) => Math.max(min, Math.min(max, v + (Math.random() - 0.5) * amp));
    // controlled anomaly on A13-N06
    if (n.id === 'A13-N06') {
      r.temperature = Math.min(35.4, r.temperature + 0.15 + Math.random() * 0.2);
      r.humidity = Math.max(38, r.humidity - 0.4);
      r.pressure = Math.max(996, r.pressure - 0.1);
      n.status = 'critical';
    } else {
      r.temperature = drift(r.temperature, 0.5, n.baselineTemp - 3, n.baselineTemp + 3);
    }
    r.humidity = drift(r.humidity, 1.2, 15, 98);
    r.pressure = drift(r.pressure, 0.4, 985, 1025);
    r.co2 = Math.round(drift(r.co2, 14, 400, 1200));
    r.pm25 = Math.round(drift(r.pm25, 2.4, 2, 80));
    r.pm1 = Math.round(drift(r.pm1, 1.8, 1, 60));
    r.pm10 = Math.round(drift(r.pm10, 3.2, 4, 140));
    r.aqi = aqiFromPm25(r.pm25);
    r.light = Math.round(drift(r.light, 900, 5, 60000));
    r.windSpeed = drift(r.windSpeed, 0.8, 0, 18);
    r.battery = Math.max(30, r.battery - 0.01);
    r.signal = Math.round(drift(r.signal, 3, -95, -48));
    n.battery = Math.round(r.battery); n.signal = r.signal;
    n.history.push({ t: time, temperature: +r.temperature.toFixed(1), humidity: +r.humidity.toFixed(1), pressure: +r.pressure.toFixed(1), aqi: r.aqi, co2: r.co2, pm25: r.pm25 });
    if (n.history.length > 30) n.history.shift();
  });
  return time;
}

export function networkStats() {
  const total = NODES.length;
  const offline = NODES.filter(n => n.status === 'offline').length;
  const critical = NODES.filter(n => n.status === 'critical').length;
  const warning = NODES.filter(n => n.status === 'warning').length;
  const healthy = total - offline - critical - warning;
  return { total, online: total - offline, offline, critical, warning, healthy };
}
